<script lang="ts">
	import { Building2, Users, Plus, Pencil, Trash2, Table, Grid } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { ConfirmDialog } from '$lib/components/ui/confirm-dialog';
	import {
		departments,
		addDepartment,
		updateDepartment,
		removeDepartment
	} from '$lib/departments/store';
	import type { Department } from '$lib/departments/types';
	import RelativeTime from '$lib/components/site/RelativeTime.svelte';

	let search = '';
	let viewMode: 'table' | 'cards' = 'table';

	// Modal state
	let showCreate = false;
	let showEdit: Department | null = null;

	// New / edit form
	let formName = '';
	let formDescription = '';

	function openCreate() {
		formName = '';
		formDescription = '';
		showCreate = true;
	}

	function createDepartment() {
		if (!formName.trim()) return;
		addDepartment(formName.trim(), formDescription);
		showCreate = false;
	}

	function openEdit(dep: Department) {
		showEdit = dep;
		formName = dep.name;
		formDescription = dep.description;
	}

	function saveEdit() {
		if (!showEdit) return;
		updateDepartment(showEdit.id, { name: formName, description: formDescription });
		showEdit = null;
	}

	let departmentPendingDelete: Department | null = null;

	function requestRemoveDepartment(dep: Department) {
		departmentPendingDelete = dep;
	}

	function confirmRemoveDepartment() {
		if (departmentPendingDelete) {
			removeDepartment(departmentPendingDelete.id);
		}
		departmentPendingDelete = null;
	}

	$: filteredDepartments = $departments.filter((d) =>
		d.name.toLowerCase().includes(search.toLowerCase())
	);
</script>


<div class="space-y-6"> 
<!-- Search + View -->
<div class="mb-4 flex flex-wrap items-center justify-between gap-4">
	<input
		type="text"
		placeholder="Search department..."
		bind:value={search}
		class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2 md:w-64"
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

<!-- Empty State -->
{#if filteredDepartments.length === 0}
	<div class="bg-card text-muted-foreground border-border/60 flex h-80 flex-col items-center justify-center gap-2 rounded-xl border text-center text-sm shadow-sm">
		No departments found.
	</div>
{/if}

<!-- TABLE VIEW -->
<!-- TABLE VIEW -->
{#if viewMode === 'table' && filteredDepartments.length}
  <div class="bg-card border-border/60 overflow-x-auto rounded-xl border shadow-sm">
    <table class="w-full text-sm">
      <thead class="border-border/60 border-b">
        <tr>
          <th class="text-muted-foreground px-4 py-3 text-left text-xs font-medium tracking-wide uppercase">Name</th>
          <th class="text-muted-foreground px-4 py-3 text-xs font-medium tracking-wide uppercase">Info</th>
          <th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">Members</th>
          <th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">Created</th>
          <th class="text-muted-foreground px-4 py-3 text-right text-xs font-medium tracking-wide uppercase">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredDepartments as dep}
          <tr class="hover:bg-muted/50 border-border/60 border-b transition-colors">
            <td class="px-4 py-3.5 font-medium">{dep.name}</td>
            <td class="text-muted-foreground px-4 py-3.5 text-center text-sm">{dep.description}</td>
            <td class="px-4 py-3.5 text-center">{dep.members.length}</td>
            <td class="px-4 py-3.5 text-center"><RelativeTime value={dep.createdAt} /></td>
            <td class="flex justify-end gap-1 px-4 py-3.5">
              <button class="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors" on:click={() => openEdit(dep)}>
                <Pencil class="h-4 w-4" />
              </button>
              <button class="text-destructive hover:bg-destructive/10 rounded-md p-1.5 transition-colors" on:click={() => requestRemoveDepartment(dep)}>
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
<!-- CARD VIEW -->
{#if viewMode === 'cards'}
  <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
    {#each filteredDepartments as dep}
      <div class="bg-card border-border/60 rounded-xl border p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold tracking-tight">{dep.name}</h3>
          <div class="flex gap-1">
            <button class="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors" on:click={() => openEdit(dep)}>
              <Pencil class="h-4 w-4" />
            </button>
            <button class="text-destructive hover:bg-destructive/10 rounded-md p-1.5 transition-colors" on:click={() => requestRemoveDepartment(dep)}>
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- Info Section -->
        <p class="text-muted-foreground mt-0.5 text-sm">
          {dep.description}
        </p>

        <div class="text-muted-foreground mt-3 flex items-center gap-1.5 text-sm">
          <Users class="h-3.5 w-3.5" />
          {dep.members.length} members
        </div>
      </div>
    {/each}
  </div>
{/if}
</div>

<!-- CREATE / EDIT MODAL -->
{#if showCreate || showEdit}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<div class="bg-card border-border/60 w-full max-w-md rounded-2xl border p-6 shadow-2xl">
			<h2 class="mb-5 text-lg font-semibold tracking-tight">
				{showEdit ? 'Edit Department' : 'Create Department'}
			</h2>

			<div class="space-y-3">
				<input
					placeholder="Department name"
					bind:value={formName}
					class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
				/>

				<textarea
					placeholder="Description"
					bind:value={formDescription}
					class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
				></textarea>
			</div>

			<div class="mt-4 flex justify-end gap-2">
				<Button variant="outline" onclick={() => ((showCreate = false), (showEdit = null))}>
					Cancel
				</Button>
				<Button onclick={showEdit ? saveEdit : createDepartment}>Save</Button>
			</div>
		</div>
	</div>
{/if}

<ConfirmDialog
	open={!!departmentPendingDelete}
	title="Delete department?"
	description={departmentPendingDelete ? `This will permanently remove "${departmentPendingDelete.name}" and unassign its ${departmentPendingDelete.members.length} member(s).` : ''}
	confirmText="Delete"
	onConfirm={confirmRemoveDepartment}
	onCancel={() => (departmentPendingDelete = null)}
/>
