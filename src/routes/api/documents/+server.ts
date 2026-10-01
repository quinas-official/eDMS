import { error, json } from '@sveltejs/kit';
import type { DocumentListQuery } from '$lib/documents/api-types';
import { requirePermission } from '$lib/server/auth/guard';
import {
	createDocument,
	DESCRIPTION_MAX,
	listDocuments,
	NOTE_MAX,
	parseStatus,
	TITLE_MAX
} from '$lib/server/documents/service';
import { formText, readUpload } from '$lib/server/documents/upload';
import { getAppSettings } from '$lib/server/settings';
import type { RequestHandler } from './$types';

/**
 * Query: `search`, `status`, `departmentId`, `deleted=true`, `archived=true`, `page`,
 * `pageSize`. Newest-updated first.
 */
export const GET: RequestHandler = (event) => {
	const user = requirePermission(event, 'view');
	const params = event.url.searchParams;

	const query: DocumentListQuery = {
		search: params.get('search')?.trim() || undefined,
		status: params.has('status') ? parseStatus(params.get('status')) : undefined,
		departmentId: optionalInt(params, 'departmentId'),
		deleted: params.get('deleted') === 'true',
		archived: params.get('archived') === 'true',
		page: optionalInt(params, 'page'),
		pageSize: optionalInt(params, 'pageSize')
	};

	return json(listDocuments(user, query));
};

/**
 * Multipart: `file` (required), plus optional `title`, `description`,
 * `status`, `departmentId` (empty for none) and `note` for the first version.
 */
export const POST: RequestHandler = async (event) => {
	const user = requirePermission(event, 'upload');
	const upload = await readUpload(event.request, getAppSettings());
	const { form } = upload;

	const status = formText(form, 'status', 20);
	const departmentId = formText(form, 'departmentId', 20);

	const document = await createDocument(user, upload, {
		title: formText(form, 'title', TITLE_MAX),
		description: formText(form, 'description', DESCRIPTION_MAX),
		status: status ? parseStatus(status) : undefined,
		departmentId:
			departmentId === undefined ? undefined : departmentId === '' ? null : toInt(departmentId),
		note: formText(form, 'note', NOTE_MAX)
	});

	return json({ document }, { status: 201 });
};

function optionalInt(params: URLSearchParams, name: string) {
	const raw = params.get(name);
	return raw === null || raw === '' ? undefined : toInt(raw, name);
}

function toInt(raw: string, name = 'departmentId') {
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0) error(400, `${name} must be a whole number`);
	return value;
}
