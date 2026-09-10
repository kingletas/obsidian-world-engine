// Turns one file's already-parsed metadata into an EntityRecord. Pure: it takes
// a plain input object and a link resolver, so the tests drive it directly and
// nothing about Obsidian's cache shape leaks past this file.

import type { EntityRecord, LinkRef } from "./types";
import { normaliseCanon } from "../canon/canon-engine";
import { linkText, parseRelationships, type LinkResolver } from "../relationships/relationship-engine";
import { normaliseType } from "../schema/schema-engine";

/** What the indexer hands over. Mirrors what Obsidian's metadata cache provides
 * plus the file stat, and nothing else. */
export interface ParseInput {
	path: string;
	basename: string;
	frontmatter: Record<string, unknown> | null;
	/** Raw link text for every wikilink and markdown link in the note. */
	links: Array<{ link: string; displayText?: string }>;
	embeds: Array<{ link: string; displayText?: string }>;
	tags: string[];
	headings: number;
	/** Body only -- frontmatter already removed. */
	body: string;
	mtime: number;
	size: number;
}

export interface ParseOptions {
	typeProperty: string;
	canonProperty: string;
	idProperty: string;
	titleProperty: string;
	relationshipProperty: string;
	/** Top-level properties that are relationships in disguise (§39's
	 * `location:` and `participants:`). */
	inlineRelationshipTypes: string[];
	/** Read when `typeProperty` is absent. `entity_type` by default, because
	 * §2.1's whole example is a vault that used both. */
	typeFallbacks: string[];
}

export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
	typeProperty: "type",
	canonProperty: "canon_status",
	idProperty: "id",
	titleProperty: "title",
	relationshipProperty: "relationships",
	inlineRelationshipTypes: ["location", "participants", "faction", "member_of", "parent", "part_of"],
	typeFallbacks: ["entity_type", "note_type"],
};

function firstString(fm: Record<string, unknown>, keys: string[]): string | null {
	for (const key of keys) {
		const value = fm[key];
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number") return String(value);
	}
	return null;
}

function countWords(body: string): number {
	const matched = body.match(/[\p{L}\p{N}'’-]+/gu);
	return matched ? matched.length : 0;
}

export function parseNote(input: ParseInput, resolve: LinkResolver, options: ParseOptions): EntityRecord {
	const fm = input.frontmatter ?? {};

	const rawType = firstString(fm, [options.typeProperty, ...options.typeFallbacks]);
	const rawCanonValue = fm[options.canonProperty];
	// A bare `canon: true` is read only when `canon_status` is absent.
	const rawCanon =
		rawCanonValue !== undefined && rawCanonValue !== null
			? String(rawCanonValue)
			: fm.canon !== undefined && fm.canon !== null
				? String(fm.canon)
				: null;

	const idValue = fm[options.idProperty];
	const titleValue = fm[options.titleProperty];

	// Every link goes through `linkText` first, so a table-escaped `[[Note\|alias]]` resolves.
	const links: LinkRef[] = [
		...input.links.map((l) => ({ raw: l.link, display: l.displayText ?? null, target: resolve(linkText(l.link), input.path), embed: false })),
		...input.embeds.map((l) => ({ raw: l.link, display: l.displayText ?? null, target: resolve(linkText(l.link), input.path), embed: true })),
	];

	const body = input.body ?? "";

	return {
		path: input.path,
		basename: input.basename,
		type: rawType ? normaliseType(rawType) : null,
		rawType,
		id: typeof idValue === "string" && idValue.trim() ? idValue.trim() : typeof idValue === "number" ? String(idValue) : null,
		title: typeof titleValue === "string" && titleValue.trim() ? titleValue.trim() : input.basename,
		canon: normaliseCanon(rawCanon),
		rawCanon,
		props: fm,
		hasFrontmatter: input.frontmatter !== null,
		relationships: parseRelationships(input.path, fm, resolve, {
			relProperty: options.relationshipProperty,
			inlineTypes: options.inlineRelationshipTypes,
		}),
		links,
		tags: input.tags.map((t) => t.replace(/^#/, "")),
		mtime: input.mtime,
		size: input.size,
		bodyChars: body.trim().length,
		words: countWords(body),
		headings: input.headings,
	};
}

/** Strip a leading YAML frontmatter block. Used only for the word/character
 * counts -- the properties themselves always come from Obsidian's parse, never
 * from this. Two separate YAML readers disagreeing is a bug generator. */
export function stripFrontmatter(text: string): string {
	if (!text.startsWith("---")) return text;
	const end = text.indexOf("\n---", 3);
	if (end < 0) return text;
	const after = text.indexOf("\n", end + 1);
	return after < 0 ? "" : text.slice(after + 1);
}

/** Re-run link resolution over a record restored from the snapshot, so its targets match the current vault. */
export function reresolveLinks(record: EntityRecord, resolve: LinkResolver): EntityRecord {
	return {
		...record,
		links: record.links.map((link) => ({ ...link, target: resolve(linkText(link.raw), record.path) })),
		relationships: record.relationships.map((ref) => ({ ...ref, target: resolve(linkText(ref.raw), record.path) })),
	};
}
