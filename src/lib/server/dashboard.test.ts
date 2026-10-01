import { beforeAll, describe, expect, it, vi } from 'vitest';

// A fresh in-memory database; mocked because SvelteKit fills $env from .env.
vi.mock('$env/dynamic/private', () => ({ env: { DATABASE_URL: ':memory:' } }));

const { db, runMigrations, schema } = await import('$lib/server/db');
const { getDashboardSummary } = await import('./dashboard');

const HOUR = 3_600_000;
let n = 0;

function addDocument(opts: {
	status?: 'draft' | 'pending' | 'approved';
	departmentId?: number | null;
	files: { name: string; at: number }[];
	deleted?: boolean;
	ownerId: string;
}) {
	const doc = db
		.insert(schema.documents)
		.values({
			reference: `T-${++n}`,
			title: `Doc ${n}`,
			status: opts.status ?? 'draft',
			departmentId: opts.departmentId ?? null,
			ownerId: opts.ownerId,
			deletedAt: opts.deleted ? new Date() : null
		})
		.returning()
		.get();
	opts.files.forEach((file, i) =>
		db
			.insert(schema.documentVersions)
			.values({
				documentId: doc.id,
				versionNumber: i + 1,
				storageKey: `key-${doc.id}-${i}`,
				originalName: file.name,
				mimeType: 'application/octet-stream',
				size: 100,
				sha256: 'x',
				createdAt: new Date(file.at)
			})
			.run()
	);
}

const now = Date.now();

beforeAll(() => {
	expect(db.$client.name).toBe(':memory:');
	runMigrations(db);
	const [hr] = db.insert(schema.departments).values({ name: 'HR' }).returning().all();
	const user = db
		.insert(schema.users)
		.values({ username: 'u', name: 'U', passwordHash: 'x', role: 'admin' })
		.returning()
		.get();

	addDocument({ ownerId: user.id, departmentId: hr.id, status: 'pending', files: [{ name: 'a.pdf', at: now }] });
	// Two versions: counts once by type (latest is .docx), twice as uploads.
	addDocument({
		ownerId: user.id,
		departmentId: hr.id,
		files: [
			{ name: 'b.txt', at: now - 2 * HOUR },
			{ name: 'b.docx', at: now - HOUR }
		]
	});
	addDocument({ ownerId: user.id, status: 'approved', files: [{ name: 'c.pdf', at: now - 10 * 24 * HOUR }] });
	addDocument({ ownerId: user.id, deleted: true, files: [{ name: 'd.pdf', at: now }] });
});

describe('getDashboardSummary', () => {
	it('counts live documents, deleted ones and storage separately', () => {
		const { totals, byStatus } = getDashboardSummary();
		expect(totals.documents).toBe(3);
		expect(totals.deleted).toBe(1);
		// Storage includes the deleted document's file: it's still on disk.
		expect(totals.versions).toBe(5);
		expect(totals.storageBytes).toBe(500);
		expect(byStatus).toMatchObject({ draft: 1, pending: 1, approved: 1, reviewed: 0, rejected: 0 });
	});

	it('groups by department, with unfiled documents last', () => {
		expect(getDashboardSummary().byDepartment).toEqual([
			{ id: expect.any(Number), name: 'HR', count: 2 },
			{ id: null, name: 'No department', count: 1 }
		]);
	});

	it('counts file types by the latest version of live documents', () => {
		expect(getDashboardSummary().byType).toEqual([
			{ label: 'PDF', count: 2 },
			{ label: 'DOCX', count: 1 }
		]);
	});

	it('returns 14 days of uploads ending today, including empty days', () => {
		const days = getDashboardSummary().uploadsByDay;
		expect(days).toHaveLength(14);
		const total = days.reduce((t, d) => t + d.count, 0);
		// a.pdf, b.txt, b.docx, d.pdf (deleted docs' uploads still happened) and c.pdf 10 days ago.
		expect(total).toBe(5);
		expect(days.at(-1)!.date).toBe(new Date(now).toISOString().slice(0, 10));
	});

	it('uses the viewer\'s calendar days for the time zone given', () => {
		// UTC+14 (offset -840): "today" there can already be tomorrow in UTC.
		const east = getDashboardSummary(-840).uploadsByDay;
		expect(east.at(-1)!.date).toBe(new Date(now + 14 * HOUR).toISOString().slice(0, 10));
		expect(east.reduce((t, d) => t + d.count, 0)).toBe(5);
	});
});
