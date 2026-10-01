import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth/guard';
import { deleteDepartment, parseDepartmentInput, updateDepartment } from '$lib/server/departments';
import type { RequestHandler } from './$types';

function parseId(raw: string) {
	if (!/^\d+$/.test(raw)) error(404, 'Department not found');
	return Number(raw);
}

/** Admins only. JSON with `name` and/or `description`. A rename also updates Settings' default department. */
export const PATCH: RequestHandler = async (event) => {
	const user = requireAdmin(event);
	const input = parseDepartmentInput(await event.request.json().catch(() => null), true);
	return json({ department: updateDepartment(user, parseId(event.params.id), input) });
};

/** Admins only. 409 while users or documents are still filed under it, or it's the default. */
export const DELETE: RequestHandler = (event) => {
	const user = requireAdmin(event);
	deleteDepartment(user, parseId(event.params.id));
	return new Response(null, { status: 204 });
};
