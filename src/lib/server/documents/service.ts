import { error } from '@sveltejs/kit';
import {
	aliasedTable,
	and,
	count,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	or,
	sql,
	type SQL
} from 'drizzle-orm';
import type { AuthUser } from '$lib/auth/types';
import type {
	DocumentActivityDTO,
	DocumentDetailDTO,
	DocumentDTO,
	DocumentListQuery,
	DocumentListResponse,
	DocumentUpdate,
	DocumentVersionDTO
} from '$lib/documents/api-types';
import { can, isAdmin } from '$lib/permissions';
import { logActivity } from '$lib/server/activity';
import { db, schema } from '$lib/server/db';
import { DOCUMENT_STATUSES, type Document, type DocumentStatus } from '$lib/server/db/schema';
import { getAppSettings } from '$lib/server/settings';
import { removeFile, saveFile } from '$lib/server/storage/files';
import type { AppSettings } from '$lib/settings/types';
import { extractText, type Upload } from './upload';

const { documents, documentVersions, departments, users } = schema;

const owners = aliasedTable(users, 'owner');
const assignees = aliasedTable(users, 'assignee');
const uploaders = aliasedTable(users, 'uploader');

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 5000;
export const NOTE_MAX = 1000;
const PAGE_SIZE_MAX = 100;

// ---- Reading ----------------------------------------------------------------

const documentColumns = {
	doc: documents,
	department: { id: departments.id, name: departments.name },
	owner: { id: owners.id, name: owners.name },
	assignee: { id: assignees.id, name: assignees.name }
};

function selectDocuments() {
	return db
		.select(documentColumns)
		.from(documents)
		.innerJoin(owners, eq(documents.ownerId, owners.id))
		.leftJoin(departments, eq(documents.departmentId, departments.id))
		.leftJoin(assignees, eq(documents.assigneeId, assignees.id))
		.$dynamic();
}

type Ref<T> = { id: T; name: string };

/**
 * Written out because Drizzle infers `never` for a select that mixes a whole
 * table with nested objects over aliased joins; the runtime shape is this.
 */
interface DocumentRow {
	doc: Document;
	department: Ref<number> | null;
	owner: Ref<string>;
	assignee: Ref<string> | null;
}

// Everything but `extractedText`, which can be large and only the detail view needs.
const versionColumns = {
	id: documentVersions.id,
	documentId: documentVersions.documentId,
	versionNumber: documentVersions.versionNumber,
	originalName: documentVersions.originalName,
	mimeType: documentVersions.mimeType,
	size: documentVersions.size,
	sha256: documentVersions.sha256,
	note: documentVersions.note,
	createdAt: documentVersions.createdAt,
	uploader: { id: uploaders.id, name: uploaders.name }
};

function selectVersions(documentIds: string[]) {
	return db
		.select(versionColumns)
		.from(documentVersions)
		.leftJoin(uploaders, eq(documentVersions.uploadedById, uploaders.id))
		.where(inArray(documentVersions.documentId, documentIds))
		.orderBy(documentVersions.versionNumber)
		.all();
}

type VersionRow = ReturnType<typeof selectVersions>[number];

function toVersionSummary(row: VersionRow): Omit<DocumentVersionDTO, 'extractedText'> {
	return {
		id: row.id,
		versionNumber: row.versionNumber,
		originalName: row.originalName,
		mimeType: row.mimeType,
		size: row.size,
		sha256: row.sha256,
		note: row.note,
		uploadedBy: row.uploader,
		createdAt: row.createdAt.toISOString()
	};
}

function toDocumentDTO(row: DocumentRow, versions: VersionRow[]): DocumentDTO {
	const { doc } = row;
	const latest = versions.at(-1);
	return {
		id: doc.id,
		reference: doc.reference,
		title: doc.title,
		description: doc.description,
		status: doc.status,
		department: row.department,
		owner: row.owner,
		assignee: row.assignee,
		latestVersion: latest ? toVersionSummary(latest) : null,
		versionCount: versions.length,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
		archivedAt: doc.archivedAt?.toISOString() ?? null,
		deletedAt: doc.deletedAt?.toISOString() ?? null
	};
}

function escapeLike(text: string) {
	return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Admins and approvers work across the whole organization; nobody else is
 * limited by department.
 */
function seesAllDepartments(user: AuthUser) {
	return isAdmin(user) || can(user, 'approve');
}

/**
 * Department scoping: everyone else sees their own department's documents
 * plus any they own or are assigned to review, so a cross-department reviewer
 * can still open what's on their plate. "No department" acts as a department
 * of its own: users without one see the unfiled documents.
 */
function visibleTo(user: AuthUser): SQL | undefined {
	if (seesAllDepartments(user)) return undefined;
	return or(
		user.departmentId === null
			? isNull(documents.departmentId)
			: eq(documents.departmentId, user.departmentId),
		eq(documents.ownerId, user.id),
		eq(documents.assigneeId, user.id)
	);
}

/** Row-level twin of `visibleTo`; keep the two in step. */
function canSee(user: AuthUser, doc: Document) {
	return (
		seesAllDepartments(user) ||
		doc.departmentId === user.departmentId ||
		doc.ownerId === user.id ||
		doc.assigneeId === user.id
	);
}

export function listDocuments(user: AuthUser, query: DocumentListQuery): DocumentListResponse {
	const conditions: SQL[] = [];
	const scope = visibleTo(user);
	if (scope) conditions.push(scope);

	if (query.deleted) {
		if (!can(user, 'delete')) error(403, 'You do not have permission to see deleted documents');
		conditions.push(isNotNull(documents.deletedAt));
	} else {
		conditions.push(isNull(documents.deletedAt));
	}
	if (query.status) conditions.push(eq(documents.status, query.status));
	if (query.departmentId !== undefined) {
		conditions.push(eq(documents.departmentId, query.departmentId));
	}
	if (query.search) {
		const pattern = `%${escapeLike(query.search)}%`;
		conditions.push(
			or(
				sql`${documents.title} like ${pattern} escape '\\'`,
				sql`${documents.reference} like ${pattern} escape '\\'`,
				sql`${documents.description} like ${pattern} escape '\\'`
			)!
		);
	}

	const where = and(...conditions);
	const page = Math.max(1, query.page ?? 1);
	const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, query.pageSize ?? 25));

	const total = db.select({ n: count() }).from(documents).where(where).get()?.n ?? 0;
	const rows = selectDocuments()
		.where(where)
		.orderBy(desc(documents.updatedAt))
		.limit(pageSize)
		.offset((page - 1) * pageSize)
		.all() as DocumentRow[];

	const versionsByDoc = groupVersions(rows.length ? selectVersions(rows.map((r) => r.doc.id)) : []);

	return {
		documents: rows.map((row) => toDocumentDTO(row, versionsByDoc.get(row.doc.id) ?? [])),
		total,
		page,
		pageSize
	};
}

function groupVersions(rows: VersionRow[]) {
	const map = new Map<string, VersionRow[]>();
	for (const row of rows) {
		const list = map.get(row.documentId);
		if (list) list.push(row);
		else map.set(row.documentId, [row]);
	}
	return map;
}

/**
 * 404s for missing documents, ones outside the user's scope (so ids from other
 * departments can't be probed), and deleted ones unless the user can restore them.
 */
function loadDocument(user: AuthUser, id: string): DocumentRow {
	const row = selectDocuments().where(eq(documents.id, id)).get() as DocumentRow | undefined;
	if (!row || !canSee(user, row.doc) || (row.doc.deletedAt && !can(user, 'delete'))) {
		error(404, 'Document not found');
	}
	return row;
}

export function getDocumentDetail(user: AuthUser, id: string): DocumentDetailDTO {
	const row = loadDocument(user, id);
	const versions = db
		.select({ ...versionColumns, extractedText: documentVersions.extractedText })
		.from(documentVersions)
		.leftJoin(uploaders, eq(documentVersions.uploadedById, uploaders.id))
		.where(eq(documentVersions.documentId, id))
		.orderBy(documentVersions.versionNumber)
		.all();
	return {
		...toDocumentDTO(row, versions),
		versions: versions.map((v) => ({ ...toVersionSummary(v), extractedText: v.extractedText }))
	};
}

/**
 * The document's audit trail, oldest first. Downloads and previews are left
 * out: they're in the system log, but would drown the timeline.
 */
export function listDocumentActivity(user: AuthUser, id: string): DocumentActivityDTO[] {
	loadDocument(user, id);
	const { activityLog } = schema;
	return db
		.select({
			id: activityLog.id,
			action: activityLog.action,
			actor: activityLog.actorName,
			details: activityLog.details,
			createdAt: activityLog.createdAt
		})
		.from(activityLog)
		.where(
			and(
				eq(activityLog.targetType, 'document'),
				eq(activityLog.targetId, id),
				ne(activityLog.action, 'downloaded')
			)
		)
		.orderBy(activityLog.createdAt, activityLog.id)
		.all()
		.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/** The file to serve: a given version number, or the latest. */
export function getVersionForDownload(user: AuthUser, id: string, versionNumber?: number) {
	const row = loadDocument(user, id);
	const version = db
		.select()
		.from(documentVersions)
		.where(
			versionNumber === undefined
				? eq(documentVersions.documentId, id)
				: and(
						eq(documentVersions.documentId, id),
						eq(documentVersions.versionNumber, versionNumber)
					)
		)
		.orderBy(desc(documentVersions.versionNumber))
		.limit(1)
		.get();
	if (!version) error(404, 'Version not found');
	return { document: row.doc, version };
}

// ---- Rules ------------------------------------------------------------------

/** Workflow decisions; with "Require approval" on, only users with `approve` can make them. */
const DECISIONS: readonly DocumentStatus[] = ['reviewed', 'approved', 'rejected'];

function assertStatusAllowed(user: AuthUser, status: DocumentStatus, settings: AppSettings) {
	if (DECISIONS.includes(status) && settings.documents.requireApproval && !can(user, 'approve')) {
		error(403, `Only approvers can mark a document as ${status}`);
	}
}

/** Approved documents are frozen for everyone but approvers, who can reopen them. */
function assertNotLocked(user: AuthUser, doc: Document) {
	if (doc.deletedAt) error(409, 'Restore this document before changing it');
	if (doc.status === 'approved' && !can(user, 'approve')) {
		error(403, 'Approved documents can only be changed by an approver');
	}
}

/**
 * Department-scoped users can only file documents under their own department
 * (or under none, if they have none), or they'd lose sight of them. Admins
 * and approvers can refile anything, e.g. to fix a misfiled document.
 */
function assertCanFileUnder(user: AuthUser, departmentId: number | null) {
	if (seesAllDepartments(user) || departmentId === user.departmentId) return;
	error(403, 'You can only file documents under your own department');
}

function assertDepartment(id: number) {
	const found = db
		.select({ id: departments.id })
		.from(departments)
		.where(eq(departments.id, id))
		.get();
	if (!found) error(400, 'Unknown department');
}

function assertAssignee(id: string) {
	const found = db.select({ status: users.status }).from(users).where(eq(users.id, id)).get();
	if (!found) error(400, 'Unknown assignee');
	if (found.status !== 'active') error(400, 'The assignee account is disabled');
}

/** Validates an untrusted JSON body into a `DocumentUpdate`. */
export function parseDocumentUpdate(body: unknown): DocumentUpdate {
	if (!body || typeof body !== 'object' || Array.isArray(body))
		error(400, 'Expected a JSON object');
	const input = body as Record<string, unknown>;
	const update: DocumentUpdate = {};

	if ('title' in input) {
		if (typeof input.title !== 'string' || !input.title.trim()) error(400, 'Title is required');
		if (input.title.trim().length > TITLE_MAX)
			error(400, `Title can be at most ${TITLE_MAX} characters`);
		update.title = input.title.trim();
	}
	if ('description' in input) {
		if (typeof input.description !== 'string') error(400, 'Description must be text');
		if (input.description.length > DESCRIPTION_MAX) {
			error(400, `Description can be at most ${DESCRIPTION_MAX} characters`);
		}
		update.description = input.description.trim();
	}
	if ('status' in input) update.status = parseStatus(input.status);
	if ('departmentId' in input) {
		const value = input.departmentId;
		if (value !== null && !Number.isInteger(value))
			error(400, 'departmentId must be an id or null');
		update.departmentId = value as number | null;
	}
	if ('assigneeId' in input) {
		const value = input.assigneeId;
		if (value !== null && typeof value !== 'string') error(400, 'assigneeId must be an id or null');
		update.assigneeId = value as string | null;
	}
	return update;
}

export function parseStatus(value: unknown): DocumentStatus {
	if (typeof value !== 'string' || !DOCUMENT_STATUSES.includes(value as DocumentStatus)) {
		error(400, `Status must be one of: ${DOCUMENT_STATUSES.join(', ')}`);
	}
	return value as DocumentStatus;
}

// ---- Writing ----------------------------------------------------------------

/** `HR`, `IT`, `Finance` -> `FIN`; the prefix of references like `HR-2026-007`. */
function departmentCode(name: string | null) {
	const letters = (name ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
	return (letters.length <= 4 ? letters : letters.slice(0, 3)) || 'DOC';
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Must run inside the insert's transaction so two uploads can't take the same number. */
function nextReference(tx: Tx, departmentName: string | null) {
	const prefix = `${departmentCode(departmentName)}-${new Date().getFullYear()}-`;
	const row = tx
		.select({
			last: sql<
				number | null
			>`max(cast(substr(${documents.reference}, ${prefix.length + 1}) as integer))`
		})
		.from(documents)
		.where(sql`${documents.reference} like ${`${prefix}%`}`)
		.get();
	return `${prefix}${String((row?.last ?? 0) + 1).padStart(3, '0')}`;
}

function departmentName(id: number | null) {
	if (id === null) return null;
	return (
		db.select({ name: departments.name }).from(departments).where(eq(departments.id, id)).get()
			?.name ?? null
	);
}

export interface NewDocument {
	title?: string;
	description?: string;
	status?: DocumentStatus;
	departmentId?: number | null;
	note?: string;
}

export async function createDocument(
	user: AuthUser,
	upload: Upload,
	fields: NewDocument
): Promise<DocumentDetailDTO> {
	const settings = getAppSettings();

	// With approval required, new documents start as drafts; without it they're published.
	const status = fields.status ?? (settings.documents.requireApproval ? 'draft' : 'approved');
	assertStatusAllowed(user, status, settings);

	// Admins default to the organization's default department; everyone else to their own.
	let departmentId = fields.departmentId;
	if (departmentId === undefined) {
		departmentId = isAdmin(user)
			? (db
					.select({ id: departments.id })
					.from(departments)
					.where(eq(departments.name, settings.general.defaultDepartment))
					.get()?.id ??
				user.departmentId ??
				null)
			: user.departmentId;
	} else {
		if (departmentId !== null) assertDepartment(departmentId);
		assertCanFileUnder(user, departmentId);
	}

	const extractedText = await extractText(upload);
	const stored = await saveFile(upload.bytes);
	const deptName = departmentName(departmentId);

	let doc: Document;
	try {
		doc = db.transaction((tx) => {
			const created = tx
				.insert(documents)
				.values({
					reference: nextReference(tx, deptName),
					title: fields.title || upload.originalName,
					description: fields.description ?? '',
					status,
					departmentId,
					ownerId: user.id
				})
				.returning()
				.get();
			tx.insert(documentVersions)
				.values({
					documentId: created.id,
					versionNumber: 1,
					...stored,
					originalName: upload.originalName,
					mimeType: upload.mimeType,
					extractedText,
					note: fields.note ?? '',
					uploadedById: user.id
				})
				.run();
			return created;
		});
	} catch (err) {
		await removeFile(stored.storageKey);
		throw err;
	}

	logActivity({
		action: 'created',
		actor: user,
		targetType: 'document',
		targetId: doc.id,
		target: doc.title,
		details: `Uploaded ${upload.originalName}`,
		metadata: { reference: doc.reference, status, departmentId }
	});

	return getDocumentDetail(user, doc.id);
}

/**
 * With versioning on, each upload is a new numbered version. With it off, the
 * upload replaces the current file in place and the old one is removed.
 */
export async function addVersion(
	user: AuthUser,
	id: string,
	upload: Upload,
	note = ''
): Promise<DocumentDetailDTO> {
	const { doc } = loadDocument(user, id);
	assertNotLocked(user, doc);

	const versioning = getAppSettings().documents.enableVersioning;
	const extractedText = await extractText(upload);
	const stored = await saveFile(upload.bytes);
	const file = {
		...stored,
		originalName: upload.originalName,
		mimeType: upload.mimeType,
		extractedText,
		note,
		uploadedById: user.id
	};

	let result: { versionNumber: number; replacedKey: string | null };
	try {
		result = db.transaction((tx) => {
			const latest = tx
				.select({
					id: documentVersions.id,
					versionNumber: documentVersions.versionNumber,
					storageKey: documentVersions.storageKey
				})
				.from(documentVersions)
				.where(eq(documentVersions.documentId, id))
				.orderBy(desc(documentVersions.versionNumber))
				.limit(1)
				.get();

			tx.update(documents).set({ updatedAt: new Date() }).where(eq(documents.id, id)).run();

			if (!versioning && latest) {
				tx.update(documentVersions)
					.set({ ...file, createdAt: new Date() })
					.where(eq(documentVersions.id, latest.id))
					.run();
				return { versionNumber: latest.versionNumber, replacedKey: latest.storageKey };
			}
			const versionNumber = (latest?.versionNumber ?? 0) + 1;
			tx.insert(documentVersions)
				.values({ documentId: id, versionNumber, ...file })
				.run();
			return { versionNumber, replacedKey: null };
		});
	} catch (err) {
		await removeFile(stored.storageKey);
		throw err;
	}

	if (result.replacedKey) await removeFile(result.replacedKey);

	logActivity({
		action: 'edited',
		actor: user,
		targetType: 'document',
		targetId: id,
		target: doc.title,
		details: result.replacedKey
			? `File replaced with ${upload.originalName}`
			: `Uploaded version ${result.versionNumber} (${upload.originalName})`,
		metadata: { versionNumber: result.versionNumber, sha256: stored.sha256 }
	});

	return getDocumentDetail(user, id);
}

export function updateDocument(
	user: AuthUser,
	id: string,
	update: DocumentUpdate
): DocumentDetailDTO {
	const settings = getAppSettings();
	const { doc } = loadDocument(user, id);
	assertNotLocked(user, doc);

	const changes: Record<string, [unknown, unknown]> = {};
	for (const field of ['title', 'description', 'status', 'departmentId', 'assigneeId'] as const) {
		const next = update[field];
		if (next !== undefined && next !== doc[field]) changes[field] = [doc[field], next];
	}
	const changed = Object.keys(changes);
	if (!changed.length) return getDocumentDetail(user, id);

	// Content edits need `upload`; moving a document along the workflow is also open to approvers.
	const workflowOnly = changed.every((f) => f === 'status' || f === 'assigneeId');
	if (!can(user, 'upload') && !(workflowOnly && can(user, 'approve'))) {
		error(403, 'You do not have permission to edit documents');
	}
	if (update.status !== undefined && changes.status)
		assertStatusAllowed(user, update.status, settings);
	if (update.departmentId !== undefined && changes.departmentId) {
		if (update.departmentId !== null) assertDepartment(update.departmentId);
		assertCanFileUnder(user, update.departmentId);
	}
	if (update.assigneeId != null && changes.assigneeId) assertAssignee(update.assigneeId);

	const values = Object.fromEntries(changed.map((f) => [f, changes[f][1]])) as DocumentUpdate;
	db.update(documents).set(values).where(eq(documents.id, id)).run();

	logActivity({
		action: 'edited',
		actor: user,
		targetType: 'document',
		targetId: id,
		target: doc.title,
		details: describeChanges(changes),
		metadata: { changes }
	});
	if (changes.status && (update.status === 'approved' || update.status === 'rejected')) {
		logActivity({
			action: update.status,
			actor: user,
			targetType: 'document',
			targetId: id,
			target: update.title ?? doc.title
		});
	}

	return getDocumentDetail(user, id);
}

const FIELD_LABELS: Record<string, string> = {
	title: 'Title',
	description: 'Description',
	status: 'Status',
	departmentId: 'Department',
	assigneeId: 'Assignee'
};

function describeChanges(changes: Record<string, [unknown, unknown]>) {
	return Object.entries(changes)
		.map(([field, [before, after]]) => {
			if (field === 'description') return 'Description updated';
			if (field === 'departmentId') {
				before = departmentName(before as number | null);
				after = departmentName(after as number | null);
			}
			if (field === 'assigneeId') {
				before = userName(before as string | null);
				after = userName(after as string | null);
			}
			return `${FIELD_LABELS[field]}: ${before ?? 'None'} → ${after ?? 'None'}`;
		})
		.join('; ');
}

function userName(id: string | null) {
	if (id === null) return null;
	return db.select({ name: users.name }).from(users).where(eq(users.id, id)).get()?.name ?? null;
}

/** Soft delete; files stay on disk until a purge. */
export function deleteDocument(user: AuthUser, id: string) {
	if (!can(user, 'delete')) error(403, 'You do not have permission to delete documents');
	const { doc } = loadDocument(user, id);
	if (doc.deletedAt) return;

	db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, id)).run();
	logActivity({
		action: 'deleted',
		actor: user,
		targetType: 'document',
		targetId: id,
		target: doc.title
	});
}

export function restoreDocument(user: AuthUser, id: string): DocumentDetailDTO {
	if (!can(user, 'delete')) error(403, 'You do not have permission to restore documents');
	const { doc } = loadDocument(user, id);
	if (doc.deletedAt) {
		db.update(documents).set({ deletedAt: null }).where(eq(documents.id, id)).run();
		logActivity({
			action: 'restored',
			actor: user,
			targetType: 'document',
			targetId: id,
			target: doc.title
		});
	}
	return getDocumentDetail(user, id);
}
