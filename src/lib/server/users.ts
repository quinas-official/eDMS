import { error } from '@sveltejs/kit';
import { and, asc, count, eq, max, ne, sql } from 'drizzle-orm';
import type { AuthUser } from '$lib/auth/types';
import { ROLES, type Role } from '$lib/settings/types';
import {
	PASSWORD_MIN,
	type AssignableUserDTO,
	type UserDTO,
	type UserInput,
	type UserStatus
} from '$lib/users/types';
import { logActivity } from '$lib/server/activity';
import { hashPassword } from '$lib/server/auth/password';
import { db, schema } from '$lib/server/db';
import { USER_STATUSES } from '$lib/server/db/schema';

const { users, departments, documents, activityLog, sessions } = schema;

const USERNAME = /^[a-z0-9._-]{3,64}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 100;
const PASSWORD_MAX = 256;

// ---- Reading ------------------------------------------------------------------

export function listUsers(): UserDTO[] {
	const rows = db
		.select({ user: users, department: departments.name })
		.from(users)
		.leftJoin(departments, eq(users.departmentId, departments.id))
		.orderBy(asc(users.name))
		.all();

	const lastLogins = new Map(
		db
			.select({ id: activityLog.actorId, at: max(activityLog.createdAt) })
			.from(activityLog)
			.where(eq(activityLog.action, 'login'))
			.groupBy(activityLog.actorId)
			.all()
			.map((r) => [r.id, r.at])
	);
	const owned = new Map(
		db
			.select({ id: documents.ownerId, n: count() })
			.from(documents)
			.groupBy(documents.ownerId)
			.all()
			.map((r) => [r.id, r.n])
	);

	return rows.map(({ user, department }) => {
		const lastLogin = lastLogins.get(user.id);
		return {
			id: user.id,
			username: user.username,
			name: user.name,
			email: user.email,
			role: user.role,
			status: user.status,
			departmentId: user.departmentId,
			department,
			createdAt: user.createdAt.toISOString(),
			// `max()` loses the column's timestamp mode, so this may come back as a number.
			lastLoginAt: lastLogin ? new Date(lastLogin as unknown as number).toISOString() : null,
			ownedDocuments: owned.get(user.id) ?? 0
		};
	});
}

function findUser(id: string): UserDTO {
	const found = listUsers().find((u) => u.id === id);
	if (!found) error(404, 'User not found');
	return found;
}

/** Active accounts, for the Workflow and Documents assignee pickers. */
export function listAssignableUsers(): AssignableUserDTO[] {
	return db
		.select({
			id: users.id,
			name: users.name,
			departmentId: users.departmentId,
			department: departments.name
		})
		.from(users)
		.leftJoin(departments, eq(users.departmentId, departments.id))
		.where(eq(users.status, 'active'))
		.orderBy(asc(users.name))
		.all();
}

// ---- Validation ---------------------------------------------------------------

/** Every field is optional when `partial` (PATCH); on create all but email are required. */
export function parseUserInput(body: unknown, partial: boolean): Partial<UserInput> {
	if (!body || typeof body !== 'object') error(400, 'Expected a JSON object');
	const input = body as Record<string, unknown>;
	const out: Partial<UserInput> = {};
	const has = (key: string) => key in input || !partial;

	if (has('username')) {
		const value = typeof input.username === 'string' ? input.username.trim() : '';
		if (!USERNAME.test(value)) {
			error(400, 'Username must be 3–64 characters: letters, digits, dots, dashes or underscores');
		}
		out.username = value;
	}
	if (has('name')) {
		const value = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
		if (!value) error(400, 'Name is required');
		if (value.length > NAME_MAX) error(400, `Name can be at most ${NAME_MAX} characters`);
		out.name = value;
	}
	if ('email' in input) {
		if (input.email !== null && typeof input.email !== 'string') error(400, 'Email must be text');
		const value = (input.email ?? '').trim();
		if (value && (!EMAIL.test(value) || value.length > 254)) error(400, 'Email is not a valid address');
		out.email = value;
	}
	if (has('role')) {
		if (!ROLES.includes(input.role as Role)) error(400, `Role must be one of ${ROLES.join(', ')}`);
		out.role = input.role as Role;
	}
	if (has('status')) {
		if (!USER_STATUSES.includes(input.status as UserStatus)) {
			error(400, 'Status must be active or inactive');
		}
		out.status = input.status as UserStatus;
	}
	if (has('departmentId')) {
		const value = input.departmentId ?? null;
		if (value !== null && !(typeof value === 'number' && Number.isInteger(value))) {
			error(400, 'departmentId must be a department id or null');
		}
		out.departmentId = value as number | null;
	}
	if ('password' in input || !partial) {
		const value = input.password;
		if (typeof value !== 'string' || value.length < PASSWORD_MIN) {
			error(400, `Password must be at least ${PASSWORD_MIN} characters`);
		}
		if (value.length > PASSWORD_MAX) error(400, `Password can be at most ${PASSWORD_MAX} characters`);
		out.password = value;
	}
	return out;
}

function assertUsernameFree(username: string, exceptId?: string) {
	const clash = db
		.select({ id: users.id })
		.from(users)
		.where(
			and(
				eq(sql`lower(${users.username})`, username.toLowerCase()),
				exceptId ? ne(users.id, exceptId) : undefined
			)
		)
		.get();
	if (clash) error(409, `The username "${username}" is taken`);
}

function assertEmailFree(email: string, exceptId?: string) {
	const clash = db
		.select({ id: users.id })
		.from(users)
		.where(
			and(
				eq(sql`lower(${users.email})`, email.toLowerCase()),
				exceptId ? ne(users.id, exceptId) : undefined
			)
		)
		.get();
	if (clash) error(409, `Another account already uses ${email}`);
}

function assertDepartment(id: number | null | undefined) {
	if (id == null) return;
	const found = db.select({ id: departments.id }).from(departments).where(eq(departments.id, id)).get();
	if (!found) error(400, 'Unknown department');
}

function activeAdminCount() {
	return (
		db
			.select({ n: count() })
			.from(users)
			.where(and(eq(users.role, 'admin'), eq(users.status, 'active')))
			.get()?.n ?? 0
	);
}

// ---- Writing ------------------------------------------------------------------

// Hashing is the only async step, so it runs first. Every check after it runs
// synchronously alongside the write, so a concurrent request can't slip in
// between a check and the write that relies on it.

export async function createUser(actor: AuthUser, input: Partial<UserInput>): Promise<UserDTO> {
	const data = input as UserInput;
	const passwordHash = await hashPassword(data.password!);

	assertUsernameFree(data.username);
	if (data.email) assertEmailFree(data.email);
	assertDepartment(data.departmentId);

	const created = db.transaction(() => {
		const row = db
			.insert(users)
			.values({
				username: data.username,
				name: data.name,
				email: data.email || null,
				role: data.role,
				status: data.status,
				departmentId: data.departmentId,
				passwordHash
			})
			.returning()
			.get();
		logActivity({
			action: 'created',
			actor,
			targetType: 'user',
			targetId: row.id,
			target: row.name,
			details: `${row.username} (${row.role})`,
			metadata: { username: row.username, role: row.role, departmentId: row.departmentId }
		});
		return row;
	});
	return findUser(created.id);
}

const FIELD_LABELS: Record<string, string> = {
	username: 'Username',
	name: 'Name',
	email: 'Email',
	role: 'Role',
	status: 'Status',
	departmentId: 'Department'
};

/** `actorSessionId` is kept when admins reset their own password; every other session ends. */
export async function updateUser(
	actor: AuthUser,
	actorSessionId: string | undefined,
	id: string,
	input: Partial<UserInput>
): Promise<UserDTO> {
	const passwordChanged = input.password !== undefined;
	const passwordHash = passwordChanged ? await hashPassword(input.password!) : undefined;

	const current = db.select().from(users).where(eq(users.id, id)).get();
	if (!current) error(404, 'User not found');

	const changes: Record<string, [unknown, unknown]> = {};
	for (const field of ['username', 'name', 'email', 'role', 'status', 'departmentId'] as const) {
		if (input[field] === undefined) continue;
		const next = field === 'email' ? input.email || null : input[field];
		if (next !== current[field]) changes[field] = [current[field], next];
	}
	if (!Object.keys(changes).length && !passwordChanged) return findUser(id);

	if (id === actor.id && (changes.role || changes.status)) {
		error(409, "You can't change your own role or status; ask another admin");
	}
	const losesAdmin =
		current.role === 'admin' &&
		current.status === 'active' &&
		((changes.role && input.role !== 'admin') || (changes.status && input.status !== 'active'));
	if (losesAdmin && activeAdminCount() <= 1) {
		error(409, 'This is the last active admin; make someone else an admin first');
	}
	if (changes.username) assertUsernameFree(input.username!, id);
	if (changes.email && input.email) assertEmailFree(input.email, id);
	if (changes.departmentId) assertDepartment(input.departmentId);

	db.transaction(() => {
		const values = Object.fromEntries(Object.entries(changes).map(([f, [, next]]) => [f, next]));
		db.update(users)
			.set({ ...values, ...(passwordHash ? { passwordHash } : {}) })
			.where(eq(users.id, id))
			.run();

		// A new password or a disabled account signs them out everywhere. Admins
		// resetting their own password keep this session; other devices still drop.
		if (passwordChanged || changes.status) {
			const keep = id === actor.id ? actorSessionId : undefined;
			db.delete(sessions)
				.where(and(eq(sessions.userId, id), keep ? ne(sessions.id, keep) : undefined))
				.run();
		}

		const parts = Object.keys(changes).map((f) => FIELD_LABELS[f]);
		if (passwordChanged) parts.push('Password reset');
		logActivity({
			action: 'edited',
			actor,
			targetType: 'user',
			targetId: id,
			target: current.name,
			details: parts.join(', '),
			// Never the password, not even its hash.
			metadata: { changes, ...(passwordChanged ? { passwordReset: true } : {}) }
		});
	});
	return findUser(id);
}

/**
 * Hard delete, for accounts made by mistake. Anyone who owns documents is
 * refused (the schema restricts it too): deactivate them instead, so their
 * documents keep an owner and the audit log keeps its link.
 */
export function deleteUser(actor: AuthUser, id: string) {
	const current = db.select().from(users).where(eq(users.id, id)).get();
	if (!current) error(404, 'User not found');
	if (id === actor.id) error(409, "You can't delete your own account");
	if (current.role === 'admin' && current.status === 'active' && activeAdminCount() <= 1) {
		error(409, 'This is the last active admin');
	}
	const owned =
		db.select({ n: count() }).from(documents).where(eq(documents.ownerId, id)).get()?.n ?? 0;
	if (owned) {
		error(
			409,
			`${current.name} owns ${owned} document${owned === 1 ? '' : 's'}; deactivate the account instead`
		);
	}

	db.transaction(() => {
		db.delete(users).where(eq(users.id, id)).run();
		logActivity({
			action: 'deleted',
			actor,
			targetType: 'user',
			targetId: id,
			target: current.name,
			details: current.username
		});
	});
}
