/**
 * Restores a backup made from Settings → Backup (GET /api/backup).
 *
 *   npm run db:restore -- path/to/edms-backup-….tar.gz          # check and describe only
 *   npm run db:restore -- path/to/edms-backup-….tar.gz --yes    # actually restore
 *
 * Stop the server first. The current database and file storage are not
 * deleted: they're renamed to `<name>.before-restore-<timestamp>` next to
 * where they were. Pending migrations run the next time the server starts.
 *
 * The archive is unpacked here rather than with the system `tar`: Windows,
 * Git Bash and Linux ship different tars that disagree about `C:\…` paths.
 */
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { cp, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createGunzip } from 'node:zlib';

const BACKUP_FORMAT = 1;

const args = process.argv.slice(2);
const archive = args.find((a) => !a.startsWith('--'));
const confirmed = args.includes('--yes');

function fail(message: string): never {
	console.error(`\n✗ ${message}\n`);
	process.exit(1);
}

if (!archive) fail('Usage: npm run db:restore -- <backup.tar.gz> [--yes]');
const archivePath = resolve(archive);
if (!existsSync(archivePath)) fail(`No such file: ${archivePath}`);

const dbPath = resolve(process.env.DATABASE_URL ?? 'data/edms.db');
const storageDir = resolve(process.env.STORAGE_DIR || 'data/files');

// ---- Refuse while the server is up ------------------------------------------------

const port = process.env.PORT ?? '3000';
// `localhost`, not 127.0.0.1: a server bound to ::1 only would be missed.
const running = await fetch(`http://localhost:${port}/api/health`, {
	signal: AbortSignal.timeout(1500)
})
	.then((r) => r.ok)
	.catch(() => false);
if (running) fail(`A server is answering on port ${port}. Stop it before restoring.`);

// ---- Unpack into a staging folder next to the database ----------------------------

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const staging = join(dirname(dbPath), `.restore-${stamp}`);
await mkdir(staging, { recursive: true });

async function cleanStaging() {
	await rm(staging, { recursive: true, force: true });
}

/**
 * Streams a gzipped ustar archive into `dest`. Only the paths a backup
 * contains are accepted, so a crafted archive can't write outside `dest`.
 */
const ALLOWED = /^(manifest\.json|database\.db|files\/[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

async function extract(file: string, dest: string) {
	const input = createReadStream(file).pipe(createGunzip());
	let buf = Buffer.alloc(0);
	let entry: { left: number; pad: number; out: Awaited<ReturnType<typeof open>> } | null = null;

	for await (const chunk of input) {
		buf = buf.length ? Buffer.concat([buf, chunk as Buffer]) : (chunk as Buffer);
		for (;;) {
			if (entry) {
				if (entry.left > 0) {
					if (!buf.length) break;
					const part = buf.subarray(0, Math.min(buf.length, entry.left));
					await entry.out.write(part);
					entry.left -= part.length;
					buf = buf.subarray(part.length);
					if (entry.left > 0) break;
				}
				if (buf.length < entry.pad) break;
				buf = buf.subarray(entry.pad);
				await entry.out.close();
				entry = null;
			}
			if (buf.length < 512) break;
			const header = buf.subarray(0, 512);
			buf = buf.subarray(512);
			if (header.every((b) => b === 0)) return; // end-of-archive marker

			const sum = header.reduce((s, b, i) => s + (i >= 148 && i < 156 ? 32 : b), 0);
			if (sum !== parseInt(header.subarray(148, 156).toString(), 8)) {
				throw new Error('corrupt archive (bad header checksum)');
			}
			const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
			if (!ALLOWED.test(name)) throw new Error(`unexpected entry "${name}"`);
			const size = parseInt(header.subarray(124, 136).toString(), 8);

			const path = join(dest, ...name.split('/'));
			await mkdir(dirname(path), { recursive: true });
			entry = { left: size, pad: (512 - (size % 512)) % 512, out: await open(path, 'wx') };
		}
	}
	await entry?.out.close();
	throw new Error('the archive ends early; the download may have been cut off');
}

try {
	await extract(archivePath, staging);
} catch (err) {
	await cleanStaging();
	fail(`Couldn't unpack the archive: ${(err as Error).message}`);
}

// ---- Check what's inside ----------------------------------------------------------

interface Manifest {
	app: string;
	format: number;
	createdAt: string;
	createdBy: string;
	migrations: number;
	counts: { users: number; departments: number; documents: number; versions: number };
	files: { count: number; bytes: number; missing: string[] };
}

let manifest: Manifest;
try {
	manifest = JSON.parse(readFileSync(join(staging, 'manifest.json'), 'utf8'));
} catch {
	await cleanStaging();
	fail('This is not an eDMS backup (no readable manifest.json).');
}
if (manifest.app !== 'edms') {
	await cleanStaging();
	fail('This is not an eDMS backup.');
}
if (manifest.format !== BACKUP_FORMAT) {
	await cleanStaging();
	fail(`Backup format ${manifest.format} can't be read by this version (expects ${BACKUP_FORMAT}).`);
}
const localMigrations = JSON.parse(
	readFileSync(resolve('drizzle/meta/_journal.json'), 'utf8')
).entries.length as number;
if (manifest.migrations > localMigrations) {
	await cleanStaging();
	fail(
		`The backup comes from a newer version of eDMS (${manifest.migrations} migrations, this one has ${localMigrations}). Update the app first.`
	);
}
if (!existsSync(join(staging, 'database.db'))) {
	await cleanStaging();
	fail('The archive has no database.db.');
}

function countFiles(dir: string): number {
	if (!existsSync(dir)) return 0;
	return readdirSync(dir).reduce((n, name) => {
		const path = join(dir, name);
		return n + (statSync(path).isDirectory() ? countFiles(path) : 1);
	}, 0);
}
const unpackedFiles = countFiles(join(staging, 'files'));
if (unpackedFiles !== manifest.files.count) {
	await cleanStaging();
	fail(`The archive is incomplete: ${unpackedFiles} of ${manifest.files.count} files present.`);
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
console.log(`
Backup from ${manifest.createdAt} by ${manifest.createdBy}
  ${manifest.counts.users} users, ${manifest.counts.departments} departments
  ${manifest.counts.documents} documents, ${manifest.counts.versions} versions
  ${manifest.files.count} files (${mb(manifest.files.bytes)})${
		manifest.files.missing.length
			? `\n  ⚠ ${manifest.files.missing.length} files were already missing when it was made`
			: ''
	}

Restores to
  database  ${dbPath}
  files     ${storageDir}`);

if (!confirmed) {
	await cleanStaging();
	console.log('\nNothing changed. Run again with --yes to restore.\n');
	process.exit(0);
}

// ---- Swap in, keeping what was there -----------------------------------------------

/** rename, falling back to copy + delete when the target is on another drive. */
async function move(from: string, to: string) {
	try {
		await rename(from, to);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
		await cp(from, to, { recursive: true });
		await rm(from, { recursive: true, force: true });
	}
}

const kept: string[] = [];
for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, storageDir]) {
	if (!existsSync(path)) continue;
	const aside = `${path}.before-restore-${stamp}`;
	await move(path, aside);
	kept.push(aside);
}

await mkdir(dirname(dbPath), { recursive: true });
await move(join(staging, 'database.db'), dbPath);
if (existsSync(join(staging, 'files'))) {
	await mkdir(dirname(storageDir), { recursive: true });
	await move(join(staging, 'files'), storageDir);
} else {
	await mkdir(storageDir, { recursive: true });
}
await cleanStaging();

console.log(`
✓ Restored. Start the server; any pending migrations run on startup.
${kept.length ? `\nThe previous data was kept at:\n${kept.map((p) => `  ${p}`).join('\n')}\nDelete it once you're happy with the restore.\n` : ''}`);
