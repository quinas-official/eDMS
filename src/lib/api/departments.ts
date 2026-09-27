import { apiFetch } from './client';

export interface DepartmentDTO {
	id: number;
	name: string;
	description: string;
}

export async function listDepartments() {
	return (await apiFetch<{ departments: DepartmentDTO[] }>('/api/departments')).departments;
}
