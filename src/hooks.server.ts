import { json, redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
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
	// Auto-archive and the purge of expired deleted documents, hourly.
	startRetentionSchedule();
};

/** Everything else under /api requires a signed-in user. */
const PUBLIC_API = new Set(['/api/health', '/api/auth/login', '/api/auth/logout']);

const handleAuth: Handle = ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.session = null;

	const found = readSessionToken(event);
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

export const handle: Handle = sequence(handleAuth, handleParaglide);
