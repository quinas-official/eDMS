export type Role = 'admin' | 'editor' | 'viewer';

export const ROLES: Role[] = ['admin', 'editor', 'viewer'];

export type Permission = 'view' | 'upload' | 'approve' | 'delete';

export const PERMISSION_LABELS: { value: Permission; label: string; description: string }[] = [
	{ value: 'view', label: 'View', description: 'Open and read documents' },
	{ value: 'upload', label: 'Upload', description: 'Add new documents and versions' },
	{ value: 'approve', label: 'Approve', description: 'Move documents through the workflow' },
	{ value: 'delete', label: 'Delete', description: 'Remove documents and departments' }
];

export interface GeneralSettings {
	orgName: string;
	supportEmail: string;
	/** Department name, matched against `$lib/departments/store`. */
	defaultDepartment: string;
	timezone: string;
}

export interface DocumentSettings {
	maxUploadSizeMb: number;
	/** Comma-separated extension list as typed by the admin, e.g. ".pdf, .docx". */
	allowedFileTypes: string;
	enableVersioning: boolean;
	requireApproval: boolean;
}

export interface RetentionSettings {
	autoArchiveEnabled: boolean;
	archiveAfterDays: number;
	purgeDeletedAfterDays: number;
}

/**
 * Stored and validated, but hidden in the UI and unused: there's no mail
 * transport yet. Kept so turning the feature on later needs no migration.
 */
export interface NotificationSettings {
	notifySubmitted: boolean;
	notifyAssigned: boolean;
	weeklyDigest: boolean;
}

export interface SecuritySettings {
	sessionTimeoutMinutes: number;
	/** Always false: there's no second factor yet, and the server refuses to turn it on. */
	require2fa: boolean;
}

export interface AppSettings {
	general: GeneralSettings;
	documents: DocumentSettings;
	retention: RetentionSettings;
	notifications: NotificationSettings;
	security: SecuritySettings;
	roles: Record<Role, Permission[]>;
}

export const DEFAULT_SETTINGS: AppSettings = {
	general: {
		orgName: 'Acme Corporation',
		supportEmail: 'support@acme.com',
		defaultDepartment: 'HR',
		timezone: 'UTC'
	},
	documents: {
		maxUploadSizeMb: 25,
		allowedFileTypes: '.pdf, .docx, .xlsx, .txt',
		enableVersioning: true,
		requireApproval: true
	},
	retention: {
		autoArchiveEnabled: false,
		archiveAfterDays: 365,
		purgeDeletedAfterDays: 30
	},
	notifications: {
		notifySubmitted: true,
		notifyAssigned: true,
		weeklyDigest: false
	},
	security: {
		sessionTimeoutMinutes: 30,
		require2fa: false
	},
	roles: {
		admin: ['view', 'upload', 'approve', 'delete'],
		editor: ['view', 'upload'],
		viewer: ['view']
	}
};

/**
 * Section-wise merge over the defaults. A plain spread of the stored object
 * would leave any key added in a later release `undefined` for everyone who
 * already has settings saved, which surfaces as blank inputs and NaN numbers.
 *
 * Shared by the client store and the server, which keeps its copy in the DB.
 */
export function withDefaults(stored: Partial<AppSettings> | null | undefined): AppSettings {
	if (!stored) return structuredClone(DEFAULT_SETTINGS);

	return {
		general: { ...DEFAULT_SETTINGS.general, ...stored.general },
		documents: { ...DEFAULT_SETTINGS.documents, ...stored.documents },
		retention: { ...DEFAULT_SETTINGS.retention, ...stored.retention },
		notifications: { ...DEFAULT_SETTINGS.notifications, ...stored.notifications },
		security: { ...DEFAULT_SETTINGS.security, ...stored.security },
		roles: { ...DEFAULT_SETTINGS.roles, ...stored.roles }
	};
}

/**
 * `.pdf, docx , .TXT` -> `['.pdf', '.docx', '.txt']`.
 * Tolerates a missing leading dot and stray whitespace, because the admin types
 * this by hand into a free-text field.
 */
export function parseAllowedTypes(raw: string): string[] {
	return raw
		.split(',')
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean)
		.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
}

/** The same list in the form an `<input type="file" accept>` expects. */
export function toAcceptAttribute(raw: string): string {
	return parseAllowedTypes(raw).join(',');
}

export function fileExtension(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot === -1 ? '' : name.slice(dot).toLowerCase();
}
