<script lang="ts">
	import {
		FileText,
		Users,
		Clock,
		Upload,
		TrendingUp,
		TrendingDown,
		Minus,
		Trash2,
		ScrollText,
		Building,
		Settings,
		Workflow,
		HardDrive,
		ShieldCheck,
		ShieldAlert,
		RefreshCw,
		ArrowRight,
		Plus,
		Pencil,
		CircleCheck,
		CircleX,
		RotateCcw,
		Archive,
		Download,
		LogIn,
		LogOut,
		KeyRound,
		Activity
	} from '@lucide/svelte';
	import { onDestroy, onMount, tick } from 'svelte';

	import QuickActions, { type QuickAction } from '$lib/components/site/QuickActions.svelte';
	import RelativeTime from '$lib/components/site/RelativeTime.svelte';
	import { StatusBadge } from '$lib/components/ui/status-badge';
	import { Button } from '$lib/components/ui/button';
	import { getDashboard } from '$lib/api/dashboard';
	import { actionLabel } from '$lib/activity/types';
	import { currentUser } from '$lib/auth/store';
	import type { DashboardSummary } from '$lib/dashboard/types';
	import type { DocumentStatus } from '$lib/documents/api-types';
	import { formatFileSize } from '$lib/documents/preview';
	import { toast } from '$lib/toast/store';
	import {
		FONT_FAMILY,
		areaGradient,
		axisTicks,
		barValueLabelPlugin,
		chartTheme,
		compact,
		crosshairPlugin,
		doughnutCenterPlugin,
		onModeChange,
		tooltipStyle,
		withAlpha
	} from '$lib/charts/theme';

	const STATUSES: DocumentStatus[] = ['draft', 'pending', 'reviewed', 'approved', 'rejected'];
	/** The palette has five categorical slots; past that, departments fold into "Other". */
	const MAX_SLICES = 5;

	let summary = $state<DashboardSummary | null>(null);
	let loading = $state(true);
	let loadError = $state('');

	async function load() {
		loading = true;
		loadError = '';
		try {
			summary = await getDashboard();
			await tick();
			if (Chart) render();
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Could not load the dashboard';
			toast.error("Couldn't load the dashboard", { description: loadError });
		} finally {
			loading = false;
		}
	}

	// ---- Header ---------------------------------------------------------------

	function greeting() {
		const hour = new Date().getHours();
		if (hour < 12) return 'Good morning';
		if (hour < 18) return 'Good afternoon';
		return 'Good evening';
	}

	const today = new Date().toLocaleDateString(undefined, {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric'
	});

	// ---- Shortcuts ------------------------------------------------------------

	const shortcuts = $derived<QuickAction[]>([
		{
			label: 'Upload document',
			description: 'Add a new file',
			icon: Upload,
			href: '/admin/documents'
		},
		{
			label: 'Review queue',
			description: 'Documents pending review',
			icon: Clock,
			href: '/admin/documents?status=pending',
			badge: summary?.byStatus.pending
		},
		{
			label: 'Deleted documents',
			description: 'Restore removed files',
			icon: Trash2,
			href: '/admin/documents?deleted=true',
			badge: summary?.totals.deleted
		},
		{
			label: 'Audit log',
			description: 'Everything that changed',
			icon: ScrollText,
			href: '/admin/settings#audit'
		},
		{ label: 'Users', description: 'Accounts and roles', icon: Users, href: '/admin/users' },
		{
			label: 'Departments',
			description: 'Teams and filing',
			icon: Building,
			href: '/admin/departments'
		},
		{ label: 'Workflow', description: 'Approval board', icon: Workflow, href: '/admin/workflow' },
		{
			label: 'Settings',
			description: 'System configuration',
			icon: Settings,
			href: '/admin/settings'
		}
	]);

	// ---- Derived figures ------------------------------------------------------

	/** Local calendar date for a `YYYY-MM-DD` key (not UTC midnight). */
	function localDate(key: string) {
		const [y, m, d] = key.split('-').map(Number);
		return new Date(y, m - 1, d);
	}

	const lastWeek = $derived(summary?.uploadsByDay.slice(-7) ?? []);
	const weekTotal = $derived(lastWeek.reduce((a, d) => a + d.count, 0));
	const previousWeekTotal = $derived(
		summary?.uploadsByDay.slice(0, -7).reduce((a, d) => a + d.count, 0) ?? 0
	);
	/** Null when there's nothing to compare against. */
	const weekDelta = $derived(
		previousWeekTotal ? Math.round(((weekTotal - previousWeekTotal) / previousWeekTotal) * 100) : null
	);

	/** Department slices in colour order; the long tail folds into "Other" in the last slot. */
	const slices = $derived.by(() => {
		const all = summary?.byDepartment ?? [];
		if (all.length <= MAX_SLICES) return all.map((d) => ({ name: d.name, count: d.count }));
		const keep = new Set(
			[...all]
				.sort((a, b) => b.count - a.count)
				.slice(0, MAX_SLICES - 1)
				.map((d) => d.id)
		);
		const head = all.filter((d) => keep.has(d.id)).map((d) => ({ name: d.name, count: d.count }));
		const rest = all.filter((d) => !keep.has(d.id)).reduce((t, d) => t + d.count, 0);
		return [...head, { name: 'Other', count: rest }];
	});
	const departmentTotal = $derived(slices.reduce((a, s) => a + s.count, 0));

	// The legend swatches are painted from the same slots the doughnut uses.
	let legendColors = $state(chartTheme('light').series);
	const legend = $derived(
		slices.map((s, i) => ({
			...s,
			share: departmentTotal ? Math.round((s.count / departmentTotal) * 100) : 0,
			color: legendColors[i]
		}))
	);

	const statusMax = $derived(Math.max(1, ...STATUSES.map((s) => summary?.byStatus[s] ?? 0)));

	function statusLabel(status: string) {
		return status.charAt(0).toUpperCase() + status.slice(1);
	}

	const ACTION_ICONS: Record<string, typeof Plus> = {
		created: Plus,
		edited: Pencil,
		approved: CircleCheck,
		rejected: CircleX,
		deleted: Trash2,
		restored: RotateCcw,
		archived: Archive,
		purged: Trash2,
		downloaded: Download,
		login: LogIn,
		logout: LogOut,
		login_failed: KeyRound
	};

	// ---- Charts ---------------------------------------------------------------

	let typeChart = $state<HTMLCanvasElement>();
	let activityChart = $state<HTMLCanvasElement>();
	let departmentChart = $state<HTMLCanvasElement>();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let Chart: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let charts: any[] = [];
	let stopWatchingTheme: (() => void) | undefined;

	function render() {
		const data = summary;
		if (!data || !Chart) return;
		const t = chartTheme();
		legendColors = t.series;
		charts.forEach((c) => c.destroy());
		charts = [];

		if (activityChart) {
			charts.push(
				new Chart(activityChart, {
					type: 'line',
					data: {
						labels: lastWeek.map((d) =>
							localDate(d.date).toLocaleDateString(undefined, { weekday: 'short' })
						),
						datasets: [
							{
								label: 'Uploads',
								data: lastWeek.map((d) => d.count),
								borderColor: t.accent,
								borderWidth: 2,
								cubicInterpolationMode: 'monotone',
								fill: true,
								// eslint-disable-next-line @typescript-eslint/no-explicit-any
								backgroundColor: (ctx: any) =>
									ctx.chart.chartArea
										? areaGradient(ctx.chart.ctx, ctx.chart.chartArea, t.accent)
										: 'transparent',
								pointRadius: 0,
								pointHoverRadius: 5,
								pointHoverBackgroundColor: t.accent,
								pointHoverBorderColor: t.surface,
								pointHoverBorderWidth: 2,
								pointHitRadius: 24
							}
						]
					},
					options: {
						responsive: true,
						maintainAspectRatio: false,
						interaction: { mode: 'index', intersect: false },
						layout: { padding: { top: 8 } },
						plugins: {
							legend: { display: false },
							tooltip: {
								...tooltipStyle(t),
								callbacks: {
									// eslint-disable-next-line @typescript-eslint/no-explicit-any
									title: (items: any[]) =>
										localDate(lastWeek[items[0].dataIndex].date).toLocaleDateString(undefined, {
											weekday: 'long',
											month: 'short',
											day: 'numeric'
										}),
									// eslint-disable-next-line @typescript-eslint/no-explicit-any
									label: (c: any) => ` ${c.parsed.y} ${c.parsed.y === 1 ? 'upload' : 'uploads'}`
								}
							},
							edmsCrosshair: {
								color: t.mode === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.10)'
							}
						},
						scales: {
							x: { grid: { display: false }, border: { display: false }, ticks: axisTicks(t) },
							y: {
								beginAtZero: true,
								suggestedMax: 4,
								grid: { color: t.grid, drawTicks: false },
								border: { display: false },
								ticks: axisTicks(t, { maxTicksLimit: 5, precision: 0, callback: (v: number) => compact(v) })
							}
						}
					},
					plugins: [crosshairPlugin]
				})
			);
		}

		if (departmentChart && departmentTotal) {
			// Empty departments stay in the legend but not the ring, where their
			// zero-width slice would still draw a gap. Colours stay tied to the slot.
			const drawn = slices
				.map((s, i) => ({ ...s, color: t.series[i] }))
				.filter((s) => s.count > 0);
			charts.push(
				new Chart(departmentChart, {
					type: 'doughnut',
					data: {
						labels: drawn.map((s) => s.name),
						datasets: [
							{
								data: drawn.map((s) => s.count),
								backgroundColor: drawn.map((s) => s.color),
								// A 2px ring in the surface colour is the gap between slices.
								borderColor: t.surface,
								borderWidth: 2,
								hoverBorderColor: t.surface,
								hoverBorderWidth: 2,
								hoverOffset: 6
							}
						]
					},
					options: {
						responsive: true,
						maintainAspectRatio: false,
						cutout: '72%',
						layout: { padding: 6 },
						plugins: {
							legend: { display: false },
							tooltip: {
								...tooltipStyle(t),
								callbacks: {
									// eslint-disable-next-line @typescript-eslint/no-explicit-any
									label: (c: any) =>
										` ${compact(c.parsed)} · ${Math.round((c.parsed / departmentTotal) * 100)}%`
								}
							},
							edmsDoughnutCenter: {
								value: compact(departmentTotal),
								label: 'Documents',
								ink: t.ink,
								muted: t.muted
							}
						}
					},
					plugins: [doughnutCenterPlugin]
				})
			);
		}

		if (typeChart && data.byType.length) {
			charts.push(
				new Chart(typeChart, {
					type: 'bar',
					data: {
						labels: data.byType.map((d) => d.label),
						datasets: [
							{
								label: 'Documents',
								data: data.byType.map((d) => d.count),
								backgroundColor: withAlpha(t.accent, 0.85),
								hoverBackgroundColor: t.accent,
								borderRadius: 4,
								borderSkipped: 'start',
								barThickness: 14
							}
						]
					},
					options: {
						indexAxis: 'y',
						responsive: true,
						maintainAspectRatio: false,
						// Room for the value set just past each bar tip.
						layout: { padding: { right: 44 } },
						plugins: {
							legend: { display: false },
							tooltip: {
								...tooltipStyle(t),
								// eslint-disable-next-line @typescript-eslint/no-explicit-any
								callbacks: { label: (c: any) => ` ${compact(c.parsed.x)} documents` }
							},
							edmsBarValueLabel: { color: t.ink }
						},
						scales: {
							x: { display: false, beginAtZero: true, grid: { display: false } },
							y: { grid: { display: false }, border: { display: false }, ticks: axisTicks(t) }
						}
					},
					plugins: [barValueLabelPlugin]
				})
			);
		}
	}

	onMount(async () => {
		const [chartModule] = await Promise.all([import('chart.js/auto'), load()]);
		Chart = chartModule.default;
		Chart.defaults.font.family = FONT_FAMILY;
		Chart.defaults.font.size = 11;
		Chart.defaults.animation.duration = 650;
		Chart.defaults.animation.easing = 'easeOutQuart';

		render();
		stopWatchingTheme = onModeChange(render);
	});

	onDestroy(() => {
		stopWatchingTheme?.();
		charts.forEach((c) => c.destroy());
		charts = [];
	});

	const cardClass = 'bg-card border-border/60 rounded-xl border p-5 shadow-sm';
	const kpiClass =
		'bg-card border-border/60 group block rounded-xl border p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50';
</script>

<div class="space-y-8">
	<!-- Greeting -->
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h2 class="text-xl font-semibold tracking-tight">
				{greeting()}{$currentUser ? `, ${$currentUser.name}` : ''}
			</h2>
			<p class="text-muted-foreground mt-0.5 text-sm">{today}</p>
		</div>
		<div class="text-muted-foreground flex items-center gap-3 text-xs">
			{#if summary}
				<span>Updated <RelativeTime value={summary.generatedAt} /></span>
			{/if}
			<Button variant="outline" size="sm" disabled={loading} onclick={load}>
				<RefreshCw class={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
				Refresh
			</Button>
		</div>
	</div>

	{#if loadError && !summary}
		<div class="border-destructive/30 bg-destructive/5 text-destructive flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm">
			<p>Couldn't load the dashboard: {loadError}</p>
			<Button variant="outline" size="sm" onclick={load}>Try again</Button>
		</div>
	{/if}

	<!-- Shortcuts -->
	<section class="space-y-3" aria-labelledby="shortcuts-title">
		<h2 id="shortcuts-title" class="text-sm font-semibold tracking-tight">Shortcuts</h2>
		<QuickActions actions={shortcuts} />
	</section>

	<!-- KPI Cards -->
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
		{#each [
			{
				label: 'Documents',
				icon: FileText,
				value: summary ? compact(summary.totals.documents) : '—',
				note: summary ? `${summary.totals.deleted} deleted, restorable` : '',
				href: '/admin/documents'
			},
			{
				label: 'Pending Review',
				icon: Clock,
				value: summary ? String(summary.byStatus.pending) : '—',
				note: summary ? `${summary.byStatus.reviewed} awaiting approval` : '',
				href: '/admin/documents?status=pending'
			},
			{
				label: 'Active Users',
				icon: Users,
				value: summary ? String(summary.totals.activeUsers) : '—',
				note: summary ? `${summary.security.signedInUsers} signed in now` : '',
				href: '/admin/users'
			},
			{
				label: 'Storage Used',
				icon: HardDrive,
				value: summary ? formatFileSize(summary.totals.storageBytes) : '—',
				note: summary
					? `${summary.totals.versions} file ${summary.totals.versions === 1 ? 'version' : 'versions'}`
					: '',
				href: '/admin/documents'
			}
		] as kpi (kpi.label)}
			<a href={kpi.href} class={kpiClass}>
				<div class="flex items-center gap-4">
					<div class="bg-muted flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors group-hover:bg-foreground/10">
						<kpi.icon class="h-5 w-5" />
					</div>
					<div class="min-w-0">
						<p class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{kpi.label}</p>
						<p class="text-2xl font-semibold tracking-tight tabular-nums">{kpi.value}</p>
						{#if kpi.note}
							<p class="text-muted-foreground truncate text-xs">{kpi.note}</p>
						{/if}
					</div>
				</div>
			</a>
		{/each}
	</div>

	<!-- Charts -->
	<div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
		<!-- Upload activity -->
		<div class={`${cardClass} md:col-span-2`}>
			<div class="flex items-start justify-between gap-4">
				<div>
					<h2 class="text-sm font-semibold tracking-tight">Upload Activity</h2>
					<div class="mt-2 flex items-baseline gap-2.5">
						<span class="text-2xl font-semibold tracking-tight tabular-nums">{weekTotal}</span>
						<span class="text-muted-foreground text-xs">
							{weekTotal === 1 ? 'file' : 'files'} uploaded
						</span>
						{#if weekDelta !== null}
							<span
								class={`inline-flex items-center gap-1 text-xs font-medium ${
									weekDelta > 0
										? 'text-[#006300] dark:text-[#0ca30c]'
										: weekDelta < 0
											? 'text-destructive'
											: 'text-muted-foreground'
								}`}
								title={`${previousWeekTotal} the 7 days before`}
							>
								{#if weekDelta > 0}
									<TrendingUp class="h-3.5 w-3.5" />
								{:else if weekDelta < 0}
									<TrendingDown class="h-3.5 w-3.5" />
								{:else}
									<Minus class="h-3.5 w-3.5" />
								{/if}
								{weekDelta > 0 ? '+' : ''}{weekDelta}% vs previous week
							</span>
						{/if}
					</div>
				</div>
				<span class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">Last 7 days</span>
			</div>
			<div class="mt-4 h-56">
				<canvas bind:this={activityChart} aria-label="Files uploaded per day, last 7 days"></canvas>
			</div>
		</div>

		<!-- Department load -->
		<div class={`${cardClass} flex flex-col`}>
			<h2 class="text-sm font-semibold tracking-tight">Documents by Department</h2>
			{#if summary && !departmentTotal}
				<p class="text-muted-foreground flex flex-1 items-center justify-center py-10 text-sm">No documents yet.</p>
			{:else}
				<div class="mt-2 h-40">
					<canvas bind:this={departmentChart} aria-label="Documents by department"></canvas>
				</div>
				<!-- The legend carries identity and the values, so the slices never rely on hue alone. -->
				<ul class="mt-4 space-y-1.5">
					{#each legend as item (item.name)}
						<li class="flex items-center gap-2.5 text-xs">
							<span class="h-2 w-2 shrink-0 rounded-full" style:background-color={item.color}></span>
							<span class="text-muted-foreground flex-1 truncate">{item.name}</span>
							<span class="font-medium tabular-nums">{item.count}</span>
							<span class="text-muted-foreground w-8 text-right tabular-nums">{item.share}%</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- Documents by type -->
		<div class={`${cardClass} flex flex-col`}>
			<div class="flex items-baseline justify-between gap-3">
				<h2 class="text-sm font-semibold tracking-tight">Documents by Type</h2>
				<span class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase" title="By each document's latest file">Latest file</span>
			</div>
			{#if summary && !summary.byType.length}
				<p class="text-muted-foreground flex flex-1 items-center justify-center py-10 text-sm">No documents yet.</p>
			{:else}
				<div class="mt-4 h-64">
					<canvas bind:this={typeChart} aria-label="Documents by file type"></canvas>
				</div>
			{/if}
		</div>
	</div>

	<!-- Activity + status + security -->
	<div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
		<!-- Recent activity -->
		<section class={`${cardClass} xl:col-span-2`} aria-labelledby="recent-activity-title">
			<div class="flex items-center justify-between gap-3">
				<h2 id="recent-activity-title" class="flex items-center gap-2 text-sm font-semibold tracking-tight">
					<Activity class="text-muted-foreground h-4 w-4" /> Recent Activity
				</h2>
				<a href="/admin/settings#audit" class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium transition-colors">
					View audit log <ArrowRight class="h-3.5 w-3.5" />
				</a>
			</div>

			{#if summary?.recentActivity.length}
				<ol class="divide-border/60 mt-3 divide-y">
					{#each summary.recentActivity as entry (entry.id)}
						{@const Icon = ACTION_ICONS[entry.action] ?? Activity}
						<li class="flex items-start gap-3 py-2.5">
							<span
								class={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
									entry.action === 'login_failed' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
								}`}
							>
								<Icon class="h-3.5 w-3.5" />
							</span>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm">
									<span class="font-medium">{entry.actor}</span>
									<span class="text-muted-foreground">{actionLabel(entry.action).toLowerCase()}</span>
									{#if entry.target}
										<span class="font-medium">{entry.target}</span>
									{/if}
								</p>
								{#if entry.details}
									<p class="text-muted-foreground truncate text-xs">{entry.details}</p>
								{/if}
							</div>
							<RelativeTime value={entry.createdAt} class="text-muted-foreground shrink-0 text-xs whitespace-nowrap" />
						</li>
					{/each}
				</ol>
			{:else}
				<p class="text-muted-foreground py-10 text-center text-sm">
					{summary ? 'Nothing recorded yet.' : 'Loading…'}
				</p>
			{/if}
		</section>

		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-1">
			<!-- Status breakdown -->
			<section class={cardClass} aria-labelledby="status-title">
				<h2 id="status-title" class="text-sm font-semibold tracking-tight">Status Breakdown</h2>
				<ul class="mt-3 space-y-2.5">
					{#each STATUSES as status (status)}
						{@const n = summary?.byStatus[status] ?? 0}
						<li>
							<a
								href={`/admin/documents?status=${status}`}
								class="hover:bg-muted/60 -mx-2 flex items-center gap-3 rounded-lg px-2 py-1 transition-colors"
							>
								<span class="w-20 shrink-0"><StatusBadge status={statusLabel(status)} /></span>
								<span class="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
									<span
										class="bg-foreground/60 block h-full rounded-full transition-[width] duration-500"
										style:width={`${(n / statusMax) * 100}%`}
									></span>
								</span>
								<span class="w-8 text-right text-sm font-medium tabular-nums">{n}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>

			<!-- Security -->
			<section class={cardClass} aria-labelledby="security-title">
				<h2 id="security-title" class="text-sm font-semibold tracking-tight">Security</h2>
				{#if summary}
					{@const failed = summary.security.failedSignIns24h}
					<div class="mt-3 space-y-3 text-sm">
						<a
							href="/admin/settings#audit"
							class="hover:bg-muted/60 -mx-2 flex items-center gap-3 rounded-lg px-2 py-1 transition-colors"
						>
							{#if failed}
								<ShieldAlert class="text-destructive h-4 w-4 shrink-0" />
							{:else}
								<ShieldCheck class="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
							{/if}
							<span class="flex-1">Failed sign-ins, last 24 hours</span>
							<span class={`font-medium tabular-nums ${failed ? 'text-destructive' : ''}`}>{failed}</span>
						</a>
						<div class="-mx-2 flex items-center gap-3 px-2 py-1">
							<LogIn class="text-muted-foreground h-4 w-4 shrink-0" />
							<span class="flex-1">Users signed in now</span>
							<span class="font-medium tabular-nums">{summary.security.signedInUsers}</span>
						</div>
					</div>
				{:else}
					<p class="text-muted-foreground py-6 text-center text-sm">Loading…</p>
				{/if}
			</section>
		</div>
	</div>

	<!-- Recently updated documents -->
	<section class={cardClass} aria-labelledby="recent-docs-title">
		<div class="flex items-center justify-between gap-3">
			<h2 id="recent-docs-title" class="text-sm font-semibold tracking-tight">Recently Updated Documents</h2>
			<a href="/admin/documents" class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium transition-colors">
				All documents <ArrowRight class="h-3.5 w-3.5" />
			</a>
		</div>
		{#if summary?.recentDocuments.length}
			<ul class="divide-border/60 mt-3 divide-y">
				{#each summary.recentDocuments as doc (doc.id)}
					<li>
						<a
							href={`/admin/documents?search=${encodeURIComponent(doc.reference)}`}
							class="hover:bg-muted/60 -mx-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-2 py-2.5 transition-colors"
						>
							<span class="text-muted-foreground w-28 shrink-0 text-xs tabular-nums">{doc.reference}</span>
							<span class="min-w-0 flex-1 truncate text-sm font-medium">{doc.title}</span>
							<span class="text-muted-foreground hidden text-xs sm:inline">{doc.department ?? 'No department'}</span>
							<StatusBadge status={statusLabel(doc.status)} />
							<RelativeTime value={doc.updatedAt} class="text-muted-foreground w-36 shrink-0 text-right text-xs" />
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-muted-foreground py-8 text-center text-sm">
				{summary ? 'No documents yet. Upload one to get started.' : 'Loading…'}
			</p>
		{/if}
	</section>
</div>
