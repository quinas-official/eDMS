import type { DashboardSummary } from '$lib/dashboard/types';
import { apiFetch } from './client';

/** Admins only. Daily counts follow the browser's time zone. */
export function getDashboard() {
	const tzOffset = new Date().getTimezoneOffset();
	return apiFetch<DashboardSummary>(`/api/dashboard?tzOffset=${tzOffset}`);
}
