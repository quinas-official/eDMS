<script lang="ts">
  import { onMount } from 'svelte';
  import { Users, UserCheck, Table, Grid, Upload, RefreshCw, ExternalLink, Lock } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { StatusBadge } from '$lib/components/ui/status-badge';
  import { departments, loadDepartments } from '$lib/departments/store';
  import { settings } from '$lib/settings/store';
  import { currentUser } from '$lib/auth/store';
  import { can } from '$lib/permissions';
  import { ApiError } from '$lib/api/client';
  import { listDocuments, updateDocument } from '$lib/api/documents';
  import { listAssignableUsers, type AssignableUserDTO } from '$lib/api/users';
  import type { DocumentDTO, DocumentStatus } from '$lib/documents/api-types';
  import { toast } from '$lib/toast/store';
  import RelativeTime from '$lib/components/site/RelativeTime.svelte';
  import { crossfade, fade } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { cubicOut, quintOut } from 'svelte/easing';

  // Cards leaving one column "fly" into their new column: send/receive match on
  // the document id, so the browser animates the real position delta.
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

  function errorMessage(err: unknown) {
    return err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong';
  }

  const stages: DocumentStatus[] = ['draft', 'pending', 'reviewed', 'approved', 'rejected'];
  /** Workflow decisions; with "Require approval" on, only approvers may make them. */
  const DECISIONS: DocumentStatus[] = ['reviewed', 'approved', 'rejected'];
  const label = (status: string) => status.charAt(0).toUpperCase() + status.slice(1);

  // ---- Permissions, mirroring the server (which has the final say) ----------

  $: canUpload = can($currentUser, 'upload');
  $: canApprove = can($currentUser, 'approve');
  $: canWork = canUpload || canApprove;

  /** Approved documents are frozen for everyone but approvers. */
  $: isLocked = (doc: DocumentDTO) => doc.status === 'approved' && !canApprove;

  $: canMoveTo = (doc: DocumentDTO, stage: DocumentStatus) =>
    canWork &&
    doc.status !== stage &&
    !isLocked(doc) &&
    !(DECISIONS.includes(stage) && $settings.documents.requireApproval && !canApprove);

  // ---- Server state ---------------------------------------------------------

  /** The board shows every live document; past this, use the Documents page's search. */
  const MAX_ITEMS = 1000;
  const PAGE_SIZE = 100;

  let docs: DocumentDTO[] = [];
  let total = 0;
  let loading = true;
  let listError = '';

  async function refresh() {
    loading = true;
    listError = '';
    try {
      const all: DocumentDTO[] = [];
      for (let page = 1; ; page++) {
        const res = await listDocuments({ page, pageSize: PAGE_SIZE });
        all.push(...res.documents);
        total = res.total;
        if (all.length >= res.total || all.length >= MAX_ITEMS || !res.documents.length) break;
      }
      docs = all;
    } catch (err) {
      listError = errorMessage(err);
    } finally {
      loading = false;
    }
  }

  let assignable: AssignableUserDTO[] = [];

  onMount(() => {
    refresh();
    loadDepartments().catch(() => {});
    if (canWork) {
      listAssignableUsers()
        .then((list) => (assignable = list))
        .catch(() => {});
    }
  });

  function replaceDoc(next: DocumentDTO) {
    docs = docs.map((d) => (d.id === next.id ? next : d));
  }

  // ---- Filters --------------------------------------------------------------

  /** A department id, `none`, or empty for all. */
  let filterDept = '';
  let filterStatus: DocumentStatus | '' = '';
  let viewMode: 'table' | 'cards' = 'cards';

  $: filteredItems = docs.filter(
    (doc) =>
      (!filterDept ||
        (filterDept === 'none' ? !doc.department : String(doc.department?.id) === filterDept)) &&
      (!filterStatus || doc.status === filterStatus)
  );

  // ---- Status changes -------------------------------------------------------

  /** Ids with a request in flight, so a card can't be moved twice at once. */
  let busy = new Set<string>();

  async function moveTo(doc: DocumentDTO, stage: DocumentStatus) {
    if (!canMoveTo(doc, stage) || busy.has(doc.id)) return;
    const before = doc;
    busy = new Set(busy).add(doc.id);
    // Optimistic: the card moves at once and snaps back if the server refuses.
    replaceDoc({ ...doc, status: stage });
    try {
      replaceDoc(await updateDocument(doc.id, { status: stage }));
      toast.success(`${doc.reference} moved to ${label(stage)}`);
    } catch (err) {
      replaceDoc(before);
      toast.error(`Couldn't move ${doc.reference}`, { description: errorMessage(err) });
    } finally {
      busy.delete(doc.id);
      busy = new Set(busy);
    }
  }

  // ---- Drag-and-drop --------------------------------------------------------

  let draggedItem: DocumentDTO | null = null;
  let draggingId: string | null = null;
  let dragOverStage: DocumentStatus | null = null;

  function handleDragStart(event: DragEvent, item: DocumentDTO) {
    draggedItem = item;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // Firefox refuses to start a drag without payload.
      event.dataTransfer.setData('text/plain', item.id);
    }
    // Defer the "lifted" styling by a frame so the browser's drag ghost is a
    // snapshot of the untouched card, not the dimmed placeholder.
    requestAnimationFrame(() => (draggingId = item.id));
  }

  function handleDragEnd() {
    draggedItem = null;
    draggingId = null;
    dragOverStage = null;
  }

  function handleDragOver(event: DragEvent, stage: DocumentStatus) {
    // Only columns the card may move to accept the drop.
    if (!draggedItem || !canMoveTo(draggedItem, stage)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragOverStage = stage;
  }

  function handleDragLeave(event: DragEvent, stage: DocumentStatus) {
    // dragleave also fires when crossing into a child element - ignore those.
    const next = event.relatedTarget as Node | null;
    if (next && (event.currentTarget as HTMLElement).contains(next)) return;
    if (dragOverStage === stage) dragOverStage = null;
  }

  function handleDrop(stage: DocumentStatus) {
    const item = draggedItem;
    handleDragEnd();
    if (item) moveTo(item, stage);
  }

  // ---- Assign ---------------------------------------------------------------

  let assignModal: DocumentDTO | null = null;
  let selectedUser: string | null = null;
  let assigning = false;

  function openAssign(item: DocumentDTO) {
    assignModal = item;
    selectedUser = item.assignee?.id ?? null;
  }

  // People in the document's department first, then everyone else.
  $: assignOptions = assignModal
    ? [...assignable].sort(
        (a, b) =>
          Number(b.departmentId === assignModal!.department?.id) -
            Number(a.departmentId === assignModal!.department?.id) || a.name.localeCompare(b.name)
      )
    : [];

  async function saveAssign() {
    const doc = assignModal;
    if (!doc) return;
    if (selectedUser === (doc.assignee?.id ?? null)) {
      assignModal = null;
      return;
    }
    assigning = true;
    try {
      replaceDoc(await updateDocument(doc.id, { assigneeId: selectedUser }));
      const name = assignable.find((u) => u.id === selectedUser)?.name;
      toast.success(name ? `${doc.reference} assigned to ${name}` : `${doc.reference} unassigned`);
      assignModal = null;
    } catch (err) {
      toast.error(`Couldn't assign ${doc.reference}`, { description: errorMessage(err) });
    } finally {
      assigning = false;
    }
  }

  const docLink = (doc: DocumentDTO) => `/admin/documents?search=${encodeURIComponent(doc.reference)}`;
</script>

<div class="space-y-6">
  <!-- Filters + View Toggle -->
  <div class="flex flex-wrap gap-4 items-center justify-between">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div class="flex items-center gap-2">
        <label for="workflow-filter-department" class="text-muted-foreground shrink-0 text-xs font-medium">Department</label>
        <select id="workflow-filter-department" bind:value={filterDept} class="border-border/60 rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs">
          <option value="">All</option>
          {#each $departments as dep (dep.id)}
            <option value={String(dep.id)}>{dep.name}</option>
          {/each}
          <option value="none">No department</option>
        </select>
      </div>

      <div class="flex items-center gap-2">
        <label for="workflow-filter-status" class="text-muted-foreground shrink-0 text-xs font-medium">Status</label>
        <select id="workflow-filter-status" bind:value={filterStatus} class="border-border/60 rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs">
          <option value="">All</option>
          {#each stages as stage (stage)}
            <option value={stage}>{label(stage)}</option>
          {/each}
        </select>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={loading} onclick={refresh}>
        <RefreshCw class={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
      </Button>
      {#if canUpload}
        <!-- Every document needs a file, so new items start with an upload. -->
        <Button href="/admin/documents" size="sm">
          <Upload class="h-4 w-4" /> Upload document
        </Button>
      {/if}
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
        <Grid class="h-4 w-4" /> Pipeline
      </Button>
    </div>
  </div>

  {#if $settings.documents.requireApproval && !canApprove && canWork}
    <p class="border-border/60 bg-muted/40 text-muted-foreground rounded-lg border p-3 text-xs">
      "Require approval" is on: you can move documents between Draft and Pending. Reviewing,
      approving and rejecting are up to approvers.
    </p>
  {/if}

  {#if total > docs.length && !loading}
    <p class="text-muted-foreground text-xs">
      Showing the {docs.length} most recently updated of {total} documents. Use the Documents page to search the rest.
    </p>
  {/if}

  {#if listError}
    <div class="border-destructive/30 bg-destructive/5 text-destructive flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
      <span>Couldn't load documents: {listError}</span>
      <Button variant="outline" size="sm" onclick={refresh}>
        <RefreshCw class="h-4 w-4" /> Retry
      </Button>
    </div>
  {/if}

  <!-- Empty state -->
  {#if filteredItems.length === 0 && !listError}
    <div class="bg-card text-muted-foreground border-border/60 flex h-80 flex-col items-center justify-center gap-2 rounded-xl border text-center text-sm shadow-sm">
      {#if loading}
        Loading…
      {:else if docs.length}
        No documents match these filters.
      {:else}
        No documents yet. Upload one on the Documents page to start its workflow.
      {/if}
    </div>
  {/if}

  <!-- Table view -->
  {#if viewMode === 'table' && filteredItems.length}
    <div class="bg-card border-border/60 overflow-x-auto rounded-xl border shadow-sm">
      <table class="w-full text-sm table-auto">
        <thead class="border-border/60 border-b">
          <tr>
            <th class="text-muted-foreground px-4 py-3 text-left text-xs font-medium tracking-wide uppercase">Title</th>
            <th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">Department</th>
            <th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">Status</th>
            <th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">Assigned</th>
            <th class="text-muted-foreground px-4 py-3 text-center text-xs font-medium tracking-wide uppercase">Updated</th>
            <th class="text-muted-foreground px-4 py-3 text-right text-xs font-medium tracking-wide uppercase">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each filteredItems as item (item.id)}
            <tr class="hover:bg-muted/50 border-border/60 border-b transition-colors">
              <td class="px-4 py-3.5">
                <a class="font-medium hover:underline" href={docLink(item)}>{item.title}</a>
                <span class="text-muted-foreground block text-xs">{item.reference}</span>
              </td>
              <td class="text-muted-foreground px-4 py-3.5 text-center">{item.department?.name ?? '—'}</td>
              <td class="px-4 py-3.5 text-center">
                {#if canWork && !isLocked(item)}
                  <!-- Keyboard-friendly alternative to dragging on the pipeline. -->
                  <select
                    aria-label={`Status of ${item.reference}`}
                    value={item.status}
                    disabled={busy.has(item.id)}
                    on:change={(e) => {
                      const target = e.currentTarget;
                      const next = target.value as DocumentStatus;
                      target.value = item.status;
                      moveTo(item, next);
                    }}
                    class="border-border/60 rounded-lg border bg-transparent px-2 py-1 text-xs shadow-xs"
                  >
                    {#each stages as stage (stage)}
                      <option value={stage} disabled={stage !== item.status && !canMoveTo(item, stage)}>{label(stage)}</option>
                    {/each}
                  </select>
                {:else}
                  <StatusBadge status={label(item.status)} />
                {/if}
              </td>
              <td class="text-muted-foreground px-4 py-3.5 text-center">{item.assignee?.name ?? '—'}</td>
              <td class="text-muted-foreground px-4 py-3.5 text-center"><RelativeTime value={item.updatedAt} /></td>
              <td class="px-4 py-3.5">
                <div class="flex justify-end gap-2">
                  {#if canWork && !isLocked(item)}
                    <Button size="sm" onclick={() => openAssign(item)}>
                      <UserCheck class="h-4 w-4" /> Assign
                    </Button>
                  {/if}
                  <Button size="sm" variant="outline" href={docLink(item)}>
                    <ExternalLink class="h-4 w-4" /> Open
                  </Button>
                </div>
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
        {@const isTarget = dragOverStage === stage}
        {@const blocked = draggedItem !== null && draggedItem.status !== stage && !canMoveTo(draggedItem, stage)}
        <ul
          class={`min-w-52 flex-1 rounded-xl border p-4 transition-[colors,opacity] duration-200 ${
            isTarget
              ? 'bg-primary/5 border-primary/50 ring-primary/30 ring-2'
              : 'bg-muted/40 border-border/60'
          } ${blocked ? 'opacity-50' : ''}`}
          on:dragover={(e) => handleDragOver(e, stage)}
          on:dragleave={(e) => handleDragLeave(e, stage)}
          on:drop={() => handleDrop(stage)}
        >
          <h3 class="mb-4 flex items-center justify-center gap-2 text-center text-sm font-semibold tracking-tight">
            {label(stage)}
            {#if blocked}<Lock class="text-muted-foreground h-3.5 w-3.5" aria-label="You can't move documents here" />{/if}
            <span class="bg-muted-foreground/15 text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
              {stageItems.length}
            </span>
          </h3>

          <div class="flex min-h-50 flex-col gap-3">
            {#each stageItems as item (item.id)}
              {@const draggable = canWork && !isLocked(item) && !busy.has(item.id)}
              <li
                class={`bg-card border-border/60 flex list-none flex-col gap-2 rounded-lg border p-3 shadow-sm transition-[box-shadow,opacity] duration-200 hover:shadow-md ${
                  draggable ? 'cursor-grab active:cursor-grabbing' : ''
                } ${draggingId === item.id ? 'border-dashed opacity-40 shadow-none' : ''} ${busy.has(item.id) ? 'opacity-70' : ''}`}
                draggable={draggable}
                on:dragstart={(e) => handleDragStart(e, item)}
                on:dragend={handleDragEnd}
                in:receive={{ key: item.id }}
                out:send={{ key: item.id }}
                animate:flip={{ duration: 320, easing: quintOut }}
              >
                <div class="flex items-start justify-between gap-2">
                  <a class="font-medium hover:underline" href={docLink(item)} draggable="false">{item.title}</a>
                  <span class="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
                    <Users class="h-3 w-3" /> {item.assignee?.name ?? 'Unassigned'}
                  </span>
                </div>
                <p class="text-muted-foreground text-xs">
                  {item.reference} · {item.department?.name ?? 'No department'}
                  {#if isLocked(item)}<Lock class="ml-1 inline h-3 w-3" aria-label="Locked" />{/if}
                </p>
                {#if canWork && !isLocked(item)}
                  <Button size="sm" class="mt-2" onclick={() => openAssign(item)}>
                    <UserCheck class="h-4 w-4" /> Assign
                  </Button>
                {/if}
              </li>
            {/each}

            <!-- Where the card will land -->
            {#if isTarget}
              <li
                class="border-primary/40 bg-primary/5 text-primary/70 flex h-16 list-none items-center justify-center rounded-lg border-2 border-dashed text-xs font-medium"
                transition:fade={{ duration: 150 }}
              >
                Drop to move to {label(stage)}
              </li>
            {/if}
          </div>
        </ul>
      {/each}
    </div>
  {/if}
</div>

<!-- Assign Modal -->
{#if assignModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <form class="bg-card border-border/60 w-full max-w-md rounded-2xl border p-6 shadow-2xl" on:submit|preventDefault={saveAssign}>
      <h2 class="mb-1 text-lg font-semibold">Assign Document</h2>
      <p class="text-muted-foreground mb-4 text-sm">{assignModal.reference} · {assignModal.title}</p>
      <div class="space-y-3">
        <select aria-label="Assignee" bind:value={selectedUser} class="border-border/60 focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2">
          <option value={null}>Unassigned</option>
          {#each assignOptions as user (user.id)}
            <option value={user.id}>{user.name}{user.department ? ` — ${user.department}` : ''}</option>
          {/each}
        </select>
        <p class="text-muted-foreground text-xs">
          People in {assignModal.department?.name ?? 'the same department'} are listed first. The assignee can see the document even outside their department.
        </p>
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onclick={() => (assignModal = null)}>Cancel</Button>
        <Button type="submit" disabled={assigning}>{assigning ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  </div>
{/if}
