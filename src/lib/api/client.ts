import { getApiBaseUrl, isDesktop, savedSessionToken, saveSessionToken } from '$lib/config/env';

/** A non-2xx response; `message` is the server's `{ message }` when it sent one. */
export class ApiError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}

/** The request never got an answer: the server is down or unreachable. */
export class NetworkError extends Error {
	constructor(cause: unknown) {
		super("Couldn't reach the server", { cause });
		this.name = 'NetworkError';
	}
}

let unauthorizedHandler: (() => void) | null = null;
let networkErrorHandler: (() => void) | null = null;

/** Lets the auth store react when the server reports the session is gone. */
export function onUnauthorized(handler: () => void) {
	unauthorizedHandler = handler;
}

/** Lets the desktop app show its "can't reach the server" screen. */
export function onNetworkError(handler: () => void) {
	networkErrorHandler = handler;
}

/**
 * Desktop only: the Bearer token from sign-in. The web app uses an httpOnly
 * cookie instead, which page code never sees.
 */
let sessionToken: string | null = isDesktop ? savedSessionToken() : null;

export function setSessionToken(token: string | null) {
	sessionToken = token;
	saveSessionToken(token);
}

/** The raw response, for bodies that aren't JSON such as file downloads. Throws on non-2xx. */
export async function apiFetchResponse(path: string, options: RequestInit = {}): Promise<Response> {
	const headers = new Headers(options.headers);
	if (!headers.has('Accept')) headers.set('Accept', 'application/json');
	// Only for JSON strings: a FormData upload must let the browser set its own boundary.
	if (typeof options.body === 'string' && !headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/json');
	}
	if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);

	let res: Response;
	try {
		res = await fetch(`${getApiBaseUrl()}${path}`, {
			// The desktop app is cross-origin to its server and never uses cookies.
			credentials: isDesktop ? 'omit' : 'include',
			...options,
			headers
		});
	} catch (err) {
		if ((err as Error)?.name === 'AbortError') throw err;
		networkErrorHandler?.();
		throw new NetworkError(err);
	}

	if (!res.ok) {
		const body = await res.json().catch(() => null);
		if (res.status === 401) {
			if (sessionToken) setSessionToken(null);
			unauthorizedHandler?.();
		}
		throw new ApiError(res.status, body?.message ?? `Request failed (${res.status})`);
	}

	return res;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
	const res = await apiFetchResponse(path, options);
	if (res.status === 204) return undefined as T;
	return res.json() as Promise<T>;
}
