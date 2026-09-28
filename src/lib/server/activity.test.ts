import { beforeAll, describe, expect, it, vi } from 'vitest';

// A fresh in-memory database. Mocked rather than set on process.env, because
// SvelteKit fills $env from .env, which would point this at the real database.
vi.mock('$env/dynamic/private', () => ({ env: { DATABASE_URL: ':memory:' } }));

const { db, runMigrations } = await import('$lib/server/db');
const { listActivity, logActivity } = await import('./activity');

beforeAll(() => {
	// Belt and braces: never write test rows into a file-backed database.
	expect(db.$client.name).toBe(':memory:');
	runMigrations(db);
	for (let i = 1; i <= 7; i++) {
		logActivity({
			action: i % 2 ? 'created' : 'edited',
			actor: null,
			actorName: i === 3 ? 'Grace' : 'Ada',
			target: `Doc ${i}`,
			details: i === 5 ? '100% done' : undefined
		});
	}
});

describe('listActivity', () => {
	it('returns newest first', () => {
		const { entries } = listActivity({});
		expect(entries.map((e) => e.target)).toEqual([7, 6, 5, 4, 3, 2, 1].map((i) => `Doc ${i}`));
	});

	it('pages with a cursor until there are no more', () => {
		const first = listActivity({ limit: 3 });
		expect(first.entries.map((e) => e.target)).toEqual(['Doc 7', 'Doc 6', 'Doc 5']);
		expect(first.nextCursor).toBe(first.entries[2].id);

		const second = listActivity({ limit: 3, before: first.nextCursor! });
		expect(second.entries.map((e) => e.target)).toEqual(['Doc 4', 'Doc 3', 'Doc 2']);

		const last = listActivity({ limit: 3, before: second.nextCursor! });
		expect(last.entries.map((e) => e.target)).toEqual(['Doc 1']);
		expect(last.nextCursor).toBeNull();
	});

	it('filters by action', () => {
		const { entries } = listActivity({ action: 'edited' });
		expect(entries.every((e) => e.action === 'edited')).toBe(true);
		expect(entries).toHaveLength(3);
	});

	it('searches actor, target and details, treating % literally', () => {
		expect(listActivity({ search: 'grace' }).entries.map((e) => e.target)).toEqual(['Doc 3']);
		expect(listActivity({ search: 'Doc 6' }).entries).toHaveLength(1);
		expect(listActivity({ search: '100%' }).entries.map((e) => e.target)).toEqual(['Doc 5']);
		expect(listActivity({ search: '%' }).entries.map((e) => e.target)).toEqual(['Doc 5']);
	});
});
