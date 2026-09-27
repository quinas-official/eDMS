import { json } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { requireUser } from '$lib/server/auth/guard';
import { db, schema } from '$lib/server/db';
import type { RequestHandler } from './$types';

/** Every department, by name. Any signed-in user needs them to file and filter documents. */
export const GET: RequestHandler = (event) => {
	requireUser(event);
	const { departments } = schema;
	const rows = db
		.select({
			id: departments.id,
			name: departments.name,
			description: departments.description
		})
		.from(departments)
		.orderBy(asc(departments.name))
		.all();
	return json({ departments: rows });
};
