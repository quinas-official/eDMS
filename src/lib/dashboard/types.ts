import type { ActivityEntryDTO } from '$lib/activity/types';
import type { DocumentStatus } from '$lib/documents/api-types';

/** What /api/dashboard returns: one round trip for the whole admin overview. */
export interface DashboardSummary {
	totals: {
		/** Not deleted. */
		documents: number;
		/** Soft-deleted, still restorable. */
		deleted: number;
		activeUsers: number;
		/** Every stored file version, including those of deleted documents. */
		storageBytes: number;
		versions: number;
	};
	byStatus: Record<DocumentStatus, number>;
	/** Ordered by department id so each keeps its chart colour; `id: null` is "No department". */
	byDepartment: { id: number | null; name: string; count: number }[];
	/** By the latest version's file extension, largest first. */
	byType: { label: string; count: number }[];
	/**
	 * Files uploaded (new documents and new versions) per local calendar day, for
	 * the last 14 days, oldest first. Days with none are included as 0.
	 */
	uploadsByDay: { date: string; count: number }[];
	recentActivity: ActivityEntryDTO[];
	recentDocuments: {
		id: string;
		reference: string;
		title: string;
		status: DocumentStatus;
		department: string | null;
		updatedAt: string;
	}[];
	security: {
		failedSignIns24h: number;
		/** Users with a session that hasn't expired. */
		signedInUsers: number;
	};
	generatedAt: string;
}
