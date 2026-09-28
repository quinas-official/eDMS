<script lang="ts">
	import { CircleCheck, X } from '@lucide/svelte';
	import { fade, scale } from 'svelte/transition';
	import { welcome } from '$lib/auth/welcome';

	const DURATION_MS = 3000;

	let timer: ReturnType<typeof setTimeout> | undefined;

	// Restart the countdown whenever a new sign-in sets it.
	$: {
		clearTimeout(timer);
		if ($welcome) timer = setTimeout(close, DURATION_MS);
	}

	function close() {
		clearTimeout(timer);
		welcome.set(null);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && $welcome) close();
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if $welcome}
	<!-- Above the page and its modals, below the toasts. -->
	<div class="fixed inset-0 z-[90] flex items-center justify-center p-4" transition:fade={{ duration: 150 }}>
		<button
			aria-label="Close"
			class="absolute inset-0 cursor-default bg-black/40"
			on:click={close}
		></button>

		<div
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="welcome-title"
			aria-describedby="welcome-description"
			class="bg-card border-border/60 relative w-full max-w-sm overflow-hidden rounded-2xl border p-6 text-center shadow-2xl"
			transition:scale={{ start: 0.95, duration: 180 }}
		>
			<button
				type="button"
				aria-label="Close"
				class="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-3 right-3 rounded-md p-1 transition-colors"
				on:click={close}
			>
				<X class="h-4 w-4" />
			</button>

			<div
				class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
			>
				<CircleCheck class="h-8 w-8" />
			</div>
			<h2 id="welcome-title" class="text-lg font-semibold">Signed in successfully</h2>
			<p id="welcome-description" class="text-muted-foreground mt-1 text-sm">
				Welcome back, {$welcome.name}.
			</p>

			<!-- Drains over the 3 seconds so it's clear the modal will close on its own. -->
			<div class="bg-muted absolute inset-x-0 bottom-0 h-1">
				<div
					class="countdown h-full bg-emerald-500"
					style={`animation-duration: ${DURATION_MS}ms`}
				></div>
			</div>
		</div>
	</div>
{/if}

<style>
	.countdown {
		animation-name: drain;
		animation-timing-function: linear;
		animation-fill-mode: forwards;
		transform-origin: left;
	}

	@keyframes drain {
		from {
			transform: scaleX(1);
		}
		to {
			transform: scaleX(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.countdown {
			animation: none;
		}
	}
</style>
