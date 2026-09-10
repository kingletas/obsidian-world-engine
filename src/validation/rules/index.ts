// The rule set (§10.1); each rule runs over the whole index, because duplicates and
// orphans are only visible vault-wide.

import type { EntityRecord, Issue, Severity, WorldIndex } from "../../core/types";
import { CANON_STATES, isCanonAlias } from "../../canon/canon-engine";
import { linkText } from "../../relationships/relationship-engine";
import type { CompiledSchemas } from "../../schema/types";
import { validateEntity, looksLikeDate } from "../../schema/validator";

export interface RuleContext {
	index: WorldIndex;
	schemas: CompiledSchemas;
	/** Properties the plugin owns, never reported as unknown or as dates. */
	ignoreProperties: string[];
	/** Frontmatter keys that should be dates wherever they appear, even with no
	 * schema. `date` is in §39's event example and is worth checking on its own. */
	dateProperties: string[];
}

export interface Rule {
	id: string;
	code: string;
	title: string;
	description: string;
	defaultSeverity: Severity;
	run(ctx: RuleContext): Issue[];
}

const entityList = (ctx: RuleContext): EntityRecord[] => [...ctx.index.entities.values()];

export const brokenLinks: Rule = {
	id: "broken-links",
	code: "WE001",
	title: "Broken links",
	description: "A wikilink that resolves to no file in the vault.",
	defaultSeverity: "warning",
	run(ctx) {
		const out: Issue[] = [];
		for (const record of entityList(ctx)) {
			for (const link of record.links) {
				if (link.target || link.embed) continue;
				out.push({
					path: record.path,
					code: "WE001",
					rule: "broken-links",
					severity: "warning",
					message: `broken link \`[[${linkText(link.raw)}]]\``,
				});
			}
		}
		return out;
	},
};

export const deadEmbeds: Rule = {
	id: "dead-embeds",
	code: "WE002",
	title: "Dead embeds",
	description: "An embed whose target file is missing.",
	defaultSeverity: "warning",
	run(ctx) {
		const out: Issue[] = [];
		for (const record of entityList(ctx)) {
			for (const link of record.links) {
				if (link.target || !link.embed) continue;
				const raw = linkText(link.raw);
				const attachment = /\.[a-z0-9]{2,5}$/i.test(raw) && !raw.toLowerCase().endsWith(".md");
				out.push({
					path: record.path,
					code: "WE002",
					rule: "dead-embeds",
					severity: "warning",
					message: attachment ? `missing embedded file \`${raw}\`` : `dead embed \`![[${raw}]]\``,
				});
			}
		}
		return out;
	},
};

export const duplicateIds: Rule = {
	id: "duplicate-ids",
	code: "WE003",
	title: "Duplicate entity IDs",
	description: "Two notes declaring the same `id`. The one thing in the vault that is supposed to be unique.",
	defaultSeverity: "error",
	run(ctx) {
		const byId = new Map<string, EntityRecord[]>();
		for (const record of entityList(ctx)) {
			if (!record.id) continue;
			const key = record.id.trim().toLowerCase();
			const list = byId.get(key);
			if (list) list.push(record);
			else byId.set(key, [record]);
		}
		const out: Issue[] = [];
		for (const [id, records] of byId) {
			if (records.length < 2) continue;
			for (const record of records) {
				const others = records.filter((r) => r !== record).map((r) => r.path);
				out.push({
					path: record.path,
					code: "WE003",
					rule: "duplicate-ids",
					severity: "error",
					property: "id",
					message: `duplicate entity id \`${id}\``,
					hint: `Also declared by: ${others.join(", ")}`,
				});
			}
		}
		return out;
	},
};

export const duplicateEntities: Rule = {
	id: "duplicate-entities",
	code: "WE004",
	title: "Duplicate entities",
	description: "Two notes of the same type with the same title. Usually a second note about one character.",
	defaultSeverity: "warning",
	run(ctx) {
		const byKey = new Map<string, EntityRecord[]>();
		for (const record of entityList(ctx)) {
			if (!record.type) continue;
			const key = `${record.type}::${record.title.trim().toLowerCase()}`;
			const list = byKey.get(key);
			if (list) list.push(record);
			else byKey.set(key, [record]);
		}
		const out: Issue[] = [];
		for (const records of byKey.values()) {
			if (records.length < 2) continue;
			for (const record of records) {
				out.push({
					path: record.path,
					code: "WE004",
					rule: "duplicate-entities",
					severity: "warning",
					message: `a second \`${record.type}\` is titled \`${record.title}\``,
					hint: `Also: ${records.filter((r) => r !== record).map((r) => r.path).join(", ")}`,
				});
			}
		}
		return out;
	},
};

export const orphanNotes: Rule = {
	id: "orphan-notes",
	code: "WE005",
	title: "Orphan notes",
	description: "An entity nothing links to and which links to nothing.",
	defaultSeverity: "info",
	run(ctx) {
		const out: Issue[] = [];
		for (const record of entityList(ctx)) {
			if (!record.type) continue; // A journal entry linking nowhere is not an orphan, it is a journal entry.
			if ((ctx.index.backlinks.get(record.path)?.size ?? 0) > 0) continue;
			// Relationships count as outgoing links, so a frontmatter-only note is not an orphan.
			if (record.links.length > 0 || record.relationships.length > 0) continue;
			out.push({ path: record.path, code: "WE005", rule: "orphan-notes", severity: "info", message: "orphan: nothing links here and it links nowhere" });
		}
		return out;
	},
};

export const emptyNotes: Rule = {
	id: "empty-notes",
	code: "WE006",
	title: "Empty notes",
	description: "A note with frontmatter and no body.",
	defaultSeverity: "info",
	run(ctx) {
		const out: Issue[] = [];
		for (const record of entityList(ctx)) {
			if (record.bodyChars > 0) continue;
			out.push({ path: record.path, code: "WE006", rule: "empty-notes", severity: "info", message: "no body content" });
		}
		return out;
	},
};

export const missingType: Rule = {
	id: "missing-type",
	code: "WE007",
	title: "Untyped notes in an entity folder",
	description: "A note sitting in a folder where every other note declares a type, but declaring none itself.",
	defaultSeverity: "info",
	run(ctx) {
		// Folder-relative rather than vault-wide: a vault is mostly not entities,
		// and flagging every journal note as missing a type would bury everything
		// else this linter finds.
		const byFolder = new Map<string, { typed: number; untyped: EntityRecord[] }>();
		for (const record of entityList(ctx)) {
			const folder = record.path.includes("/") ? record.path.slice(0, record.path.lastIndexOf("/")) : "";
			const bucket = byFolder.get(folder) ?? { typed: 0, untyped: [] };
			if (record.type) bucket.typed += 1;
			else bucket.untyped.push(record);
			byFolder.set(folder, bucket);
		}
		const out: Issue[] = [];
		for (const bucket of byFolder.values()) {
			const total = bucket.typed + bucket.untyped.length;
			if (bucket.typed === 0 || bucket.typed / total < 0.6) continue;
			for (const record of bucket.untyped) {
				out.push({
					path: record.path,
					code: "WE007",
					rule: "missing-type",
					severity: "info",
					property: "type",
					message: `no \`type\`, but ${bucket.typed} of ${total} notes in this folder have one`,
				});
			}
		}
		return out;
	},
};

export const unknownType: Rule = {
	id: "unknown-type",
	code: "WE008",
	title: "Types with no schema",
	description: "A note declaring a type that no schema defines. Nothing validates it.",
	defaultSeverity: "info",
	run(ctx) {
		if (ctx.schemas.byType.size === 0) return []; // No schemas at all is a setup state, not a finding on every note.
		const out: Issue[] = [];
		for (const record of entityList(ctx)) {
			if (!record.type || ctx.schemas.byType.has(record.type)) continue;
			out.push({
				path: record.path,
				code: "WE008",
				rule: "unknown-type",
				severity: "info",
				property: "type",
				message: `no schema defines the type \`${record.rawType}\``,
				hint: "Add a schema for it, or correct the value. Until then this note is not validated.",
			});
		}
		return out;
	},
};

export const canonState: Rule = {
	id: "canon-state",
	code: "WE009",
	title: "Canon state",
	description: "A canon value outside the six states, or one reached through an alias.",
	defaultSeverity: "warning",
	run(ctx) {
		const out: Issue[] = [];
		for (const record of entityList(ctx)) {
			if (record.rawCanon === null) continue;
			if (record.canon === null) {
				out.push({
					path: record.path,
					code: "WE009",
					rule: "canon-state",
					severity: "warning",
					property: "canon_status",
					message: `unrecognised canon state \`${record.rawCanon}\``,
					hint: `Expected one of: ${CANON_STATES.join(", ")}`,
				});
			} else if (isCanonAlias(record.rawCanon)) {
				out.push({
					path: record.path,
					code: "WE009",
					rule: "canon-state",
					severity: "info",
					property: "canon_status",
					message: `\`${record.rawCanon}\` is read as \`${record.canon}\``,
					hint: `Write \`${record.canon}\` so queries on this property match.`,
				});
			}
		}
		return out;
	},
};

export const brokenRelationships: Rule = {
	id: "broken-relationships",
	code: "WE010",
	title: "Broken relationships",
	description: "A relationship whose target does not exist.",
	defaultSeverity: "warning",
	run(ctx) {
		const out: Issue[] = [];
		for (const record of entityList(ctx)) {
			for (const ref of record.relationships) {
				if (ref.target) continue;
				out.push({
					path: record.path,
					code: "WE010",
					rule: "broken-relationships",
					severity: "warning",
					property: ref.type,
					message: `\`${ref.type}\` points at \`${linkText(ref.raw)}\`, which does not exist`,
				});
			}
		}
		return out;
	},
};

export const invalidDates: Rule = {
	id: "invalid-dates",
	code: "WE011",
	title: "Invalid dates",
	description: "A date property that is not a date.",
	defaultSeverity: "warning",
	run(ctx) {
		const out: Issue[] = [];
		for (const record of entityList(ctx)) {
			for (const key of ctx.dateProperties) {
				const value = record.props[key];
				if (value === undefined || value === null || value === "") continue;
				if (looksLikeDate(value)) continue;
				out.push({
					path: record.path,
					code: "WE011",
					rule: "invalid-dates",
					severity: "warning",
					property: key,
					message: `\`${key}\`: \`${String(value)}\` is not a date`,
					hint: "Expected `YYYY-MM-DD`, `YYYY-MM` or a bare year. Quote in-world date formats under a different property.",
				});
			}
		}
		return out;
	},
};

export const schemaViolations: Rule = {
	id: "schema",
	code: "WE1xx",
	title: "Schema violations",
	description: "Missing required properties, invalid values, wrong types, undeclared relationships.",
	defaultSeverity: "warning",
	run(ctx) {
		const out: Issue[] = [];
		const typeOf = (path: string): string | null => ctx.index.entities.get(path)?.type ?? null;
		for (const record of entityList(ctx)) {
			if (!record.type) continue;
			const schema = ctx.schemas.byType.get(record.type);
			if (!schema) continue; // Covered by unknown-type; reporting twice helps nobody.
			out.push(...validateEntity(record, schema, { ignoreProperties: ctx.ignoreProperties, typeOf }));
		}
		return out;
	},
};

export const RULES: Rule[] = [
	brokenLinks,
	deadEmbeds,
	duplicateIds,
	duplicateEntities,
	orphanNotes,
	emptyNotes,
	missingType,
	unknownType,
	canonState,
	brokenRelationships,
	invalidDates,
	schemaViolations,
];
