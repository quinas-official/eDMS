import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth/guard';
import { getAppSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/**
 * The organization's settings as the server enforces them. Readable by any
 * signed-in user so the UI can mirror upload limits and approval rules.
 */
export const GET: RequestHandler = (event) => {
	requireUser(event);
	return json({ settings: getAppSettings() });
};
