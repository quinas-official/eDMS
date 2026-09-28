/** Actions the server records in the audit log. */
export type ActivityAction =
	| 'created'
	| 'edited'
	| 'approved'
	| 'rejected'
	| 'deleted'
	| 'restored'
	| 'archived'
	| 'purged'
	| 'downloaded'
	| 'login'
	| 'logout'
	| 'login_failed';

export const ACTIVITY_ACTIONS: { value: ActivityAction; label: string }[] = [
	{ value: 'created', label: 'Created' },
	{ value: 'edited', label: 'Edited' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'rejected', label: 'Rejected' },
	{ value: 'deleted', label: 'Deleted' },
	{ value: 'restored', label: 'Restored' },
	{ value: 'archived', label: 'Archived' },
	{ value: 'purged', label: 'Purged' },
	{ value: 'downloaded', label: 'Downloaded' },
	{ value: 'login', label: 'Signed in' },
	{ value: 'logout', label: 'Signed out' },
	{ value: 'login_failed', label: 'Failed sign-in' }
];

export function actionLabel(action: string) {
	return ACTIVITY_ACTIONS.find((a) => a.value === action)?.label ?? action;
}

/** One audit-log entry as /api/activity returns it. */
export interface ActivityEntryDTO {
	id: number;
	action: string;
	/** Name at the time; stays readable after the account is removed. */
	actor: string;
	actorId: string | null;
	targetType: string | null;
	targetId: string | null;
	/** Label for the target at the time, e.g. the document title. */
	target: string | null;
	details: string | null;
	createdAt: string;
}

export interface ActivityListQuery {
	action?: string;
	/** Matches actor, target and details. */
	search?: string;
	/** Cursor: only entries older than this id. */
	before?: number;
	limit?: number;
}

export interface ActivityListResponse {
	/** Newest first. */
	entries: ActivityEntryDTO[];
	/** Pass as `before` for the next page; null when there are no more. */
	nextCursor: number | null;
}
