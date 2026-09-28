<script lang="ts">
	import { page } from '$app/state';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import '$lib/theme';
	import Toaster from '$lib/components/site/Toaster.svelte';
	import WelcomeModal from '$lib/components/site/WelcomeModal.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
<WelcomeModal />
<Toaster />
<div style="display:none">
	{#each locales as locale}
		<a href={localizeHref(page.url.pathname, { locale })}>
			{locale}
		</a>
	{/each}
</div>
