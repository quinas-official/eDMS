import type { DepartmentDetailDTO, DepartmentDTO } from '$lib/departments/types';
import { apiFetch } from './client';

export type { DepartmentDetailDTO, DepartmentDTO };

export async function listDepartments() {
	return (await apiFetch<{ departments: DepartmentDTO[] }>('/api/departments')).departments;
}

/** Admins only: with members and document counts. */
export async function listDepartmentDetails() {
	return (await apiFetch<{ departments: DepartmentDetailDTO[] }>('/api/departments?details=true'))
		.departments;
}

export interface DepartmentInput {
	name: string;
	description: string;
}

export async function createDepartment(input: DepartmentInput) {
	return (
		await apiFetch<{ department: DepartmentDetailDTO }>('/api/departments', {
			method: 'POST',
			body: JSON.stringify(input)
		})
	).department;
}

export async function updateDepartment(id: number, input: Partial<DepartmentInput>) {
	return (
		await apiFetch<{ department: DepartmentDetailDTO }>(`/api/departments/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(input)
		})
	).department;
}

export function deleteDepartment(id: number) {
	return apiFetch<void>(`/api/departments/${id}`, { method: 'DELETE' });
}
