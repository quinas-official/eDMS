import { error, json } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/auth/guard';
import { setArchived } from '$lib/server/documents/service';
import type { RequestHandler } from './$types';

/** JSON `{ archived: boolean }`: moves the document out of, or back into, the active list. */
export const POST: RequestHandler = async (event) => {
	// Beyond `view`, archiving needs `upload` or `approve`; the service checks.
	const user = requirePermission(event, 'view');
	const body = await event.request.json().catch(() => null);
	if (typeof body?.archived !== 'boolean') error(400, 'Expected { archived: true | false }');
	return json({ document: setArchived(user, event.params.id, body.archived) });
};
