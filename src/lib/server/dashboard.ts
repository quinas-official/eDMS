import { and, asc, count, countDistinct, desc, eq, gt, gte, isNotNull, isNull, sql, sum } from 'drizzle-orm';
import type { DashboardSummary } from '$lib/dashboard/types';
import { DOCUMENT_STATUSES, type DocumentStatus } from '$lib/server/db/schema';
import { db, schema } from '$lib/server/db';
import { listActivity } from './activity';

const { documents, documentVersions, departments, users, sessions, activityLog } = schema;

const DAY_MS = 86_400_000;
const UPLOAD_DAYS = 14;
/** Beyond this many file types the rest are folded into "Other". */
const MAX_TYPES = 5;

/**
 * The admin dashboard's numbers. Admin-only, so nothing here is department
 * scoped. `tzOffsetMinutes` is the browser's `Date#getTimezoneOffset()`, so
 * "per day" means the viewer's calendar days, not UTC ones.
 */
export function getDashboardSummary(tzOffsetMinutes = 0): DashboardSummary {
	const now = Date.now();
	const live = isNull(documents.deletedAt);

	const docCount = (where = live) =>
		db.select({ n: count() }).from(documents).where(where).get()?.n ?? 0;

	const storage = db
		.select({ bytes: sum(documentVersions.size), versions: count() })
		.from(documentVersions)
		.get();

	const byStatus = Object.fromEntries(DOCUMENT_STATUSES.map((s) => [s, 0])) as Record<
		DocumentStatus,
		number
	>;
	for (const row of db
		.select({ status: documents.status, n: count() })
		.from(documents)
		.where(live)
		.groupBy(documents.status)
		.all()) {
		byStatus[row.status] = row.n;
	}

	// Every department, even empty ones, so the chart's colour order is stable.
	const deptCounts = new Map(
		db
			.select({ id: documents.departmentId, n: count() })
			.from(documents)
			.where(live)
			.groupBy(documents.departmentId)
			.all()
			.map((r) => [r.id, r.n])
	);
	const byDepartment: DashboardSummary['byDepartment'] = db
		.select({ id: departments.id, name: departments.name })
		.from(departments)
		.orderBy(asc(departments.id))
		.all()
		.map((d) => ({ ...d, count: deptCounts.get(d.id) ?? 0 }));
	const unfiled = deptCounts.get(null) ?? 0;
	if (unfiled) byDepartment.push({ id: null, name: 'No department', count: unfiled });

	return {
		totals: {
			documents: docCount(),
			deleted: docCount(isNotNull(documents.deletedAt)),
			activeUsers:
				db.select({ n: count() }).from(users).where(eq(users.status, 'active')).get()?.n ?? 0,
			storageBytes: Number(storage?.bytes ?? 0),
			versions: storage?.versions ?? 0
		},
		byStatus,
		byDepartment,
		byType: countByType(),
		uploadsByDay: uploadsByDay(now, tzOffsetMinutes),
		recentActivity: listActivity({ limit: 8 }).entries,
		recentDocuments: db
			.select({
				id: documents.id,
				reference: documents.reference,
				title: documents.title,
				status: documents.status,
				department: departments.name,
				updatedAt: documents.updatedAt
			})
			.from(documents)
			.leftJoin(departments, eq(documents.departmentId, departments.id))
			.where(live)
			.orderBy(desc(documents.updatedAt))
			.limit(5)
			.all()
			.map((d) => ({ ...d, updatedAt: d.updatedAt.toISOString() })),
		security: {
			failedSignIns24h:
				db
					.select({ n: count() })
					.from(activityLog)
					.where(
						and(
							eq(activityLog.action, 'login_failed'),
							gte(activityLog.createdAt, new Date(now - DAY_MS))
						)
					)
					.get()?.n ?? 0,
			signedInUsers:
				db
					.select({ n: countDistinct(sessions.userId) })
					.from(sessions)
					.where(gt(sessions.expiresAt, new Date(now)))
					.get()?.n ?? 0
		},
		generatedAt: new Date(now).toISOString()
	};
}

/** By each live document's latest file, e.g. PDF, DOCX; the long tail becomes "Other". */
function countByType(): DashboardSummary['byType'] {
	const latest = db
		.select({
			documentId: documentVersions.documentId,
			number: sql<number>`max(${documentVersions.versionNumber})`.as('number')
		})
		.from(documentVersions)
		.groupBy(documentVersions.documentId)
		.as('latest');

	const names = db
		.select({ name: documentVersions.originalName })
		.from(documentVersions)
		.innerJoin(
			latest,
			and(
				eq(documentVersions.documentId, latest.documentId),
				eq(documentVersions.versionNumber, latest.number)
			)
		)
		.innerJoin(documents, eq(documents.id, documentVersions.documentId))
		.where(isNull(documents.deletedAt))
		.all();

	const counts = new Map<string, number>();
	for (const { name } of names) {
		const dot = name.lastIndexOf('.');
		const label = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : 'Other';
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}

	const sorted = [...counts].map(([label, n]) => ({ label, count: n }));
	sorted.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
	if (sorted.length <= MAX_TYPES) return sorted;
	const head = sorted.slice(0, MAX_TYPES - 1);
	const rest = sorted.slice(MAX_TYPES - 1).reduce((total, t) => total + t.count, 0);
	return [...head, { label: 'Other', count: rest }];
}

function uploadsByDay(now: number, tzOffsetMinutes: number): DashboardSummary['uploadsByDay'] {
	// Shift timestamps into the viewer's local time, then take the calendar date.
	const shiftMs = -tzOffsetMinutes * 60_000;
	const localDay = (ms: number) => new Date(ms + shiftMs).toISOString().slice(0, 10);

	const today = localDay(now);
	const firstDay = new Date(Date.parse(today) - (UPLOAD_DAYS - 1) * DAY_MS);
	const since = new Date(firstDay.getTime() - shiftMs);

	const day = sql<string>`date((${documentVersions.createdAt} + ${shiftMs}) / 1000, 'unixepoch')`;
	const counts = new Map(
		db
			.select({ day, n: count() })
			.from(documentVersions)
			.where(gte(documentVersions.createdAt, since))
			.groupBy(day)
			.all()
			.map((r) => [r.day, r.n])
	);

	return Array.from({ length: UPLOAD_DAYS }, (_, i) => {
		const date = new Date(firstDay.getTime() + i * DAY_MS).toISOString().slice(0, 10);
		return { date, count: counts.get(date) ?? 0 };
	});
}
