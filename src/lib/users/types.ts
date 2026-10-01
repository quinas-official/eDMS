import type { Role } from '$lib/settings/types';

export type UserStatus = 'active' | 'inactive';

/** An account as GET /api/users returns it to admins. Never includes the password hash. */
export interface UserDTO {
	id: string;
	username: string;
	name: string;
	email: string | null;
	role: Role;
	status: UserStatus;
	departmentId: number | null;
	department: string | null;
	createdAt: string;
	/** Most recent sign-in from the audit log; null if they never signed in. */
	lastLoginAt: string | null;
	/** Documents they own. An owner can't be deleted, only deactivated. */
	ownedDocuments: number;
}

/** The slim list for assignee pickers, from GET /api/users/assignable. */
export interface AssignableUserDTO {
	id: string;
	name: string;
	departmentId: number | null;
	department: string | null;
}

export interface UserInput {
	username: string;
	name: string;
	email: string;
	role: Role;
	status: UserStatus;
	departmentId: number | null;
	/** Required on create; on update, set only to change it. */
	password?: string;
}

export const PASSWORD_MIN = 8;
