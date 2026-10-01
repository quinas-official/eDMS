import { error, json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth/guard';
import { can } from '$lib/permissions';
import { listAssignableUsers } from '$lib/server/users';
import type { RequestHandler } from './$types';

/**
 * Active users' names and departments, for assignee pickers. Open to anyone
 * who may set an assignee on a document: editors (`upload`) and approvers.
 */
export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	if (!can(user, 'upload') && !can(user, 'approve')) {
		error(403, 'You do not have permission to assign documents');
	}
	return json({ users: listAssignableUsers() });
};
