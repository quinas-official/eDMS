import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth/guard';
import { createUser, listUsers, parseUserInput } from '$lib/server/users';
import type { RequestHandler } from './$types';

/** Admins only. Every account, by name, with last sign-in and owned-document counts. */
export const GET: RequestHandler = (event) => {
	requireAdmin(event);
	return json({ users: listUsers() });
};

/**
 * Admins only. JSON `{ username, name, email?, role, status, departmentId, password }`;
 * 409 when the username or email is taken.
 */
export const POST: RequestHandler = async (event) => {
	const actor = requireAdmin(event);
	const input = parseUserInput(await event.request.json().catch(() => null), false);
	return json({ user: await createUser(actor, input) }, { status: 201 });
};
