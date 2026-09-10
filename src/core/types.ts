// The record types the plugin reads, each derived from a Markdown file and safe to discard.

export type Severity = "error" | "warning" | "info";

/** One finding. The linter, the schema validator and the relationship engine all
 * emit this shape, so the results pane has exactly one renderer to maintain. */
export interface Issue {
	/** Vault-relative path of the note the finding is about. */
	path: string;
	/** Stable code, `WE###`. Used for muting a rule and for the tests. */
	code: string;
	/** Rule id, kebab-case. Matches the key in the settings' rule map. */
	rule: string;
	severity: Severity;
	message: string;
	/** Frontmatter property the finding is about, when there is one. The UI uses
	 * it to put the cursor on the right line without the rule having to know how
	 * many lines the frontmatter block occupies. */
	property?: string;
	/** What the user should do. Kept separate from `message` so a list of
	 * findings stays scannable and the fix only shows on the expanded row. */
	hint?: string;
}

/** A wikilink or embed found in a note, with the resolution result attached.
 * `target` is null when nothing in the vault answers to `raw`, which is what a
 * broken link is -- there is no separate "broken" flag to fall out of sync. */
export interface LinkRef {
	raw: string;
	display: string | null;
	target: string | null;
	embed: boolean;
}

/** A parsed relationship. `raw` is kept verbatim because the linter reports it
 * back to the user, and a normalised form they never typed reads as a bug. */
export interface RelationshipRef {
	/** Vault-relative path of the note that declares the relationship. */
	from: string;
	/** Normalised relationship type, e.g. `member_of`. */
	type: string;
	raw: string;
	/** Resolved target path, or null when the link does not resolve. */
	target: string | null;
	/** Everything on the relationship other than target and type -- `since`,
	 * `status`, and whatever else the user put there (§12.1). */
	meta: Record<string, unknown>;
	/** True when this ref was inferred from another note's declaration rather
	 * than written in this note's frontmatter. Inverse edges are never written
	 * back to Markdown; they exist only in the index. */
	inferred?: boolean;
}

/** The indexed form of one Markdown note. */
export interface EntityRecord {
	path: string;
	basename: string;
	/** Normalised `type`. Null for a note that declares none -- most of a real
	 * vault. A note without a type is still indexed, because broken links and
	 * orphans matter there too. */
	type: string | null;
	/** The type exactly as written, for the "you wrote `Character`, the schema is
	 * `character`" message. */
	rawType: string | null;
	/** Explicit `id`, or null. Not synthesised from the path: a duplicate-id
	 * check that invents the ids it compares would never find anything. */
	id: string | null;
	title: string;
	/** Normalised canon state, or null when the note declares none. */
	canon: string | null;
	rawCanon: string | null;
	/** Frontmatter, verbatim. */
	props: Record<string, unknown>;
	/** True when the file has a frontmatter block at all. */
	hasFrontmatter: boolean;
	relationships: RelationshipRef[];
	links: LinkRef[];
	/** Tags from frontmatter and body, without the leading `#`. */
	tags: string[];
	mtime: number;
	size: number;
	/** Body length in characters, frontmatter excluded. Drives the empty-note
	 * check and the dashboard's word count, and is cheap enough to keep for
	 * every note. */
	bodyChars: number;
	words: number;
	headings: number;
}

/** The whole derived index. Rebuildable from the vault in full, always. */
export interface WorldIndex {
	/** Keyed by vault-relative path. */
	entities: Map<string, EntityRecord>;
	/** path -> paths that link to it. Built once per index pass rather than
	 * recomputed per query; the orphan check and the dashboard both want it. */
	backlinks: Map<string, Set<string>>;
	/** path -> relationships pointing *at* this note, inverted. */
	inbound: Map<string, RelationshipRef[]>;
	builtAt: number;
}

export function emptyIndex(): WorldIndex {
	return { entities: new Map(), backlinks: new Map(), inbound: new Map(), builtAt: 0 };
}
