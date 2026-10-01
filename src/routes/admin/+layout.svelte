<script lang="ts">
  import { LayoutDashboard, Folder, Users, Clock, Settings, LogOut, Building, Menu, X } from '@lucide/svelte';
  import { page } from '$app/stores';
  import { derived } from 'svelte/store';
  import { fade, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { currentUser, loadSession, sessionChecked, signOut } from '$lib/auth/store';
  import { NON_ADMIN_HOME, canAccessPath } from '$lib/auth/guards';
  import { loadSettings, settings } from '$lib/settings/store';

  let isCollapsed = false;
  let mobileOpen = false;
  const currentPath = derived(page, ($page) => $page.url.pathname);

  // Close the mobile drawer whenever navigation happens
  $: if ($currentPath) mobileOpen = false;

  // ---- Access control -------------------------------------------------------
  // The session is checked against the server on first load. This runs on the
  // client because the desktop app's bundled pages never pass through the
  // server's hooks; the API enforces access either way.
  // Signed-in non-admins may use the Documents page; everything else is
  // admin-only, so they're sent there instead of back to the login screen.
  let redirecting = false;
  $: authorized = browser && canAccessPath($currentUser, $currentPath);

  $: if (browser && $sessionChecked && !authorized && !redirecting) {
    redirecting = true;
    goto($currentUser ? NON_ADMIN_HOME : '/login').finally(() => (redirecting = false));
  }

  // ---- Idle session timeout -------------------------------------------------
  // The server expires idle sessions too; this just signs out promptly.
  let idleTimer: ReturnType<typeof setTimeout>;

  async function endSession() {
    await signOut();
    goto('/login');
  }

  function resetIdleTimer() {
    if (!browser) return;
    clearTimeout(idleTimer);
    const minutes = $settings.security.sessionTimeoutMinutes;
    if (!minutes || !authorized) return;
    idleTimer = setTimeout(endSession, minutes * 60_000);
  }

  // Re-arm whenever the configured timeout changes, not just on activity.
  $: $settings.security.sessionTimeoutMinutes, authorized, resetIdleTimer();

  onMount(async () => {
    resetIdleTimer();
    const user = $sessionChecked ? $currentUser : await loadSession();
    // The idle timeout and the pages below all follow the server's settings.
    if (user) loadSettings().catch(() => {});
  });
  onDestroy(() => clearTimeout(idleTimer));

  const navItems = [
    { label: 'Dashboard', icon: LayoutDashboard, href: '/admin' },
    { label: 'Documents', icon: Folder, href: '/admin/documents' },
    { label: 'Departments', icon: Building, href: '/admin/departments' },
    { label: 'Users', icon: Users, href: '/admin/users' },
    { label: 'Workflow', icon: Clock, href: '/admin/workflow' },
    { label: 'Settings', icon: Settings, href: '/admin/settings' }
  ];
</script>

<svelte:window
  on:pointerdown={resetIdleTimer}
  on:keydown={resetIdleTimer}
  on:wheel={resetIdleTimer}
/>

{#if !authorized}
  <div class="bg-background text-muted-foreground flex min-h-screen items-center justify-center text-sm">
    Checking access…
  </div>
{:else}
<div class="bg-background flex min-h-screen">
  <!-- Mobile backdrop -->
  {#if mobileOpen}
    <button
      aria-label="Close menu"
      class="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
      on:click={() => (mobileOpen = false)}
      transition:fade={{ duration: 200 }}
    ></button>
  {/if}

  <!-- Sidebar -->
  <aside
    class={`bg-sidebar text-sidebar-foreground border-sidebar-border fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r transition-transform duration-300 ease-in-out md:static md:z-auto md:translate-x-0 md:transition-[width] ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} ${isCollapsed ? 'md:w-20' : 'md:w-56'}`}
  >
    <div class="border-sidebar-border/60 flex items-center gap-3 border-b px-4 py-5">
      <div class="bg-sidebar-accent/60 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-300 hover:scale-105">
        <LayoutDashboard class="text-sidebar-primary h-5 w-5" />
      </div>
      {#if !isCollapsed}<span class="text-lg font-semibold tracking-tight whitespace-nowrap">eDMS Admin</span>{/if}
      <button
        aria-label="Close menu"
        class="hover:bg-sidebar-accent ml-auto rounded-md p-1.5 transition-colors md:hidden"
        on:click={() => (mobileOpen = false)}
      >
        <X class="h-5 w-5" />
      </button>
    </div>

    <nav class="flex-1 space-y-0.5 overflow-y-auto p-3 text-sm">
      {#each navItems.filter((item) => canAccessPath($currentUser, item.href)) as item (item.href)}
        {@const active = $currentPath === item.href}
        <a
          href={item.href}
          class={`hover:bg-sidebar-accent/70 relative flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium transition-all duration-200 hover:translate-x-0.5 ${active ? 'bg-sidebar-accent text-sidebar-primary' : 'text-sidebar-foreground/70'}`}
        >
          {#if active}
            <span
              class="bg-sidebar-primary absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-r-full"
              in:scale={{ duration: 200, easing: quintOut, start: 0.3 }}
            ></span>
          {/if}
          <item.icon class="h-4.5 w-4.5 shrink-0 transition-transform duration-200" />
          {#if !isCollapsed}<span class="whitespace-nowrap">{item.label}</span>{/if}
        </a>
      {/each}
    </nav>

    <div class="border-sidebar-border/60 space-y-0.5 border-t p-3">
      <button
        class="hover:bg-sidebar-accent/70 text-sidebar-foreground/70 hidden w-full items-center gap-3 rounded-lg px-3 py-2.5 font-medium transition-colors md:flex"
        on:click={() => (isCollapsed = !isCollapsed)}
      >
        <LayoutDashboard class={`h-4.5 w-4.5 shrink-0 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} />
        {#if !isCollapsed}<span class="whitespace-nowrap">Collapse</span>{/if}
      </button>
      <button
        class="hover:bg-sidebar-accent/70 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 font-medium text-red-400 transition-colors"
        on:click={endSession}
      >
        <LogOut class="h-4.5 w-4.5 shrink-0" />
        {#if !isCollapsed}<span class="whitespace-nowrap">Logout</span>{/if}
      </button>
    </div>
  </aside>

  <!-- Page Content -->
  <main class="bg-muted flex-1 overflow-y-auto">
    <!-- Header -->
    <header class="bg-muted/80 sticky top-0 z-20 flex items-center gap-3 border-b p-4 backdrop-blur-sm md:border-none md:bg-transparent md:p-6 md:pb-0">
      <button
        aria-label="Open menu"
        class="hover:bg-accent hover:text-accent-foreground -ml-1 rounded-md p-2 transition-colors md:hidden"
        on:click={() => (mobileOpen = true)}
      >
        <Menu class="h-5 w-5" />
      </button>
      <div>
        <h1 class="text-lg font-semibold tracking-tight md:text-2xl">
          {#if $currentPath === '/admin'}Dashboard{/if}
          {#if $currentPath === '/admin/documents'}Documents{/if}
          {#if $currentPath === '/admin/departments'}Departments{/if}
          {#if $currentPath === '/admin/users'}Users{/if}
          {#if $currentPath === '/admin/workflow'}Workflow{/if}
          {#if $currentPath === '/admin/settings'}Settings{/if}
        </h1>
        <p class="text-muted-foreground hidden text-sm md:mt-0.5 md:block">
          {#if $currentPath === '/admin'}Enterprise Document Management Overview{/if}
          {#if $currentPath === '/admin/documents'}Manage all uploaded documents{/if}
          {#if $currentPath === '/admin/departments'}Manage departments and assigned personnel{/if}
          {#if $currentPath === '/admin/users'}User management and roles{/if}
          {#if $currentPath === '/admin/workflow'}Workflow overview and approvals{/if}
          {#if $currentPath === '/admin/settings'}System-wide preferences and configuration{/if}
        </p>
      </div>
    </header>

    <!-- Animated Slot -->
    <!-- Grid stack: incoming and outgoing pages share one cell, so nothing is
         pushed down while the old page fades out. -->
    <div class="page-stack">
      {#key $currentPath}
        <div class="page-stack-item p-4 md:p-6 md:pt-6" in:fade={{ duration: 200, delay: 120, easing: quintOut }} out:fade={{ duration: 120, easing: quintOut }}>
          <div class="bg-card border-border/60 rounded-2xl border p-4 shadow-sm md:p-6">
            <slot />
          </div>
        </div>
      {/key}
    </div>
  </main>
</div>
{/if}

<style>
  .page-stack {
    display: grid;
    grid-template-areas: 'stack';
  }
  .page-stack-item {
    grid-area: stack;
    min-width: 0;
  }
</style>
