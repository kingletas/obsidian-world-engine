// Relationship parsing and resolution for both frontmatter shapes (§12, §12.1).

import type { RelationshipRef } from "../core/types";

/** Resolves a raw link target ("[[Isa Venn]]", "Isa Venn", "Characters/Isa Venn.md") to a
 * vault-relative path, or null. Supplied by the indexer, which is the only part
 * that knows about Obsidian's link resolution. */
export type LinkResolver = (raw: string, fromPath: string) => string | null;

/** Normalise a relationship type to `snake_case`. `Member Of`, `member-of` and
 * `memberOf` all become `member_of`, because the vault will contain all three
 * and they are one relationship, not three. */
export function normaliseRelType(value: string): string {
	return value
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[\s\-.]+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "")
		.toLowerCase();
}

/** Strip `[[ ]]`, an alias after `|`, and a heading or block after `#`/`^`.
 * Returns the bare link path as typed. */
export function linkText(value: string): string {
	let text = String(value).trim();
	const wiki = text.match(/^!?\[\[([^\]]+)\]\]$/);
	if (wiki) text = wiki[1];
	const md = text.match(/^!?\[[^\]]*\]\(([^)]+)\)$/);
	if (md) text = decodeURIComponent(md[1]);
	// Unescape a table-escaped pipe so `[[Note\|alias]]` splits at its alias.
	text = text.replace(/\\\|/g, "|");
	const pipe = text.indexOf("|");
	if (pipe >= 0) text = text.slice(0, pipe);
	return text.trim();
}

/** True when the value looks like a link rather than free text. Used to tell a
 * relationship list from a stray string property. */
export function looksLikeLink(value: unknown): boolean {
	return typeof value === "string" && /^!?\[\[[^\]]+\]\]/.test(value.trim());
}

function toArray(value: unknown): unknown[] {
	if (value === null || value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

const RESERVED = new Set(["target", "targets", "to", "type", "kind"]);

/** Pull every relationship out of one note's frontmatter, including `inlineTypes` written as
 * top-level properties. */
export function parseRelationships(
	fromPath: string,
	frontmatter: Record<string, unknown>,
	resolve: LinkResolver,
	options: { relProperty?: string; inlineTypes?: string[] } = {}
): RelationshipRef[] {
	const relProperty = options.relProperty ?? "relationships";
	const out: RelationshipRef[] = [];

	const push = (type: string, rawValue: unknown, meta: Record<string, unknown>): void => {
		if (typeof rawValue !== "string") return;
		const raw = rawValue.trim();
		if (!raw) return;
		out.push({
			from: fromPath,
			type: normaliseRelType(type),
			raw,
			target: resolve(linkText(raw), fromPath),
			meta,
		});
	};

	const block = frontmatter[relProperty];

	// List form: each item carries its own type and metadata.
	if (Array.isArray(block)) {
		for (const item of block) {
			if (!item || typeof item !== "object") continue;
			const rec = item as Record<string, unknown>;
			const type = rec.type ?? rec.kind;
			if (typeof type !== "string") continue;
			const meta: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(rec)) if (!RESERVED.has(k)) meta[k] = v;
			for (const t of toArray(rec.target ?? rec.targets ?? rec.to)) push(type, t, meta);
		}
	} else if (block && typeof block === "object") {
		// Map form: `knows: ["[[Isa Venn]]"]`. A value that is itself an object is
		// the single-target metadata form -- `knows: {target: ..., since: ...}`.
		for (const [type, value] of Object.entries(block as Record<string, unknown>)) {
			if (value && typeof value === "object" && !Array.isArray(value)) {
				const rec = value as Record<string, unknown>;
				const meta: Record<string, unknown> = {};
				for (const [k, v] of Object.entries(rec)) if (!RESERVED.has(k)) meta[k] = v;
				for (const t of toArray(rec.target ?? rec.targets ?? rec.to)) push(type, t, meta);
				continue;
			}
			for (const t of toArray(value)) push(type, t, {});
		}
	}

	for (const type of options.inlineTypes ?? []) {
		const value = frontmatter[type];
		for (const t of toArray(value)) if (looksLikeLink(t)) push(type, t, {});
	}

	return out;
}

/** How a relationship type behaves. Declared in a schema's `relationships:`
 * block; anything not declared still works, it is just unvalidated. */
export interface RelationshipTypeDef {
	/** The type that means the same edge read from the other end. `knows` is its
	 * own inverse; `possesses` inverts to `possessed_by`. */
	inverse?: string;
	/** Entity type the target is expected to be. */
	target?: string;
	/** `one` makes a second value on the same note a finding. */
	cardinality?: "one" | "many";
	description?: string;
}

/** Build the inbound map, including inferred inverse edges that are never written back to Markdown. */
export function buildInbound(
	all: RelationshipRef[],
	types: Map<string, RelationshipTypeDef>
): Map<string, RelationshipRef[]> {
	const inbound = new Map<string, RelationshipRef[]>();
	const add = (path: string, ref: RelationshipRef): void => {
		const list = inbound.get(path);
		if (list) list.push(ref);
		else inbound.set(path, [ref]);
	};

	for (const ref of all) {
		if (!ref.target) continue;
		add(ref.target, ref);
		const inverse = types.get(ref.type)?.inverse;
		if (!inverse) continue;
		// The inverse of a symmetric type points back at the declaring note; the
		// edge already exists from the other side if that note declares it too,
		// so it is added once, from here, and deduped by the caller if needed.
		add(ref.from, {
			from: ref.target,
			type: normaliseRelType(inverse),
			raw: ref.raw,
			target: ref.from,
			meta: ref.meta,
			inferred: true,
		});
	}
	return inbound;
}
