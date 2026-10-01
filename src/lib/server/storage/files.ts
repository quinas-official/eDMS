import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { env } from '$env/dynamic/private';

/**
 * Uploaded files live on disk under STORAGE_DIR, named by a server-generated
 * key (never the user's file name), fanned out by the key's first two
 * characters so no single directory grows huge. The database holds everything
 * else about the file.
 */

const STORAGE_DIR = resolve(env.STORAGE_DIR || 'data/files');

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Absolute path of a stored file; for the backup, which reads them straight from disk. */
export function storagePath(key: string) {
	return pathFor(key);
}

function pathFor(key: string) {
	// Keys only ever come from `saveFile`, but a bad row must not become a path traversal.
	if (!KEY_PATTERN.test(key)) throw new Error(`Invalid storage key: ${key}`);
	return join(STORAGE_DIR, key.slice(0, 2), key);
}

export interface StoredFile {
	storageKey: string;
	size: number;
	sha256: string;
}

/**
 * Writes to a temp name first and renames into place, so a crash mid-write
 * never leaves a truncated file under a real key.
 */
export async function saveFile(bytes: Uint8Array): Promise<StoredFile> {
	const storageKey = randomUUID();
	const target = pathFor(storageKey);
	const temp = `${target}.part`;

	await mkdir(join(STORAGE_DIR, storageKey.slice(0, 2)), { recursive: true });
	await writeFile(temp, bytes, { flag: 'wx' });
	await rename(temp, target);

	return {
		storageKey,
		size: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex')
	};
}

/** A web stream of the file, or null when it's missing from disk. */
export async function openFile(storageKey: string) {
	const path = pathFor(storageKey);
	const info = await stat(path).catch(() => null);
	if (!info?.isFile()) return null;
	return {
		size: info.size,
		stream: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>
	};
}

/** Best effort: a leftover file is harmless, a failed request because of one isn't. */
export async function removeFile(storageKey: string) {
	await rm(pathFor(storageKey), { force: true }).catch(() => {});
}
