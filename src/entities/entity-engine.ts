// Queries over the index (§23). Pure -- everything takes a WorldIndex and
// returns plain data, so the dashboard, the modals and the future public API
// (§30) all read the vault the same way.

import type { EntityRecord, RelationshipRef, WorldIndex } from "../core/types";
import { normaliseCanon } from "../canon/canon-engine";
import { normaliseType } from "../schema/schema-engine";
import { linkText } from "../relationships/relationship-engine";

export interface EntityFilter {
	type?: string;
	canon?: string;
	folder?: string;
	tag?: string;
	/** `{ status: "alive" }` -- compared as strings, case-insensitively, because
	 * the point is to find notes, not to be a type system. */
	props?: Record<string, string>;
	/** Substring match against title, basename and id. */
	text?: string;
	/** Only notes carrying a relationship of this type. */
	relationship?: string;
	/** Only notes with a relationship pointing at this path. */
	relatedTo?: string;
}

function propMatches(record: EntityRecord, key: string, want: string): boolean {
	const value = record.props[key];
	if (value === undefined || value === null) return false;
	const values = Array.isArray(value) ? value : [value];
	return values.some((v) => String(v).trim().toLowerCase() === want.trim().toLowerCase());
}

export function matches(record: EntityRecord, filter: EntityFilter): boolean {
	if (filter.type && record.type !== normaliseType(filter.type)) return false;
	if (filter.canon && record.canon !== normaliseCanon(filter.canon)) return false;
	if (filter.folder && !record.path.startsWith(filter.folder.replace(/\/$/, "") + "/")) return false;
	if (filter.tag && !record.tags.some((t) => t.toLowerCase() === filter.tag!.replace(/^#/, "").toLowerCase())) return false;
	if (filter.relationship && !record.relationships.some((r) => r.type === filter.relationship)) return false;
	if (filter.relatedTo && !record.relationships.some((r) => r.target === filter.relatedTo)) return false;
	if (filter.props) {
		for (const [key, want] of Object.entries(filter.props)) {
			if (!propMatches(record, key, want)) return false;
		}
	}
	if (filter.text) {
		const needle = filter.text.toLowerCase();
		const hay = `${record.title} ${record.basename} ${record.id ?? ""}`.toLowerCase();
		if (!hay.includes(needle)) return false;
	}
	return true;
}

/** All filters combine with AND, which is what §23's example asks for. */
export function find(index: WorldIndex, filter: EntityFilter): EntityRecord[] {
	const out: EntityRecord[] = [];
	for (const record of index.entities.values()) if (matches(record, filter)) out.push(record);
	return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** Notes carrying a `type`. The rest of the vault is indexed but is not an
 * entity, and counting it as one would make every statistic meaningless in a
 * vault that is 90% journal. */
export function entities(index: WorldIndex): EntityRecord[] {
	return [...index.entities.values()].filter((r) => r.type !== null);
}

export function countByType(index: WorldIndex): Map<string, number> {
	const counts = new Map<string, number>();
	for (const record of index.entities.values()) {
		if (!record.type) continue;
		counts.set(record.type, (counts.get(record.type) ?? 0) + 1);
	}
	return new Map([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

/** Everything connected to one note, from both ends. Inverse edges are marked
 * `inferred` so the UI can say where they came from -- an edge the user cannot
 * find in the file is otherwise indistinguishable from a bug. */
export function related(index: WorldIndex, path: string): { outgoing: RelationshipRef[]; incoming: RelationshipRef[] } {
	const record = index.entities.get(path);
	return {
		outgoing: record ? record.relationships : [],
		incoming: index.inbound.get(path) ?? [],
	};
}

/** Notes nothing points at and which point at nothing (§10.1). Embeds count as
 * links -- they are in `links` too -- and so do relationships, which is the case
 * that matters: a note connected only through frontmatter is connected. */
export function orphans(index: WorldIndex): EntityRecord[] {
	const out: EntityRecord[] = [];
	for (const record of index.entities.values()) {
		const inbound = index.backlinks.get(record.path);
		if (inbound && inbound.size > 0) continue;
		if (record.links.length > 0 || record.relationships.length > 0) continue;
		out.push(record);
	}
	return out;
}

/** Every link in the vault that resolves to nothing, with the note that made it. */
export function brokenLinks(index: WorldIndex): Array<{ from: string; raw: string; embed: boolean }> {
	const out: Array<{ from: string; raw: string; embed: boolean }> = [];
	for (const record of index.entities.values()) {
		for (const link of record.links) {
			if (link.target) continue;
			out.push({ from: record.path, raw: linkText(link.raw), embed: link.embed });
		}
	}
	return out;
}
