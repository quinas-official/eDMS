/**
 * Runs Vite for the desktop app's UI: `node scripts/desktop.js dev|build`.
 *
 * Sets BUILD_TARGET=desktop, which svelte.config.js and vite.config.ts read
 * to switch to the static adapter (output: build-desktop/) and turn on the
 * desktop code paths. A script rather than `BUILD_TARGET=desktop vite …` so it
 * works the same in cmd, PowerShell and POSIX shells. Tauri calls it through
 * `beforeDevCommand` / `beforeBuildCommand` in src-tauri/tauri.conf.json.
 */
import { spawn } from 'node:child_process';

const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'build') {
	console.error('Usage: node scripts/desktop.js dev|build');
	process.exit(1);
}

const args = mode === 'dev' ? ['dev', '--port', '5173', '--strictPort'] : ['build'];
const child = spawn('vite', args, {
	stdio: 'inherit',
	shell: true,
	env: { ...process.env, BUILD_TARGET: 'desktop' }
});
child.on('exit', (code) => process.exit(code ?? 1));
