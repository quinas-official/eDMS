import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import Database from 'better-sqlite3';
import type { AuthUser } from '$lib/auth/types';
import { logActivity } from '$lib/server/activity';
import { db } from '$lib/server/db';
import { beginBackup } from '$lib/server/retention';
import { storagePath } from '$lib/server/storage/files';

/**
 * A backup is a gzipped tar archive:
 *
 *   manifest.json   what's inside (see BackupManifest)
 *   database.db     a consistent SQLite snapshot (online backup API)
 *   files/xx/<key>  every file the snapshot's versions point at
 *
 * Restore it with `npm run db:restore -- <archive>` while the server is stopped.
 */

export const BACKUP_FORMAT = 1;

export interface BackupManifest {
	app: 'edms';
	format: number;
	createdAt: string;
	createdBy: string;
	/** Migrations applied to the snapshot; restore refuses a backup newer than the app. */
	migrations: number;
	counts: { users: number; departments: number; documents: number; versions: number };
	files: { count: number; bytes: number; missing: string[] };
}

// ---- Minimal tar (ustar) writer -------------------------------------------------

const BLOCK = 512;

function octal(value: number, width: number) {
	return value.toString(8).padStart(width - 1, '0') + '\0';
}

function tarHeader(name: string, size: number, mtime: Date) {
	if (Buffer.byteLength(name) > 100) throw new Error(`Path too long for tar: ${name}`);
	const header = Buffer.alloc(BLOCK);
	header.write(name, 0, 100, 'utf8');
	header.write(octal(0o644, 8), 100);
	header.write(octal(0, 8), 108);
	header.write(octal(0, 8), 116);
	header.write(octal(size, 12), 124);
	header.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136);
	header.write('        ', 148); // checksum placeholder: eight spaces
	header.write('0', 156); // regular file
	header.write('ustar\0', 257);
	header.write('00', 263);
	let sum = 0;
	for (const byte of header) sum += byte;
	header.write(octal(sum, 7) + ' ', 148);
	return header;
}

const padding = (size: number) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

// ---- Building a backup ----------------------------------------------------------

interface Snapshot {
	dir: string;
	dbPath: string;
	manifest: BackupManifest;
	keys: string[];
}

async function takeSnapshot(actor: AuthUser): Promise<Snapshot> {
	const dir = await mkdtemp(join(tmpdir(), 'edms-backup-'));
	const dbPath = join(dir, 'database.db');
	try {
		// SQLite's online backup: a consistent copy even while requests keep writing.
		await db.$client.backup(dbPath);

		const snap = new Database(dbPath, { readonly: true });
		let manifest: BackupManifest;
		let keys: string[];
		try {
			const n = (sql: string) => (snap.prepare(sql).get() as { n: number }).n;
			keys = (snap.prepare('select storage_key as key from document_versions').all() as { key: string }[]).map(
				(r) => r.key
			);
			manifest = {
				app: 'edms',
				format: BACKUP_FORMAT,
				createdAt: new Date().toISOString(),
				createdBy: actor.name,
				migrations: n('select count(*) as n from __drizzle_migrations'),
				counts: {
					users: n('select count(*) as n from users'),
					departments: n('select count(*) as n from departments'),
					documents: n('select count(*) as n from documents'),
					versions: keys.length
				},
				files: { count: 0, bytes: 0, missing: [] }
			};
		} finally {
			snap.close();
		}

		for (const key of keys) {
			const info = await stat(storagePath(key)).catch(() => null);
			if (info?.isFile()) {
				manifest.files.count++;
				manifest.files.bytes += info.size;
			} else {
				manifest.files.missing.push(key);
			}
		}
		return { dir, dbPath, manifest, keys: keys.filter((k) => !manifest.files.missing.includes(k)) };
	} catch (err) {
		await rm(dir, { recursive: true, force: true });
		throw err;
	}
}

/** One archive entry, read through a handle opened first, so the size in the header is the size streamed. */
async function* fileEntry(name: string, path: string) {
	const handle = await open(path, 'r');
	try {
		const { size, mtime } = await handle.stat();
		yield tarHeader(name, size, mtime);
		let left = size;
		if (size > 0) {
			for await (const chunk of handle.createReadStream({ autoClose: false, end: size - 1 })) {
				left -= (chunk as Buffer).length;
				yield chunk as Buffer;
			}
		}
		if (left !== 0) throw new Error(`${name} changed while it was being backed up`);
		yield padding(size);
	} finally {
		await handle.close();
	}
}

async function* archiveEntries(snapshot: Snapshot) {
	const manifest = Buffer.from(JSON.stringify(snapshot.manifest, null, 2));
	yield tarHeader('manifest.json', manifest.length, new Date());
	yield manifest;
	yield padding(manifest.length);

	yield* fileEntry('database.db', snapshot.dbPath);
	for (const key of snapshot.keys) {
		yield* fileEntry(`files/${key.slice(0, 2)}/${key}`, storagePath(key));
	}
	yield Buffer.alloc(BLOCK * 2); // end-of-archive marker
}

/**
 * Snapshots the database now and streams the archive. Retention purges wait
 * until the stream finishes, so no file the snapshot needs can disappear.
 */
export async function createBackup(actor: AuthUser) {
	const release = beginBackup();
	let snapshot: Snapshot;
	try {
		snapshot = await takeSnapshot(actor);
	} catch (err) {
		release();
		throw err;
	}

	logActivity({
		action: 'backup',
		actor,
		targetType: 'system',
		target: 'Backup',
		details: `${snapshot.manifest.counts.documents} documents, ${snapshot.manifest.files.count} files${
			snapshot.manifest.files.missing.length
				? `; ${snapshot.manifest.files.missing.length} missing from storage`
				: ''
		}`
	});

	const cleanup = () => {
		release();
		rm(snapshot.dir, { recursive: true, force: true }).catch(() => {});
	};
	const gzip = createGzip();
	const source = Readable.from(archiveEntries(snapshot));
	source.on('error', (err) => gzip.destroy(err));
	gzip.on('close', cleanup);
	source.pipe(gzip);

	const stamp = snapshot.manifest.createdAt.slice(0, 19).replace(/[:T]/g, '-');
	return {
		filename: `edms-backup-${stamp}.tar.gz`,
		manifest: snapshot.manifest,
		stream: Readable.toWeb(gzip) as ReadableStream<Uint8Array>
	};
}
