import { and, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import type { DocumentStatus } from '$lib/server/db/schema';
import { logActivity } from '$lib/server/activity';
import { db, schema } from '$lib/server/db';
import { getAppSettings } from '$lib/server/settings';
import { removeFile } from '$lib/server/storage/files';
import type { AppSettings } from '$lib/settings/types';

const { documents, documentVersions } = schema;

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Only settled documents are archived. Anything in review (pending,
 * reviewed) stays on the board however old it is, so nothing vanishes from
 * under a reviewer.
 */
const ARCHIVABLE: DocumentStatus[] = ['draft', 'approved', 'rejected'];

const SYSTEM = { actor: null, actorName: 'System' } as const;

export interface RetentionResult {
	at: string;
	archived: number;
	purged: number;
	/** Why nothing ran, e.g. a backup was being written. */
	skipped?: string;
}

// ---- Coordination with backups ------------------------------------------------

let backupsRunning = 0;

/**
 * Held while a backup copies files, so a purge can't delete a file the
 * backup's database snapshot still points at.
 */
export function beginBackup() {
	backupsRunning++;
	let done = false;
	return () => {
		if (!done) backupsRunning--;
		done = true;
	};
}

// ---- The job ------------------------------------------------------------------

let running = false;
let lastRun: RetentionResult | null = null;

export function getLastRetentionRun() {
	return lastRun;
}

/**
 * Auto-archives documents untouched for `archiveAfterDays` (when enabled) and
 * permanently removes documents deleted more than `purgeDeletedAfterDays`
 * ago, files included. Every document affected gets its own audit entry.
 */
export async function runRetention(
	now = new Date(),
	settings: AppSettings = getAppSettings()
): Promise<RetentionResult> {
	const at = now.toISOString();
	if (running) return { at, archived: 0, purged: 0, skipped: 'Already running' };
	if (backupsRunning) return { at, archived: 0, purged: 0, skipped: 'A backup is being written' };
	running = true;
	try {
		const archived = archiveStale(now, settings);
		const purged = await purgeDeleted(now, settings);
		lastRun = { at, archived, purged };
		return lastRun;
	} finally {
		running = false;
	}
}

function archiveStale(now: Date, { retention }: AppSettings) {
	if (!retention.autoArchiveEnabled) return 0;
	const cutoff = new Date(now.getTime() - retention.archiveAfterDays * DAY);

	return db.transaction(() => {
		const stale = db
			.select({ id: documents.id, title: documents.title })
			.from(documents)
			.where(
				and(
					isNull(documents.deletedAt),
					isNull(documents.archivedAt),
					inArray(documents.status, ARCHIVABLE),
					lt(documents.updatedAt, cutoff)
				)
			)
			.all();
		if (!stale.length) return 0;

		db.update(documents)
			.set({ archivedAt: now })
			.where(inArray(documents.id, stale.map((d) => d.id)))
			.run();
		for (const doc of stale) {
			logActivity({
				action: 'archived',
				...SYSTEM,
				targetType: 'document',
				targetId: doc.id,
				target: doc.title,
				details: `Automatically, after ${retention.archiveAfterDays} days without changes`
			});
		}
		return stale.length;
	});
}

async function purgeDeleted(now: Date, { retention }: AppSettings) {
	const cutoff = new Date(now.getTime() - retention.purgeDeletedAfterDays * DAY);

	const { count, keys } = db.transaction(() => {
		const expired = db
			.select({ id: documents.id, title: documents.title, reference: documents.reference })
			.from(documents)
			.where(and(isNotNull(documents.deletedAt), lt(documents.deletedAt, cutoff)))
			.all();
		if (!expired.length) return { count: 0, keys: [] as string[] };

		const ids = expired.map((d) => d.id);
		const keys = db
			.select({ key: documentVersions.storageKey })
			.from(documentVersions)
			.where(inArray(documentVersions.documentId, ids))
			.all()
			.map((v) => v.key);

		// Versions go with the row (ON DELETE CASCADE); the audit trail stays.
		db.delete(documents).where(inArray(documents.id, ids)).run();
		for (const doc of expired) {
			logActivity({
				action: 'purged',
				...SYSTEM,
				targetType: 'document',
				targetId: doc.id,
				target: doc.title,
				details: `${doc.reference}: deleted more than ${retention.purgeDeletedAfterDays} days ago`
			});
		}
		return { count: expired.length, keys };
	});

	// Only once the rows are gone: a file without a row is harmless, a row without its file isn't.
	for (const key of keys) await removeFile(key);
	return count;
}

// ---- Schedule -----------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null;

/** Hourly, starting a minute after boot so startup isn't slowed down. */
export function startRetentionSchedule() {
	if (timer) return;
	const tick = () =>
		runRetention().catch((err) => console.error('[retention] run failed:', err));
	setTimeout(tick, 60_000).unref?.();
	timer = setInterval(tick, HOUR);
	timer.unref?.();
}
