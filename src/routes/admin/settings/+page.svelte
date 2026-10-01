<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import { ConfirmDialog } from '$lib/components/ui/confirm-dialog';
	import { themePreference, setTheme, type ThemePreference } from '$lib/theme';
	import { loadSettings, saveSettings, settings, settingsLoaded } from '$lib/settings/store';
	import {
		DEFAULT_SETTINGS,
		PERMISSION_LABELS,
		ROLES,
		parseAllowedTypes,
		type AppSettings,
		type Permission,
		type Role
	} from '$lib/settings/types';
	import { departmentNames, loadDepartments } from '$lib/departments/store';
	import { onMount } from 'svelte';
	import RelativeTime from '$lib/components/site/RelativeTime.svelte';
	import { toast } from '$lib/toast/store';
	import { ApiError } from '$lib/api/client';
	import { listActivity } from '$lib/api/activity';
	import { ACTIVITY_ACTIONS, actionLabel, type ActivityEntryDTO } from '$lib/activity/types';
	import { isDesktop } from '$lib/config/env';
	import {
		backupDownloadUrl,
		downloadBackupWithToken,
		getLastRetentionRun,
		runRetentionNow,
		type RetentionRunDTO
	} from '$lib/api/maintenance';
	import { Sun, Moon, Monitor, RotateCcw, RefreshCw, Download, Play } from '@lucide/svelte';
	import { fade } from 'svelte/transition';

	function errorMessage(err: unknown) {
		return err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong';
	}

	/**
	 * Draft/commit. The page has an explicit Save button, so edits stay in the
	 * draft until it's pressed; the store mirrors what the server has stored.
	 */
	let draft = structuredClone($settings);
	let loadError = '';
	let saving = false;
	$: dirty = $settingsLoaded && JSON.stringify(draft) !== JSON.stringify($settings);

	async function reloadSettings() {
		loadError = '';
		try {
			draft = structuredClone(await loadSettings());
		} catch (err) {
			loadError = errorMessage(err);
		}
	}

	async function commit(next: AppSettings, successMessage: string) {
		saving = true;
		try {
			draft = structuredClone(await saveSettings(next));
			toast.success(successMessage);
		} catch (err) {
			// The draft is kept, so the admin can correct the field the server named.
			toast.error("Settings weren't saved", { description: errorMessage(err) });
		} finally {
			saving = false;
		}
	}

	function handleSave() {
		commit(draft, 'Settings saved');
	}

	function discardChanges() {
		draft = structuredClone($settings);
		toast.info('Changes discarded');
	}

	onMount(() => {
		reloadSettings();
		loadDepartments().catch(() => {});
		getLastRetentionRun()
			.then((run) => (lastRetention = run))
			.catch(() => {});
	});

	// ---- Backup (desktop) -----------------------------------------------------

	let backupBusy = false;

	async function downloadBackupDesktop() {
		backupBusy = true;
		try {
			await downloadBackupWithToken();
		} catch (err) {
			toast.error("Couldn't download the backup", { description: errorMessage(err) });
		} finally {
			backupBusy = false;
		}
	}

	// ---- Retention job --------------------------------------------------------

	let lastRetention: RetentionRunDTO | null = null;
	let retentionRunning = false;

	async function runRetention() {
		if (dirty) {
			toast.info('Save your changes first', {
				description: 'The job uses the saved retention settings.'
			});
			return;
		}
		retentionRunning = true;
		try {
			lastRetention = await runRetentionNow();
			const { archived, purged } = lastRetention;
			toast.success('Retention job finished', {
				description: `${archived} archived, ${purged} permanently removed.`
			});
		} catch (err) {
			toast.error("The retention job didn't run", { description: errorMessage(err) });
		} finally {
			retentionRunning = false;
		}
	}

	const sections = [
		{ id: 'general', label: 'General' },
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'documents', label: 'Documents' },
		{ id: 'retention', label: 'Retention' },
		{ id: 'roles', label: 'Roles' },
		{ id: 'security', label: 'Security' },
		{ id: 'audit', label: 'Audit log' },
		{ id: 'backup', label: 'Backup' },
		{ id: 'danger', label: 'Danger zone' }
	];

	const themeOptions: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
		{ value: 'light', label: 'Light', icon: Sun },
		{ value: 'dark', label: 'Dark', icon: Moon },
		{ value: 'system', label: 'System', icon: Monitor }
	];

	const timezones = [
		'UTC',
		'America/New_York',
		'America/Los_Angeles',
		'Asia/Manila',
		'Europe/London'
	];

	// ---- Roles ----------------------------------------------------------------

	function togglePermission(role: Role, permission: Permission, granted: boolean) {
		const current = new Set(draft.roles[role]);
		if (granted) current.add(permission);
		else current.delete(permission);
		// Keep the stored order stable so the dirty check stays meaningful.
		draft.roles[role] = PERMISSION_LABELS.map((p) => p.value).filter((p) => current.has(p));
		draft = draft;
	}

	// ---- Audit log ------------------------------------------------------------

	// Read from the server, which records every action; it's append-only, so there's no clearing it.

	const AUDIT_PAGE_SIZE = 25;

	let actionFilter = '';
	let auditSearch = '';
	let auditEntries: ActivityEntryDTO[] = [];
	let auditCursor: number | null = null;
	let auditLoading = false;
	let auditError = '';

	// Filters can change mid-request; only the latest request may land.
	let auditSeq = 0;

	async function loadAudit(reset: boolean) {
		const seq = ++auditSeq;
		auditLoading = true;
		auditError = '';
		try {
			const res = await listActivity({
				action: actionFilter || undefined,
				search: auditSearch.trim() || undefined,
				before: reset ? undefined : (auditCursor ?? undefined),
				limit: AUDIT_PAGE_SIZE
			});
			if (seq !== auditSeq) return;
			auditEntries = reset ? res.entries : [...auditEntries, ...res.entries];
			auditCursor = res.nextCursor;
		} catch (error) {
			if (seq === auditSeq) {
				auditError = error instanceof Error ? error.message : 'Could not load the audit log.';
			}
		} finally {
			if (seq === auditSeq) auditLoading = false;
		}
	}

	let auditSearchTimer: ReturnType<typeof setTimeout>;
	function handleAuditSearch() {
		clearTimeout(auditSearchTimer);
		auditSearchTimer = setTimeout(() => loadAudit(true), 250);
	}

	onMount(() => loadAudit(true));

	// ---- Destructive confirmations -------------------------------------------

	type PendingAction = 'reset-settings' | null;
	let pendingAction: PendingAction = null;

	const confirmCopy: Record<
		Exclude<PendingAction, null>,
		{ title: string; description: string; confirmText: string }
	> = {
		'reset-settings': {
			title: 'Reset all settings?',
			description:
				'Every section returns to its factory default. Documents, departments and the activity log are left alone.',
			confirmText: 'Reset settings'
		}
	};

	function runPendingAction() {
		if (pendingAction === 'reset-settings') {
			const defaults = structuredClone(DEFAULT_SETTINGS);
			// The factory default department may not exist here; the server would refuse it.
			if (!$departmentNames.includes(defaults.general.defaultDepartment)) {
				defaults.general.defaultDepartment = $departmentNames[0] ?? '';
			}
			commit(defaults, 'Settings reset to defaults');
		}
		pendingAction = null;
	}

	const inputClass =
		'border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2';
</script>

<div class="lg:grid lg:grid-cols-[160px_1fr] lg:gap-10">
	<!-- Section nav -->
	<nav class="mb-6 lg:mb-0">
		<label class="sr-only" for="settings-jump">Jump to section</label>
		<select
			id="settings-jump"
			class={`${inputClass} lg:hidden`}
			on:change={(e) => {
				const id = (e.currentTarget as HTMLSelectElement).value;
				document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}}
		>
			{#each sections as section (section.id)}
				<option value={section.id}>{section.label}</option>
			{/each}
		</select>

		<ul class="sticky top-4 hidden space-y-0.5 text-sm lg:block">
			{#each sections as section (section.id)}
				<li>
					<a
						href={`#${section.id}`}
						class="text-muted-foreground hover:bg-muted hover:text-foreground block rounded-md px-3 py-1.5 transition-colors"
					>
						{section.label}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<div class="divide-border/60 min-w-0 divide-y">
		{#if loadError}
			<div class="border-destructive/30 bg-destructive/5 text-destructive mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
				<span>Couldn't load settings from the server: {loadError}</span>
				<Button variant="outline" size="sm" onclick={reloadSettings}>
					<RefreshCw class="h-4 w-4" /> Retry
				</Button>
			</div>
		{/if}

		<!-- General -->
		<section id="general" class="scroll-mt-4 pb-6">
			<h2 class="text-sm font-semibold tracking-tight">General</h2>
			<p class="text-muted-foreground mt-1 text-sm">Basic information about your organization.</p>

			<div class="mt-4 grid gap-4 sm:grid-cols-2">
				<div>
					<label class="mb-1.5 block text-sm font-medium" for="org-name">Organization name</label>
					<input id="org-name" type="text" bind:value={draft.general.orgName} class={inputClass} />
				</div>
				<div>
					<label class="mb-1.5 block text-sm font-medium" for="support-email">Support email</label>
					<input
						id="support-email"
						type="email"
						bind:value={draft.general.supportEmail}
						class={inputClass}
					/>
				</div>
				<div>
					<label class="mb-1.5 block text-sm font-medium" for="default-department">
						Default department
					</label>
					<select id="default-department" bind:value={draft.general.defaultDepartment} class={inputClass}>
						<option value="">None</option>
						{#each $departmentNames as name (name)}
							<option>{name}</option>
						{/each}
					</select>
					<p class="text-muted-foreground mt-1.5 text-xs">
						Pre-selected when creating documents, users and workflow items. Managed on the
						Departments page.
					</p>
				</div>
				<div>
					<label class="mb-1.5 block text-sm font-medium" for="timezone">Time zone</label>
					<select id="timezone" bind:value={draft.general.timezone} class={inputClass}>
						{#each timezones as zone (zone)}
							<option>{zone}</option>
						{/each}
					</select>
				</div>
			</div>
		</section>

		<!-- Appearance -->
		<section id="appearance" class="scroll-mt-4 py-6">
			<h2 class="text-sm font-semibold tracking-tight">Appearance</h2>
			<p class="text-muted-foreground mt-1 text-sm">
				Choose how eDMS looks on this device. Applies immediately — it is not part of Save Changes.
			</p>

			<div class="mt-4 flex gap-2">
				{#each themeOptions as option (option.value)}
					<Button
						variant={$themePreference === option.value ? 'default' : 'outline'}
						size="sm"
						onclick={() => setTheme(option.value)}
					>
						<option.icon class="h-4 w-4" />
						{option.label}
					</Button>
				{/each}
			</div>
		</section>

		<!-- Document Management -->
		<section id="documents" class="scroll-mt-4 py-6">
			<h2 class="text-sm font-semibold tracking-tight">Document Management</h2>
			<p class="text-muted-foreground mt-1 text-sm">Defaults applied to newly uploaded documents.</p>

			<div class="mt-4 grid gap-4 sm:grid-cols-2">
				<div>
					<label class="mb-1.5 block text-sm font-medium" for="max-upload">
						Max upload size (MB)
					</label>
					<input
						id="max-upload"
						type="number"
						min="1"
						bind:value={draft.documents.maxUploadSizeMb}
						class={inputClass}
					/>
				</div>
				<div>
					<label class="mb-1.5 block text-sm font-medium" for="allowed-types">
						Allowed file types
					</label>
					<input
						id="allowed-types"
						type="text"
						bind:value={draft.documents.allowedFileTypes}
						class={inputClass}
					/>
					<p class="text-muted-foreground mt-1.5 text-xs">
						Comma-separated extensions. Enforced by the uploader:
						{parseAllowedTypes(draft.documents.allowedFileTypes).join(', ') || 'any type allowed'}
					</p>
				</div>
			</div>

			<div class="mt-4 space-y-3">
				<div class="border-border/60 flex items-center justify-between gap-4 rounded-lg border p-4">
					<div>
						<p class="text-sm font-medium">Enable versioning</p>
						<p class="text-muted-foreground text-sm">
							Keep a history of every change made to a document.
						</p>
					</div>
					<Switch bind:checked={draft.documents.enableVersioning} />
				</div>
				<div class="border-border/60 flex items-center justify-between gap-4 rounded-lg border p-4">
					<div>
						<p class="text-sm font-medium">Require approval before publish</p>
						<p class="text-muted-foreground text-sm">
							New documents stay in Draft until an approver signs off.
						</p>
					</div>
					<Switch bind:checked={draft.documents.requireApproval} />
				</div>
			</div>
		</section>

		<!-- Retention -->
		<section id="retention" class="scroll-mt-4 py-6">
			<h2 class="text-sm font-semibold tracking-tight">Retention &amp; Archival</h2>
			<p class="text-muted-foreground mt-1 text-sm">
				How long documents stay active, and how long deleted ones are recoverable.
			</p>

			<div class="mt-4 space-y-3">
				<div class="border-border/60 flex items-center justify-between gap-4 rounded-lg border p-4">
					<div>
						<p class="text-sm font-medium">Auto-archive inactive documents</p>
						<p class="text-muted-foreground text-sm">
							Move untouched documents out of the active list automatically.
						</p>
					</div>
					<Switch bind:checked={draft.retention.autoArchiveEnabled} />
				</div>
			</div>

			<div class="mt-4 grid gap-4 sm:grid-cols-2">
				<div>
					<label class="mb-1.5 block text-sm font-medium" for="archive-after">
						Archive after (days)
					</label>
					<input
						id="archive-after"
						type="number"
						min="1"
						disabled={!draft.retention.autoArchiveEnabled}
						bind:value={draft.retention.archiveAfterDays}
						class={`${inputClass} disabled:opacity-60`}
					/>
				</div>
				<div>
					<label class="mb-1.5 block text-sm font-medium" for="purge-after">
						Purge deleted after (days)
					</label>
					<input
						id="purge-after"
						type="number"
						min="1"
						bind:value={draft.retention.purgeDeletedAfterDays}
						class={inputClass}
					/>
					<p class="text-muted-foreground mt-1.5 text-xs">
						Deleted documents stay restorable for this long before they are removed for good.
					</p>
				</div>
			</div>

			<div class="border-border/60 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
				<div class="text-sm">
					<p class="font-medium">Retention job</p>
					<p class="text-muted-foreground">
						Runs hourly on the server. Documents in Pending or Reviewed are never auto-archived.
						{#if lastRetention}
							Last run <RelativeTime value={lastRetention.at} />: {lastRetention.archived} archived,
							{lastRetention.purged} removed.
						{:else}
							Hasn't run since the server started.
						{/if}
					</p>
				</div>
				<Button variant="outline" size="sm" disabled={retentionRunning || !$settingsLoaded} onclick={runRetention}>
					<Play class="h-4 w-4" />
					{retentionRunning ? 'Running…' : 'Run now'}
				</Button>
			</div>
		</section>

		<!-- Roles & Permissions -->
		<section id="roles" class="scroll-mt-4 py-6">
			<h2 class="text-sm font-semibold tracking-tight">Roles &amp; Permissions</h2>
			<p class="text-muted-foreground mt-1 text-sm">
				What each role is allowed to do. Assign a role to a person on the Users page.
			</p>

			<div class="border-border/60 mt-4 overflow-x-auto rounded-lg border">
				<table class="w-full text-sm">
					<thead class="border-border/60 bg-muted/40 border-b">
						<tr>
							<th class="text-muted-foreground px-4 py-3 text-left text-xs font-medium tracking-wide uppercase">
								Permission
							</th>
							{#each ROLES as role (role)}
								<th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">
									{role}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each PERMISSION_LABELS as permission (permission.value)}
							<tr class="border-border/60 border-b last:border-0">
								<td class="px-4 py-3">
									<p class="font-medium">{permission.label}</p>
									<p class="text-muted-foreground text-xs">{permission.description}</p>
								</td>
								{#each ROLES as role (role)}
									<td class="px-4 py-3 text-center">
										<input
											type="checkbox"
											class="accent-primary h-4 w-4 align-middle disabled:opacity-50"
											aria-label={`${permission.label} for ${role}`}
											checked={draft.roles[role].includes(permission.value)}
											disabled={role === 'admin'}
											on:change={(e) =>
												togglePermission(role, permission.value, e.currentTarget.checked)}
										/>
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="text-muted-foreground mt-2 text-xs">
				The admin row is fixed — removing an admin's own permissions would lock everyone out of
				this page.
			</p>
		</section>

		<!-- Security -->
		<section id="security" class="scroll-mt-4 py-6">
			<h2 class="text-sm font-semibold tracking-tight">Security</h2>
			<p class="text-muted-foreground mt-1 text-sm">Session and authentication policies.</p>

			<div class="mt-4 grid gap-4 sm:grid-cols-2">
				<div>
					<label class="mb-1.5 block text-sm font-medium" for="session-timeout">
						Session timeout
					</label>
					<select
						id="session-timeout"
						bind:value={draft.security.sessionTimeoutMinutes}
						class={inputClass}
					>
						<option value={15}>15 minutes</option>
						<option value={30}>30 minutes</option>
						<option value={60}>1 hour</option>
						<option value={480}>8 hours</option>
					</select>
					<p class="text-muted-foreground mt-1.5 text-xs">
						Signed out automatically after this long without activity.
					</p>
				</div>
			</div>

		</section>

		<!-- Audit log -->
		<section id="audit" class="scroll-mt-4 py-6">
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 class="text-sm font-semibold tracking-tight">Audit Log</h2>
					<p class="text-muted-foreground mt-1 text-sm">
						System-wide record of what changed, newest first. Kept on the server and can't be
						edited or cleared.
					</p>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<label class="sr-only" for="audit-search">Search audit log</label>
					<input
						id="audit-search"
						type="text"
						placeholder="Search actor, target, details…"
						bind:value={auditSearch}
						on:input={handleAuditSearch}
						class="border-border/60 focus-visible:ring-ring/50 rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2"
					/>
					<label class="text-muted-foreground shrink-0 text-xs font-medium" for="audit-filter">
						Action
					</label>
					<select
						id="audit-filter"
						bind:value={actionFilter}
						on:change={() => loadAudit(true)}
						class="border-border/60 rounded-lg border bg-transparent px-2 py-2 text-sm shadow-xs"
					>
						<option value="">All</option>
						{#each ACTIVITY_ACTIONS as action (action.value)}
							<option value={action.value}>{action.label}</option>
						{/each}
					</select>
					<Button variant="outline" size="sm" disabled={auditLoading} onclick={() => loadAudit(true)}>
						<RefreshCw class={`h-4 w-4 ${auditLoading ? 'animate-spin' : ''}`} />
						Refresh
					</Button>
				</div>
			</div>

			{#if auditError}
				<p class="border-destructive/30 bg-destructive/5 text-destructive mt-4 rounded-lg border p-3 text-sm">
					{auditError}
				</p>
			{/if}

			{#if auditEntries.length === 0}
				<p
					class="border-border/60 text-muted-foreground mt-4 rounded-lg border border-dashed p-6 text-center text-sm"
				>
					{#if auditLoading}
						Loading…
					{:else if actionFilter || auditSearch.trim()}
						No entries match these filters.
					{:else}
						Nothing recorded yet.
					{/if}
				</p>
			{:else}
				<div class="border-border/60 mt-4 overflow-x-auto rounded-lg border">
					<table class="w-full text-sm">
						<thead class="border-border/60 bg-muted/40 border-b">
							<tr>
								<th class="text-muted-foreground px-4 py-3 text-left text-xs font-medium tracking-wide uppercase">
									When
								</th>
								<th class="text-muted-foreground px-4 py-3 text-left text-xs font-medium tracking-wide uppercase">
									Action
								</th>
								<th class="text-muted-foreground px-4 py-3 text-left text-xs font-medium tracking-wide uppercase">
									Target
								</th>
								<th class="text-muted-foreground px-4 py-3 text-left text-xs font-medium tracking-wide uppercase">
									Actor
								</th>
								<th class="text-muted-foreground px-4 py-3 text-left text-xs font-medium tracking-wide uppercase">
									Details
								</th>
							</tr>
						</thead>
						<tbody>
							{#each auditEntries as entry (entry.id)}
								<tr class="border-border/60 border-b last:border-0">
									<td class="text-muted-foreground px-4 py-3 whitespace-nowrap">
										<RelativeTime value={entry.createdAt} />
									</td>
									<td class="px-4 py-3">
										<span
											class={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
												entry.action === 'login_failed'
													? 'bg-destructive/10 text-destructive'
													: 'bg-muted'
											}`}
										>
											{actionLabel(entry.action)}
										</span>
									</td>
									<td class="px-4 py-3">
										{entry.target ?? '—'}
										{#if entry.targetType}
											<span class="text-muted-foreground block text-xs capitalize">{entry.targetType}</span>
										{/if}
									</td>
									<td class="text-muted-foreground px-4 py-3">{entry.actor}</td>
									<td class="text-muted-foreground px-4 py-3">{entry.details ?? '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<div class="mt-3 flex items-center justify-between gap-4">
					<p class="text-muted-foreground text-xs">
						Showing {auditEntries.length}{auditCursor !== null ? '+' : ''} entries
					</p>
					{#if auditCursor !== null}
						<Button variant="outline" size="sm" disabled={auditLoading} onclick={() => loadAudit(false)}>
							{auditLoading ? 'Loading…' : 'Show more'}
						</Button>
					{/if}
				</div>
			{/if}
		</section>

		<!-- Backup -->
		<section id="backup" class="scroll-mt-4 py-6">
			<h2 class="text-sm font-semibold tracking-tight">Backup &amp; Restore</h2>
			<p class="text-muted-foreground mt-1 text-sm">
				Everything (settings, departments, users, documents, their files and the audit log) is
				stored on the server, in the database file and the file storage folder.
			</p>

			<div class="mt-4 flex flex-wrap gap-2">
				{#if isDesktop}
					<Button variant="outline" size="sm" disabled={backupBusy} onclick={downloadBackupDesktop}>
						<Download class="h-4 w-4" />
						{backupBusy ? 'Preparing backup…' : 'Download backup'}
					</Button>
				{:else}
					<Button variant="outline" size="sm" href={backupDownloadUrl()} download>
						<Download class="h-4 w-4" /> Download backup
					</Button>
				{/if}
			</div>
			<p class="text-muted-foreground mt-2 text-xs">
				A <code>.tar.gz</code> with a consistent snapshot of the database and every stored file,
				taken while the server keeps running. Large libraries take a while to download. Each backup
				is recorded in the audit log.
			</p>

			<p class="border-border/60 bg-muted/40 text-muted-foreground mt-3 rounded-lg border p-3 text-xs">
				<span class="text-foreground font-medium">To restore</span>, the server administrator stops
				the server and runs <code>npm run db:restore -- &lt;backup file&gt; --yes</code> on it. The
				current data is set aside, not deleted. Restoring replaces everything, so it isn't offered
				from this page.
			</p>
		</section>

		<!-- Danger Zone -->
		<section id="danger" class="scroll-mt-4 pt-6">
			<h2 class="text-destructive text-sm font-semibold tracking-tight">Danger Zone</h2>
			<p class="text-muted-foreground mt-1 text-sm">Irreversible actions — proceed with caution.</p>

			<div class="mt-4 space-y-3">
				<div
					class="border-destructive/30 bg-destructive/5 flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
				>
					<div>
						<p class="text-sm font-medium">Reset all settings</p>
						<p class="text-muted-foreground text-sm">
							Returns every section on this page to its factory default.
						</p>
					</div>
					<Button
						variant="destructive"
						size="sm"
						disabled={!$settingsLoaded || saving}
						onclick={() => (pendingAction = 'reset-settings')}
					>
						<RotateCcw class="h-4 w-4" />
						Reset
					</Button>
				</div>
			</div>
		</section>
	</div>
</div>

<!-- Save bar -->
<div class="border-border/60 mt-6 flex items-center justify-end gap-3 border-t pt-6">
	{#if dirty}
		<p class="text-muted-foreground text-sm" transition:fade={{ duration: 150 }}>
			You have unsaved changes
		</p>
	{/if}
	<Button variant="outline" disabled={!dirty || saving} onclick={discardChanges}>Discard</Button>
	<Button disabled={!dirty || saving} onclick={handleSave}>
		{saving ? 'Saving…' : 'Save Changes'}
	</Button>
</div>

<ConfirmDialog
	open={pendingAction !== null}
	title={pendingAction ? confirmCopy[pendingAction].title : ''}
	description={pendingAction ? confirmCopy[pendingAction].description : ''}
	confirmText={pendingAction ? confirmCopy[pendingAction].confirmText : ''}
	onConfirm={runPendingAction}
	onCancel={() => (pendingAction = null)}
/>
