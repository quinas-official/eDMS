import type { AppSettings } from '$lib/settings/types';
import { apiFetch } from './client';

/** The settings the server enforces. Any signed-in user can read them. */
export async function getServerSettings() {
	return (await apiFetch<{ settings: AppSettings }>('/api/settings')).settings;
}

/** Admins only. Sends the whole object; resolves with what the server stored. */
export async function updateServerSettings(settings: AppSettings) {
	return (
		await apiFetch<{ settings: AppSettings }>('/api/settings', {
			method: 'PUT',
			body: JSON.stringify({ settings })
		})
	).settings;
}
