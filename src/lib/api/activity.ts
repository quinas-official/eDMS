import type { ActivityListQuery, ActivityListResponse } from '$lib/activity/types';
import { apiFetch } from './client';

/** Admins only. Newest first; pass `nextCursor` back as `before` for the next page. */
export function listActivity(query: ActivityListQuery = {}) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined && value !== '') params.set(key, String(value));
	}
	const qs = params.toString();
	return apiFetch<ActivityListResponse>(`/api/activity${qs ? `?${qs}` : ''}`);
}
