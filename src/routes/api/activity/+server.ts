import { error, json } from '@sveltejs/kit';
import { listActivity } from '$lib/server/activity';
import { requireAdmin } from '$lib/server/auth/guard';
import type { RequestHandler } from './$types';

/**
 * The system-wide audit log, admins only. Query: `action`, `search`,
 * `before` (cursor from the previous page's `nextCursor`), `limit`.
 */
export const GET: RequestHandler = (event) => {
	requireAdmin(event);
	const params = event.url.searchParams;
	return json(
		listActivity({
			action: params.get('action')?.trim() || undefined,
			search: params.get('search')?.trim().slice(0, 200) || undefined,
			before: optionalInt(params, 'before'),
			limit: optionalInt(params, 'limit')
		})
	);
};

function optionalInt(params: URLSearchParams, name: string) {
	const raw = params.get(name);
	if (raw === null || raw === '') return undefined;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0) error(400, `${name} must be a whole number`);
	return value;
}
