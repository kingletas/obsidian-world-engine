// Compiles already-parsed schema objects into the shapes the validator uses.

import type {
	CompiledSchemas,
	EntitySchema,
	PropertyDef,
	PropertyKind,
	RelationshipDef,
	SchemaProblem,
} from "./types";
import { normaliseRelType } from "../relationships/relationship-engine";

const KINDS: PropertyKind[] = [
	"string",
	"number",
	"integer",
	"boolean",
	"date",
	"enum",
	"list",
	"link",
	"links",
	"any",
];

/** Normalise an entity type name. `Story Thread`, `story-thread` and
 * `StoryThread` all become `story_thread`; the vault will contain all three,
 * because §2.1 is a description of what actually happens to a growing vault. */
export function normaliseType(value: string): string {
	return normaliseRelType(value);
}

/** One raw schema file's contents. Either a map of `TypeName: definition` (the
 * form §8.1 shows), or a single definition carrying its own `type:`. */
export interface RawSchemaFile {
	source: string;
	data: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function asStringList(value: unknown): string[] {
	if (value === null || value === undefined) return [];
	const items = Array.isArray(value) ? value : [value];
	return items.filter((v) => typeof v === "string" || typeof v === "number").map((v) => String(v));
}

function compileProperty(
	name: string,
	raw: unknown,
	required: boolean,
	problems: SchemaProblem[],
	source: string,
	schemaName: string
): PropertyDef {
	// A bare `age: number` is allowed. It is what people write first, and
	// rejecting it would make the shortest schema the wrong one.
	if (typeof raw === "string") {
		const kind = KINDS.includes(raw as PropertyKind) ? (raw as PropertyKind) : "any";
		if (kind === "any" && raw !== "any") {
			problems.push({ source, schema: schemaName, message: `property \`${name}\`: unknown type \`${raw}\`, treated as \`any\`` });
		}
		return { name, kind, required };
	}

	const rec = asRecord(raw);
	if (!rec) return { name, kind: "any", required };

	let kind: PropertyKind = "any";
	const declared = typeof rec.type === "string" ? rec.type.trim().toLowerCase() : "";
	if (declared) {
		if (KINDS.includes(declared as PropertyKind)) kind = declared as PropertyKind;
		else problems.push({ source, schema: schemaName, message: `property \`${name}\`: unknown type \`${declared}\`, treated as \`any\`` });
	}

	const values = asStringList(rec.values ?? rec.enum);
	// `values:` without `type: enum` is unambiguous, and demanding both is the
	// kind of ceremony that makes people give up on schemas.
	if (values.length && kind === "any") kind = "enum";
	if (kind === "enum" && !values.length) {
		problems.push({ source, schema: schemaName, message: `property \`${name}\`: enum with no \`values\`, treated as \`string\`` });
		kind = "string";
	}

	const items = typeof rec.items === "string" && KINDS.includes(rec.items as PropertyKind) ? (rec.items as PropertyKind) : undefined;

	const def: PropertyDef = {
		name,
		kind,
		required: required || rec.required === true,
		description: typeof rec.description === "string" ? rec.description : undefined,
		values: values.length ? values : undefined,
		items,
		targetTypes: asStringList(rec.target ?? rec.targets ?? rec.targetTypes).map(normaliseType),
		default: rec.default,
		min: typeof rec.min === "number" ? rec.min : undefined,
		max: typeof rec.max === "number" ? rec.max : undefined,
		pattern: typeof rec.pattern === "string" ? rec.pattern : undefined,
	};
	if (!def.targetTypes?.length) delete def.targetTypes;
	return def;
}

function compileRelationship(name: string, raw: unknown): RelationshipDef {
	const rec = asRecord(raw) ?? {};
	const target = typeof rec.target === "string" ? normaliseType(rec.target) : undefined;
	return {
		name: normaliseRelType(name),
		inverse: typeof rec.inverse === "string" ? normaliseRelType(rec.inverse) : undefined,
		target,
		cardinality: rec.cardinality === "one" ? "one" : "many",
		description: typeof rec.description === "string" ? rec.description : undefined,
	};
}

function compileOne(
	rawType: string,
	raw: unknown,
	source: string,
	problems: SchemaProblem[]
): EntitySchema | null {
	const rec = asRecord(raw);
	if (!rec) {
		problems.push({ source, schema: rawType, message: "schema is not a mapping" });
		return null;
	}

	const requiredNames = new Set(asStringList(rec.required));
	const properties = new Map<string, PropertyDef>();
	const propsRec = asRecord(rec.properties) ?? {};
	for (const [name, value] of Object.entries(propsRec)) {
		properties.set(name, compileProperty(name, value, requiredNames.has(name), problems, source, rawType));
	}
	// A name in `required:` with no entry under `properties:` is legal and means
	// "must be present, any value". Dropping it would make the shortest useful
	// schema -- `required: [name]` and nothing else -- do nothing at all.
	for (const name of requiredNames) {
		if (!properties.has(name)) properties.set(name, { name, kind: "any", required: true });
	}

	const relationships = new Map<string, RelationshipDef>();
	for (const [name, value] of Object.entries(asRecord(rec.relationships) ?? {})) {
		const def = compileRelationship(name, value);
		relationships.set(def.name, def);
	}

	return {
		type: normaliseType(rawType),
		rawType,
		description: typeof rec.description === "string" ? rec.description : undefined,
		version: typeof rec.version === "number" ? rec.version : 1,
		extends: typeof rec.extends === "string" ? normaliseType(rec.extends) : undefined,
		folder: typeof rec.folder === "string" ? rec.folder : undefined,
		properties,
		relationships,
		additionalProperties: rec.additionalProperties !== false,
		source,
	};
}

/** Fold a parent schema into a child. The child wins on every key it declares,
 * which is the only rule that makes `extends` predictable. */
function inherit(child: EntitySchema, parent: EntitySchema): EntitySchema {
	const properties = new Map(parent.properties);
	for (const [name, def] of child.properties) properties.set(name, def);
	const relationships = new Map(parent.relationships);
	for (const [name, def] of child.relationships) relationships.set(name, def);
	return {
		...child,
		properties,
		relationships,
		folder: child.folder ?? parent.folder,
		description: child.description ?? parent.description,
	};
}

export function compileSchemas(files: RawSchemaFile[]): CompiledSchemas {
	const problems: SchemaProblem[] = [];
	const flat = new Map<string, EntitySchema>();

	for (const file of files) {
		const rec = asRecord(file.data);
		if (!rec) {
			if (file.data !== null && file.data !== undefined) {
				problems.push({ source: file.source, message: "file does not contain a YAML mapping" });
			}
			continue;
		}

		// Single-schema file: `type: character` at the top level.
		const entries: Array<[string, unknown]> =
			typeof rec.type === "string" && (rec.properties !== undefined || rec.required !== undefined)
				? [[rec.type, rec]]
				: Object.entries(rec);

		for (const [name, value] of entries) {
			const schema = compileOne(name, value, file.source, problems);
			if (!schema) continue;
			const existing = flat.get(schema.type);
			if (existing) {
				problems.push({
					source: file.source,
					schema: schema.rawType,
					message: `type \`${schema.type}\` is already defined in ${existing.source}; the later definition wins`,
				});
			}
			flat.set(schema.type, schema);
		}
	}

	// Resolve `extends` after every file is in, so order does not matter and a
	// parent may live in another file.
	const byType = new Map<string, EntitySchema>();
	const resolve = (type: string, seen: string[]): EntitySchema | undefined => {
		const done = byType.get(type);
		if (done) return done;
		const schema = flat.get(type);
		if (!schema) return undefined;
		if (!schema.extends) {
			byType.set(type, schema);
			return schema;
		}
		if (seen.includes(type)) {
			problems.push({
				source: schema.source,
				schema: schema.rawType,
				message: `circular \`extends\` (${[...seen, type].join(" -> ")}); inheritance ignored for this type`,
			});
			const cut = { ...schema, extends: undefined };
			byType.set(type, cut);
			return cut;
		}
		const parent = resolve(schema.extends, [...seen, type]);
		if (!parent) {
			problems.push({
				source: schema.source,
				schema: schema.rawType,
				message: `extends \`${schema.extends}\`, which is not defined anywhere`,
			});
			const cut = { ...schema, extends: undefined };
			byType.set(type, cut);
			return cut;
		}
		const merged = inherit(schema, parent);
		byType.set(type, merged);
		return merged;
	};

	for (const type of flat.keys()) resolve(type, []);
	return { byType, problems };
}

/** Every relationship type any schema declares, flattened for the engine that
 * builds inverse edges. A type declared twice with different inverses is a
 * problem the caller reports; here, last definition wins. */
export function relationshipTypes(schemas: CompiledSchemas): Map<string, RelationshipDef> {
	const out = new Map<string, RelationshipDef>();
	for (const schema of schemas.byType.values()) {
		for (const [name, def] of schema.relationships) out.set(name, def);
	}
	return out;
}
