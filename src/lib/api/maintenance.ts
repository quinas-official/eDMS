import { getApiBaseUrl } from '$lib/config/env';
import { apiFetch, apiFetchResponse } from './client';

/** One run of the retention job, as /api/retention reports it. */
export interface RetentionRunDTO {
	at: string;
	archived: number;
	purged: number;
	skipped?: string;
}

/** Admins only. Null until the job has run since the server started. */
export async function getLastRetentionRun() {
	return (await apiFetch<{ lastRun: RetentionRunDTO | null }>('/api/retention')).lastRun;
}

/** Admins only. 409 while a backup is being written. */
export async function runRetentionNow() {
	return (await apiFetch<{ lastRun: RetentionRunDTO }>('/api/retention', { method: 'POST' })).lastRun;
}

/**
 * Admins only. A plain link rather than a fetch, so the browser streams a
 * large archive straight to disk instead of holding it in memory. (The web
 * app's session cookie goes along with it.)
 */
export function backupDownloadUrl() {
	return `${getApiBaseUrl()}/api/backup`;
}

/**
 * Desktop: a link can't carry the Bearer token, so the archive is fetched and
 * saved from memory. Fine for typical libraries; very large ones are better
 * downloaded from the web app.
 */
export async function downloadBackupWithToken() {
	const res = await apiFetchResponse('/api/backup', { headers: { Accept: 'application/gzip' } });
	const name =
		/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'edms-backup.tar.gz';
	const { saveAs } = await import('file-saver');
	saveAs(await res.blob(), name);
}
