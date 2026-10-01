<script lang="ts">
	import { onMount } from 'svelte';
	import { Building2, Plus, Pencil, Trash2, Table, Grid, RefreshCw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { StatusBadge } from '$lib/components/ui/status-badge';
	import { ConfirmDialog } from '$lib/components/ui/confirm-dialog';
	import { departments, loadDepartments } from '$lib/departments/store';
	import { settings } from '$lib/settings/store';
	import { ROLES, type Role } from '$lib/settings/types';
	import { currentUser } from '$lib/auth/store';
	import { ApiError } from '$lib/api/client';
	import { createUser, deleteUser, listUsers, updateUser, type UserDTO } from '$lib/api/users';
	import { PASSWORD_MIN, type UserInput, type UserStatus } from '$lib/users/types';
	import { toast } from '$lib/toast/store';
	import RelativeTime from '$lib/components/site/RelativeTime.svelte';

	function errorMessage(err: unknown) {
		return err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong';
	}

	const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

	// ---- Server state ---------------------------------------------------------

	let users: UserDTO[] = [];
	let loading = true;
	let listError = '';

	async function refresh() {
		loading = true;
		listError = '';
		try {
			users = await listUsers();
		} catch (err) {
			listError = errorMessage(err);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		refresh();
		loadDepartments().catch(() => {});
	});

	// ---- Filters --------------------------------------------------------------

	let search = '';
	/** A department id, `none`, or empty for all. */
	let filterDept = '';
	let filterStatus: UserStatus | '' = '';
	let viewMode: 'table' | 'cards' = 'table';

	$: query = search.trim().toLowerCase();
	$: filteredUsers = users.filter(
		(u) =>
			(!query ||
				u.name.toLowerCase().includes(query) ||
				u.username.toLowerCase().includes(query) ||
				(u.email ?? '').toLowerCase().includes(query)) &&
			(!filterDept ||
				(filterDept === 'none' ? u.departmentId === null : String(u.departmentId) === filterDept)) &&
			(!filterStatus || u.status === filterStatus)
	);

	// ---- Create / edit --------------------------------------------------------

	let showCreate = false;
	let showEdit: UserDTO | null = null;
	let form: UserInput = emptyForm();
	let formError = '';
	let saving = false;

	function emptyForm(): UserInput {
		// New users land in the organization's default department from Settings.
		const fallback = $departments.find((d) => d.name === $settings.general.defaultDepartment);
		return {
			username: '',
			name: '',
			email: '',
			role: 'viewer',
			status: 'active',
			departmentId: fallback?.id ?? null,
			password: ''
		};
	}

	function openCreate() {
		form = emptyForm();
		formError = '';
		showCreate = true;
	}

	function openEdit(user: UserDTO) {
		showEdit = user;
		form = {
			username: user.username,
			name: user.name,
			email: user.email ?? '',
			role: user.role,
			status: user.status,
			departmentId: user.departmentId,
			password: ''
		};
		formError = '';
	}

	function closeForm() {
		showCreate = false;
		showEdit = null;
	}

	$: editingSelf = !!showEdit && showEdit.id === $currentUser?.id;

	async function submitForm() {
		formError = '';
		if (!form.name.trim() || !form.username.trim()) {
			formError = 'Name and username are required';
			return;
		}
		if ((showCreate || form.password) && (form.password ?? '').length < PASSWORD_MIN) {
			formError = `Password must be at least ${PASSWORD_MIN} characters`;
			return;
		}

		saving = true;
		try {
			if (showEdit) {
				const { password, ...rest } = form;
				// Your own role and status are locked on the server; don't send them.
				const changes: Partial<UserInput> = editingSelf
					? { username: rest.username, name: rest.name, email: rest.email, departmentId: rest.departmentId }
					: rest;
				await updateUser(showEdit.id, password ? { ...changes, password } : changes);
				toast.success('User updated', {
					description: password
						? `${form.name} has a new password and was signed out of other sessions.`
						: form.name
				});
			} else {
				await createUser(form);
				toast.success('User created', { description: `${form.name} can sign in as ${form.username}` });
			}
			closeForm();
			await refresh();
		} catch (err) {
			// Shown in the dialog, e.g. a taken username, so the admin can fix it there.
			formError = errorMessage(err);
		} finally {
			saving = false;
		}
	}

	// ---- Activate / deactivate / delete ---------------------------------------

	async function setStatus(user: UserDTO, status: UserStatus) {
		try {
			await updateUser(user.id, { status });
			toast.success(status === 'active' ? 'User activated' : 'User deactivated', {
				description:
					status === 'active' ? user.name : `${user.name} was signed out and can no longer sign in.`
			});
		} catch (err) {
			toast.error(`Couldn't update ${user.name}`, { description: errorMessage(err) });
		}
		await refresh();
	}

	let userPendingDelete: UserDTO | null = null;

	function requestRemoveUser(user: UserDTO) {
		if (user.id === $currentUser?.id) {
			toast.error("You can't delete your own account");
			return;
		}
		if (user.ownedDocuments) {
			toast.error(`Can't delete ${user.name}`, {
				description: `They own ${user.ownedDocuments} document${user.ownedDocuments === 1 ? '' : 's'}. Deactivate the account instead.`
			});
			return;
		}
		userPendingDelete = user;
	}

	async function confirmRemoveUser() {
		const user = userPendingDelete;
		userPendingDelete = null;
		if (!user) return;
		try {
			await deleteUser(user.id);
			toast.success('User deleted', { description: user.name });
		} catch (err) {
			toast.error(`Can't delete ${user.name}`, { description: errorMessage(err) });
		}
		await refresh();
	}

	const inputClass =
		'border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2 disabled:opacity-60';
</script>

<div class="space-y-6">
<!-- Search + Filters + View -->
<div class="mb-4 flex flex-wrap items-center justify-between gap-4">
	<input
		type="text"
		placeholder="Search name, username, email…"
		bind:value={search}
		class={`${inputClass} md:w-64`}
	/>

	<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
		<div class="flex items-center gap-2">
			<label for="user-filter-department" class="text-muted-foreground shrink-0 text-xs font-medium">Department</label>
			<select id="user-filter-department" bind:value={filterDept} class="border-border/60 rounded-lg border bg-transparent px-2 py-2 text-sm shadow-xs">
				<option value="">All</option>
				{#each $departments as dep (dep.id)}
					<option value={String(dep.id)}>{dep.name}</option>
				{/each}
				<option value="none">No department</option>
			</select>
		</div>

		<div class="flex items-center gap-2">
			<label for="user-filter-status" class="text-muted-foreground shrink-0 text-xs font-medium">Status</label>
			<select id="user-filter-status" bind:value={filterStatus} class="border-border/60 rounded-lg border bg-transparent px-2 py-2 text-sm shadow-xs">
				<option value="">All</option>
				<option value="active">Active</option>
				<option value="inactive">Inactive</option>
			</select>
		</div>
	</div>

	<div class="flex gap-2">
		<Button
			variant={viewMode === 'table' ? 'default' : 'outline'}
			size="sm"
			onclick={() => (viewMode = 'table')}
		>
			<Table class="h-4 w-4" /> Table
		</Button>

		<Button
			variant={viewMode === 'cards' ? 'default' : 'outline'}
			size="sm"
			onclick={() => (viewMode = 'cards')}
		>
			<Grid class="h-4 w-4" /> Cards
		</Button>
	</div>

	<Button onclick={openCreate}>
		<Plus class="h-4 w-4" /> New User
	</Button>
</div>

{#if listError}
	<div class="border-destructive/30 bg-destructive/5 text-destructive flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
		<span>Couldn't load users: {listError}</span>
		<Button variant="outline" size="sm" onclick={refresh}>
			<RefreshCw class="h-4 w-4" /> Retry
		</Button>
	</div>
{/if}

<!-- Empty / loading state -->
{#if filteredUsers.length === 0 && !listError}
	<div class="bg-card text-muted-foreground border-border/60 flex h-80 flex-col items-center justify-center gap-2 rounded-xl border text-center text-sm shadow-sm">
		{loading ? 'Loading…' : users.length ? 'No users match these filters.' : 'No users yet.'}
	</div>
{/if}

<!-- Table View -->
{#if viewMode === 'table' && filteredUsers.length}
	<div class="bg-card border-border/60 overflow-x-auto rounded-xl border shadow-sm">
		<table class="w-full text-sm">
			<thead class="border-border/60 border-b">
				<tr>
					<th class="text-muted-foreground px-4 py-3 text-left text-xs font-medium tracking-wide uppercase">Name</th>
					<th class="text-muted-foreground px-4 py-3 text-xs font-medium tracking-wide uppercase">Email</th>
					<th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">Department</th>
					<th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">Role</th>
					<th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">Status</th>
					<th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">Last sign-in</th>
					<th class="text-muted-foreground px-4 py-3 text-right text-xs font-medium tracking-wide uppercase">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredUsers as user (user.id)}
					<tr class="hover:bg-muted/50 border-border/60 border-b transition-colors">
						<td class="px-4 py-3.5">
							<span class="font-medium">{user.name}</span>
							{#if user.id === $currentUser?.id}
								<span class="bg-muted text-muted-foreground ml-1.5 rounded-full px-2 py-0.5 text-xs">You</span>
							{/if}
							<span class="text-muted-foreground block text-xs">{user.username}</span>
						</td>
						<td class="text-muted-foreground px-4 py-3.5 text-center text-sm">{user.email ?? '—'}</td>
						<td class="px-4 py-3.5 text-center">{user.department ?? '—'}</td>
						<td class="px-4 py-3.5 text-center">
							<span class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium capitalize">
								{user.role}
							</span>
						</td>
						<td class="px-4 py-3.5 text-center"><StatusBadge status={capitalize(user.status)} /></td>
						<td class="text-muted-foreground px-4 py-3.5 text-center">
							{#if user.lastLoginAt}<RelativeTime value={user.lastLoginAt} />{:else}Never{/if}
						</td>
						<td class="px-4 py-3.5">
							<div class="flex items-center justify-end gap-1">
								{#if user.id !== $currentUser?.id}
									<Button
										variant="ghost"
										size="sm"
										onclick={() => setStatus(user, user.status === 'active' ? 'inactive' : 'active')}
									>
										{user.status === 'active' ? 'Deactivate' : 'Activate'}
									</Button>
								{/if}
								<button aria-label={`Edit ${user.name}`} class="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors" on:click={() => openEdit(user)}>
									<Pencil class="h-4 w-4" />
								</button>
								<button aria-label={`Delete ${user.name}`} class="text-destructive hover:bg-destructive/10 rounded-md p-1.5 transition-colors" on:click={() => requestRemoveUser(user)}>
									<Trash2 class="h-4 w-4" />
								</button>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<!-- Card View -->
{#if viewMode === 'cards'}
	<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
		{#each filteredUsers as user (user.id)}
			<div class="bg-card border-border/60 rounded-xl border p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
				<div class="flex items-center justify-between">
					<h3 class="font-semibold tracking-tight">
						{user.name}
						{#if user.id === $currentUser?.id}
							<span class="bg-muted text-muted-foreground ml-1 rounded-full px-2 py-0.5 text-xs font-normal">You</span>
						{/if}
					</h3>
					<div class="flex gap-1">
						<button aria-label={`Edit ${user.name}`} class="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors" on:click={() => openEdit(user)}>
							<Pencil class="h-4 w-4" />
						</button>
						<button aria-label={`Delete ${user.name}`} class="text-destructive hover:bg-destructive/10 rounded-md p-1.5 transition-colors" on:click={() => requestRemoveUser(user)}>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				</div>

				<p class="text-muted-foreground mt-0.5 text-sm">{user.username}{user.email ? ` · ${user.email}` : ''}</p>
				<p class="text-muted-foreground mt-3 flex items-center gap-1.5 text-sm">
					<Building2 class="h-3.5 w-3.5" />
					{user.department ?? 'No department'}
				</p>
				<p class="mt-3 flex items-center gap-2 text-sm">
					<StatusBadge status={capitalize(user.status)} />
					<span class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium capitalize">
						{user.role}
					</span>
				</p>
				<p class="text-muted-foreground mt-3 text-xs">
					Last sign-in: {#if user.lastLoginAt}<RelativeTime value={user.lastLoginAt} />{:else}never{/if}
				</p>
			</div>
		{/each}
	</div>
{/if}
</div>

<!-- CREATE / EDIT MODAL -->
{#if showCreate || showEdit}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<form
			class="bg-card border-border/60 w-full max-w-md rounded-2xl border p-6 shadow-2xl"
			on:submit|preventDefault={submitForm}
		>
			<h2 class="mb-5 text-lg font-semibold tracking-tight">{showEdit ? 'Edit User' : 'Create User'}</h2>

			<div class="space-y-3">
				<input placeholder="Full name" aria-label="Full name" maxlength="100" bind:value={form.name} class={inputClass} />
				<input
					placeholder="Username (used to sign in)"
					aria-label="Username"
					autocomplete="off"
					maxlength="64"
					bind:value={form.username}
					class={inputClass}
				/>
				<input placeholder="Email (optional)" aria-label="Email" type="email" bind:value={form.email} class={inputClass} />

				<select aria-label="Department" bind:value={form.departmentId} class={inputClass}>
					<option value={null}>No department</option>
					{#each $departments as dep (dep.id)}
						<option value={dep.id}>{dep.name}</option>
					{/each}
				</select>

				<select aria-label="Role" bind:value={form.role} disabled={editingSelf} class={inputClass}>
					{#each ROLES as role (role)}
						<option value={role}>
							{capitalize(role)} — {$settings.roles[role as Role].join(', ') || 'no permissions'}
						</option>
					{/each}
				</select>

				<select aria-label="Status" bind:value={form.status} disabled={editingSelf} class={inputClass}>
					<option value="active">Active</option>
					<option value="inactive">Inactive</option>
				</select>
				{#if editingSelf}
					<p class="text-muted-foreground text-xs">
						You can't change your own role or status. Another admin has to.
					</p>
				{/if}

				<input
					placeholder={showEdit ? 'New password (leave blank to keep)' : `Password (at least ${PASSWORD_MIN} characters)`}
					aria-label="Password"
					type="password"
					autocomplete="new-password"
					bind:value={form.password}
					class={inputClass}
				/>
				{#if showEdit && form.password}
					<p class="text-muted-foreground text-xs">
						Saving a new password signs {editingSelf ? 'you out of your other sessions' : `${showEdit.name} out everywhere`}.
					</p>
				{/if}

				{#if formError}
					<p class="text-destructive text-sm">{formError}</p>
				{/if}
			</div>

			<div class="mt-4 flex justify-end gap-2">
				<Button type="button" variant="outline" onclick={closeForm}>Cancel</Button>
				<Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
			</div>
		</form>
	</div>
{/if}

<ConfirmDialog
	open={!!userPendingDelete}
	title="Delete user?"
	description={userPendingDelete ? `"${userPendingDelete.name}" (${userPendingDelete.username}) will be removed permanently. Their past actions stay in the audit log under their name.` : ''}
	confirmText="Delete"
	onConfirm={confirmRemoveUser}
	onCancel={() => (userPendingDelete = null)}
/>
