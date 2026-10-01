import { requireAdmin } from '$lib/server/auth/guard';
import { createBackup } from '$lib/server/backup';
import type { RequestHandler } from './$types';

/**
 * Admins only. Streams a `.tar.gz` with a database snapshot, every stored file
 * and a manifest. Restore with `npm run db:restore` while the server is stopped.
 */
export const GET: RequestHandler = async (event) => {
	const actor = requireAdmin(event);
	const backup = await createBackup(actor);
	return new Response(backup.stream, {
		headers: {
			'Content-Type': 'application/gzip',
			'Content-Disposition': `attachment; filename="${backup.filename}"`,
			'Cache-Control': 'no-store'
		}
	});
};
