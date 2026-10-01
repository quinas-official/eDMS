import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth/guard';
import { getLastRetentionRun, runRetention } from '$lib/server/retention';
import type { RequestHandler } from './$types';

/** Admins only. The last run since the server started (it runs hourly), or null. */
export const GET: RequestHandler = (event) => {
	requireAdmin(event);
	return json({ lastRun: getLastRetentionRun() });
};

/** Admins only. Runs auto-archive and the purge of expired deleted documents now. */
export const POST: RequestHandler = async (event) => {
	requireAdmin(event);
	const result = await runRetention();
	if (result.skipped) error(409, result.skipped);
	return json({ lastRun: result });
};
