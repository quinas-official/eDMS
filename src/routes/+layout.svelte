<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import '$lib/theme';
	import Toaster from '$lib/components/site/Toaster.svelte';
	import WelcomeModal from '$lib/components/site/WelcomeModal.svelte';
	import ServerConnect from '$lib/components/site/ServerConnect.svelte';
	import { isDesktop } from '$lib/config/env';
	import { connection, startConnection } from '$lib/config/connection';

	let { children } = $props();

	// The desktop app needs a server before any page can load data.
	onMount(() => {
		startConnection();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if $connection.everReady}
	{@render children()}
{/if}
{#if isDesktop && $connection.state !== 'ready'}
	<ServerConnect />
{/if}
<WelcomeModal />
<Toaster />
<div style="display:none">
	{#each locales as locale}
		<a href={localizeHref(page.url.pathname, { locale })}>
			{locale}
		</a>
	{/each}
</div>
