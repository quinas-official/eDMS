<script lang="ts">
	import { CircleCheck, CircleX, Info, X } from '@lucide/svelte';
	import { flip } from 'svelte/animate';
	import { fly } from 'svelte/transition';
	import { dismissToast, toasts, type Toast, type ToastKind } from '$lib/toast/store';

	const ICONS: Record<ToastKind, typeof Info> = { success: CircleCheck, error: CircleX, info: Info };
	const ICON_CLASS: Record<ToastKind, string> = {
		success: 'text-emerald-600 dark:text-emerald-400',
		error: 'text-destructive',
		info: 'text-blue-600 dark:text-blue-400'
	};

	/**
	 * Per-toast countdown that pauses while the pointer is over the stack, so a
	 * message doesn't vanish while someone is reading it.
	 */
	function autoDismiss(_node: HTMLElement, entry: Toast) {
		if (!entry.duration) return;
		let remaining = entry.duration;
		let startedAt = Date.now();
		let timer = setTimeout(() => dismissToast(entry.id), remaining);

		const pause = () => {
			clearTimeout(timer);
			remaining -= Date.now() - startedAt;
		};
		const resume = () => {
			startedAt = Date.now();
			timer = setTimeout(() => dismissToast(entry.id), Math.max(remaining, 1000));
		};
		const region = _node.parentElement;
		region?.addEventListener('pointerenter', pause);
		region?.addEventListener('pointerleave', resume);

		return {
			destroy() {
				clearTimeout(timer);
				region?.removeEventListener('pointerenter', pause);
				region?.removeEventListener('pointerleave', resume);
			}
		};
	}
</script>

<!-- Above every modal (they go up to z-60). -->
<section
	aria-label="Notifications"
	class="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
>
	{#each $toasts as entry (entry.id)}
		{@const Icon = ICONS[entry.kind]}
		<div
			use:autoDismiss={entry}
			animate:flip={{ duration: 200 }}
			in:fly={{ x: 24, duration: 200 }}
			out:fly={{ x: 24, duration: 150 }}
			role={entry.kind === 'error' ? 'alert' : 'status'}
			aria-live={entry.kind === 'error' ? 'assertive' : 'polite'}
			class="bg-card border-border/60 text-foreground pointer-events-auto flex items-start gap-3 rounded-xl border p-3.5 pr-2.5 shadow-lg"
		>
			<Icon class={`mt-0.5 h-4 w-4 shrink-0 ${ICON_CLASS[entry.kind]}`} />
			<div class="min-w-0 flex-1">
				<p class="text-sm font-medium">{entry.message}</p>
				{#if entry.description}
					<p class="text-muted-foreground mt-0.5 text-xs break-words">{entry.description}</p>
				{/if}
			</div>
			<button
				type="button"
				aria-label="Dismiss notification"
				class="text-muted-foreground hover:bg-muted hover:text-foreground -mt-0.5 rounded-md p-1 transition-colors"
				on:click={() => dismissToast(entry.id)}
			>
				<X class="h-3.5 w-3.5" />
			</button>
		</div>
	{/each}
</section>
