// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { AuthUser } from '$lib/auth/types';
import type { Session } from '$lib/server/db/schema';

declare global {
	/** Set by vite.config.ts: true in the desktop app's static build. Use `isDesktop` from `$lib/config/env`. */
	const __DESKTOP__: boolean;

	namespace App {
		// interface Error {}
		interface Locals {
			/** Set by `hooks.server.ts` from the session cookie or Bearer token. */
			user: AuthUser | null;
			session: Session | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
