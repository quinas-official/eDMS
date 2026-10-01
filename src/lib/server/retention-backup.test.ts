import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '$lib/auth/types';
import { DEFAULT_SETTINGS, type AppSettings } from '$lib/settings/types';

// A fresh in-memory database and a throwaway storage folder.
const storage = mkdtempSync(join(tmpdir(), 'edms-test-files-'));
vi.mock('$env/dynamic/private', () => ({
	env: { DATABASE_URL: ':memory:', STORAGE_DIR: storage }
}));

const { db, runMigrations, schema } = await import('$lib/server/db');
const { saveFile, storagePath } = await import('./storage/files');
const { runRetention, beginBackup } = await import('./retention');
const { createBackup } = await import('./backup');

const DAY = 86_400_000;
const now = new Date('2026-10-01T12:00:00Z');
let admin: AuthUser;
let n = 0;

async function addDocument(opts: {
	status: 'draft' | 'pending' | 'reviewed' | 'approved' | 'rejected';
	updatedDaysAgo: number;
	deletedDaysAgo?: number;
	content?: string;
}) {
	const stored = await saveFile(new TextEncoder().encode(opts.content ?? `file ${++n}`));
	const doc = db
		.insert(schema.documents)
		.values({
			reference: `T-${++n}`,
			title: `Doc ${n}`,
			status: opts.status,
			ownerId: admin.id,
			deletedAt: opts.deletedDaysAgo === undefined ? null : new Date(now.getTime() - opts.deletedDaysAgo * DAY)
		})
		.returning()
		.get();
	db.insert(schema.documentVersions)
		.values({
			documentId: doc.id,
			versionNumber: 1,
			storageKey: stored.storageKey,
			originalName: `doc-${n}.txt`,
			mimeType: 'text/plain',
			size: stored.size,
			sha256: stored.sha256
		})
		.run();
	// `updatedAt` is set by $onUpdate, so backdate it with raw SQL.
	db.$client
		.prepare('update documents set updated_at = ? where id = ?')
		.run(now.getTime() - opts.updatedDaysAgo * DAY, doc.id);
	return { id: doc.id, key: stored.storageKey };
}

const docRow = (id: string) => db.select().from(schema.documents).all().find((d) => d.id === id);

function settings(patch: (s: AppSettings) => void) {
	const s = structuredClone(DEFAULT_SETTINGS);
	patch(s);
	return s;
}

beforeAll(() => {
	expect(db.$client.name).toBe(':memory:');
	runMigrations(db);
	const row = db
		.insert(schema.users)
		.values({ username: 'admin', name: 'Admin', passwordHash: 'x', role: 'admin' })
		.returning()
		.get();
	admin = {
		id: row.id,
		username: 'admin',
		name: 'Admin',
		role: 'admin',
		departmentId: null,
		department: null,
		permissions: ['view', 'upload', 'approve', 'delete']
	};
});

describe('runRetention', () => {
	it('archives only settled documents untouched for long enough, and only when enabled', async () => {
		const oldApproved = await addDocument({ status: 'approved', updatedDaysAgo: 400 });
		const oldPending = await addDocument({ status: 'pending', updatedDaysAgo: 400 });
		const recent = await addDocument({ status: 'draft', updatedDaysAgo: 10 });

		const off = await runRetention(now, settings(() => {}));
		expect(off.archived).toBe(0);

		const on = await runRetention(
			now,
			settings((s) => {
				s.retention.autoArchiveEnabled = true;
				s.retention.archiveAfterDays = 365;
			})
		);
		expect(on.archived).toBe(1);
		expect(docRow(oldApproved.id)?.archivedAt).not.toBeNull();
		expect(docRow(oldPending.id)?.archivedAt).toBeNull();
		expect(docRow(recent.id)?.archivedAt).toBeNull();
	});

	it('purges documents deleted longer ago than the setting, with their files', async () => {
		const expired = await addDocument({ status: 'draft', updatedDaysAgo: 50, deletedDaysAgo: 40 });
		const fresh = await addDocument({ status: 'draft', updatedDaysAgo: 5, deletedDaysAgo: 5 });

		const result = await runRetention(now, settings((s) => (s.retention.purgeDeletedAfterDays = 30)));
		expect(result.purged).toBe(1);
		expect(docRow(expired.id)).toBeUndefined();
		await expect(readFile(storagePath(expired.key))).rejects.toThrow();
		expect(docRow(fresh.id)).toBeDefined();

		const audit = db.select().from(schema.activityLog).all().filter((e) => e.targetId === expired.id);
		expect(audit.map((e) => e.action)).toContain('purged');
		expect(audit.find((e) => e.action === 'purged')?.actorName).toBe('System');
	});

	it('waits while a backup is being written', async () => {
		const release = beginBackup();
		const result = await runRetention(now, settings(() => {}));
		expect(result.skipped).toMatch(/backup/);
		release();
		expect((await runRetention(now, settings(() => {}))).skipped).toBeUndefined();
	});
});

/** Reads a ustar archive back into { name: contents }. */
function untar(buffer: Buffer) {
	const entries: Record<string, Buffer> = {};
	for (let offset = 0; offset + 512 <= buffer.length; ) {
		const header = buffer.subarray(offset, offset + 512);
		if (header.every((b) => b === 0)) break;
		const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
		const size = parseInt(header.subarray(124, 136).toString('utf8'), 8);
		// The checksum covers the header with its own field read as spaces.
		const stored = parseInt(header.subarray(148, 156).toString('utf8'), 8);
		const sum = [...header].reduce((s, b, i) => s + (i >= 148 && i < 156 ? 32 : b), 0);
		expect(sum).toBe(stored);
		entries[name] = buffer.subarray(offset + 512, offset + 512 + size);
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	return entries;
}

describe('createBackup', () => {
	it('writes a manifest, a database snapshot and every stored file', async () => {
		const doc = await addDocument({ status: 'approved', updatedDaysAgo: 1, content: 'the handbook' });

		const backup = await createBackup(admin);
		expect(backup.filename).toMatch(/^edms-backup-.*\.tar\.gz$/);
		const chunks: Uint8Array[] = [];
		const reader = backup.stream.getReader();
		for (let r = await reader.read(); !r.done; r = await reader.read()) chunks.push(r.value);
		const entries = untar(gunzipSync(Buffer.concat(chunks)));

		const manifest = JSON.parse(entries['manifest.json'].toString());
		expect(manifest).toMatchObject({ app: 'edms', format: 1, createdBy: 'Admin' });
		expect(manifest.migrations).toBeGreaterThan(0);
		expect(manifest.files.missing).toEqual([]);
		expect(manifest.files.count).toBe(manifest.counts.versions);

		expect(entries['database.db'].subarray(0, 15).toString()).toBe('SQLite format 3');
		expect(entries[`files/${doc.key.slice(0, 2)}/${doc.key}`].toString()).toBe('the handbook');

		const log = db.select().from(schema.activityLog).all().at(-1);
		expect(log?.action).toBe('backup');
	});
});
