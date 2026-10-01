import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '$lib/auth/types';
import { DEFAULT_SETTINGS, type AppSettings } from '$lib/settings/types';

// A fresh in-memory database; mocked because SvelteKit fills $env from .env.
vi.mock('$env/dynamic/private', () => ({ env: { DATABASE_URL: ':memory:' } }));

const { db, runMigrations, schema } = await import('$lib/server/db');
const { getAppSettings, saveAppSettings, writeAppSettings } = await import('./settings');
const departments = await import('./departments');

let admin: AuthUser;

/** The HTTP status a SvelteKit `error()` inside `fn` would send. */
function statusOf(fn: () => unknown): number | undefined {
	try {
		fn();
	} catch (err) {
		return (err as { status?: number }).status;
	}
	return undefined;
}

function settingsWith(patch: (s: AppSettings) => void): AppSettings {
	const next = structuredClone(getAppSettings());
	patch(next);
	return next;
}

function auditFor(targetType: string) {
	return db
		.select()
		.from(schema.activityLog)
		.all()
		.filter((e) => e.targetType === targetType);
}

beforeAll(() => {
	expect(db.$client.name).toBe(':memory:');
	runMigrations(db);
	db.insert(schema.departments).values([{ name: 'HR' }, { name: 'IT' }]).run();
	const row = db
		.insert(schema.users)
		.values({ username: 'admin', name: 'Admin', passwordHash: 'x', role: 'admin' })
		.returning()
		.get();
	admin = {
		id: row.id,
		username: row.username,
		name: row.name,
		role: 'admin',
		departmentId: null,
		department: null,
		permissions: ['view', 'upload', 'approve', 'delete']
	};
});

beforeEach(() => writeAppSettings(structuredClone(DEFAULT_SETTINGS)));

describe('saveAppSettings', () => {
	it('stores valid settings and audit-logs only what changed', () => {
		const before = auditFor('settings').length;
		const saved = saveAppSettings(
			admin,
			settingsWith((s) => {
				s.documents.maxUploadSizeMb = 50;
				s.documents.requireApproval = false;
			})
		);
		expect(saved.documents.maxUploadSizeMb).toBe(50);
		expect(getAppSettings().documents.requireApproval).toBe(false);

		const entries = auditFor('settings');
		expect(entries).toHaveLength(before + 1);
		expect(Object.keys(entries.at(-1)!.metadata!.changes as object).sort()).toEqual([
			'documents.maxUploadSizeMb',
			'documents.requireApproval'
		]);
	});

	it('writes nothing when nothing changed', () => {
		const before = auditFor('settings').length;
		saveAppSettings(admin, getAppSettings());
		expect(auditFor('settings')).toHaveLength(before);
	});

	it('rejects out-of-range numbers, unknown departments and missing sections', () => {
		const bad = [
			settingsWith((s) => (s.documents.maxUploadSizeMb = 0)),
			settingsWith((s) => (s.security.sessionTimeoutMinutes = 1.5)),
			settingsWith((s) => (s.general.defaultDepartment = 'Nope')),
			settingsWith((s) => (s.general.timezone = 'Mars/Olympus')),
			settingsWith((s) => (s.roles.editor = ['view', 'fly' as never])),
			{ ...getAppSettings(), retention: undefined }
		];
		for (const input of bad) expect(statusOf(() => saveAppSettings(admin, input))).toBe(400);
		expect(getAppSettings()).toEqual(DEFAULT_SETTINGS);
	});

	it('always gives admins every permission and refuses 2FA', () => {
		const saved = saveAppSettings(
			admin,
			settingsWith((s) => {
				s.roles.admin = [];
				s.roles.viewer = ['upload', 'view'];
				s.security.require2fa = true;
			})
		);
		expect(saved.roles.admin).toEqual(['view', 'upload', 'approve', 'delete']);
		expect(saved.roles.viewer).toEqual(['view', 'upload']);
		expect(saved.security.require2fa).toBe(false);
	});
});

describe('departments', () => {
	it('creates one and rejects a name that differs only in case', () => {
		const created = departments.createDepartment(admin, { name: 'Legal', description: 'Law' });
		expect(created).toMatchObject({ name: 'Legal', members: [], documentCount: 0 });
		expect(statusOf(() => departments.createDepartment(admin, { name: 'legal' }))).toBe(409);
	});

	it('renames, and carries the default department in Settings along', () => {
		const hr = departments.listDepartments().find((d) => d.name === 'HR')!;
		expect(getAppSettings().general.defaultDepartment).toBe('HR');

		const renamed = departments.updateDepartment(admin, hr.id, { name: 'People' });
		expect(renamed.name).toBe('People');
		expect(renamed.isDefault).toBe(true);
		expect(getAppSettings().general.defaultDepartment).toBe('People');

		departments.updateDepartment(admin, hr.id, { name: 'HR' });
	});

	it('refuses to delete the default department or one still in use', () => {
		const list = departments.listDepartments();
		const hr = list.find((d) => d.name === 'HR')!;
		const it = list.find((d) => d.name === 'IT')!;
		expect(statusOf(() => departments.deleteDepartment(admin, hr.id))).toBe(409);

		db.insert(schema.documents)
			.values({ reference: 'IT-1', title: 'Gone', ownerId: admin.id, departmentId: it.id, deletedAt: new Date() })
			.run();
		// A deleted document still counts: restoring it would bring it back unfiled.
		expect(statusOf(() => departments.deleteDepartment(admin, it.id))).toBe(409);
	});

	it('deletes an unused department and logs it', () => {
		const temp = departments.createDepartment(admin, { name: 'Temp' });
		departments.deleteDepartment(admin, temp.id);
		expect(departments.listDepartments().some((d) => d.id === temp.id)).toBe(false);
		expect(auditFor('department').at(-1)).toMatchObject({ action: 'deleted', target: 'Temp' });
		expect(statusOf(() => departments.deleteDepartment(admin, temp.id))).toBe(404);
	});
});
