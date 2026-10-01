<script lang="ts">
	import { Server, RefreshCw, WifiOff } from '@lucide/svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import {
		cancelChangeServer,
		changeServer,
		connection,
		connectTo,
		retry
	} from '$lib/config/connection';

	// Desktop only: first-run server setup, and the screen shown when the
	// server stops answering. Rendered by the root layout over everything else.

	let address = $state($connection.url ?? '');
	let error = $state('');
	let busy = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			await connectTo(address);
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<div class="bg-sidebar/95 text-sidebar-foreground fixed inset-0 z-100 flex items-center justify-center p-4 backdrop-blur-sm">
	<div class="border-sidebar-border bg-sidebar w-full max-w-md space-y-6 rounded-2xl border p-8 shadow-2xl">
		{#if $connection.state === 'checking'}
			<div class="flex flex-col items-center gap-3 py-6 text-center">
				<RefreshCw class="h-8 w-8 animate-spin opacity-70" />
				<p class="text-sm">Connecting to {$connection.url}…</p>
			</div>
		{:else if $connection.state === 'unreachable'}
			<div class="flex flex-col items-center gap-3 text-center">
				<div class="bg-destructive/15 text-destructive flex h-14 w-14 items-center justify-center rounded-full">
					<WifiOff class="h-7 w-7" />
				</div>
				<h1 class="text-xl font-semibold">Can't reach the server</h1>
				<p class="text-sidebar-foreground/70 text-sm">{$connection.error}</p>
				<p class="text-sidebar-foreground/50 text-xs">{$connection.url}</p>
			</div>
			<div class="flex flex-col gap-2">
				<Button class="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90" onclick={retry}>
					<RefreshCw class="h-4 w-4" /> Try again
				</Button>
				<Button variant="ghost" class="hover:bg-sidebar-accent hover:text-sidebar-foreground" onclick={changeServer}>Use a different server</Button>
			</div>
		{:else}
			<div class="flex flex-col items-center gap-3 text-center">
				<div class="bg-sidebar-primary text-sidebar-primary-foreground flex h-14 w-14 items-center justify-center rounded-full">
					<Server class="h-7 w-7" />
				</div>
				<h1 class="text-xl font-semibold">Connect to your eDMS server</h1>
				<p class="text-sidebar-foreground/70 text-sm">
					Enter the address your administrator gave you, for example
					<span class="font-mono">192.168.1.10:3000</span>.
				</p>
			</div>
			<form class="space-y-3" onsubmit={submit}>
				<Input bind:value={address} placeholder="http://192.168.1.10:3000" aria-label="Server address" autofocus />
				{#if error}
					<p class="text-destructive text-sm">{error}</p>
				{/if}
				<Button type="submit" disabled={busy} class="w-full bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90">
					{busy ? 'Checking…' : 'Connect'}
				</Button>
				{#if $connection.url}
					<Button type="button" variant="ghost" class="hover:bg-sidebar-accent hover:text-sidebar-foreground w-full" onclick={cancelChangeServer}>
						Cancel
					</Button>
				{/if}
			</form>
		{/if}
	</div>
</div>
