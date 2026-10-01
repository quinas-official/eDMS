import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Two builds from one codebase:
 * - web (default): a Node server that hosts the UI and the /api endpoints
 *   that both the browser and the desktop app talk to.
 * - desktop (`BUILD_TARGET=desktop`, see scripts/build-desktop.js): the same
 *   UI as static files with a client-side fallback, bundled into the Tauri
 *   app. It has no server of its own; it calls the configured server's /api.
 */
const desktop = process.env.BUILD_TARGET === 'desktop';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter: desktop
			? adapterStatic({ pages: 'build-desktop', assets: 'build-desktop', fallback: 'index.html' })
			: adapterNode(),
		outDir: desktop ? '.svelte-kit-desktop' : '.svelte-kit',
		csrf: {
			// SvelteKit's own check would reject the desktop app's multipart uploads
			// (a cross-origin form POST) and is fixed at build time. hooks.server.ts
			// does a stricter check at runtime instead: cookie-authenticated writes
			// must be same-origin; Bearer requests can't be forged by another site.
			trustedOrigins: ['*']
		}
	}
};

export default config;
