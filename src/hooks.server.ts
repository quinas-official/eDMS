import { json, redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { db, runMigrations } from '$lib/server/db';
import { startRetentionSchedule } from '$lib/server/retention';
import {
	deleteSessionCookie,
	readSessionToken,
	setSessionCookie,
	validateSessionToken
} from '$lib/server/auth/session';

// Bring the schema up to date before the first request, so deploying a new
// build onto an existing LAN server needs no separate migrate step.
export const init: ServerInit = () => {
	runMigrations(db);
	// Auto-archive and the purge of expired deleted documents, hourly. Not
	// while building, where the server only renders the desktop app's shell.
	if (!building) startRetentionSchedule();
};

// ---- CORS for the desktop app -----------------------------------------------------

/**
 * Where the desktop app's bundled pages come from (Tauri 2 defaults): macOS
 * and Linux use `tauri://localhost`, Windows `http://tauri.localhost` (https
 * with `useHttpsScheme`). `DESKTOP_ORIGINS` adds more, comma-separated.
 */
const DESKTOP_ORIGINS = new Set([
	'tauri://localhost',
	'http://tauri.localhost',
	'https://tauri.localhost',
	...(env.DESKTOP_ORIGINS ?? '')
		.split(',')
		.map((o) => o.trim().replace(/\/+$/, ''))
		.filter(Boolean)
]);

/**
 * The desktop app authenticates with a Bearer token, never a cookie, so no
 * `Allow-Credentials`: a browser page on an allowed origin still can't ride
 * on a web user's session.
 */
const handleCors: Handle = async ({ event, resolve }) => {
	if (!event.url.pathname.startsWith('/api/')) return resolve(event);
	const origin = event.request.headers.get('origin');
	const allowed = !!origin && DESKTOP_ORIGINS.has(origin);

	if (event.request.method === 'OPTIONS') {
		if (!allowed) return new Response(null, { status: 403 });
		return new Response(null, {
			status: 204,
			headers: {
				'Access-Control-Allow-Origin': origin,
				'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
				'Access-Control-Allow-Headers': 'Authorization, Content-Type',
				'Access-Control-Max-Age': '600',
				Vary: 'Origin'
			}
		});
	}

	const response = await resolve(event);
	if (!allowed) return response;

	const headers = new Headers(response.headers);
	headers.set('Access-Control-Allow-Origin', origin);
	// Lets the app read a download's file name and a rate limit's wait.
	headers.set('Access-Control-Expose-Headers', 'Content-Disposition, Retry-After');
	headers.append('Vary', 'Origin');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
};

// ---- Sessions ---------------------------------------------------------------------

/** Everything else under /api requires a signed-in user. */
const PUBLIC_API = new Set(['/api/health', '/api/auth/login', '/api/auth/logout']);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const handleAuth: Handle = ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.session = null;

	const found = readSessionToken(event);

	// CSRF: a write carrying the session cookie must come from this server's
	// own pages. (SvelteKit's built-in check is off; see svelte.config.js.)
	// Bearer requests can't be forged cross-site, so they're exempt.
	const origin = event.request.headers.get('origin');
	if (
		found?.source === 'cookie' &&
		!SAFE_METHODS.has(event.request.method) &&
		origin &&
		origin !== event.url.origin
	) {
		return json({ message: 'Cross-site request refused' }, { status: 403 });
	}

	if (found) {
		const result = validateSessionToken(found.token);
		if (result) {
			event.locals.user = result.user;
			event.locals.session = result.session;
			if (result.renewed && found.source === 'cookie') {
				setSessionCookie(event, found.token, result.session.expiresAt);
			}
		} else if (found.source === 'cookie') {
			deleteSessionCookie(event);
		}
	}

	const path = event.url.pathname;
	if (path.startsWith('/api/') && !PUBLIC_API.has(path) && !event.locals.user) {
		return json({ message: 'Not signed in' }, { status: 401 });
	}
	// Web only: saves a flash of the admin shell. The desktop app's bundled pages
	// never reach this, so the admin layout checks the session on the client too.
	if (path.startsWith('/admin') && !event.locals.user) {
		redirect(303, '/login');
	}

	return resolve(event);
};

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale)
		});
	});

export const handle: Handle = sequence(handleCors, handleAuth, handleParaglide);
