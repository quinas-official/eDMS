import type { AssignableUserDTO, UserDTO, UserInput } from '$lib/users/types';
import { apiFetch } from './client';

export type { AssignableUserDTO, UserDTO, UserInput };

/** Admins only. */
export async function listUsers() {
	return (await apiFetch<{ users: UserDTO[] }>('/api/users')).users;
}

/** Editors and approvers: active users for assignee pickers. */
export async function listAssignableUsers() {
	return (await apiFetch<{ users: AssignableUserDTO[] }>('/api/users/assignable')).users;
}

export async function createUser(input: UserInput) {
	return (
		await apiFetch<{ user: UserDTO }>('/api/users', {
			method: 'POST',
			body: JSON.stringify(input)
		})
	).user;
}

/** Leave `password` out to keep the current one. */
export async function updateUser(id: string, input: Partial<UserInput>) {
	return (
		await apiFetch<{ user: UserDTO }>(`/api/users/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			body: JSON.stringify(input)
		})
	).user;
}

export function deleteUser(id: string) {
	return apiFetch<void>(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
