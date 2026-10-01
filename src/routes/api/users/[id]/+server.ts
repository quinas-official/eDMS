import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth/guard';
import { deleteUser, parseUserInput, updateUser } from '$lib/server/users';
import type { RequestHandler } from './$types';

/**
 * Admins only. Any of the create fields; `password` resets it. A new password
 * or deactivation signs the user out everywhere.
 */
export const PATCH: RequestHandler = async (event) => {
	const actor = requireAdmin(event);
	const input = parseUserInput(await event.request.json().catch(() => null), true);
	const user = await updateUser(actor, event.locals.session?.id, event.params.id, input);
	return json({ user });
};

/** Admins only. 409 for yourself, the last active admin, or anyone who owns documents. */
export const DELETE: RequestHandler = (event) => {
	const actor = requireAdmin(event);
	deleteUser(actor, event.params.id);
	return new Response(null, { status: 204 });
};
