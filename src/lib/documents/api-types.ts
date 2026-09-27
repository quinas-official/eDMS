import type { DocumentStatus } from '$lib/server/db/schema';

export type { DocumentStatus };

/**
 * Shapes returned by /api/documents. Dates are ISO strings; the UI's older
 * `DocumentMeta` in `./types` goes away once the documents page is on the API.
 */

export interface DocumentVersionDTO {
	id: string;
	versionNumber: number;
	originalName: string;
	mimeType: string;
	size: number;
	sha256: string;
	note: string;
	/** Plain text from DOCX/TXT uploads, for the content diff; null for other types. */
	extractedText: string | null;
	uploadedBy: { id: string; name: string } | null;
	createdAt: string;
}

export interface DocumentDTO {
	id: string;
	reference: string;
	title: string;
	description: string;
	status: DocumentStatus;
	department: { id: number; name: string } | null;
	owner: { id: string; name: string };
	assignee: { id: string; name: string } | null;
	/** The newest version, without its extracted text. */
	latestVersion: Omit<DocumentVersionDTO, 'extractedText'> | null;
	versionCount: number;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
	deletedAt: string | null;
}

export interface DocumentDetailDTO extends DocumentDTO {
	/** Oldest first. */
	versions: DocumentVersionDTO[];
}

export interface DocumentListResponse {
	documents: DocumentDTO[];
	total: number;
	page: number;
	pageSize: number;
}

/** An audit-log entry about one document, for its Approval Timeline. */
export interface DocumentActivityDTO {
	id: number;
	action: string;
	actor: string;
	details: string | null;
	createdAt: string;
}

export interface DocumentListQuery {
	search?: string;
	status?: DocumentStatus;
	departmentId?: number;
	/** Admins and users with `delete` only: list soft-deleted documents instead. */
	deleted?: boolean;
	page?: number;
	pageSize?: number;
}

export interface DocumentUpdate {
	title?: string;
	description?: string;
	status?: DocumentStatus;
	departmentId?: number | null;
	assigneeId?: string | null;
}
