// Schema shapes (§8.1). These are the *compiled* forms -- what the schema engine
// produces after resolving `extends`, filling defaults and normalising type
// names. The raw YAML the user writes is deliberately looser than this.

export type PropertyKind =
	| "string"
	| "number"
	| "integer"
	| "boolean"
	| "date"
	| "enum"
	| "list"
	| "link"
	| "links"
	| "any";

export interface PropertyDef {
	name: string;
	kind: PropertyKind;
	required: boolean;
	description?: string;
	/** Only for `enum`. Compared case-insensitively; the reported message quotes
	 * the values as the schema wrote them. */
	values?: string[];
	/** Item kind for `list`. */
	items?: PropertyKind;
	/** Only for `link`/`links`: the entity type the target should be. */
	targetTypes?: string[];
	default?: unknown;
	min?: number;
	max?: number;
	/** Anchored full-match regex source, for `string`. */
	pattern?: string;
}

export interface RelationshipDef {
	name: string;
	inverse?: string;
	target?: string;
	cardinality: "one" | "many";
	description?: string;
}

export interface EntitySchema {
	/** Normalised type name -- the value that must appear in a note's `type`. */
	type: string;
	/** The type name as the schema file wrote it, for messages. */
	rawType: string;
	description?: string;
	/** Schema version. Bumping it is how a migration announces itself; the
	 * linter reports notes still carrying an older `schema_version`. */
	version: number;
	/** Normalised type of the schema this one extends. */
	extends?: string;
	/** Default folder for notes created from this schema. */
	folder?: string;
	properties: Map<string, PropertyDef>;
	relationships: Map<string, RelationshipDef>;
	/** False turns an undeclared property into a finding. Default true, because
	 * a vault that predates its schemas is the normal case and a fresh schema
	 * should not light up every note in the folder. */
	additionalProperties: boolean;
	/** Where this schema was read from, for the "which file do I edit" question. */
	source: string;
}

/** A problem in a schema *file*, as opposed to a note. Reported separately: a
 * broken schema silently disabling validation for a whole entity type is the
 * failure mode this exists to prevent. */
export interface SchemaProblem {
	source: string;
	schema?: string;
	message: string;
}

export interface CompiledSchemas {
	byType: Map<string, EntitySchema>;
	problems: SchemaProblem[];
}
