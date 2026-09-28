import { writable } from 'svelte/store';

/**
 * Set by the login page just before it navigates away; the root layout shows
 * a short "Signed in" modal over whichever page the user lands on.
 */
export const welcome = writable<{ name: string } | null>(null);

export function showWelcome(name: string) {
	welcome.set({ name });
}
