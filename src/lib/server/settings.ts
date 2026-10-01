import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { AuthUser } from '$lib/auth/types';
import { ALL_PERMISSIONS } from '$lib/permissions';
import { db, schema } from '$lib/server/db';
import { logActivity } from '$lib/server/activity';
import {
	ROLES,
	withDefaults,
	type AppSettings,
	type Permission
} from '$lib/settings/types';

/** The organization's settings as stored by the server (seeded from `DEFAULT_SETTINGS`). */
export function getAppSettings(): AppSettings {
	const row = db
		.select({ value: schema.settings.value })
		.from(schema.settings)
		.where(eq(schema.settings.key, 'app'))
		.get();
	return withDefaults(row?.value as Partial<AppSettings> | undefined);
}

/** Upsert without validation or audit; for callers that already did both. */
export function writeAppSettings(next: AppSettings) {
	db.insert(schema.settings)
		.values({ key: 'app', value: next })
		.onConflictDoUpdate({ target: schema.settings.key, set: { value: next } })
		.run();
}

// ---- Validation ---------------------------------------------------------------

type Section = Record<string, unknown>;

function section(input: Section, key: string): Section {
	const value = input[key];
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		error(400, `settings.${key} must be an object`);
	}
	return value as Section;
}

function text(s: Section, path: string, key: string, max: number): string {
	const value = s[key];
	if (typeof value !== 'string') error(400, `${path}.${key} must be text`);
	const trimmed = value.trim();
	if (trimmed.length > max) error(400, `${path}.${key} can be at most ${max} characters`);
	return trimmed;
}

function int(s: Section, path: string, key: string, min: number, max: number): number {
	const value = s[key];
	if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
		error(400, `${path}.${key} must be a whole number from ${min} to ${max}`);
	}
	return value;
}

function bool(s: Section, path: string, key: string): boolean {
	const value = s[key];
	if (typeof value !== 'boolean') error(400, `${path}.${key} must be true or false`);
	return value;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isTimeZone(zone: string) {
	try {
		new Intl.DateTimeFormat('en', { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/**
 * Checks a whole settings object from the client. Every field is required, so
 * a client built against an older shape fails loudly instead of silently
 * resetting what it didn't send.
 */
export function parseAppSettings(input: unknown): AppSettings {
	if (!input || typeof input !== 'object') error(400, 'Expected a settings object');
	const root = input as Section;

	const g = section(root, 'general');
	const general = {
		orgName: text(g, 'general', 'orgName', 120),
		supportEmail: text(g, 'general', 'supportEmail', 254),
		defaultDepartment: text(g, 'general', 'defaultDepartment', 100),
		timezone: text(g, 'general', 'timezone', 64)
	};
	if (!general.orgName) error(400, 'Organization name is required');
	if (general.supportEmail && !EMAIL.test(general.supportEmail)) {
		error(400, 'Support email is not a valid address');
	}
	if (!isTimeZone(general.timezone)) error(400, `Unknown time zone "${general.timezone}"`);
	if (general.defaultDepartment) {
		const found = db
			.select({ id: schema.departments.id })
			.from(schema.departments)
			.where(eq(schema.departments.name, general.defaultDepartment))
			.get();
		if (!found) error(400, `Unknown department "${general.defaultDepartment}"`);
	}

	const d = section(root, 'documents');
	const documents = {
		maxUploadSizeMb: int(d, 'documents', 'maxUploadSizeMb', 1, 10_240),
		allowedFileTypes: text(d, 'documents', 'allowedFileTypes', 500),
		enableVersioning: bool(d, 'documents', 'enableVersioning'),
		requireApproval: bool(d, 'documents', 'requireApproval')
	};

	const r = section(root, 'retention');
	const retention = {
		autoArchiveEnabled: bool(r, 'retention', 'autoArchiveEnabled'),
		archiveAfterDays: int(r, 'retention', 'archiveAfterDays', 1, 36_500),
		purgeDeletedAfterDays: int(r, 'retention', 'purgeDeletedAfterDays', 1, 36_500)
	};

	const n = section(root, 'notifications');
	const notifications = {
		notifySubmitted: bool(n, 'notifications', 'notifySubmitted'),
		notifyAssigned: bool(n, 'notifications', 'notifyAssigned'),
		weeklyDigest: bool(n, 'notifications', 'weeklyDigest')
	};

	const s = section(root, 'security');
	const security = {
		// Up to a week; 0 would mean sessions that never idle out.
		sessionTimeoutMinutes: int(s, 'security', 'sessionTimeoutMinutes', 5, 10_080),
		// No second factor exists yet, so it can't be switched on.
		require2fa: false
	};

	const rolesIn = section(root, 'roles');
	const roles = Object.fromEntries(
		ROLES.map((role) => {
			// Admins always hold everything; see resolvePermissions.
			if (role === 'admin') return [role, [...ALL_PERMISSIONS]];
			const list = rolesIn[role];
			if (!Array.isArray(list)) error(400, `roles.${role} must be a list of permissions`);
			for (const p of list) {
				if (!ALL_PERMISSIONS.includes(p as Permission)) error(400, `Unknown permission "${p}"`);
			}
			// Canonical order, so an unchanged matrix never shows up as a change.
			return [role, ALL_PERMISSIONS.filter((p) => list.includes(p))];
		})
	) as AppSettings['roles'];

	return { general, documents, retention, notifications, security, roles };
}

// ---- Saving -------------------------------------------------------------------

/** `{ 'documents.maxUploadSizeMb': [25, 50], 'roles.editor': [[…], […]] }` */
export function diffSettings(before: AppSettings, after: AppSettings) {
	const changes: Record<string, [unknown, unknown]> = {};
	for (const key of Object.keys(after) as (keyof AppSettings)[]) {
		const a = before[key] as Record<string, unknown>;
		const b = after[key] as Record<string, unknown>;
		for (const field of Object.keys(b)) {
			if (JSON.stringify(a[field]) !== JSON.stringify(b[field])) {
				changes[`${key}.${field}`] = [a[field], b[field]];
			}
		}
	}
	return changes;
}

export function saveAppSettings(user: AuthUser, input: unknown): AppSettings {
	const next = parseAppSettings(input);
	const before = getAppSettings();
	const changes = diffSettings(before, next);
	if (!Object.keys(changes).length) return before;

	db.transaction(() => {
		writeAppSettings(next);
		logActivity({
			action: 'edited',
			actor: user,
			targetType: 'settings',
			targetId: 'app',
			target: 'Settings',
			details: `Changed ${Object.keys(changes).join(', ')}`,
			metadata: { changes }
		});
	});
	return next;
}

/** Keeps `general.defaultDepartment`, which is stored by name, in step with a rename. */
export function renameDefaultDepartment(from: string, to: string) {
	const current = getAppSettings();
	if (current.general.defaultDepartment !== from) return;
	writeAppSettings({ ...current, general: { ...current.general, defaultDepartment: to } });
}
