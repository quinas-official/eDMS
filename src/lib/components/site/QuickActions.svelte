<script lang="ts" context="module">
  import type { Component } from 'svelte';

  export interface QuickAction {
    label: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon: Component<any>;
    href?: string;
    onClick?: () => void;
    /** One short line under the label. */
    description?: string;
    /** A count shown as a pill, e.g. items waiting; hidden when 0 or unset. */
    badge?: number;
  }
</script>

<script lang="ts">
  export let actions: QuickAction[] = [];

  const tileClass =
    'border-border/60 bg-card group flex items-center gap-3 rounded-xl border p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50';
</script>

<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
  {#each actions as action (action.label)}
    <svelte:element
      this={action.href ? 'a' : 'button'}
      href={action.href}
      type={action.href ? undefined : 'button'}
      role={action.href ? undefined : 'button'}
      tabindex="0"
      on:click={action.onClick}
      class={tileClass}
    >
      <span class="bg-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors group-hover:bg-foreground/10">
        <action.icon class="h-4.5 w-4.5" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium">{action.label}</span>
        {#if action.description}
          <span class="text-muted-foreground block truncate text-xs">{action.description}</span>
        {/if}
      </span>
      {#if action.badge}
        <span class="bg-foreground text-background shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums">
          {action.badge}
        </span>
      {/if}
    </svelte:element>
  {/each}
</div>
