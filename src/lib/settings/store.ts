import { writable } from 'svelte/store';
import { getServerSettings, updateServerSettings } from '$lib/api/settings';
import { DEFAULT_SETTINGS, type AppSettings } from './types';

/**
 * Client-side copy of the settings the server enforces. Nothing is kept in
 * the browser: the store holds the defaults until `loadSettings()` fetches
 * the real values, and saving goes through the API.
 */
export const settings = writable<AppSettings>(structuredClone(DEFAULT_SETTINGS));

/** False until the first load succeeds, so pages can wait before showing a form. */
export const settingsLoaded = writable(false);

let pending: Promise<AppSettings> | null = null;

export function loadSettings(): Promise<AppSettings> {
	pending ??= getServerSettings()
		.then((value) => {
			settings.set(value);
			settingsLoaded.set(true);
			return value;
		})
		.finally(() => (pending = null));
	return pending;
}

/** Admins only. Throws an `ApiError` with the server's message when validation fails. */
export async function saveSettings(next: AppSettings): Promise<AppSettings> {
	const stored = await updateServerSettings(next);
	settings.set(stored);
	return stored;
}
