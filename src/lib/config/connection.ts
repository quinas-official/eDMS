import { get, writable } from 'svelte/store';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { onNetworkError } from '$lib/api/client';
import { forgetSession } from '$lib/auth/store';
import { isDesktop, savedServerUrl, saveServerUrl, setApiBaseUrl } from './env';

/**
 * Desktop only: which server the app talks to, and whether it's reachable.
 * The web app is served by its server, so it's always `ready` there.
 */
export interface Connection {
	state: 'checking' | 'setup' | 'unreachable' | 'ready';
	url: string | null;
	/** Once true, pages stay mounted under the "unreachable" screen so nothing typed is lost. */
	everReady: boolean;
	error: string;
}

export const connection = writable<Connection>({
	state: isDesktop ? 'checking' : 'ready',
	url: null,
	everReady: !isDesktop,
	error: ''
});

/** `192.168.1.10:3000` -> `http://192.168.1.10:3000`. Throws with a message for the form. */
export function normalizeServerUrl(input: string): string {
	let value = input.trim();
	if (!value) throw new Error('Enter the server address');
	if (!/^[a-z]+:\/\//i.test(value)) value = `http://${value}`;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("That doesn't look like a server address");
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('The address must start with http:// or https://');
	}
	// Only scheme, host and port: the API lives at /api on the server's root.
	return url.origin;
}

/** Resolves when `url` answers like an eDMS server; throws a readable reason otherwise. */
async function probe(url: string) {
	let res: Response;
	try {
		res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
	} catch {
		throw new Error(`No answer from ${url}. Check the address and that the server is running.`);
	}
	const body = await res.json().catch(() => null);
	if (!res.ok || body?.service !== 'edms') {
		throw new Error(`${url} answered, but it isn't an eDMS server.`);
	}
}

function update(patch: Partial<Connection>) {
	connection.update((c) => ({ ...c, ...patch }));
}

/** Runs once at app start (desktop). */
export async function startConnection() {
	if (!isDesktop) return;
	onNetworkError(() => {
		if (get(connection).state === 'ready') {
			update({ state: 'unreachable', error: "The server stopped answering." });
		}
	});

	const url = savedServerUrl();
	if (!url) {
		update({ state: 'setup' });
		return;
	}
	setApiBaseUrl(url);
	update({ url });
	await retry();
}

export async function retry() {
	const { url } = get(connection);
	if (!url) return update({ state: 'setup' });
	update({ state: 'checking', error: '' });
	try {
		await probe(url);
		update({ state: 'ready', everReady: true });
	} catch (err) {
		update({ state: 'unreachable', error: (err as Error).message });
	}
}

/** From the setup form. Throws with a message to show next to the field. */
export async function connectTo(input: string) {
	const url = normalizeServerUrl(input);
	await probe(url);

	const previous = get(connection).url;
	saveServerUrl(url);
	setApiBaseUrl(url);
	update({ state: 'ready', url, everReady: true, error: '' });
	if (previous !== url) {
		// A session belongs to one server.
		forgetSession();
		await goto(resolve('/login'));
	}
}

export function changeServer() {
	update({ state: 'setup', error: '' });
}

export function cancelChangeServer() {
	const { url } = get(connection);
	if (url) retry();
}
