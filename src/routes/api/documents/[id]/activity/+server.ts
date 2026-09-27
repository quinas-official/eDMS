import { json } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/auth/guard';
import { listDocumentActivity } from '$lib/server/documents/service';
import type { RequestHandler } from './$types';

/** The document's audit trail, oldest first, for the Approval Timeline. */
export const GET: RequestHandler = (event) => {
	const user = requirePermission(event, 'view');
	return json({ activity: listDocumentActivity(user, event.params.id) });
};
