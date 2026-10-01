import { json } from '@sveltejs/kit';
import { requireAdmin, requireUser } from '$lib/server/auth/guard';
import {
	createDepartment,
	listDepartmentDetails,
	listDepartments,
	parseDepartmentInput
} from '$lib/server/departments';
import type { RequestHandler } from './$types';

/**
 * Every department, by name. Any signed-in user needs them to file and filter
 * documents. `?details=true` (admins only) adds members and document counts.
 */
export const GET: RequestHandler = (event) => {
	if (event.url.searchParams.get('details') === 'true') {
		requireAdmin(event);
		return json({ departments: listDepartmentDetails() });
	}
	requireUser(event);
	return json({ departments: listDepartments() });
};

/** Admins only. JSON `{ name, description? }`; 409 when the name is taken. */
export const POST: RequestHandler = async (event) => {
	const user = requireAdmin(event);
	const input = parseDepartmentInput(await event.request.json().catch(() => null), false);
	return json({ department: createDepartment(user, input) }, { status: 201 });
};
