import type { AppSettings } from '$lib/settings/types';
import { apiFetch } from './client';

/** The settings the server enforces, which can differ from the browser-local Settings store. */
export async function getServerSettings() {
	return (await apiFetch<{ settings: AppSettings }>('/api/settings')).settings;
}
