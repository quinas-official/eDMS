import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import type { ActivityListQuery, ActivityListResponse } from '$lib/activity/types';
import { db, schema } from '$lib/server/db';

export interface ActivityInput {
	action: string;
	/** Who did it; null for anonymous events such as a failed sign-in. */
	actor: { id: string; name: string } | null;
	/** Label to record when there is no actor, e.g. the username that was tried. */
	actorName?: string;
	targetType?: string;
	targetId?: string;
	target?: string;
	details?: string;
	metadata?: Record<string, unknown>;
}

/** Appends to the audit trail. Entries can't be changed afterwards (see the DB triggers). */
export function logActivity(entry: ActivityInput) {
	db.insert(schema.activityLog)
		.values({
			action: entry.action,
			actorId: entry.actor?.id ?? null,
			actorName: entry.actor?.name ?? entry.actorName ?? 'Unknown',
			targetType: entry.targetType,
			targetId: entry.targetId,
			target: entry.target,
			details: entry.details,
			metadata: entry.metadata
		})
		.run();
}

const LIMIT_MAX = 100;

/**
 * Newest first, paged by id: ids only grow, so a cursor stays stable while new
 * entries keep arriving, where an offset would shift under the reader.
 */
export function listActivity(query: ActivityListQuery): ActivityListResponse {
	const { activityLog } = schema;
	const conditions: SQL[] = [];
	if (query.action) conditions.push(eq(activityLog.action, query.action));
	if (query.before !== undefined) conditions.push(lt(activityLog.id, query.before));
	if (query.search) {
		const pattern = `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		conditions.push(
			or(
				sql`${activityLog.actorName} like ${pattern} escape '\\'`,
				sql`${activityLog.target} like ${pattern} escape '\\'`,
				sql`${activityLog.details} like ${pattern} escape '\\'`
			)!
		);
	}

	const limit = Math.min(LIMIT_MAX, Math.max(1, query.limit ?? 50));
	// One extra row tells us whether there's another page.
	const rows = db
		.select({
			id: activityLog.id,
			action: activityLog.action,
			actor: activityLog.actorName,
			actorId: activityLog.actorId,
			targetType: activityLog.targetType,
			targetId: activityLog.targetId,
			target: activityLog.target,
			details: activityLog.details,
			createdAt: activityLog.createdAt
		})
		.from(activityLog)
		.where(and(...conditions))
		.orderBy(desc(activityLog.id))
		.limit(limit + 1)
		.all();

	const page = rows.slice(0, limit);
	return {
		entries: page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
		nextCursor: rows.length > limit ? page[page.length - 1].id : null
	};
}
