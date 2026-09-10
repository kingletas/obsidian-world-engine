// The on-disk index snapshot; any doubt about it resolves to a rebuild from the vault.

import type { EntityRecord, WorldIndex } from "./types";

/** Bumped whenever EntityRecord changes shape. A snapshot from an older version
 * is discarded, never migrated -- migrating a cache is work with no payoff when
 * regenerating it is a second of CPU. */
export const SNAPSHOT_VERSION = 1;

export interface Snapshot {
	version: number;
	/** Hash of the parse settings. Change the canon property name and every
	 * record in the snapshot is about a different question than the one now
	 * being asked, so the whole thing is dropped. */
	fingerprint: string;
	builtAt: number;
	records: EntityRecord[];
}

export function fingerprint(parts: unknown): string {
	const text = JSON.stringify(parts);
	// FNV-1a. Not a security hash -- it only has to notice that settings moved.
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i += 1) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

export function toSnapshot(index: WorldIndex, fp: string): Snapshot {
	return {
		version: SNAPSHOT_VERSION,
		fingerprint: fp,
		builtAt: index.builtAt,
		records: [...index.entities.values()],
	};
}

/** Read a snapshot back. Returns null for anything unexpected -- including an
 * older version and a different fingerprint -- and the caller rebuilds. */
export function readSnapshot(raw: string, fp: string): Snapshot | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const snapshot = parsed as Partial<Snapshot>;
	if (snapshot.version !== SNAPSHOT_VERSION) return null;
	if (snapshot.fingerprint !== fp) return null;
	if (!Array.isArray(snapshot.records)) return null;
	return {
		version: SNAPSHOT_VERSION,
		fingerprint: fp,
		builtAt: typeof snapshot.builtAt === "number" ? snapshot.builtAt : 0,
		records: snapshot.records as EntityRecord[],
	};
}

/** Which snapshot records may be reused, given what the vault looks like now.
 * A record is reusable only when the file still exists with the same mtime and
 * size. Everything else -- new, changed, or gone -- is handled by the caller. */
export function reusable(
	snapshot: Snapshot,
	current: Map<string, { mtime: number; size: number }>
): { keep: EntityRecord[]; stale: string[] } {
	const keep: EntityRecord[] = [];
	const seen = new Set<string>();
	for (const record of snapshot.records) {
		const stat = current.get(record.path);
		seen.add(record.path);
		if (!stat) continue; // Deleted since the snapshot; simply dropped.
		if (stat.mtime !== record.mtime || stat.size !== record.size) continue;
		keep.push(record);
	}
	const stale: string[] = [];
	for (const path of current.keys()) {
		if (!seen.has(path)) stale.push(path);
	}
	for (const record of snapshot.records) {
		const stat = current.get(record.path);
		if (stat && (stat.mtime !== record.mtime || stat.size !== record.size)) stale.push(record.path);
	}
	return { keep, stale };
}
