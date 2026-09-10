// Builds the backlink and inbound-relationship maps from a set of records.

import type { EntityRecord, RelationshipRef, WorldIndex } from "./types";
import { buildInbound, type RelationshipTypeDef } from "../relationships/relationship-engine";

export function assemble(
	records: Map<string, EntityRecord>,
	relationshipTypes: Map<string, RelationshipTypeDef>,
	now: number = Date.now()
): WorldIndex {
	const backlinks = new Map<string, Set<string>>();
	const all: RelationshipRef[] = [];

	const link = (target: string, from: string): void => {
		const set = backlinks.get(target);
		if (set) set.add(from);
		else backlinks.set(target, new Set([from]));
	};

	for (const record of records.values()) {
		for (const ref of record.links) if (ref.target) link(ref.target, record.path);
		for (const ref of record.relationships) {
			all.push(ref);
			// A relationship also counts as a backlink, so a note reached only through
			// frontmatter is not an orphan.
			if (ref.target) link(ref.target, record.path);
		}
	}

	return { entities: records, backlinks, inbound: buildInbound(all, relationshipTypes), builtAt: now };
}
