import { browser } from '$app/environment';

/**
 * True in the desktop app. Its UI is bundled into the app instead of served
 * by the server, so it calls a server address the user configures, and signs
 * in with a Bearer token because cookies don't cross from the app's origin.
 */
export const isDesktop: boolean = __DESKTOP__;

/**
 * Base URL for API calls. Empty means same origin, which is how the web app
 * is served. The desktop app sets it to the server the user connected to.
 */
let apiBaseUrl = '';

export function getApiBaseUrl(): string {
	return apiBaseUrl;
}

export function setApiBaseUrl(url: string) {
	apiBaseUrl = url.replace(/\/+$/, '');
}

// ---- Desktop: persisted per device ------------------------------------------------

const SERVER_KEY = 'edms.serverUrl';
const TOKEN_KEY = 'edms.sessionToken';

/** localStorage can be unavailable or throw; the app then just asks again. */
function read(key: string): string | null {
	if (!browser) return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string | null) {
	if (!browser) return;
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// Not persisted; the app keeps working for this run.
	}
}

export function savedServerUrl() {
	return read(SERVER_KEY);
}

export function saveServerUrl(url: string | null) {
	write(SERVER_KEY, url);
}

/**
 * The desktop session token. It sits in the app's own storage, which no web
 * page can read; the server still expires it after the idle timeout.
 */
export function savedSessionToken() {
	return read(TOKEN_KEY);
}

export function saveSessionToken(token: string | null) {
	write(TOKEN_KEY, token);
}
