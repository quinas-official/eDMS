<script lang="ts">
  import { FileText, Users, UserCheck, Pencil, Trash2, Table, Grid, Plus } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { StatusBadge } from '$lib/components/ui/status-badge';
  import { departmentNames } from '$lib/departments/store';
  import { settings } from '$lib/settings/store';
  import { crossfade, fade } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { cubicOut, quintOut } from 'svelte/easing';

  // Cards leaving one column "fly" into their new column: send/receive match on
  // the card's uid, so the browser animates the real position delta.
  const [send, receive] = crossfade({
    duration: 320,
    easing: cubicOut,
    fallback(node) {
      const style = getComputedStyle(node);
      const transform = style.transform === 'none' ? '' : style.transform;
      return {
        duration: 200,
        easing: cubicOut,
        css: (t) => `transform: ${transform} scale(${0.96 + 0.04 * t}); opacity: ${t}`
      };
    }
  });

  interface User {
    id: number;
    name: string;
    department: string;
  }

  interface WorkflowItem {
    uid: number;
    id: string;
    title: string;
    department: string;
    status: 'Draft' | 'Pending' | 'Reviewed' | 'Approved';
    assignedTo?: User;
    createdAt: string;
  }

  const users: User[] = [
    { id: 1, name: 'Jane Santos', department: 'HR' },
    { id: 2, name: 'Mark Reyes', department: 'HR' },
    { id: 3, name: 'Paul Cruz', department: 'IT' },
    { id: 4, name: 'Anna Lim', department: 'Finance' }
  ];

  // `id` is not unique in the seed data, so every card carries its own `uid`.
  // Keyed `{#each}` blocks, the drag/drop animation and the assign modal all
  // key off `uid`; without it, moving one card moved its twin as well.
  const seedItems: Omit<WorkflowItem, 'uid'>[] = [
    { id: 'HR-091', title: 'Employee Handbook', department: 'HR', status: 'Draft', createdAt: '2024-12-20' },
    { id: 'HR-091', title: 'Employee Handbook', department: 'HR', status: 'Draft', createdAt: '2024-12-20' },
    { id: 'FIN-014', title: 'Budget Proposal Q1', department: 'Finance', status: 'Pending', createdAt: '2024-12-21' },
    { id: 'IT-332', title: 'Server Upgrade', department: 'IT', status: 'Reviewed', createdAt: '2024-12-18' }
  ];

  let uidSeq = 0;
  let workflowItems: WorkflowItem[] = seedItems.map((item) => ({ ...item, uid: ++uidSeq }));

  const stages: WorkflowItem['status'][] = ['Draft', 'Pending', 'Reviewed', 'Approved'];

  // Filters
  let filterDept: string = 'All';
  let filterStatus: string = 'All';
  let viewMode: 'table' | 'cards' = 'table';

  // Drag-and-drop
  let draggedItem: WorkflowItem | null = null;
  let draggingUid: number | null = null;
  let dragOverStage: WorkflowItem['status'] | null = null;

  function handleDragStart(event: DragEvent, item: WorkflowItem) {
    draggedItem = item;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // Firefox refuses to start a drag without payload.
      event.dataTransfer.setData('text/plain', String(item.uid));
    }
    // Defer the "lifted" styling by a frame so the browser's drag ghost is a
    // snapshot of the untouched card, not the dimmed placeholder.
    requestAnimationFrame(() => (draggingUid = item.uid));
  }

  function handleDragEnd() {
    draggedItem = null;
    draggingUid = null;
    dragOverStage = null;
  }

  function handleDragOver(event: DragEvent, stage: WorkflowItem['status']) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragOverStage = stage;
  }

  function handleDragLeave(event: DragEvent, stage: WorkflowItem['status']) {
    // dragleave also fires when crossing into a child element - ignore those.
    const next = event.relatedTarget as Node | null;
    if (next && (event.currentTarget as HTMLElement).contains(next)) return;
    if (dragOverStage === stage) dragOverStage = null;
  }

  function handleDrop(stage: WorkflowItem['status']) {
    const item = draggedItem;
    handleDragEnd();
    if (!item || item.status === stage) return;
    workflowItems = workflowItems.map(i =>
      i.uid === item.uid ? { ...i, status: stage } : i
    );
  }

  // Assign modal
  let assignModal: WorkflowItem | null = null;
  let selectedUser: number | null = null;

  function openAssign(item: WorkflowItem) {
    assignModal = item;
    selectedUser = item.assignedTo?.id ?? null;
  }

  function saveAssign() {
    if (assignModal && selectedUser != null) {
      const user = users.find(u => u.id === selectedUser);
      workflowItems = workflowItems.map(i =>
        i.uid === assignModal!.uid ? { ...i, assignedTo: user } : i
      );
    }
    assignModal = null;
    selectedUser = null;
  }

  // Filtered items
  $: filteredItems = workflowItems.filter(item => 
    (filterDept === 'All' || item.department === filterDept) &&
    (filterStatus === 'All' || item.status === filterStatus)
  );

  // Add workflow modal
let addModal = false;

let newWorkflow: {
  title: string;
  department: string;
  status: WorkflowItem['status'];
} = {
  title: '',
  department: 'HR',
  status: 'Draft'
};

function openAddWorkflow() {
  // Settings decide where a new item starts: with approval required it must
  // begin as a Draft, otherwise an admin may create it already Approved.
  newWorkflow = {
    title: '',
    department: $settings.general.defaultDepartment,
    status: $settings.documents.requireApproval ? 'Draft' : 'Approved'
  };
  addModal = true;
}

function saveWorkflow() {
  if (!newWorkflow.title.trim()) return;

  const newItem: WorkflowItem = {
    uid: ++uidSeq,
    id: `${newWorkflow.department}-${Math.floor(Math.random() * 1000)}`,
    title: newWorkflow.title,
    department: newWorkflow.department,
    status: newWorkflow.status,
    createdAt: new Date().toISOString().split('T')[0]
  };

  workflowItems = [newItem, ...workflowItems];

  addModal = false;
}

</script>

<div class="space-y-6">
  <!-- Filters + View Toggle -->
  <div class="flex flex-wrap gap-4 items-center justify-between">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div class="flex items-center gap-2">
        <label for="workflow-filter-department" class="text-muted-foreground shrink-0 text-xs font-medium">Department</label>
        <select id="workflow-filter-department" bind:value={filterDept} class="border-border/60 rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs">
          <option>All</option>
          {#each $departmentNames as name (name)}
            <option>{name}</option>
          {/each}
        </select>
      </div>

      <div class="flex items-center gap-2">
        <label for="workflow-filter-status" class="text-muted-foreground shrink-0 text-xs font-medium">Status</label>
        <select id="workflow-filter-status" bind:value={filterStatus} class="border-border/60 rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs">
          <option>All</option>
          <option>Draft</option>
          <option>Pending</option>
          <option>Reviewed</option>
          <option>Approved</option>
        </select>
      </div>
    </div>

    <Button onclick={openAddWorkflow}>
      <Plus class="h-4 w-4" />
      Add Workflow
    </Button>

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
        <Grid class="h-4 w-4" /> Pipeline
      </Button>
    </div>
  </div>

  <!-- Empty state -->
  {#if filteredItems.length === 0}
    <div class="bg-card text-muted-foreground border-border/60 flex h-80 flex-col items-center justify-center gap-2 rounded-xl border text-center text-sm shadow-sm">
      No workflow items found.
    </div>
  {/if}

  <!-- Table view -->
  {#if viewMode === 'table' && filteredItems.length}
   <div class="bg-card border-border/60 overflow-x-auto rounded-xl border shadow-sm">
  <table class="w-full text-sm table-auto">
    <thead class="border-border/60 border-b">
      <tr>
        <th class="text-muted-foreground px-4 py-3 text-left text-xs font-medium tracking-wide uppercase">
        Title
        </th>
        <th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">
          Department
        </th>
        <th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">
          Status
        </th>
        <th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">
          Assigned
        </th>
        <th class="text-muted-foreground px-4 py-3 text-right text-xs font-medium tracking-wide uppercase">Actions</th>
      </tr>
    </thead>
    <tbody>
      {#each filteredItems as item (item.uid)}
        <tr class="hover:bg-muted/50 border-border/60 border-b transition-colors">
          <td class="px-4 py-3.5 font-medium">{item.title}</td>
          <td class="text-muted-foreground px-4 py-3.5 text-center">{item.department}</td>
          <td class="px-4 py-3.5 text-center"><StatusBadge status={item.status} /></td>
          <td class="text-muted-foreground px-4 py-3.5 text-center">{item.assignedTo?.name ?? '-'}</td>
          <td class="px-4 py-3.5 flex justify-end gap-2">
            <Button size="sm" onclick={() => openAssign(item)}>
              <UserCheck class="h-4 w-4" /> Assign
            </Button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

  {/if}

  <!-- Card / Pipeline view -->
 {#if viewMode === 'cards' && filteredItems.length}
  <div class="flex gap-4 overflow-x-auto pb-4">
    {#each stages as stage (stage)}
      {@const stageItems = filteredItems.filter((i) => i.status === stage)}
      {@const isTarget = dragOverStage === stage && draggedItem !== null && draggedItem.status !== stage}
      <ul
        class={`min-w-[17rem] flex-1 rounded-xl border p-4 transition-colors duration-200 ${
          isTarget
            ? 'bg-primary/5 border-primary/50 ring-primary/30 ring-2'
            : 'bg-muted/40 border-border/60'
        }`}
        on:dragover={(e) => handleDragOver(e, stage)}
        on:dragleave={(e) => handleDragLeave(e, stage)}
        on:drop={() => handleDrop(stage)}
      >
        <h3 class="mb-4 flex items-center justify-center gap-2 text-center text-sm font-semibold tracking-tight">
          {stage}
          <span class="bg-muted-foreground/15 text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
            {stageItems.length}
          </span>
        </h3>

        <div class="flex min-h-[200px] flex-col gap-3">
          {#each stageItems as item (item.uid)}
            <li
              class={`bg-card border-border/60 flex cursor-grab list-none flex-col gap-2 rounded-lg border p-3 shadow-sm transition-[box-shadow,opacity] duration-200 hover:shadow-md active:cursor-grabbing ${
                draggingUid === item.uid ? 'border-dashed opacity-40 shadow-none' : ''
              }`}
              draggable="true"
              on:dragstart={(e) => handleDragStart(e, item)}
              on:dragend={handleDragEnd}
              in:receive={{ key: item.uid }}
              out:send={{ key: item.uid }}
              animate:flip={{ duration: 320, easing: quintOut }}
            >
              <div class="flex items-center justify-between">
                <p class="font-medium">{item.title}</p>
                <span class="text-muted-foreground flex items-center gap-1 text-xs">
                  <Users class="h-3 w-3" /> {item.assignedTo?.name ?? 'Unassigned'}
                </span>
              </div>
              <p class="text-muted-foreground text-xs">{item.department}</p>
              <Button size="sm" class="mt-2" onclick={() => openAssign(item)}>
                <UserCheck class="h-4 w-4" /> Assign
              </Button>
            </li>
          {/each}

          <!-- Where the card will land -->
          {#if isTarget}
            <li
              class="border-primary/40 bg-primary/5 text-primary/70 flex h-16 list-none items-center justify-center rounded-lg border-2 border-dashed text-xs font-medium"
              transition:fade={{ duration: 150 }}
            >
              Drop to move to {stage}
            </li>
          {/if}
        </div>
      </ul>
    {/each}
  </div>
{/if}

</div>

{#if addModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div class="bg-card border-border/60 w-full max-w-md rounded-2xl border p-6 shadow-2xl">
      <h2 class="mb-4 text-lg font-semibold">Add Workflow</h2>

      <div class="space-y-4">
        <div>
          <label class="mb-1.5 block text-sm font-medium" for="workflow-title">Title</label>
          <input
            id="workflow-title"
            type="text"
            bind:value={newWorkflow.title}
            class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
            placeholder="Document title"
          />
        </div>

        <div>
          <label class="mb-1.5 block text-sm font-medium" for="workflow-department">Department</label>
          <select
            id="workflow-department"
            bind:value={newWorkflow.department}
            class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2"
          >
            {#each $departmentNames as name (name)}
              <option>{name}</option>
            {/each}
          </select>
        </div>

        <div>
          <label class="mb-1.5 block text-sm font-medium" for="workflow-status">Initial Status</label>
          <select
            id="workflow-status"
            bind:value={newWorkflow.status}
            disabled={$settings.documents.requireApproval}
            class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2 disabled:opacity-60"
          >
            {#each stages as stage}
              <option value={stage}>{stage}</option>
            {/each}
          </select>
          {#if $settings.documents.requireApproval}
            <p class="text-muted-foreground mt-1.5 text-xs">
              Locked to Draft because “Require approval before publish” is on in Settings.
            </p>
          {/if}
        </div>
      </div>

      <div class="mt-6 flex justify-end gap-2">
        <Button variant="outline" onclick={() => (addModal = false)}>Cancel</Button>
        <Button onclick={saveWorkflow}>Create</Button>
      </div>
    </div>
  </div>
{/if}


<!-- Assign Modal -->
{#if assignModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div class="bg-card border-border/60 w-full max-w-md rounded-2xl border p-6 shadow-2xl">
      <h2 class="mb-4 text-lg font-semibold">Assign Document</h2>
      <div class="space-y-3">
        <select bind:value={selectedUser} class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2">
          <option value={null}>Select user</option>
          {#each users.filter(u => u.department === assignModal!.department) as user}
            <option value={user.id}>{user.name}</option>
          {/each}
        </select>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="outline" onclick={() => (assignModal = null, selectedUser = null)}>Cancel</Button>
        <Button onclick={saveAssign}>Save</Button>
      </div>
    </div>
  </div>
{/if}

