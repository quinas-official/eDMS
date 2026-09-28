<script lang="ts">
	import { formatFull, formatRelative, now } from '$lib/format/date';

	/** Shows "5 minutes ago"-style text, with the exact time on hover. */
	let { value, class: className = '' }: { value: string; class?: string } = $props();
</script>

<time datetime={value} title={formatFull(value)} class={className}>{formatRelative(value, $now)}</time>
