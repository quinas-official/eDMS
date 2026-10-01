import type {
	DocumentActivityDTO,
	DocumentDetailDTO,
	DocumentListQuery,
	DocumentListResponse,
	DocumentStatus,
	DocumentUpdate
} from '$lib/documents/api-types';
import { apiFetch, apiFetchResponse } from './client';

export function listDocuments(query: DocumentListQuery = {}) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined && value !== '' && value !== false) params.set(key, String(value));
	}
	const qs = params.toString();
	return apiFetch<DocumentListResponse>(`/api/documents${qs ? `?${qs}` : ''}`);
}

export async function getDocument(id: string) {
	return (await apiFetch<{ document: DocumentDetailDTO }>(`/api/documents/${id}`)).document;
}

export async function listDocumentActivity(id: string) {
	return (await apiFetch<{ activity: DocumentActivityDTO[] }>(`/api/documents/${id}/activity`))
		.activity;
}

export interface NewDocumentInput {
	file: File;
	title?: string;
	description?: string;
	status?: DocumentStatus;
	/**
	 * null files it under no department. Omitted: the user's own department, or
	 * for admins the default from Settings. Non-admins can only pick their own.
	 */
	departmentId?: number | null;
	note?: string;
}

export async function createDocument({ file, ...fields }: NewDocumentInput) {
	const body = new FormData();
	body.set('file', file);
	for (const [key, value] of Object.entries(fields)) {
		if (value !== undefined) body.set(key, value === null ? '' : String(value));
	}
	const res = await apiFetch<{ document: DocumentDetailDTO }>('/api/documents', {
		method: 'POST',
		body
	});
	return res.document;
}

export async function uploadVersion(id: string, file: File, note?: string) {
	const body = new FormData();
	body.set('file', file);
	if (note) body.set('note', note);
	const res = await apiFetch<{ document: DocumentDetailDTO }>(`/api/documents/${id}/versions`, {
		method: 'POST',
		body
	});
	return res.document;
}

export async function updateDocument(id: string, update: DocumentUpdate) {
	const res = await apiFetch<{ document: DocumentDetailDTO }>(`/api/documents/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(update)
	});
	return res.document;
}

export function deleteDocument(id: string) {
	return apiFetch<void>(`/api/documents/${id}`, { method: 'DELETE' });
}

/** Moves a document out of (or back into) the active list. Needs `upload` or `approve`. */
export async function setDocumentArchived(id: string, archived: boolean) {
	const res = await apiFetch<{ document: DocumentDetailDTO }>(`/api/documents/${id}/archive`, {
		method: 'POST',
		body: JSON.stringify({ archived })
	});
	return res.document;
}

export async function restoreDocument(id: string) {
	const res = await apiFetch<{ document: DocumentDetailDTO }>(`/api/documents/${id}/restore`, {
		method: 'POST'
	});
	return res.document;
}

/**
 * Fetches a version's file as a Blob. Goes through `apiFetchResponse` rather
 * than a plain link so the desktop app's Bearer header applies too.
 */
export async function fetchDocumentFile(
	id: string,
	opts: { version?: number; inline?: boolean } = {}
) {
	const params = new URLSearchParams();
	if (opts.version !== undefined) params.set('version', String(opts.version));
	if (opts.inline) params.set('inline', 'true');
	const qs = params.toString();
	const res = await apiFetchResponse(`/api/documents/${id}/download${qs ? `?${qs}` : ''}`, {
		headers: { Accept: '*/*' }
	});
	return res.blob();
}
