import { writable } from 'svelte/store';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
	id: number;
	kind: ToastKind;
	message: string;
	description?: string;
	/** Milliseconds before it hides itself; 0 keeps it until dismissed. */
	duration: number;
}

interface ToastOptions {
	description?: string;
	duration?: number;
}

/** Errors stay longer: they're more likely to need reading. */
const DEFAULT_DURATION: Record<ToastKind, number> = { success: 4000, info: 4000, error: 7000 };

/** Oldest toasts are dropped past this so a burst of failures can't fill the screen. */
const MAX_VISIBLE = 4;

let nextId = 1;

export const toasts = writable<Toast[]>([]);

function push(kind: ToastKind, message: string, options: ToastOptions = {}) {
	const entry: Toast = {
		id: nextId++,
		kind,
		message,
		description: options.description,
		duration: options.duration ?? DEFAULT_DURATION[kind]
	};
	toasts.update((list) => [...list, entry].slice(-MAX_VISIBLE));
	return entry.id;
}

export function dismissToast(id: number) {
	toasts.update((list) => list.filter((t) => t.id !== id));
}

/**
 * Bottom-right notifications, e.g. `toast.success('Document uploaded')`.
 * The timers live in the Toaster so hovering can pause them.
 */
export const toast = {
	success: (message: string, options?: ToastOptions) => push('success', message, options),
	error: (message: string, options?: ToastOptions) => push('error', message, options),
	info: (message: string, options?: ToastOptions) => push('info', message, options),
	dismiss: dismissToast
};
