import { error } from '@sveltejs/kit';
import { and, asc, count, eq, isNull, ne, sql } from 'drizzle-orm';
import type { AuthUser } from '$lib/auth/types';
import type { DepartmentDetailDTO, DepartmentDTO } from '$lib/departments/types';
import { logActivity } from '$lib/server/activity';
import { db, schema } from '$lib/server/db';
import { getAppSettings, renameDefaultDepartment } from '$lib/server/settings';

const { departments, users, documents } = schema;

export const NAME_MAX = 100;
export const DESCRIPTION_MAX = 500;

export function listDepartments(): DepartmentDTO[] {
	return db
		.select({ id: departments.id, name: departments.name, description: departments.description })
		.from(departments)
		.orderBy(asc(departments.name))
		.all();
}

/** Admin view: members and document counts, for the Departments page. */
export function listDepartmentDetails(): DepartmentDetailDTO[] {
	const rows = db.select().from(departments).orderBy(asc(departments.name)).all();

	const members = db
		.select({
			id: users.id,
			name: users.name,
			username: users.username,
			email: users.email,
			status: users.status,
			departmentId: users.departmentId
		})
		.from(users)
		.orderBy(asc(users.name))
		.all();

	const docCounts = new Map(
		db
			.select({ id: documents.departmentId, n: count() })
			.from(documents)
			.where(isNull(documents.deletedAt))
			.groupBy(documents.departmentId)
			.all()
			.map((r) => [r.id, r.n])
	);

	const defaultName = getAppSettings().general.defaultDepartment;

	return rows.map((d) => ({
		id: d.id,
		name: d.name,
		description: d.description,
		createdAt: d.createdAt.toISOString(),
		isDefault: d.name === defaultName,
		documentCount: docCounts.get(d.id) ?? 0,
		members: members
			.filter((m) => m.departmentId === d.id)
			.map(({ departmentId: _, ...m }) => m)
	}));
}

export interface DepartmentInput {
	name?: string;
	description?: string;
}

export function parseDepartmentInput(body: unknown, partial: boolean): DepartmentInput {
	if (!body || typeof body !== 'object') error(400, 'Expected a JSON object');
	const input = body as Record<string, unknown>;
	const out: DepartmentInput = {};

	if ('name' in input || !partial) {
		if (typeof input.name !== 'string' || !input.name.trim()) error(400, 'Name is required');
		const name = input.name.trim().replace(/\s+/g, ' ');
		if (name.length > NAME_MAX) error(400, `Name can be at most ${NAME_MAX} characters`);
		out.name = name;
	}
	if ('description' in input) {
		if (typeof input.description !== 'string') error(400, 'Description must be text');
		const description = input.description.trim();
		if (description.length > DESCRIPTION_MAX) {
			error(400, `Description can be at most ${DESCRIPTION_MAX} characters`);
		}
		out.description = description;
	}
	return out;
}

/** Names are compared case-insensitively: "hr" and "HR" would be the same department to people. */
function assertNameFree(name: string, exceptId?: number) {
	const clash = db
		.select({ id: departments.id })
		.from(departments)
		.where(
			and(
				eq(sql`lower(${departments.name})`, name.toLowerCase()),
				exceptId === undefined ? undefined : ne(departments.id, exceptId)
			)
		)
		.get();
	if (clash) error(409, `A department named "${name}" already exists`);
}

function loadDepartment(id: number) {
	const found = db.select().from(departments).where(eq(departments.id, id)).get();
	if (!found) error(404, 'Department not found');
	return found;
}

function findDetail(id: number) {
	return listDepartmentDetails().find((d) => d.id === id)!;
}

export function createDepartment(user: AuthUser, input: DepartmentInput): DepartmentDetailDTO {
	const name = input.name!;
	assertNameFree(name);

	const created = db
		.insert(departments)
		.values({ name, description: input.description ?? '' })
		.returning()
		.get();

	logActivity({
		action: 'created',
		actor: user,
		targetType: 'department',
		targetId: String(created.id),
		target: created.name
	});
	return findDetail(created.id);
}

export function updateDepartment(
	user: AuthUser,
	id: number,
	input: DepartmentInput
): DepartmentDetailDTO {
	const current = loadDepartment(id);

	const changes: Record<string, [string, string]> = {};
	if (input.name !== undefined && input.name !== current.name) {
		// A change of case only is allowed, so skip the clash check against itself.
		assertNameFree(input.name, id);
		changes.name = [current.name, input.name];
	}
	if (input.description !== undefined && input.description !== current.description) {
		changes.description = [current.description, input.description];
	}
	if (!Object.keys(changes).length) return findDetail(id);

	db.transaction(() => {
		db.update(departments)
			.set({ name: input.name ?? current.name, description: input.description ?? current.description })
			.where(eq(departments.id, id))
			.run();
		if (changes.name) renameDefaultDepartment(changes.name[0], changes.name[1]);
		logActivity({
			action: 'edited',
			actor: user,
			targetType: 'department',
			targetId: String(id),
			target: current.name,
			details: changes.name
				? `Renamed to "${changes.name[1]}"${changes.description ? '; description changed' : ''}`
				: 'Description changed',
			metadata: { changes }
		});
	});
	return findDetail(id);
}

/**
 * Refuses while anything still points at the department. Deleting would leave
 * its documents unfiled, where only their owners, admins and approvers can see
 * them, and its users without a department.
 */
export function deleteDepartment(user: AuthUser, id: number) {
	const current = loadDepartment(id);

	if (getAppSettings().general.defaultDepartment === current.name) {
		error(409, `"${current.name}" is the default department in Settings; choose another one first`);
	}

	const memberCount =
		db.select({ n: count() }).from(users).where(eq(users.departmentId, id)).get()?.n ?? 0;
	// Includes deleted documents: restoring one later would otherwise bring it back unfiled.
	const docs = db
		.select({ n: count(), deleted: count(documents.deletedAt) })
		.from(documents)
		.where(eq(documents.departmentId, id))
		.get();
	const docCount = docs?.n ?? 0;
	if (memberCount || docCount) {
		const deletedNote = docs?.deleted ? ` (${docs.deleted} of them deleted)` : '';
		const parts = [
			memberCount && `${memberCount} user${memberCount === 1 ? '' : 's'}`,
			docCount && `${docCount} document${docCount === 1 ? '' : 's'}${deletedNote}`
		].filter(Boolean);
		error(409, `Move its ${parts.join(' and ')} to another department first`);
	}

	db.transaction(() => {
		db.delete(departments).where(eq(departments.id, id)).run();
		logActivity({
			action: 'deleted',
			actor: user,
			targetType: 'department',
			targetId: String(id),
			target: current.name
		});
	});
}
