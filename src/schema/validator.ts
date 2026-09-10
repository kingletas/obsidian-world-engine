// Property validation (§9). Pure. Every finding names the property, the value it
// found and the values it expected, because the BRD's own example message is
// three lines of exactly that and a bare "invalid value" is useless.

import type { EntityRecord, Issue } from "../core/types";
import type { EntitySchema, PropertyDef, PropertyKind } from "./types";
import { linkText, looksLikeLink, normaliseRelType } from "../relationships/relationship-engine";

export const CODES = {
	missingRequired: "WE101",
	invalidValue: "WE102",
	wrongType: "WE103",
	unknownProperty: "WE104",
	invalidDate: "WE105",
	outOfRange: "WE106",
	patternMismatch: "WE107",
	unknownRelType: "WE110",
	cardinality: "WE111",
	wrongRelTarget: "WE112",
	schemaVersion: "WE113",
} as const;

function isEmpty(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	if (typeof value === "string") return value.trim() === "";
	if (Array.isArray(value)) return value.length === 0;
	return false;
}

/** Obsidian hands dates back as strings, and YAML hands unquoted ones back as
 * Date objects. Both are valid; a string is checked for a shape a human would
 * read as a date. Deliberately permissive about era-style fiction dates -- a
 * worldbuilding vault will contain `1312-05-09`, `1312`, `3E 452` and
 * `circa 1200`, and only the first three are worth insisting on. */
const DATE_PATTERNS = [
	// Full ISO 8601, including fractional seconds and a zone offset.
	/^-?\d{1,6}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
	/^-?\d{1,6}-\d{2}$/,
	/^-?\d{1,6}$/,
];

export function looksLikeDate(value: unknown): boolean {
	if (value instanceof Date) return !Number.isNaN(value.getTime());
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value !== "string") return false;
	const text = value.trim();
	if (!text) return false;
	return DATE_PATTERNS.some((re) => re.test(text));
}

function kindMatches(kind: PropertyKind, value: unknown): boolean {
	switch (kind) {
		case "any":
			return true;
		case "string":
			return typeof value === "string";
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "integer":
			return typeof value === "number" && Number.isInteger(value);
		case "boolean":
			return typeof value === "boolean";
		case "date":
			return looksLikeDate(value);
		case "enum":
			return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
		case "list":
			return Array.isArray(value);
		case "link":
			return looksLikeLink(value);
		case "links":
			return Array.isArray(value) ? value.every(looksLikeLink) : looksLikeLink(value);
		default:
			return true;
	}
}

function describe(value: unknown): string {
	if (Array.isArray(value)) return "list";
	if (value instanceof Date) return "date";
	if (value === null) return "empty";
	return typeof value;
}

function checkValue(record: EntityRecord, def: PropertyDef, value: unknown, out: Issue[]): void {
	const base = { path: record.path, property: def.name, rule: "schema" as const };

	if (def.kind === "enum" && def.values) {
		const text = String(value).trim();
		const hit = def.values.find((v) => v.toLowerCase() === text.toLowerCase());
		if (!hit) {
			out.push({
				...base,
				code: CODES.invalidValue,
				severity: "warning",
				message: `\`${def.name}\`: invalid value \`${text}\``,
				hint: `Expected one of: ${def.values.map((v) => `\`${v}\``).join(", ")}`,
			});
		} else if (hit !== text) {
			// Same value, different casing. The vault now has two spellings of one
			// value, which is exactly the drift §2.1 is about, so it is reported --
			// at INFO, because nothing is broken.
			out.push({
				...base,
				code: CODES.invalidValue,
				severity: "info",
				message: `\`${def.name}\`: \`${text}\` differs in case from the schema's \`${hit}\``,
				hint: `Rename it to \`${hit}\` so queries on this property match.`,
			});
		}
		return;
	}

	if (!kindMatches(def.kind, value)) {
		out.push({
			...base,
			code: def.kind === "date" ? CODES.invalidDate : CODES.wrongType,
			severity: "warning",
			message: `\`${def.name}\`: expected ${def.kind}, found ${describe(value)} (\`${String(value)}\`)`,
		});
		return;
	}

	if (def.kind === "list" && def.items && Array.isArray(value)) {
		for (const item of value) {
			if (kindMatches(def.items, item)) continue;
			out.push({
				...base,
				code: CODES.wrongType,
				severity: "warning",
				message: `\`${def.name}\`: list item \`${String(item)}\` is not ${def.items}`,
			});
		}
	}

	if (typeof value === "number") {
		if (def.min !== undefined && value < def.min) {
			out.push({ ...base, code: CODES.outOfRange, severity: "warning", message: `\`${def.name}\`: ${value} is below the minimum of ${def.min}` });
		}
		if (def.max !== undefined && value > def.max) {
			out.push({ ...base, code: CODES.outOfRange, severity: "warning", message: `\`${def.name}\`: ${value} is above the maximum of ${def.max}` });
		}
	}

	if (def.pattern && typeof value === "string") {
		let re: RegExp | null = null;
		try {
			re = new RegExp(`^(?:${def.pattern})$`);
		} catch {
			re = null; // A broken pattern is a schema problem, reported by the loader.
		}
		if (re && !re.test(value)) {
			out.push({ ...base, code: CODES.patternMismatch, severity: "warning", message: `\`${def.name}\`: \`${value}\` does not match \`${def.pattern}\`` });
		}
	}
}

export interface ValidateOptions {
	/** Frontmatter keys the plugin itself owns, never reported as unknown. */
	ignoreProperties?: string[];
	/** Resolve a link target's entity type, for relationship target checks.
	 * Omitted when validating a single note without an index. */
	typeOf?: (path: string) => string | null;
}

/** Validate one indexed note against its schema. Returns findings only -- it
 * never mutates the record, and nothing here can touch the file. */
export function validateEntity(
	record: EntityRecord,
	schema: EntitySchema,
	options: ValidateOptions = {}
): Issue[] {
	const out: Issue[] = [];
	const ignore = new Set(options.ignoreProperties ?? []);

	for (const def of schema.properties.values()) {
		const value = record.props[def.name];
		if (isEmpty(value)) {
			if (def.required) {
				out.push({
					path: record.path,
					code: CODES.missingRequired,
					rule: "schema",
					severity: "warning",
					property: def.name,
					message: `missing required property \`${def.name}\``,
					hint: def.description ?? (def.values ? `Expected one of: ${def.values.join(", ")}` : undefined),
				});
			}
			continue;
		}
		checkValue(record, def, value, out);
	}

	if (!schema.additionalProperties) {
		for (const name of Object.keys(record.props)) {
			// A declared relationship kind written as a top-level property is the
			// flat relationship shape, not an unknown property.
			if (schema.properties.has(name) || schema.relationships.has(name) || ignore.has(name)) continue;
			out.push({
				path: record.path,
				code: CODES.unknownProperty,
				rule: "schema",
				severity: "info",
				property: name,
				message: `\`${name}\` is not declared by the \`${schema.rawType}\` schema`,
				hint: `Add it to ${schema.source}, or set \`additionalProperties: true\` on that schema.`,
			});
		}
	}

	const declaredVersion = record.props.schema_version;
	if (typeof declaredVersion === "number" && declaredVersion !== schema.version) {
		out.push({
			path: record.path,
			code: CODES.schemaVersion,
			rule: "schema",
			severity: "info",
			property: "schema_version",
			message: `note declares schema version ${declaredVersion}; \`${schema.rawType}\` is at version ${schema.version}`,
		});
	}

	// Relationships. Only checked when the schema declares any at all -- a schema
	// with an empty `relationships:` block would otherwise flag every edge in the
	// vault the moment it was created.
	if (schema.relationships.size > 0) {
		const seen = new Map<string, number>();
		for (const ref of record.relationships) {
			seen.set(ref.type, (seen.get(ref.type) ?? 0) + 1);
			const def = schema.relationships.get(ref.type);
			if (!def) {
				out.push({
					path: record.path,
					code: CODES.unknownRelType,
					rule: "relationship",
					severity: "info",
					property: ref.type,
					message: `relationship \`${ref.type}\` is not declared by the \`${schema.rawType}\` schema`,
					hint: `Declare it under \`relationships:\` in ${schema.source}, or correct the spelling.`,
				});
				continue;
			}
			if (def.target && ref.target && options.typeOf) {
				const actual = options.typeOf(ref.target);
				if (actual && normaliseRelType(actual) !== def.target) {
					out.push({
						path: record.path,
						code: CODES.wrongRelTarget,
						rule: "relationship",
						severity: "warning",
						property: ref.type,
						message: `\`${ref.type}\` should point at a \`${def.target}\`, but \`${linkText(ref.raw)}\` is a \`${actual}\``,
					});
				}
			}
		}
		for (const [type, count] of seen) {
			const def = schema.relationships.get(type);
			if (def?.cardinality === "one" && count > 1) {
				out.push({
					path: record.path,
					code: CODES.cardinality,
					rule: "relationship",
					severity: "warning",
					property: type,
					message: `\`${type}\` allows one target but ${count} are declared`,
				});
			}
		}
	}

	return out;
}
