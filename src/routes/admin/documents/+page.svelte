<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page as pageStore } from '$app/stores';
	import {
		FileText,
		Table,
		Grid,
		Eye,
		Settings,
		Trash2,
		X,
		Upload,
		Pencil,
		CircleCheck,
		CircleX,
		RotateCcw,
		Plus,
		Archive,
		History,
		ChevronDown,
		ChevronLeft,
		ChevronRight,
		Download,
		FileX,
		LoaderCircle
	} from '@lucide/svelte';
	import UploadDropzone from '$lib/components/site/UploadDropzone.svelte';
	import DocumentPreview from '$lib/components/site/DocumentPreview.svelte';
	import { formatFileSize } from '$lib/documents/preview';
	import { diffWords } from 'diff';
	import { Button } from '$lib/components/ui/button';
	import { StatusBadge } from '$lib/components/ui/status-badge';
	import { ConfirmDialog } from '$lib/components/ui/confirm-dialog';
	import { ApiError } from '$lib/api/client';
	import {
		createDocument,
		deleteDocument as apiDeleteDocument,
		fetchDocumentFile,
		getDocument,
		listDocumentActivity,
		listDocuments,
		restoreDocument as apiRestoreDocument,
		updateDocument,
		uploadVersion
	} from '$lib/api/documents';
	import { listDepartments, type DepartmentDTO } from '$lib/api/departments';
	import { getServerSettings } from '$lib/api/settings';
	import type {
		DocumentActivityDTO,
		DocumentDetailDTO,
		DocumentDTO,
		DocumentListQuery,
		DocumentStatus,
		DocumentUpdate,
		DocumentVersionDTO
	} from '$lib/documents/api-types';
	import { DEFAULT_SETTINGS, toAcceptAttribute, type AppSettings } from '$lib/settings/types';
	import { currentUser } from '$lib/auth/store';
	import { can, isAdmin } from '$lib/permissions';
	import RelativeTime from '$lib/components/site/RelativeTime.svelte';
	import { formatRelative } from '$lib/format/date';
	import { toast } from '$lib/toast/store';

	const PAGE_SIZE = 25;
	const STATUSES: DocumentStatus[] = ['draft', 'pending', 'reviewed', 'approved', 'rejected'];
	/** With "Require approval" on, only approvers can move a document into these. */
	const DECISIONS: DocumentStatus[] = ['reviewed', 'approved', 'rejected'];

	function statusLabel(status: string) {
		return status.charAt(0).toUpperCase() + status.slice(1);
	}

	function errorMessage(err: unknown) {
		return err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong';
	}

	// ---- Server state ---------------------------------------------------------
	// Settings come from the server, which enforces them.

	let appSettings: AppSettings = structuredClone(DEFAULT_SETTINGS);
	let departments: DepartmentDTO[] = [];

	onMount(async () => {
		try {
			[departments, appSettings] = await Promise.all([listDepartments(), getServerSettings()]);
		} catch (err) {
			toast.error("Couldn't load departments and settings", { description: errorMessage(err) });
		}
	});

	$: canUpload = can($currentUser, 'upload');
	$: canApprove = can($currentUser, 'approve');
	$: canDeleteDocs = can($currentUser, 'delete');
	/** Mirrors the server: admins and approvers can file under any department. */
	$: seesAllDepartments = isAdmin($currentUser) || canApprove;
	$: decisionsLocked = appSettings.documents.requireApproval && !canApprove;

	/** Approved documents are frozen for everyone but approvers; deleted ones for everyone. */
	$: isLocked = (doc: DocumentDTO) =>
		!!doc.deletedAt || (doc.status === 'approved' && !canApprove);
	$: canEditContent = (doc: DocumentDTO) => canUpload && !isLocked(doc);
	$: canChangeStatus = (doc: DocumentDTO) => (canUpload || canApprove) && !isLocked(doc);

	function statusOptionDisabled(status: DocumentStatus, current?: DocumentStatus) {
		return decisionsLocked && DECISIONS.includes(status) && status !== current;
	}

	// ---- List -----------------------------------------------------------------

	let docs: DocumentDTO[] = [];
	let total = 0;
	let page = 1;
	let loading = true;
	let listError = '';

	// Links such as the dashboard's shortcuts can open the page pre-filtered:
	// ?status=pending, ?deleted=true, ?search=HR-2026-001, ?departmentId=2.
	const params = $pageStore.url.searchParams;
	const initialStatus = params.get('status') as DocumentStatus | null;

	let search = params.get('search')?.trim() ?? '';
	let debouncedSearch = search;
	let selectedDepartment = /^\d+$/.test(params.get('departmentId') ?? '')
		? String(params.get('departmentId'))
		: '';
	let selectedStatus: DocumentStatus | '' =
		initialStatus && STATUSES.includes(initialStatus) ? initialStatus : '';
	let showDeleted = params.get('deleted') === 'true' && can($currentUser, 'delete');
	let viewMode: 'table' | 'cards' = 'table';

	// Any filter change goes back to the first page.
	let searchTimer: ReturnType<typeof setTimeout>;
	function handleSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			debouncedSearch = search.trim();
			page = 1;
		}, 250);
	}

	$: query = {
		search: debouncedSearch || undefined,
		status: selectedStatus || undefined,
		departmentId: selectedDepartment ? Number(selectedDepartment) : undefined,
		deleted: showDeleted,
		page,
		pageSize: PAGE_SIZE
	} satisfies DocumentListQuery;

	$: if (browser) load(query);

	// Responses can arrive out of order while typing; only the latest request wins.
	let loadSeq = 0;

	async function load(q: DocumentListQuery) {
		const seq = ++loadSeq;
		loading = true;
		listError = '';
		try {
			const res = await listDocuments(q);
			if (seq !== loadSeq) return;
			docs = res.documents;
			total = res.total;
		} catch (err) {
			if (seq === loadSeq) listError = errorMessage(err);
		} finally {
			if (seq === loadSeq) loading = false;
		}
	}

	function refresh() {
		return load(query);
	}

	$: pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

	// ---- Upload ---------------------------------------------------------------

	/** Files the dropzone turned away, shown until the next successful upload. */
	let uploadErrors: string[] = [];

	function handleReject(event: CustomEvent<{ file: File; reason: string }[]>) {
		uploadErrors = event.detail.map((r) => `${r.file.name} — ${r.reason}`);
	}

	let showModal = false;
	let currentFile: File | null = null;
	let saving = false;
	let formError = '';

	// Form fields for the new-document modal
	let title = '';
	let departmentId = '';
	let status: DocumentStatus = 'draft';
	let description = '';

	/** Where the server would file it by default: admins the org default, everyone else their own. */
	function defaultDepartmentId(): number | null {
		const user = $currentUser;
		if (isAdmin(user)) {
			return (
				departments.find((d) => d.name === appSettings.general.defaultDepartment)?.id ??
				user?.departmentId ??
				null
			);
		}
		return user?.departmentId ?? null;
	}

	function handleSelect(event: CustomEvent<File[]>) {
		uploadErrors = [];
		formError = '';
		currentFile = event.detail[0];
		showModal = true;

		title = currentFile.name;
		departmentId = String(defaultDepartmentId() ?? '');
		// With approval required a new document starts as a Draft; without it, published.
		status = appSettings.documents.requireApproval ? 'draft' : 'approved';
		description = '';
	}

	function cancelUpload() {
		if (saving) return;
		showModal = false;
		currentFile = null;
	}

	async function submitForm() {
		if (!currentFile || saving) return;
		saving = true;
		formError = '';
		try {
			const created = await createDocument({
				file: currentFile,
				title: title.trim() || undefined,
				description: description.trim() || undefined,
				status,
				departmentId: departmentId === '' ? null : Number(departmentId)
			});
			showModal = false;
			currentFile = null;
			toast.success('Document uploaded', { description: `${created.reference} · ${created.title}` });
			await refresh();
		} catch (err) {
			formError = errorMessage(err);
		} finally {
			saving = false;
		}
	}

	// ---- Delete / restore -----------------------------------------------------

	let docPendingDelete: DocumentDTO | null = null;

	async function confirmDeleteDocument() {
		const doc = docPendingDelete;
		docPendingDelete = null;
		if (!doc) return;
		try {
			await apiDeleteDocument(doc.id);
			toast.success('Document deleted', {
				description: canDeleteDocs
					? `"${doc.title}" can be restored from Show deleted.`
					: `"${doc.title}" was removed from the list.`
			});
			await refresh();
		} catch (err) {
			toast.error("Couldn't delete the document", { description: errorMessage(err) });
		}
	}

	async function restoreDocument(doc: DocumentDTO) {
		try {
			await apiRestoreDocument(doc.id);
			toast.success('Document restored', { description: `"${doc.title}" is back in the list.` });
			await refresh();
		} catch (err) {
			toast.error("Couldn't restore the document", { description: errorMessage(err) });
		}
	}

	// ---- Manage ---------------------------------------------------------------

	let manageOpen = false;
	let manageLoading = false;
	let manageError = '';
	let activeDoc: DocumentDetailDTO | null = null;
	let activity: DocumentActivityDTO[] = [];
	let activeTab: 'edit' | 'history' | 'timeline' = 'edit';

	/**
	 * The Manage form edits these copies, never `activeDoc` itself, so typing
	 * doesn't change the list and Cancel really discards.
	 */
	let editTitle = '';
	let editDescription = '';
	let editDepartmentId = '';
	let editStatus: DocumentStatus = 'draft';
	let updatedFile: File | null = null;
	let versionNote = '';
	let replaceFileInput: HTMLInputElement;

	function setActiveDoc(detail: DocumentDetailDTO) {
		activeDoc = detail;
		editTitle = detail.title;
		editDescription = detail.description;
		editDepartmentId = String(detail.department?.id ?? '');
		editStatus = detail.status;
	}

	async function manageDocument(doc: DocumentDTO) {
		manageOpen = true;
		manageLoading = true;
		manageError = '';
		activeTab = 'edit';
		activeDoc = null;
		activity = [];
		clearReplacementFile();
		try {
			const [detail, log] = await Promise.all([getDocument(doc.id), listDocumentActivity(doc.id)]);
			setActiveDoc(detail);
			activity = log;
		} catch (err) {
			manageError = errorMessage(err);
		} finally {
			manageLoading = false;
		}
	}

	function closeModal() {
		if (saving) return;
		manageOpen = false;
		activeDoc = null;
		activity = [];
		clearReplacementFile();
	}

	function handleFileUpdate(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files?.length) updatedFile = input.files[0];
	}

	function clearReplacementFile() {
		updatedFile = null;
		versionNote = '';
		if (replaceFileInput) replaceFileInput.value = '';
	}

	async function saveDocumentChanges() {
		if (!activeDoc || saving) return;
		const doc = activeDoc;

		const nextTitle = editTitle.trim();
		if (!nextTitle) {
			manageError = 'Title is required';
			return;
		}

		const update: DocumentUpdate = {};
		if (nextTitle !== doc.title) update.title = nextTitle;
		if (editDescription.trim() !== doc.description) update.description = editDescription.trim();
		const nextDepartment = editDepartmentId === '' ? null : Number(editDepartmentId);
		if (nextDepartment !== (doc.department?.id ?? null)) update.departmentId = nextDepartment;
		if (editStatus !== doc.status) update.status = editStatus;

		const hasUpdate = Object.keys(update).length > 0;
		if (!hasUpdate && !updatedFile) {
			closeModal();
			return;
		}

		saving = true;
		manageError = '';
		let uploaded = false;
		try {
			// File first: if the edit approves the document, it's locked and an upload after would be refused.
			if (updatedFile) {
				await uploadVersion(doc.id, updatedFile, versionNote.trim() || undefined);
				uploaded = true;
			}
			if (hasUpdate) await updateDocument(doc.id, update);
			const message =
				uploaded && !hasUpdate
					? appSettings.documents.enableVersioning
						? 'New version uploaded'
						: 'File replaced'
					: 'Changes saved';
			saving = false;
			closeModal();
			toast.success(message, { description: nextTitle });
			await refresh();
		} catch (err) {
			manageError = errorMessage(err);
			// The file may have gone through before the edit failed; don't upload it twice on retry.
			if (uploaded) {
				clearReplacementFile();
				try {
					const detail = await getDocument(doc.id);
					if (activeDoc?.id === doc.id) activeDoc = detail;
				} catch {
					// The error above is already on screen.
				}
				refresh();
			}
		} finally {
			saving = false;
		}
	}

	/**
	 * Returns HTML showing GitHub-style diff between two strings
	 * Additions = green, Deletions = red
	 */
	function diffHtml(prev: string, curr: string) {
		const diffs = diffWords(prev || '', curr || '');

		return diffs
			.map((part) => {
				// The text is user-supplied (file contents) and goes into {@html}.
				const value = escapeHtml(part.value);
				if (part.added) {
					return `<span class="diff-add">${value}</span>`;
				} else if (part.removed) {
					return `<span class="diff-remove">${value}</span>`;
				} else {
					return value;
				}
			})
			.join('');
	}

	function escapeHtml(text: string) {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	const ACTION_STYLES: Record<string, { icon: typeof Pencil; class: string }> = {
		created: { icon: Plus, class: 'bg-blue-500/15 text-blue-600 dark:text-blue-300' },
		edited: { icon: Pencil, class: 'bg-muted text-muted-foreground' },
		approved: { icon: CircleCheck, class: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' },
		rejected: { icon: CircleX, class: 'bg-red-500/15 text-red-600 dark:text-red-300' },
		deleted: { icon: Trash2, class: 'bg-red-500/15 text-red-600 dark:text-red-300' },
		restored: { icon: RotateCcw, class: 'bg-blue-500/15 text-blue-600 dark:text-blue-300' },
		archived: { icon: Archive, class: 'bg-amber-500/15 text-amber-600 dark:text-amber-300' },
		purged: { icon: Trash2, class: 'bg-red-500/15 text-red-600 dark:text-red-300' }
	};

	// ---- Preview --------------------------------------------------------------
	// Kept separate from Manage so it can open on top of it (from a Change
	// History card) and drop back to it when closed.

	let previewDoc: DocumentDTO | null = null;
	let previewVersions: DocumentVersionDTO[] = [];
	let previewVersionNumber: number | null = null;
	let previewFile: File | null = null;
	let previewLoading = false;
	let previewError = '';

	/** Fetched files, keyed by version and content so a replaced file isn't served stale. */
	// Nothing renders from the cache itself, so it doesn't need to be reactive.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const fileCache = new Map<string, File>();

	$: previewVersion = previewVersions.find((v) => v.versionNumber === previewVersionNumber) ?? null;

	async function openPreview(doc: DocumentDTO | DocumentDetailDTO, versionNumber: number | null = null) {
		previewDoc = doc;
		previewError = '';
		previewFile = null;
		previewVersionNumber = versionNumber;
		previewVersions = 'versions' in doc ? doc.versions : [];

		if (!('versions' in doc)) {
			previewLoading = true;
			try {
				const detail = await getDocument(doc.id);
				if (previewDoc?.id !== doc.id) return;
				previewDoc = detail;
				previewVersions = detail.versions;
			} catch (err) {
				if (previewDoc?.id === doc.id) {
					previewError = errorMessage(err);
					previewLoading = false;
				}
				return;
			}
		}

		await showVersion(versionNumber ?? previewVersions.at(-1)?.versionNumber ?? null);
	}

	async function showVersion(versionNumber: number | null) {
		previewVersionNumber = versionNumber;
		previewFile = null;
		previewError = '';
		const doc = previewDoc;
		const version = previewVersions.find((v) => v.versionNumber === versionNumber);
		if (!doc || !version) {
			previewLoading = false;
			return;
		}

		const cached = fileCache.get(cacheKey(version));
		if (cached) {
			previewFile = cached;
			previewLoading = false;
			return;
		}

		previewLoading = true;
		try {
			const file = await fetchVersionFile(doc.id, version, true);
			fileCache.set(cacheKey(version), file);
			if (previewDoc?.id === doc.id && previewVersionNumber === versionNumber) previewFile = file;
		} catch (err) {
			if (previewDoc?.id === doc.id && previewVersionNumber === versionNumber) {
				previewError = errorMessage(err);
			}
		} finally {
			if (previewDoc?.id === doc.id && previewVersionNumber === versionNumber) {
				previewLoading = false;
			}
		}
	}

	function cacheKey(version: DocumentVersionDTO) {
		return `${version.id}:${version.sha256}`;
	}

	/** Wrapped in a File with the original name and type, which the preview relies on. */
	async function fetchVersionFile(docId: string, version: DocumentVersionDTO, inline: boolean) {
		const blob = await fetchDocumentFile(docId, { version: version.versionNumber, inline });
		return new File([blob], version.originalName, { type: version.mimeType });
	}

	async function downloadVersion(version: DocumentVersionDTO) {
		if (!previewDoc) return;
		try {
			// Always fetched as a download (not from the preview cache) so it's recorded as one.
			const file = await fetchVersionFile(previewDoc.id, version, false);
			const { saveAs } = await import('file-saver');
			saveAs(file, version.originalName);
		} catch (err) {
			toast.error("Couldn't download the file", { description: errorMessage(err) });
		}
	}

	function closePreview() {
		previewDoc = null;
		previewVersions = [];
		previewVersionNumber = null;
		previewFile = null;
		previewLoading = false;
		previewError = '';
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && previewDoc) closePreview();
	}
</script>

<div class="space-y-6">
	<!-- Drag-and-Drop Upload -->
	{#if canUpload && !showDeleted}
		<UploadDropzone
			on:select={handleSelect}
			on:reject={handleReject}
			allowedFileTypes={appSettings.documents.allowedFileTypes}
			maxSizeMb={appSettings.documents.maxUploadSizeMb}
		/>
	{/if}

	{#if uploadErrors.length}
		<div class="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm">
			<p class="font-medium">
				{uploadErrors.length}
				{uploadErrors.length === 1 ? 'file was' : 'files were'} not accepted
			</p>
			<ul class="mt-1 list-inside list-disc space-y-0.5">
				{#each uploadErrors as error}
					<li>{error}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Filters + View Toggle -->
	<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
		<div class="flex flex-col gap-2 md:flex-row md:items-center">
			<input
				type="text"
				placeholder="Search documents..."
				bind:value={search}
				on:input={handleSearchInput}
				class="border-border/60 focus-visible:ring-ring/50 rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
			/>
			<div class="flex items-center gap-2">
				<label for="doc-filter-department" class="text-muted-foreground shrink-0 text-xs font-medium">Department</label>
				<select id="doc-filter-department" bind:value={selectedDepartment} on:change={() => (page = 1)} class="border-border/60 rounded-lg border bg-transparent px-2 py-2 text-sm shadow-xs">
					<option value="">All</option>
					{#each departments as dept (dept.id)}
						<option value={String(dept.id)}>{dept.name}</option>
					{/each}
				</select>
			</div>
			<div class="flex items-center gap-2">
				<label for="doc-filter-status" class="text-muted-foreground shrink-0 text-xs font-medium">Status</label>
				<select id="doc-filter-status" bind:value={selectedStatus} on:change={() => (page = 1)} class="border-border/60 rounded-lg border bg-transparent px-2 py-2 text-sm shadow-xs">
					<option value="">All</option>
					{#each STATUSES as s (s)}
						<option value={s}>{statusLabel(s)}</option>
					{/each}
				</select>
			</div>
			{#if canDeleteDocs}
				<label class="text-muted-foreground flex items-center gap-2 text-xs font-medium">
					<input type="checkbox" bind:checked={showDeleted} on:change={() => (page = 1)} class="border-border rounded" />
					Show deleted
				</label>
			{/if}
		</div>

		<!-- View Mode Buttons -->
		<div class="flex gap-2">
			<Button
				variant={viewMode === 'table' ? 'default' : 'outline'}
				size="sm"
				onclick={() => (viewMode = 'table')}
			>
				<Table class="h-4 w-4" />
				Table
			</Button>

			<Button
				variant={viewMode === 'cards' ? 'default' : 'outline'}
				size="sm"
				onclick={() => (viewMode = 'cards')}
			>
				<Grid class="h-4 w-4" />
				Cards
			</Button>
		</div>
	</div>

	<!-- Document Display -->
	{#if listError}
		<div
			class="text-muted-foreground bg-card border-border/60 flex h-80 flex-col items-center justify-center gap-3 rounded-xl border text-center shadow-sm"
		>
			<CircleX class="text-destructive h-10 w-10 opacity-60" />
			<p class="text-foreground text-sm font-medium">Couldn't load documents</p>
			<p class="text-xs">{listError}</p>
			<Button variant="outline" size="sm" onclick={refresh}>Try again</Button>
		</div>
	{:else if docs.length > 0}
		<div class="transition-opacity" class:opacity-60={loading}>
			{#if viewMode === 'table'}
				<div class="bg-card border-border/60 overflow-x-auto rounded-xl border shadow-sm">
					<table class="w-full text-center text-sm">
						<thead class="border-border/60 border-b">
							<tr>
								<th class="text-muted-foreground px-4 py-3 text-xs font-medium tracking-wide uppercase">Reference</th>
								<th class="text-muted-foreground px-4 py-3 text-xs font-medium tracking-wide uppercase">Title</th>
								<th class="text-muted-foreground px-4 py-3 text-xs font-medium tracking-wide uppercase">Department</th>
								<th class="text-muted-foreground px-4 py-3 text-xs font-medium tracking-wide uppercase">Status</th>
								<th class="text-muted-foreground px-4 py-3 text-xs font-medium tracking-wide uppercase">
									{showDeleted ? 'Deleted' : 'Created'}
								</th>
								<th class="text-muted-foreground px-4 py-3 text-xs font-medium tracking-wide uppercase">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each docs as doc (doc.id)}
								<tr class="hover:bg-muted/50 border-border/60 border-b transition-colors">
									<td class="text-muted-foreground px-4 py-3.5">{doc.reference}</td>
									<td class="px-4 py-3.5 font-medium">
										<button class="hover:underline" on:click={() => openPreview(doc)}>{doc.title}</button>
									</td>
									<td class="px-4 py-3.5">{doc.department?.name ?? '—'}</td>
									<td class="px-4 py-3.5"><StatusBadge status={statusLabel(doc.status)} /></td>
									<td class="text-muted-foreground px-4 py-3.5 whitespace-nowrap">
										<RelativeTime value={doc.deletedAt ?? doc.createdAt} />
									</td>
									<td class="px-4 py-3.5">
										<div class="inline-flex gap-2">
											<!-- View -->
											<button
												class="hover:bg-muted hover:border-foreground/20 border-border/60 flex items-center rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all hover:-translate-y-px hover:shadow-sm"
												on:click={() => openPreview(doc)}
											>
												<Eye class="mr-1 h-3.5 w-3.5" /> View
											</button>

											{#if doc.deletedAt}
												<!-- Restore -->
												<button
													class="hover:bg-muted hover:border-foreground/20 border-border/60 flex items-center rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all hover:-translate-y-px hover:shadow-sm"
													on:click={() => restoreDocument(doc)}
												>
													<RotateCcw class="mr-1 h-3.5 w-3.5" /> Restore
												</button>
											{:else}
												<!-- Manage -->
												<button
													class="hover:bg-muted hover:border-foreground/20 border-border/60 flex items-center rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all hover:-translate-y-px hover:shadow-sm"
													on:click={() => manageDocument(doc)}
												>
													<Settings class="mr-1 h-3.5 w-3.5" />
													Manage
												</button>

												<!-- Delete -->
												<button
													disabled={!canDeleteDocs}
													class="border-destructive/40 text-destructive flex items-center rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all hover:-translate-y-px hover:border-destructive hover:bg-destructive/10 hover:shadow-sm disabled:pointer-events-none disabled:opacity-50"
													on:click={() => (docPendingDelete = doc)}
												>
													<Trash2 class="mr-1 h-3.5 w-3.5" /> Delete
												</button>
											{/if}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#if viewMode === 'cards'}
				<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
					{#each docs as doc (doc.id)}
						<div class="bg-card border-border/60 flex flex-col rounded-xl border p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
							<button class="text-left font-semibold tracking-tight hover:underline" on:click={() => openPreview(doc)}>
								{doc.title}
							</button>
							<p class="text-muted-foreground mt-0.5 text-sm">{doc.reference}</p>
							<div class="mt-4 flex items-center justify-between text-sm">
								<span class="text-muted-foreground">{doc.department?.name ?? '—'}</span>
								<StatusBadge status={statusLabel(doc.status)} />
							</div>
							<p class="text-muted-foreground mt-3 text-xs">
								{doc.deletedAt ? 'Deleted' : 'Created'} ·
								<RelativeTime value={doc.deletedAt ?? doc.createdAt} />
							</p>
							<div class="border-border/60 mt-4 flex gap-2 border-t pt-4">
								<Button variant="outline" size="sm" class="flex-1" onclick={() => openPreview(doc)}>
									<Eye class="h-3.5 w-3.5" /> View
								</Button>
								{#if doc.deletedAt}
									<Button variant="outline" size="sm" class="flex-1" onclick={() => restoreDocument(doc)}>
										<RotateCcw class="h-3.5 w-3.5" /> Restore
									</Button>
								{:else}
									<Button variant="outline" size="sm" class="flex-1" onclick={() => manageDocument(doc)}>
										<Settings class="h-3.5 w-3.5" /> Manage
									</Button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		{#if pageCount > 1}
			<div class="text-muted-foreground flex items-center justify-between text-sm">
				<p>
					{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
				</p>
				<div class="flex gap-2">
					<Button variant="outline" size="sm" disabled={page <= 1 || loading} onclick={() => (page -= 1)}>
						<ChevronLeft class="h-4 w-4" /> Previous
					</Button>
					<Button variant="outline" size="sm" disabled={page >= pageCount || loading} onclick={() => (page += 1)}>
						Next <ChevronRight class="h-4 w-4" />
					</Button>
				</div>
			</div>
		{/if}
	{:else}
		<div
			class="text-muted-foreground bg-card border-border/60 flex h-80 flex-col items-center justify-center gap-2 rounded-xl border text-center shadow-sm"
		>
			{#if loading}
				<LoaderCircle class="h-8 w-8 animate-spin opacity-60" />
				<p class="text-sm">Loading documents…</p>
			{:else}
				<FileText class="h-12 w-12 opacity-40" />
				<h1 class="text-sm font-medium">
					{showDeleted ? 'No deleted documents.' : 'No documents found matching your filters.'}
				</h1>
			{/if}
		</div>
	{/if}
</div>

<!-- Modal with preview + extra info -->
{#if showModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
		<div class="max-h-[90vh] w-full max-w-[1200px] overflow-auto bg-card border-border/60 rounded-2xl border p-6 shadow-2xl">
			<h2 class="mb-4 text-lg font-semibold">Document Details</h2>

			<!-- Modal Preview -->
			<div class="border-border/60 bg-muted/40 mb-4 h-[50vh] overflow-auto rounded-xl border p-3">
				<DocumentPreview file={currentFile} class="h-full" />
			</div>

			<!-- Metadata Inputs -->
			<div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
				<div>
					<label class="mb-1.5 block text-sm font-medium" for="new-doc-title">Title</label>
					<input
						id="new-doc-title"
						type="text"
						bind:value={title}
						maxlength={200}
						class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
						required
					/>
				</div>

				<div>
					<label class="mb-1.5 block text-sm font-medium" for="new-doc-department">Department</label>
					<select
						id="new-doc-department"
						bind:value={departmentId}
						disabled={!seesAllDepartments}
						class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2 disabled:opacity-60"
					>
						<option value="">No department</option>
						{#each departments as dept (dept.id)}
							<option value={String(dept.id)}>{dept.name}</option>
						{/each}
					</select>
					{#if !seesAllDepartments}
						<p class="text-muted-foreground mt-1.5 text-xs">Documents are filed under your own department.</p>
					{/if}
				</div>

				<div>
					<label class="mb-1.5 block text-sm font-medium" for="new-doc-status">Status</label>
					<select
						id="new-doc-status"
						bind:value={status}
						class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
					>
						{#each STATUSES as s (s)}
							<option value={s} disabled={statusOptionDisabled(s)}>{statusLabel(s)}</option>
						{/each}
					</select>
					{#if decisionsLocked}
						<p class="text-muted-foreground mt-1.5 text-xs">
							“Require approval before publish” is on, so only approvers can review, approve or reject.
						</p>
					{/if}
				</div>

				<div>
					<label class="mb-1.5 block text-sm font-medium" for="new-doc-description">Description</label>
					<input
						id="new-doc-description"
						type="text"
						bind:value={description}
						class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
					/>
				</div>
			</div>

			{#if formError}
				<p class="text-destructive mb-4 text-sm">{formError}</p>
			{/if}

			<!-- Actions -->
			<div class="flex justify-end gap-2">
				<Button variant="outline" onclick={cancelUpload} disabled={saving}>Cancel</Button>
				<Button onclick={submitForm} disabled={saving}>
					{#if saving}<LoaderCircle class="h-4 w-4 animate-spin" />{/if}
					{saving ? 'Uploading…' : 'Save'}
				</Button>
			</div>
		</div>
	</div>
{/if}

{#if manageOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
		<div class="max-h-[90vh] w-full max-w-[1000px] overflow-auto bg-card border-border/60 rounded-2xl border p-6 shadow-2xl">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-lg font-semibold">Manage Document</h2>
				<button class="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg p-1.5 text-sm transition-colors" on:click={closeModal} aria-label="Close">
					<X class="h-4 w-4" />
				</button>
			</div>

			{#if manageLoading}
				<div class="text-muted-foreground flex flex-col items-center gap-2 py-16 text-sm">
					<LoaderCircle class="h-8 w-8 animate-spin opacity-60" />
					Loading document…
				</div>
			{:else if !activeDoc}
				<p class="text-destructive py-10 text-center text-sm">{manageError || 'Document not found'}</p>
			{:else}
				{#if isLocked(activeDoc)}
					<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
						This document is approved and read-only. An approver can reopen it.
					</div>
				{/if}

				<!-- Tabs -->
				<div class="mb-4 flex border-border/60 border-b">
					<button
						class="-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium transition-colors"
						class:border-primary={activeTab === 'edit'}
						class:text-primary={activeTab === 'edit'}
						class:text-muted-foreground={activeTab !== 'edit'}
						on:click={() => (activeTab = 'edit')}
					>
						Edit
					</button>
					<button
						class="-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium transition-colors"
						class:border-primary={activeTab === 'history'}
						class:text-primary={activeTab === 'history'}
						class:text-muted-foreground={activeTab !== 'history'}
						on:click={() => (activeTab = 'history')}
					>
						Versions ({activeDoc.versions.length})
					</button>
					<button
						class="-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium transition-colors"
						class:border-primary={activeTab === 'timeline'}
						class:text-primary={activeTab === 'timeline'}
						class:text-muted-foreground={activeTab !== 'timeline'}
						on:click={() => (activeTab = 'timeline')}
					>
						Approval Timeline
					</button>
				</div>

				<!-- Tab Content -->
				<div class="mt-4">
					{#if activeTab === 'edit'}
						<div class="space-y-4">
							<p class="text-muted-foreground text-xs">
								{activeDoc.reference} · owned by {activeDoc.owner.name}
							</p>

							<div>
								<label class="mb-1.5 block text-sm font-medium" for="manage-doc-title">Title</label>
								<input
									id="manage-doc-title"
									class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
									bind:value={editTitle}
									maxlength={200}
									disabled={!canEditContent(activeDoc)}
									required
								/>
							</div>

							<div>
								<label class="mb-1.5 block text-sm font-medium" for="manage-doc-description">Description</label>
								<textarea
									id="manage-doc-description"
									rows="2"
									class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
									bind:value={editDescription}
									disabled={!canEditContent(activeDoc)}
								></textarea>
							</div>

							<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
								<div>
									<label class="mb-1.5 block text-sm font-medium" for="manage-doc-department">Department</label>
									<select
										id="manage-doc-department"
										class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
										bind:value={editDepartmentId}
										disabled={!canEditContent(activeDoc) || !seesAllDepartments}
									>
										<option value="">No department</option>
										{#each departments as dept (dept.id)}
											<option value={String(dept.id)}>{dept.name}</option>
										{/each}
										{#if activeDoc.department && !departments.some((d) => d.id === activeDoc?.department?.id)}
											<option value={String(activeDoc.department.id)}>{activeDoc.department.name}</option>
										{/if}
									</select>
								</div>

								<div>
									<label class="mb-1.5 block text-sm font-medium" for="manage-doc-status">Status</label>
									<select
										id="manage-doc-status"
										class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
										bind:value={editStatus}
										disabled={!canChangeStatus(activeDoc)}
									>
										{#each STATUSES as s (s)}
											<option value={s} disabled={statusOptionDisabled(s, activeDoc.status)}>{statusLabel(s)}</option>
										{/each}
									</select>
								</div>
							</div>

							{#if canEditContent(activeDoc)}
								<div>
									<p class="mb-1.5 text-sm font-medium">
										{appSettings.documents.enableVersioning ? 'Upload new version' : 'Replace file'}
									</p>

									<div class="relative">
										<label
											for="doc-replace-file"
											class={`group flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-3 pr-12 transition-colors focus-within:ring-ring/50 focus-within:ring-2 ${
												updatedFile
													? 'border-primary/50 bg-primary/5'
													: 'border-border hover:border-primary/50 hover:bg-muted/50'
											}`}
										>
											<input
												id="doc-replace-file"
												bind:this={replaceFileInput}
												type="file"
												accept={toAcceptAttribute(appSettings.documents.allowedFileTypes) || undefined}
												on:change={handleFileUpdate}
												class="sr-only"
											/>
											<span
												class="bg-muted text-muted-foreground group-hover:text-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors"
											>
												{#if updatedFile}
													<FileText class="h-5 w-5" />
												{:else}
													<Upload class="h-5 w-5" />
												{/if}
											</span>
											<span class="min-w-0 flex-1">
												<span class="block truncate text-sm font-medium">
													{updatedFile ? updatedFile.name : 'Choose a file'}
												</span>
												<span class="text-muted-foreground block text-xs">
													{#if updatedFile}
														{formatFileSize(updatedFile.size)} · click to choose a different file
													{:else}
														Click to browse{appSettings.documents.enableVersioning
															? ' · saving creates a new version'
															: ' · saving replaces the current file'}
													{/if}
												</span>
											</span>
										</label>

										{#if updatedFile}
											<button
												type="button"
												aria-label="Remove selected file"
												class="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1.5 transition-colors"
												on:click={clearReplacementFile}
											>
												<X class="h-4 w-4" />
											</button>
										{/if}
									</div>

									{#if updatedFile}
										<label class="mt-3 mb-1.5 block text-sm font-medium" for="doc-version-note">
											What changed? <span class="text-muted-foreground font-normal">(optional)</span>
										</label>
										<input
											id="doc-version-note"
											type="text"
											bind:value={versionNote}
											maxlength={1000}
											class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
										/>
									{/if}
								</div>
							{/if}
						</div>
					{/if}

					{#if activeTab === 'history'}
						{@const versions = activeDoc.versions}
						{#if versions.length}
							<!-- Newest first; each card's content is compared with the version before it. -->
							<ol class="space-y-4">
								{#each versions.map((version, index) => ({ version, index })).reverse() as { version, index } (version.id)}
									{@const prev = index > 0 ? versions[index - 1] : null}
									{@const isCurrent = index === versions.length - 1}
									<li class="relative pl-10">
										{#if index > 0}
											<span class="bg-border absolute top-8 -bottom-4 left-[13px] w-px" aria-hidden="true"></span>
										{/if}
										<span
											class={`bg-card absolute top-0.5 left-0 flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold ${
												isCurrent ? 'border-primary text-foreground' : 'border-border text-muted-foreground'
											}`}
										>
											v{version.versionNumber}
										</span>

										<div class="border-border/60 bg-card rounded-xl border p-4">
											<div class="flex flex-wrap items-center justify-between gap-2">
												<div class="flex items-center gap-2">
													<span class="text-sm font-medium">
														{prev ? 'New version' : 'Initial version'}
														<span class="text-muted-foreground font-normal">
															by {version.uploadedBy?.name ?? 'a removed user'}
														</span>
													</span>
													{#if isCurrent}
														<StatusBadge tone="info">Current</StatusBadge>
													{/if}
												</div>
												<div class="flex items-center gap-3">
													<RelativeTime value={version.createdAt} class="text-muted-foreground text-xs" />
													{#if activeDoc}
														{@const doc = activeDoc}
														<Button variant="outline" size="sm" onclick={() => openPreview(doc, version.versionNumber)}>
															<Eye class="h-3.5 w-3.5" /> Preview
														</Button>
													{/if}
												</div>
											</div>

											<dl class="mt-3 grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
												<dt class="text-muted-foreground text-xs">File</dt>
												<dd class="flex min-w-0 items-center gap-1.5">
													<FileText class="text-muted-foreground h-3.5 w-3.5 shrink-0" />
													<span class="truncate">{version.originalName}</span>
													<span class="text-muted-foreground shrink-0 text-xs">· {formatFileSize(version.size)}</span>
												</dd>
												{#if version.note}
													<dt class="text-muted-foreground text-xs">Note</dt>
													<dd>{version.note}</dd>
												{/if}
											</dl>

											{#if version.extractedText}
												<details class="group border-border/60 mt-3 rounded-lg border" open={!!prev?.extractedText}>
													<summary
														class="hover:bg-muted/50 flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium select-none"
													>
														<FileText class="text-muted-foreground h-3.5 w-3.5" />
														{prev?.extractedText ? 'Content changes' : 'File content'}
														<ChevronDown
															class="text-muted-foreground ml-auto h-3.5 w-3.5 transition-transform group-open:rotate-180"
														/>
													</summary>
													<div
														class="doc-diff border-border/60 max-h-64 overflow-auto border-t px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap"
													>
														{#if prev?.extractedText}
															{@html diffHtml(prev.extractedText, version.extractedText)}
														{:else}
															{version.extractedText}
														{/if}
													</div>
												</details>
											{/if}
										</div>
									</li>
								{/each}
							</ol>
						{:else}
							<div class="text-muted-foreground flex flex-col items-center gap-2 py-10 text-sm">
								<History class="h-8 w-8 opacity-40" />
								No versions yet.
							</div>
						{/if}
					{/if}

					{#if activeTab === 'timeline'}
						{#if activity.length}
							{@const entries = [...activity].reverse()}
							<ol>
								{#each entries as log, i (log.id)}
									{@const style = ACTION_STYLES[log.action] ?? ACTION_STYLES.edited}
									{@const Icon = style.icon}
									<li class="relative flex gap-3 pb-5 last:pb-0">
										{#if i < entries.length - 1}
											<span class="bg-border absolute top-9 bottom-1 left-4 w-px" aria-hidden="true"></span>
										{/if}
										<span class={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${style.class}`}>
											<Icon class="h-4 w-4" />
										</span>
										<div class="min-w-0 flex-1 pt-1">
											<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
												<p class="text-sm">
													<span class="font-medium capitalize">{log.action}</span>
													<span class="text-muted-foreground">by {log.actor}</span>
												</p>
												<RelativeTime value={log.createdAt} class="text-muted-foreground text-xs" />
											</div>
											{#if log.details}
												<ul class="text-muted-foreground mt-1 space-y-0.5 text-xs">
													{#each log.details.split('; ') as line}
														<li>{line}</li>
													{/each}
												</ul>
											{/if}
										</div>
									</li>
								{/each}
							</ol>
						{:else}
							<div class="text-muted-foreground flex flex-col items-center gap-2 py-10 text-sm">
								<CircleCheck class="h-8 w-8 opacity-40" />
								No activity yet.
							</div>
						{/if}
					{/if}
				</div>

				{#if manageError}
					<p class="text-destructive mt-4 text-sm">{manageError}</p>
				{/if}
			{/if}

			<!-- Actions -->
			<div class="mt-6 flex justify-end gap-2">
				<Button variant="outline" onclick={closeModal} disabled={saving}>Cancel</Button>
				<Button
					disabled={!activeDoc || !canChangeStatus(activeDoc) || activeTab !== 'edit' || saving}
					onclick={saveDocumentChanges}
				>
					{#if saving}<LoaderCircle class="h-4 w-4 animate-spin" />{/if}
					{saving ? 'Saving…' : 'Save Changes'}
				</Button>
			</div>
		</div>
	</div>
{/if}

<svelte:window on:keydown={handleWindowKeydown} />

{#if previewDoc}
	<div class="fixed inset-0 z-[60] flex items-center justify-center p-4">
		<button
			aria-label="Close preview"
			class="absolute inset-0 cursor-default bg-black/50"
			on:click={closePreview}
		></button>

		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="preview-title"
			class="bg-card border-border/60 relative flex h-[90vh] w-full max-w-[1200px] flex-col overflow-hidden rounded-2xl border shadow-2xl"
		>
			<header class="border-border/60 flex flex-wrap items-center gap-3 border-b px-5 py-3">
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<h2 id="preview-title" class="truncate text-base font-semibold">{previewDoc.title}</h2>
						<StatusBadge status={statusLabel(previewDoc.status)} />
					</div>
					<p class="text-muted-foreground truncate text-xs">
						{previewDoc.reference} · {previewDoc.department?.name ?? 'No department'}
						{#if previewVersion}
							· {previewVersion.originalName} · {formatFileSize(previewVersion.size)}
						{/if}
					</p>
				</div>

				{#if previewVersions.length > 1}
					<label class="sr-only" for="preview-version">Version</label>
					<select
						id="preview-version"
						value={previewVersionNumber}
						on:change={(e) => showVersion(Number(e.currentTarget.value))}
						class="border-border/60 focus-visible:ring-ring/50 rounded-lg border bg-transparent py-1.5 pr-8 pl-3 text-sm shadow-xs outline-none focus-visible:ring-2"
					>
						{#each [...previewVersions].reverse() as version (version.id)}
							<option value={version.versionNumber}>
								v{version.versionNumber} · {formatRelative(version.createdAt)}{version === previewVersions.at(-1)
									? ' (latest)'
									: ''}
							</option>
						{/each}
					</select>
				{/if}

				{#if previewVersion}
					{@const version = previewVersion}
					<Button variant="outline" size="sm" onclick={() => downloadVersion(version)}>
						<Download class="h-4 w-4" /> Download
					</Button>
				{/if}

				<button
					class="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg p-1.5 transition-colors"
					on:click={closePreview}
					aria-label="Close"
				>
					<X class="h-4 w-4" />
				</button>
			</header>

			<div class="bg-muted/40 min-h-0 flex-1 overflow-auto p-4">
				{#if previewError}
					<div class="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-center text-sm">
						<FileX class="h-10 w-10 opacity-40" />
						<p class="text-foreground font-medium">Couldn't load the file</p>
						<p class="max-w-sm text-xs">{previewError}</p>
					</div>
				{:else if previewLoading}
					<div class="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
						<LoaderCircle class="h-8 w-8 animate-spin opacity-60" />
						Loading file…
					</div>
				{:else if previewFile}
					<DocumentPreview file={previewFile} class="h-full" />
				{:else}
					<div class="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-center text-sm">
						<FileX class="h-10 w-10 opacity-40" />
						<p class="text-foreground font-medium">No file attached</p>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<ConfirmDialog
	open={!!docPendingDelete}
	title="Delete document?"
	description={docPendingDelete ? `This will remove "${docPendingDelete.title}" from the active list. An admin can restore it from “Show deleted”.` : ''}
	confirmText="Delete"
	onConfirm={confirmDeleteDocument}
	onCancel={() => (docPendingDelete = null)}
/>

<style>
	/* Change history. Translucent fills so the same colours work in both themes. */
	.doc-diff :global(.diff-add),
	.doc-diff :global(.diff-remove) {
		padding: 0 2px;
		margin: 0 1px;
		border-radius: 3px;
	}

	.doc-diff :global(.diff-add) {
		background: rgb(34 197 94 / 0.16);
		color: rgb(21 128 61);
	}

	.doc-diff :global(.diff-remove) {
		background: rgb(239 68 68 / 0.14);
		color: rgb(185 28 28);
		text-decoration: line-through;
	}

	:global(.dark) .doc-diff :global(.diff-add) {
		color: rgb(134 239 172);
	}

	:global(.dark) .doc-diff :global(.diff-remove) {
		color: rgb(252 165 165);
	}

	summary::-webkit-details-marker {
		display: none;
	}
</style>
