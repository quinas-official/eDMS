import { json } from '@sveltejs/kit';
import { requireAdmin, requireUser } from '$lib/server/auth/guard';
import { getAppSettings, saveAppSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/**
 * The organization's settings as the server enforces them. Readable by any
 * signed-in user so the UI can mirror upload limits and approval rules.
 */
export const GET: RequestHandler = (event) => {
	requireUser(event);
	return json({ settings: getAppSettings() });
};

/** Admins only. Body `{ settings }`, the whole object; returns it as stored. Changes are audit-logged. */
export const PUT: RequestHandler = async (event) => {
	const user = requireAdmin(event);
	const body = await event.request.json().catch(() => null);
	return json({ settings: saveAppSettings(user, body?.settings) });
};
