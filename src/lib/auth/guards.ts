import type { AuthUser } from '$lib/auth/types';
import { can, isAdmin } from '$lib/permissions';

/**
 * Which `/admin` pages a user may open. This only decides what the UI shows;
 * the API enforces access itself. It runs on the client because the desktop
 * app's pages are bundled and never pass through the server's hooks.
 */

/** Where non-admins land, and the one admin-area page every signed-in user can open. */
export const NON_ADMIN_HOME = '/admin/documents';

export const WORKFLOW_PATH = '/admin/workflow';

export function canAccessPath(user: AuthUser | null, path: string): boolean {
	if (!user) return false;
	if (isAdmin(user)) return true;
	if (path === NON_ADMIN_HOME) return true;
	// The approval board is for the people who move documents through it.
	return path === WORKFLOW_PATH && can(user, 'approve');
}
