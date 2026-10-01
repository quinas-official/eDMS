import { derived, writable } from 'svelte/store';
import { listDepartments } from '$lib/api/departments';
import type { DepartmentDTO } from './types';

/**
 * The server's department list, shared by the dropdowns across the admin
 * pages. Empty until `loadDepartments()` runs; the Departments page calls it
 * again after every change so the other pages pick the change up.
 */
export const departments = writable<DepartmentDTO[]>([]);

/** Just the names, for the filter and form dropdowns. */
export const departmentNames = derived(departments, ($departments) =>
	$departments.map((d) => d.name)
);

let pending: Promise<DepartmentDTO[]> | null = null;

export function loadDepartments(): Promise<DepartmentDTO[]> {
	pending ??= listDepartments()
		.then((list) => {
			departments.set(list);
			return list;
		})
		.finally(() => (pending = null));
	return pending;
}
