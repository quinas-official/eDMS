/** A department as GET /api/departments returns it to any signed-in user. */
export interface DepartmentDTO {
	id: number;
	name: string;
	description: string;
}

export interface DepartmentMember {
	id: string;
	name: string;
	username: string;
	email: string | null;
	status: 'active' | 'inactive';
}

/** The admin view, from GET /api/departments?details=true. */
export interface DepartmentDetailDTO extends DepartmentDTO {
	createdAt: string;
	/** The default department in Settings; it can't be deleted. */
	isDefault: boolean;
	/** Documents filed here, not counting deleted ones. */
	documentCount: number;
	members: DepartmentMember[];
}
