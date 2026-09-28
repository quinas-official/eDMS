<script lang="ts">
	import { Users, Building2, Plus, Pencil, Trash2, Table, Grid } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { StatusBadge } from '$lib/components/ui/status-badge';
	import { ConfirmDialog } from '$lib/components/ui/confirm-dialog';
	import { departmentNames } from '$lib/departments/store';
	import { settings } from '$lib/settings/store';
	import { ROLES, type Role } from '$lib/settings/types';
	import RelativeTime from '$lib/components/site/RelativeTime.svelte';

	interface User {
		id: number;
		name: string;
		email: string;
		password: string;
		department: string;
		role: Role;
		status: 'Active' | 'Inactive';
		createdAt: string;
	}

	// Mock users
	let users: User[] = [
		{
			id: 1,
			name: 'Jane Santos',
			email: 'jane@company.com',
			password: 'test123',
			department: 'HR',
			role: 'editor',
			status: 'Active',
			createdAt: '2024-12-01'
		},
		{
			id: 2,
			name: 'Mark Reyes',
			email: 'mark@company.com',
			password: 'test123',
			department: 'IT',
			role: 'admin',
			status: 'Active',
			createdAt: '2024-12-05'
		},
		{
			id: 3,
			name: 'Paul Cruz',
			email: 'paul@company.com',
			password: 'test123',
			department: 'Finance',
			role: 'viewer',
			status: 'Inactive',
			createdAt: '2024-12-10'
		}
	];

	let search = '';
	let filterDept = 'All';
	let filterStatus = 'All';
	let viewMode: 'table' | 'cards' = 'table';

	// Modal state
	let showCreate = false;
	let showEdit: User | null = null;

	// Form fields
	let formName = '';
	let formEmail = '';
	let formPassword = '';
	let formDept = '';
	let formRole: Role = 'viewer';
	let formStatus: 'Active' | 'Inactive' = 'Active';

	function openCreate() {
		formName = '';
		formEmail = '';
		formPassword = '';
		// New users land in the organization's default department from Settings.
		formDept = $settings.general.defaultDepartment;
		formRole = 'viewer';
		formStatus = 'Active';
		showCreate = true;
	}

	function createUser() {
		users = [
			...users,
			{
				id: Date.now(),
				name: formName,
				email: formEmail,
				department: formDept,
				role: formRole,
				password: formPassword,
				status: formStatus,
				createdAt: new Date().toISOString().split('T')[0]
			}
		];
		showCreate = false;
	}

	function openEdit(user: User) {
		showEdit = user;
		formName = user.name;
		formEmail = user.email;
		formPassword = user.password;
		formDept = user.department;
		formRole = user.role;
		formStatus = user.status;
	}

	function saveEdit() {
		if (!showEdit) return;
		users = users.map((u) =>
			u.id === showEdit!.id
				? {
						...u,
						name: formName,
						email: formEmail,
						password: formPassword,
						department: formDept,
						role: formRole,
						status: formStatus
					}
				: u
		);
		showEdit = null;
	}

	let userPendingDelete: User | null = null;

	function requestRemoveUser(user: User) {
		userPendingDelete = user;
	}

	function removeUser(id: number) {
		users = users.filter((u) => u.id !== id);
	}

	function confirmRemoveUser() {
		if (userPendingDelete) {
			removeUser(userPendingDelete.id);
		}
		userPendingDelete = null;
	}

	$: filteredUsers = users.filter(
		(u) =>
			(u.name.toLowerCase().includes(search.toLowerCase()) ||
				u.email.toLowerCase().includes(search.toLowerCase())) &&
			(filterDept === 'All' || u.department === filterDept) &&
			(filterStatus === 'All' || u.status === filterStatus)
	);
</script>

<div class="space-y-6">
<!-- Search + Filters + View -->
<div class="mb-4 flex flex-wrap items-center justify-between gap-4">
	<input
		type="text"
		placeholder="Search users..."
		bind:value={search}
		class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2 md:w-64"
	/>

	<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
		<div class="flex items-center gap-2">
			<label for="user-filter-department" class="text-muted-foreground shrink-0 text-xs font-medium">Department</label>
			<select id="user-filter-department" bind:value={filterDept} class="border-border/60 rounded-lg border bg-transparent px-2 py-2 text-sm shadow-xs">
				<option>All</option>
				{#each $departmentNames as name (name)}
					<option>{name}</option>
				{/each}
			</select>
		</div>

		<div class="flex items-center gap-2">
			<label for="user-filter-status" class="text-muted-foreground shrink-0 text-xs font-medium">Status</label>
			<select id="user-filter-status" bind:value={filterStatus} class="border-border/60 rounded-lg border bg-transparent px-2 py-2 text-sm shadow-xs">
				<option>All</option>
				<option>Active</option>
				<option>Inactive</option>
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

<!-- Empty State -->
{#if filteredUsers.length === 0}
	<div class="bg-card text-muted-foreground border-border/60 flex h-80 flex-col items-center justify-center gap-2 rounded-xl border text-center text-sm shadow-sm">
		No users found.
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
					<th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">Created</th>
					<th class="text-muted-foreground px-4 py-3 text-right text-xs font-medium tracking-wide uppercase">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredUsers as user}
					<tr class="hover:bg-muted/50 border-border/60 border-b transition-colors">
						<td class="px-4 py-3.5 font-medium">{user.name}</td>
						<td class="text-muted-foreground px-4 py-3.5 text-center text-sm">{user.email}</td>
						<td class="px-4 py-3.5 text-center">{user.department}</td>
						<td class="px-4 py-3.5 text-center">
							<span class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium capitalize">
								{user.role}
							</span>
						</td>
						<td class="px-4 py-3.5 text-center"><StatusBadge status={user.status} /></td>
						<td class="px-4 py-3.5 text-center"><RelativeTime value={user.createdAt} /></td>
						<td class="flex justify-end gap-1 px-4 py-3.5">
							<button class="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors" on:click={() => openEdit(user)}>
								<Pencil class="h-4 w-4" />
							</button>
							<button class="text-destructive hover:bg-destructive/10 rounded-md p-1.5 transition-colors" on:click={() => requestRemoveUser(user)}>
								<Trash2 class="h-4 w-4" />
							</button>
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
		{#each filteredUsers as user}
			<div class="bg-card border-border/60 rounded-xl border p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
				<div class="flex items-center justify-between">
					<h3 class="font-semibold tracking-tight">{user.name}</h3>
					<div class="flex gap-1">
						<button class="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors" on:click={() => openEdit(user)}>
							<Pencil class="h-4 w-4" />
						</button>
						<button class="text-destructive hover:bg-destructive/10 rounded-md p-1.5 transition-colors" on:click={() => requestRemoveUser(user)}>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				</div>

				<p class="text-muted-foreground mt-0.5 text-sm">{user.email}</p>
				<p class="text-muted-foreground mt-3 flex items-center gap-1.5 text-sm">
					<Building2 class="h-3.5 w-3.5" />
					{user.department}
				</p>
				<p class="mt-3 flex items-center gap-2 text-sm">
					<StatusBadge status={user.status} />
					<span class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium capitalize">
						{user.role}
					</span>
				</p>
			</div>
		{/each}
	</div>
{/if}
</div>

<!-- CREATE / EDIT MODAL -->
{#if showCreate || showEdit}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<div class="bg-card border-border/60 w-full max-w-md rounded-2xl border p-6 shadow-2xl">
			<h2 class="mb-5 text-lg font-semibold tracking-tight">{showEdit ? 'Edit User' : 'Create User'}</h2>

			<div class="space-y-3">
				<input
					placeholder="Name"
					bind:value={formName}
					type="string"
					class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
				/>
				<input
					placeholder="Email"
					bind:value={formEmail}
					type="email"
					class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
				/>
				<select bind:value={formDept} class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2">
					<option value="" disabled>Select department</option>
					{#each $departmentNames as name (name)}
						<option>{name}</option>
					{/each}
				</select>

				<select bind:value={formRole} class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2">
					{#each ROLES as role (role)}
						<option value={role}>
							{role.charAt(0).toUpperCase() + role.slice(1)} — {$settings.roles[role].join(', ') || 'no permissions'}
						</option>
					{/each}
				</select>

				<input
					placeholder="Password"
					bind:value={formPassword}
					type="password"
					class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
				/>
				<select bind:value={formStatus} class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2">
					<option>Active</option>
					<option>Inactive</option>
				</select>
			</div>

			<div class="mt-4 flex justify-end gap-2">
				<Button variant="outline" onclick={() => ((showCreate = false), (showEdit = null))}>
					Cancel
				</Button>
				<Button onclick={showEdit ? saveEdit : createUser}>Save</Button>
			</div>
		</div>
	</div>
{/if}

<ConfirmDialog
	open={!!userPendingDelete}
	title="Delete user?"
	description={userPendingDelete ? `This will permanently remove "${userPendingDelete.name}" from the system.` : ''}
	confirmText="Delete"
	onConfirm={confirmRemoveUser}
	onCancel={() => (userPendingDelete = null)}
/>
