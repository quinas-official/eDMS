<script lang="ts">
  import { dev } from '$app/environment';
  import { goto } from '$app/navigation';
  import { listDocuments } from '$lib/api/documents';
  import type { DocumentDTO } from '$lib/documents/api-types';
  import { currentUser, signOut } from '$lib/auth/store';

  /**
   * Dev scratch page. Sign in through /login: sessions are real now, so this
   * page can't fake one. Documents come from the API; upload them on
   * /admin/documents.
   */
  let docs: DocumentDTO[] = [];
  let error = '';

  async function loadDocs() {
    try {
      docs = (await listDocuments({ pageSize: 10 })).documents;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  $: if (dev && $currentUser) loadDocs();
</script>

{#if dev}
  <div class="space-y-4 p-6 text-sm">
    <p class="text-muted-foreground">
      Dev scratch page. Signed in as: {$currentUser?.username ?? 'nobody'}
    </p>

    <div class="flex flex-wrap gap-2">
      <button class="border-border/60 rounded-lg border px-3 py-2" on:click={signOut}>Sign out</button>
      <button class="border-border/60 rounded-lg border px-3 py-2" on:click={() => goto('/admin')}>
        Go to admin
      </button>
    </div>

    {#if error}
      <p class="text-destructive">{error}</p>
    {/if}

    <ul class="list-inside list-disc">
      {#each docs as doc (doc.id)}
        <li>{doc.reference} · {doc.title} — {doc.status}</li>
      {/each}
    </ul>
  </div>
{:else}
  <div class="flex min-h-screen items-center justify-center">
    <a class="border-border/60 rounded-lg border px-4 py-2 text-sm" href="/login">Sign in</a>
  </div>
{/if}
