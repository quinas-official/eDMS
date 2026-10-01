import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth/guard';
import { getDashboardSummary } from '$lib/server/dashboard';
import type { RequestHandler } from './$types';

/**
 * The admin dashboard's figures. Query: `tzOffset`, the browser's
 * `getTimezoneOffset()` in minutes, so daily counts follow local days.
 */
export const GET: RequestHandler = (event) => {
	requireAdmin(event);
	const raw = Number(event.url.searchParams.get('tzOffset') ?? 0);
	// Real offsets run from UTC-12 to UTC+14.
	const tzOffset = Number.isInteger(raw) && Math.abs(raw) <= 14 * 60 ? raw : 0;
	return json(getDashboardSummary(tzOffset));
};
