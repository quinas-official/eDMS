# eDMS — Enterprise Document Management System

A document management system for organizations on a local network (LAN). People upload documents, keep versions, move them through an approval workflow, and every action is written to an audit log. Access depends on each user's role and department.

It ships two ways, both backed by **one central server**:

- **Web app**: a SvelteKit Node server that hosts the UI and a JSON API under `/api/*`.
- **Desktop app**: a Tauri 2 app that bundles its own copy of the UI and talks to the same server over `/api/*`. *(in progress)*

> **Status:** the backend (auth, sessions, permissions, documents, activity log, settings) is real and runs on SQLite. The Documents, Departments, Users and Settings pages, login, the dashboard and the audit log use the API. **The Workflow board still uses page-local mock data** and is next.

---

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | SvelteKit 2 + Svelte 5 (runes), TypeScript |
| Server | `@sveltejs/adapter-node` (UI + `/api/*` in one process) |
| Database | SQLite (`better-sqlite3`) via Drizzle ORM; migrations in `drizzle/` |
| File storage | Local disk under `STORAGE_DIR`, SHA-256 per version |
| UI | TailwindCSS 4, shadcn-svelte style components (`bits-ui`), Lucide icons, Chart.js |
| Document previews | `mammoth` (DOCX → HTML), `diff` for text comparisons between versions |
| i18n | Paraglide (`messages/en.json`) |
| Desktop | Tauri 2 (`src-tauri/`) |
| Tests | Vitest (unit + browser), Playwright (e2e) |
| Package manager | Bun (npm also works) |

---

## Architecture

```
 Browser ──(cookie)──┐
                     ├──► SvelteKit Node server ──► SQLite (data/edms.db)
 Tauri app ─(Bearer)─┘      UI + /api/*        └──► files on disk (data/files)
```

Rules the code follows:

1. **All data goes through `/api/*`.** Pages call the API via `src/lib/api/client.ts` (`apiFetch`). Pages do not use form actions or `+page.server.ts` loads, because the Tauri app ships a static UI that cannot run them.
2. **The server enforces permissions.** A single `can(user, permission)` in `src/lib/permissions/index.ts` is shared by server and UI. The server checks it on every request. The UI uses it only to decide what to show.
3. **Two ways to authenticate, one sessions table.** The web app uses an httpOnly session cookie. The desktop app logs in with `client: "desktop"`, gets a token back, and sends `Authorization: Bearer <token>`. Session IDs are stored as SHA-256 hashes, never as the raw token.
4. **The audit log is append-only.** SQL triggers reject `UPDATE`/`DELETE` on `activity_log`.
5. **Migrations run automatically** when the server starts (`hooks.server.ts` → `runMigrations`).
6. `getApiBaseUrl()` in `src/lib/config/env.ts` is empty on the web (same origin). The desktop app will set it to the server address the user chooses.

### Roles and permissions

- Roles: `admin`, `editor`, `viewer`.
- Permissions: `view`, `upload`, `approve`, `delete`. Settings holds a matrix that maps each role to its permissions. **Admins always get every permission**, so a bad edit to the matrix can't lock everyone out.
- Users, departments and settings are admin-only (`isAdmin`).
- **Department scoping:** admins and anyone with `approve` see every department. Everyone else sees their own department's documents plus documents they own or are assigned to, and can file documents only under their own department.

### Data model (`src/lib/server/db/schema.ts`)

- `departments`: name, description
- `users`: username and email (both case-insensitively unique), password hash, role, status, department
- `sessions`: hashed token ID, user, expiry
- `documents`: reference code (e.g. `HR-2024-091`), title, description, status (`draft | pending | reviewed | approved | rejected`), department, owner, assignee, `archivedAt`, `deletedAt` (soft delete)
- `document_versions`: one row per uploaded file. Holds the storage key, original name, MIME type, size, SHA-256, extracted text (DOCX/TXT) and a note. Editing only metadata does not create a version; the change is logged instead.
- `activity_log`: action, actor (name copied in), target, details, JSON metadata (e.g. field diffs)
- `settings`: key/value; the whole `AppSettings` object is stored under `app`

---

## Project structure

```
src/
  hooks.server.ts          auth for every request, 401 for /api without a session, migrations on start
  routes/
    +page.svelte           landing / dashboard entry
    login/                 sign-in page
    admin/                 app shell (sidebar layout)
      +page.svelte         dashboard (charts, quick actions)
      documents/           documents list, upload, versions, preview   ← on the API
      workflow/            approval board (Draft → Pending → Reviewed → Approved)  ← still mock
      departments/         department management                        ← on the API
      users/               user management                              ← on the API
      settings/            org settings, role matrix, audit log         ← on the API
    api/
      health/              GET: liveness check
      auth/login|logout|me session management
      documents/...        see the API table below
      departments/         GET: list (any user; ?details=true for admins), POST/PATCH/DELETE (admin)
      settings/            GET: the settings the server enforces; PUT (admin): validate, save, audit-log
      users/               GET/POST (admin), PATCH/DELETE [id] (admin), GET assignable (editors, approvers)
      activity/            GET: system-wide audit log (admin)
  lib/
    api/                   typed client wrappers per resource (client.ts, documents.ts, …)
    server/                server-only code
      db/                  Drizzle schema, client, migrations runner
      auth/                password hashing, sessions, guards (requireUser/requireAdmin), rate limit
      documents/           document service + multipart upload handling
      storage/files.ts     reading and writing files on disk
      activity.ts          writing and listing the audit log
      settings.ts          loading, validating and saving settings
      departments.ts       department CRUD; refuses to delete one still in use
      users.ts             user CRUD; last-admin and self-lockout guards, sign-out on password reset
    permissions/           can(), resolvePermissions(), isAdmin()
    auth/ settings/ departments/ documents/   client stores (server-backed) + UI types
    components/ui/         shadcn-style primitives (button, card, input, dialog, …)
    components/site/       app components (DocumentPreview, UploadDropzone, Toaster, RelativeTime, …)
    toast/ format/ theme.ts  toasts, date formatting, light/dark theme
    storage/filesystem.ts  Tauri file access (for the desktop app)
scripts/seed.ts            creates the DB, default departments, admin (+ demo users with --demo)
drizzle/                   SQL migrations (0001 adds the append-only audit triggers)
src-tauri/                 Tauri 2 desktop shell (Rust)
e2e/                       Playwright tests
```

---

## Getting started

```sh
bun install
cp .env.example .env    # adjust paths / admin username if needed
bun run db:seed         # creates the database, default departments and the admin account
bun run dev
```

If `ADMIN_PASSWORD` is empty, `db:seed` generates an admin password and prints it. Sign in with it at `/login`. Running the seed again is safe.
To also create `editor1` and `viewer1` for trying out roles, run `bun run db:seed -- --demo`. Their passwords are printed too.

| Command | Purpose |
| --- | --- |
| `bun run dev` | Dev server |
| `bun run check` | Type-check with `svelte-check` |
| `bun run lint` / `format` | Prettier + ESLint |
| `bun run test:unit` | Vitest |
| `bun run test:e2e` | Playwright |
| `bun run db:generate` | Create a migration after editing `schema.ts` |
| `bun run db:studio` | Browse the database |

### Environment (`.env`)

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | SQLite file, default `data/edms.db` |
| `STORAGE_DIR` | Where uploaded files are stored, default `data/files` |
| `BODY_SIZE_LIMIT` | Production only. Keep it above the max upload size set in Settings; the Node default of 512K blocks most uploads |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Initial admin account, used by the seed |
| `ORIGIN`, `PORT` | Production only. The server's public LAN URL (needed for CSRF checks) and port |
| `ADDRESS_HEADER`, `XFF_DEPTH` | Behind a reverse proxy, so sign-in throttling applies per client instead of per proxy |

### Production (LAN server)

```sh
bun run build
bun run start           # node build; set ORIGIN and PORT in .env
```

Check that the server is up at `/api/health`.

---

## API

Every endpoint except `health`, `auth/login` and `auth/logout` requires a signed-in user. Errors come back as `{ message }` with a suitable HTTP status.

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/login` | JSON credentials. Sets a cookie, or returns a token when `client: "desktop"` |
| `POST` | `/api/auth/logout` | Ends the session |
| `GET` | `/api/auth/me` | Current user and their resolved permissions |
| `GET` | `/api/documents` | List. Query: `search`, `status`, `departmentId`, `deleted=true`, `page`, `pageSize` |
| `POST` | `/api/documents` | Multipart: `file`, optional `title`, `description`, `status`, `departmentId`, `note` |
| `GET` | `/api/documents/:id` | A document with all its versions |
| `PATCH` | `/api/documents/:id` | JSON: `title`, `description`, `status`, `departmentId`, `assigneeId` |
| `DELETE` | `/api/documents/:id` | Soft delete |
| `POST` | `/api/documents/:id/restore` | Undo a soft delete |
| `POST` | `/api/documents/:id/versions` | Multipart: `file`, optional `note` |
| `GET` | `/api/documents/:id/download` | Query: `version` (default latest), `inline=true` for previews |
| `GET` | `/api/documents/:id/activity` | That document's history |
| `GET` | `/api/departments` | Departments |
| `GET` | `/api/settings` | Settings the server enforces (upload limits, approval rules, role matrix) |
| `GET` | `/api/activity` | Admin only. Audit log. Query: `action`, `search`, `before` (cursor), `limit` |

---

## Roadmap

Done:

1. Server foundation (adapter-node, SQLite, Drizzle, migrations)
2. Auth, sessions, and one shared `can()` permission check
3. Documents API with disk storage, versioning and department scoping
4. Documents page moved onto the API; audit log API
5. Dashboard, settings writes, departments and users on the API

Next:

6. Move the Workflow board onto the documents API
7. Tauri static build, a server-address setting, and CORS. SvelteKit's production CSRF check rejects cross-origin multipart POSTs, so the Tauri origin must be added to `kit.csrf.trustedOrigins`.
8. Tests and CI

Later ideas: expiring access requests and approvals, full-text search over extracted text, archiving, a version rollback UI, email notifications, and a Postgres option.
