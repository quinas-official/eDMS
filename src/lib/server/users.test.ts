import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '$lib/auth/types';

// A fresh in-memory database; mocked because SvelteKit fills $env from .env.
vi.mock('$env/dynamic/private', () => ({ env: { DATABASE_URL: ':memory:' } }));

const { db, runMigrations, schema } = await import('$lib/server/db');
const { verifyPassword } = await import('./auth/password');
const users = await import('./users');

let admin: AuthUser;
let hrId: number;

/** The HTTP status a SvelteKit `error()` inside `fn` would send. */
async function statusOf(fn: () => unknown): Promise<number | undefined> {
	try {
		await fn();
	} catch (err) {
		return (err as { status?: number }).status;
	}
	return undefined;
}

function input(overrides: Record<string, unknown> = {}) {
	return users.parseUserInput(
		{
			username: 'jane',
			name: 'Jane Santos',
			email: 'jane@example.com',
			role: 'editor',
			status: 'active',
			departmentId: hrId,
			password: 'correct horse',
			...overrides
		},
		false
	);
}

function sessionsOf(userId: string) {
	return db.select().from(schema.sessions).all().filter((s) => s.userId === userId);
}

function addSession(userId: string, id: string) {
	db.insert(schema.sessions)
		.values({ id, userId, expiresAt: new Date(Date.now() + 3_600_000) })
		.run();
}

beforeAll(() => {
	expect(db.$client.name).toBe(':memory:');
	runMigrations(db);
	hrId = db.insert(schema.departments).values({ name: 'HR' }).returning().get().id;
	const row = db
		.insert(schema.users)
		.values({ username: 'admin', name: 'Admin', passwordHash: 'x', role: 'admin' })
		.returning()
		.get();
	admin = {
		id: row.id,
		username: row.username,
		name: row.name,
		role: 'admin',
		departmentId: null,
		department: null,
		permissions: ['view', 'upload', 'approve', 'delete']
	};
});

describe('parseUserInput', () => {
	it('rejects bad usernames, short passwords and unknown roles', async () => {
		expect(await statusOf(() => input({ username: 'a b' }))).toBe(400);
		expect(await statusOf(() => input({ password: 'short' }))).toBe(400);
		expect(await statusOf(() => input({ role: 'owner' }))).toBe(400);
		expect(await statusOf(() => input({ email: 'not-an-email' }))).toBe(400);
	});

	it('leaves out what a partial update did not send', () => {
		expect(users.parseUserInput({ name: '  Jane   S ' }, true)).toEqual({ name: 'Jane S' });
	});
});

describe('users', () => {
	it('creates a user with a hashed password, and refuses a taken username or email', async () => {
		const jane = await users.createUser(admin, input());
		expect(jane).toMatchObject({ username: 'jane', department: 'HR', ownedDocuments: 0 });
		expect(jane).not.toHaveProperty('passwordHash');

		const stored = db.select().from(schema.users).all().find((u) => u.id === jane.id)!;
		expect(await verifyPassword('correct horse', stored.passwordHash)).toBe(true);

		expect(await statusOf(() => users.createUser(admin, input({ email: 'other@example.com', username: 'JANE' })))).toBe(409);
		expect(await statusOf(() => users.createUser(admin, input({ username: 'jane2', email: 'JANE@example.com' })))).toBe(409);
	});

	it('signs a user out everywhere on a password reset or deactivation', async () => {
		const jane = users.listUsers().find((u) => u.username === 'jane')!;
		addSession(jane.id, 's1');
		addSession(jane.id, 's2');
		await users.updateUser(admin, 'admin-session', jane.id, { password: 'another horse' });
		expect(sessionsOf(jane.id)).toHaveLength(0);

		addSession(jane.id, 's3');
		const updated = await users.updateUser(admin, undefined, jane.id, { status: 'inactive' });
		expect(updated.status).toBe('inactive');
		expect(sessionsOf(jane.id)).toHaveLength(0);
		await users.updateUser(admin, undefined, jane.id, { status: 'active' });
	});

	it('keeps the current session when admins reset their own password', async () => {
		addSession(admin.id, 'mine');
		addSession(admin.id, 'other-device');
		await users.updateUser(admin, 'mine', admin.id, { password: 'brand new pass' });
		expect(sessionsOf(admin.id).map((s) => s.id)).toEqual(['mine']);
	});

	it('protects admins from locking themselves or everyone out', async () => {
		expect(await statusOf(() => users.updateUser(admin, undefined, admin.id, { role: 'viewer' }))).toBe(409);
		expect(await statusOf(() => users.deleteUser(admin, admin.id))).toBe(409);

		// A second admin may not demote the only remaining one either.
		const other = await users.createUser(admin, input({ username: 'mark', email: '', role: 'admin' }));
		const otherAuth = { ...admin, id: other.id, name: other.name };
		await users.updateUser(otherAuth, undefined, other.id, { name: 'Mark' }); // fine
		await users.updateUser(admin, undefined, other.id, { status: 'inactive' }); // admin still active
		expect(await statusOf(() => users.updateUser(otherAuth, undefined, admin.id, { role: 'editor' }))).toBe(409);
	});

	it('refuses to delete a document owner, and deletes anyone else with an audit entry', async () => {
		const jane = users.listUsers().find((u) => u.username === 'jane')!;
		db.insert(schema.documents).values({ reference: 'HR-1', title: 'Handbook', ownerId: jane.id }).run();
		expect(await statusOf(() => users.deleteUser(admin, jane.id))).toBe(409);

		const temp = await users.createUser(admin, input({ username: 'temp', email: '' }));
		users.deleteUser(admin, temp.id);
		expect(users.listUsers().some((u) => u.id === temp.id)).toBe(false);
		const last = db.select().from(schema.activityLog).all().at(-1)!;
		expect(last).toMatchObject({ action: 'deleted', targetType: 'user', target: temp.name });
		expect(JSON.stringify(last.metadata ?? {})).not.toContain('horse');
	});

	it('lists only active users as assignable', () => {
		const names = users.listAssignableUsers().map((u) => u.name);
		expect(names).toContain('Jane Santos');
		expect(names).not.toContain('Mark');
	});
});
