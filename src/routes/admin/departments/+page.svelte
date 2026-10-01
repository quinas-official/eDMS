<script lang="ts">
	import { onMount } from 'svelte';
	import { Users, FileText, Plus, Pencil, Trash2, Table, Grid, RefreshCw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { ConfirmDialog } from '$lib/components/ui/confirm-dialog';
	import {
		createDepartment,
		deleteDepartment,
		listDepartmentDetails,
		updateDepartment,
		type DepartmentDetailDTO
	} from '$lib/api/departments';
	import { ApiError } from '$lib/api/client';
	import { loadDepartments } from '$lib/departments/store';
	import { toast } from '$lib/toast/store';
	import RelativeTime from '$lib/components/site/RelativeTime.svelte';

	function errorMessage(err: unknown) {
		return err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong';
	}

	// ---- Server state ---------------------------------------------------------

	let departments: DepartmentDetailDTO[] = [];
	let loading = true;
	let listError = '';

	async function refresh() {
		loading = true;
		listError = '';
		try {
			departments = await listDepartmentDetails();
		} catch (err) {
			listError = errorMessage(err);
		} finally {
			loading = false;
		}
	}

	/** After a change: this page's list, plus the shared one the other pages' dropdowns use. */
	async function afterChange() {
		await Promise.all([refresh(), loadDepartments().catch(() => {})]);
	}

	onMount(refresh);

	let search = '';
	let viewMode: 'table' | 'cards' = 'table';

	$: filteredDepartments = departments.filter((d) =>
		d.name.toLowerCase().includes(search.toLowerCase())
	);

	// ---- Create / edit --------------------------------------------------------

	let showCreate = false;
	let showEdit: DepartmentDetailDTO | null = null;
	let formName = '';
	let formDescription = '';
	let formError = '';
	let saving = false;

	function openCreate() {
		formName = '';
		formDescription = '';
		formError = '';
		showCreate = true;
	}

	function openEdit(dep: DepartmentDetailDTO) {
		showEdit = dep;
		formName = dep.name;
		formDescription = dep.description;
		formError = '';
	}

	function closeForm() {
		showCreate = false;
		showEdit = null;
	}

	async function submitForm() {
		if (!formName.trim()) {
			formError = 'Name is required';
			return;
		}
		saving = true;
		formError = '';
		try {
			const input = { name: formName.trim(), description: formDescription.trim() };
			if (showEdit) {
				await updateDepartment(showEdit.id, input);
				toast.success('Department updated');
			} else {
				await createDepartment(input);
				toast.success('Department created', { description: input.name });
			}
			closeForm();
			await afterChange();
		} catch (err) {
			// Shown in the dialog, e.g. a duplicate name, so the admin can fix it there.
			formError = errorMessage(err);
		} finally {
			saving = false;
		}
	}

	// ---- Delete ---------------------------------------------------------------

	let departmentPendingDelete: DepartmentDetailDTO | null = null;

	/** Why the server would refuse, so the admin learns it before confirming. */
	function deleteBlocker(dep: DepartmentDetailDTO): string | null {
		if (dep.isDefault) return 'It is the default department in Settings. Choose another one first.';
		const parts = [
			dep.members.length && `${dep.members.length} user${dep.members.length === 1 ? '' : 's'}`,
			dep.documentCount && `${dep.documentCount} document${dep.documentCount === 1 ? '' : 's'}`
		].filter(Boolean);
		return parts.length ? `Move its ${parts.join(' and ')} to another department first.` : null;
	}

	function requestRemoveDepartment(dep: DepartmentDetailDTO) {
		const blocker = deleteBlocker(dep);
		if (blocker) {
			toast.error(`Can't delete ${dep.name}`, { description: blocker });
			return;
		}
		departmentPendingDelete = dep;
	}

	async function confirmRemoveDepartment() {
		const dep = departmentPendingDelete;
		departmentPendingDelete = null;
		if (!dep) return;
		try {
			await deleteDepartment(dep.id);
			toast.success('Department deleted', { description: dep.name });
		} catch (err) {
			// E.g. deleted documents still filed there, which the counts above leave out.
			toast.error(`Can't delete ${dep.name}`, { description: errorMessage(err) });
		}
		await afterChange();
	}

	const inputClass =
		'border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2';
</script>

<div class="space-y-6">
<!-- Search + View -->
<div class="mb-4 flex flex-wrap items-center justify-between gap-4">
	<input
		type="text"
		placeholder="Search department..."
		bind:value={search}
		class={`${inputClass} md:w-64`}
	/>

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

	<Button onclick={openCreate}>
		<Plus class="h-4 w-4" />
		New Department
	</Button>
</div>

{#if listError}
	<div class="border-destructive/30 bg-destructive/5 text-destructive flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
		<span>Couldn't load departments: {listError}</span>
		<Button variant="outline" size="sm" onclick={refresh}>
			<RefreshCw class="h-4 w-4" /> Retry
		</Button>
	</div>
{/if}

<!-- Empty / loading state -->
{#if filteredDepartments.length === 0 && !listError}
	<div class="bg-card text-muted-foreground border-border/60 flex h-80 flex-col items-center justify-center gap-2 rounded-xl border text-center text-sm shadow-sm">
		{#if loading}
			Loading…
		{:else if search}
			No departments match "{search}".
		{:else}
			No departments yet.
		{/if}
	</div>
{/if}

<!-- TABLE VIEW -->
{#if viewMode === 'table' && filteredDepartments.length}
  <div class="bg-card border-border/60 overflow-x-auto rounded-xl border shadow-sm">
    <table class="w-full text-sm">
      <thead class="border-border/60 border-b">
        <tr>
          <th class="text-muted-foreground px-4 py-3 text-left text-xs font-medium tracking-wide uppercase">Name</th>
          <th class="text-muted-foreground px-4 py-3 text-xs font-medium tracking-wide uppercase">Info</th>
          <th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">Members</th>
          <th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">Documents</th>
          <th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">Created</th>
          <th class="text-muted-foreground px-4 py-3 text-right text-xs font-medium tracking-wide uppercase">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredDepartments as dep (dep.id)}
          <tr class="hover:bg-muted/50 border-border/60 border-b transition-colors">
            <td class="px-4 py-3.5 font-medium">
              {dep.name}
              {#if dep.isDefault}
                <span class="bg-muted text-muted-foreground ml-1.5 rounded-full px-2 py-0.5 text-xs font-normal">Default</span>
              {/if}
            </td>
            <td class="text-muted-foreground px-4 py-3.5 text-center text-sm">{dep.description || '—'}</td>
            <td class="px-4 py-3.5 text-center" title={dep.members.map((m) => m.name).join(', ')}>{dep.members.length}</td>
            <td class="px-4 py-3.5 text-center">
              <a class="hover:underline" href={`/admin/documents?departmentId=${dep.id}`}>{dep.documentCount}</a>
            </td>
            <td class="px-4 py-3.5 text-center"><RelativeTime value={dep.createdAt} /></td>
            <td class="flex justify-end gap-1 px-4 py-3.5">
              <button aria-label={`Edit ${dep.name}`} class="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors" on:click={() => openEdit(dep)}>
                <Pencil class="h-4 w-4" />
              </button>
              <button aria-label={`Delete ${dep.name}`} class="text-destructive hover:bg-destructive/10 rounded-md p-1.5 transition-colors" on:click={() => requestRemoveDepartment(dep)}>
                <Trash2 class="h-4 w-4" />
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<!-- CARD VIEW -->
{#if viewMode === 'cards'}
  <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
    {#each filteredDepartments as dep (dep.id)}
      <div class="bg-card border-border/60 rounded-xl border p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold tracking-tight">
            {dep.name}
            {#if dep.isDefault}
              <span class="bg-muted text-muted-foreground ml-1 rounded-full px-2 py-0.5 text-xs font-normal">Default</span>
            {/if}
          </h3>
          <div class="flex gap-1">
            <button aria-label={`Edit ${dep.name}`} class="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors" on:click={() => openEdit(dep)}>
              <Pencil class="h-4 w-4" />
            </button>
            <button aria-label={`Delete ${dep.name}`} class="text-destructive hover:bg-destructive/10 rounded-md p-1.5 transition-colors" on:click={() => requestRemoveDepartment(dep)}>
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- Info Section -->
        <p class="text-muted-foreground mt-0.5 text-sm">
          {dep.description}
        </p>

        <div class="text-muted-foreground mt-3 flex items-center gap-4 text-sm">
          <span class="flex items-center gap-1.5" title={dep.members.map((m) => m.name).join(', ')}>
            <Users class="h-3.5 w-3.5" />
            {dep.members.length} member{dep.members.length === 1 ? '' : 's'}
          </span>
          <a class="flex items-center gap-1.5 hover:underline" href={`/admin/documents?departmentId=${dep.id}`}>
            <FileText class="h-3.5 w-3.5" />
            {dep.documentCount} document{dep.documentCount === 1 ? '' : 's'}
          </a>
        </div>
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
			<h2 class="mb-5 text-lg font-semibold tracking-tight">
				{showEdit ? 'Edit Department' : 'Create Department'}
			</h2>

			<div class="space-y-3">
				<input
					placeholder="Department name"
					aria-label="Department name"
					maxlength="100"
					bind:value={formName}
					class={inputClass}
				/>

				<textarea
					placeholder="Description"
					aria-label="Description"
					maxlength="500"
					bind:value={formDescription}
					class={inputClass}
				></textarea>

				{#if showEdit && formName.trim() !== showEdit.name}
					<p class="text-muted-foreground text-xs">
						Existing document references keep their current prefix; new ones use the new name.
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
	open={!!departmentPendingDelete}
	title="Delete department?"
	description={departmentPendingDelete ? `"${departmentPendingDelete.name}" will be removed permanently. The deletion is recorded in the audit log.` : ''}
	confirmText="Delete"
	onConfirm={confirmRemoveDepartment}
	onCancel={() => (departmentPendingDelete = null)}
/>
