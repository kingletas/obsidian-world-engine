// Lifts a note's nested `relationships:` block into top-level list properties.

import { normaliseRelType } from "./relationship-engine";

export interface FlattenResult {
	changed: boolean;
	/** Relationship targets lifted into top-level properties. */
	lifted: number;
	/** Kinds left inside the block, each with the reason it could not move. */
	kept: Array<{ kind: string; reason: string }>;
}

/** Flatten one note's map-form relationship block in place; metadata forms and unmergeable
 * collisions stay in the block and are reported. */
export function flattenRelationships(frontmatter: Record<string, unknown>, relProperty: string): FlattenResult {
	const result: FlattenResult = { changed: false, lifted: 0, kept: [] };
	const block = frontmatter[relProperty];

	if (Array.isArray(block)) {
		if (block.length > 0) result.kept.push({ kind: relProperty, reason: "list form — entries carry their own type and metadata" });
		return result;
	}
	if (!block || typeof block !== "object") return result;

	const map = block as Record<string, unknown>;
	for (const [kind, value] of Object.entries(map)) {
		if (value && typeof value === "object" && !Array.isArray(value)) {
			result.kept.push({ kind, reason: "single-target metadata form — a flat list has nowhere to put the metadata" });
			continue;
		}

		const targets = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === "string" && v.trim() !== "");
		const name = normaliseRelType(kind);
		const existing = frontmatter[name];

		let merged: string[];
		if (existing === undefined || existing === null) merged = [];
		else if (typeof existing === "string") merged = [existing];
		else if (Array.isArray(existing)) merged = existing.map((v) => String(v));
		else {
			result.kept.push({ kind, reason: `top-level \`${name}\` already holds a ${typeof existing}` });
			continue;
		}

		for (const target of targets) if (!merged.includes(target)) merged.push(target);
		frontmatter[name] = merged;
		delete map[kind];
		result.lifted += targets.length;
		result.changed = true;
	}

	if (Object.keys(map).length === 0) {
		delete frontmatter[relProperty];
		result.changed = true; // an emptied (or already-empty) block is removed, not left as `relationships: {}`
	}
	return result;
}
