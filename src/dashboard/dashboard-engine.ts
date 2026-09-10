// Vault statistics and the health score (§18, §22); every dimension carries its counts.

import type { EntityRecord, Issue, WorldIndex } from "../core/types";
import { canonStats, type CanonStats } from "../canon/canon-engine";
import { countByType } from "../entities/entity-engine";
import type { CompiledSchemas } from "../schema/types";

export interface HealthDimension {
	id: string;
	label: string;
	/** 0..1, or null when the dimension cannot be computed. Null is rendered as
	 * `—`, never as 100%: an unmeasured dimension scoring full marks is the
	 * single most misleading thing a health panel can do. */
	score: number | null;
	/** What the score is out of, in the units a user can check. */
	good: number;
	total: number;
	detail: string;
	weight: number;
}

export interface HealthReport {
	dimensions: HealthDimension[];
	/** Weighted mean of the dimensions that could be computed. */
	overall: number | null;
	errors: number;
	warnings: number;
	infos: number;
}

export interface DashboardStats {
	totalNotes: number;
	entityNotes: number;
	byType: Array<{ type: string; count: number }>;
	canon: CanonStats;
	relationships: number;
	relationshipTypes: Array<{ type: string; count: number }>;
	brokenRelationships: number;
	links: number;
	brokenLinks: number;
	orphans: number;
	words: number;
	schemas: number;
	typedWithoutSchema: number;
	recent: Array<{ path: string; title: string; type: string | null; mtime: number }>;
	mostConnected: Array<{ path: string; title: string; degree: number }>;
	builtAt: number;
}

export type Weights = Record<string, number>;

export const DEFAULT_WEIGHTS: Weights = {
	structure: 1,
	metadata: 1,
	links: 1,
	schemas: 1,
	continuity: 1,
};

function ratio(good: number, total: number): number | null {
	if (total <= 0) return null;
	return Math.max(0, Math.min(1, good / total));
}

export function stats(index: WorldIndex, schemas: CompiledSchemas, recentLimit = 8): DashboardStats {
	const records = [...index.entities.values()];
	let relationships = 0;
	let brokenRelationships = 0;
	let links = 0;
	let brokenLinks = 0;
	let words = 0;
	let orphans = 0;
	let typedWithoutSchema = 0;
	const relTypes = new Map<string, number>();
	const degree = new Map<string, number>();

	for (const record of records) {
		words += record.words;
		for (const link of record.links) {
			links += 1;
			if (!link.target) brokenLinks += 1;
		}
		for (const ref of record.relationships) {
			relationships += 1;
			relTypes.set(ref.type, (relTypes.get(ref.type) ?? 0) + 1);
			if (!ref.target) brokenRelationships += 1;
			else degree.set(ref.target, (degree.get(ref.target) ?? 0) + 1);
		}
		if (record.relationships.length) degree.set(record.path, (degree.get(record.path) ?? 0) + record.relationships.length);
		if (record.type) {
			if (!schemas.byType.has(record.type)) typedWithoutSchema += 1;
			const inbound = index.backlinks.get(record.path)?.size ?? 0;
			if (inbound === 0 && record.links.length === 0 && record.relationships.length === 0) orphans += 1;
		}
	}

	const entityRecords = records.filter((r) => r.type !== null);

	return {
		totalNotes: records.length,
		entityNotes: entityRecords.length,
		byType: [...countByType(index).entries()].map(([type, count]) => ({ type, count })),
		canon: canonStats(entityRecords.map((r) => r.canon)),
		relationships,
		relationshipTypes: [...relTypes.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([type, count]) => ({ type, count })),
		brokenRelationships,
		links,
		brokenLinks,
		orphans,
		words,
		schemas: schemas.byType.size,
		typedWithoutSchema,
		recent: [...records]
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, recentLimit)
			.map((r) => ({ path: r.path, title: r.title, type: r.type, mtime: r.mtime })),
		mostConnected: [...degree.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, recentLimit)
			.map(([path, d]) => ({ path, title: index.entities.get(path)?.title ?? path, degree: d })),
		builtAt: index.builtAt,
	};
}

function countIssues(issues: Issue[], rules: string[]): number {
	const wanted = new Set(rules);
	return issues.filter((i) => wanted.has(i.rule)).length;
}

/** `continuity` is always null in this release. §15 is Stage 4 of four in the
 * BRD's own development strategy, and a continuity dimension that scores 100%
 * because nothing checks it would be worse than no dimension at all. */
export function health(
	index: WorldIndex,
	issues: Issue[],
	data: DashboardStats,
	weights: Weights = DEFAULT_WEIGHTS
): HealthReport {
	const records = [...index.entities.values()];

	const structuralIssues = countIssues(issues, ["orphan-notes", "empty-notes", "duplicate-entities", "duplicate-ids"]);
	const structureTotal = records.length;
	const structure: HealthDimension = {
		id: "structure",
		label: "Structure",
		score: ratio(Math.max(0, structureTotal - structuralIssues), structureTotal),
		good: Math.max(0, structureTotal - structuralIssues),
		total: structureTotal,
		detail: `${structuralIssues} of ${structureTotal} notes are orphaned, empty or duplicated`,
		weight: weights.structure ?? 1,
	};

	const metadataIssues = countIssues(issues, ["canon-state", "invalid-dates", "missing-type"]);
	const metadata: HealthDimension = {
		id: "metadata",
		label: "Metadata",
		score: ratio(Math.max(0, records.length - metadataIssues), records.length),
		good: Math.max(0, records.length - metadataIssues),
		total: records.length,
		detail: `${metadataIssues} notes carry an unrecognised canon state, a bad date, or no type where their folder expects one`,
		weight: weights.metadata ?? 1,
	};

	const linkTotal = data.links + data.relationships;
	const linkBroken = data.brokenLinks + data.brokenRelationships;
	const links: HealthDimension = {
		id: "links",
		label: "Links",
		score: ratio(linkTotal - linkBroken, linkTotal),
		good: linkTotal - linkBroken,
		total: linkTotal,
		detail: `${linkBroken} of ${linkTotal} links and relationships resolve to nothing`,
		weight: weights.links ?? 1,
	};

	// The denominator is typed notes, not all notes: an untyped journal note is
	// not a schema failure and including it would make the score a measure of how
	// much of the vault is worldbuilding.
	const typed = records.filter((r) => r.type !== null).length;
	const badlyTyped = new Set(issues.filter((i) => i.rule === "schema" || i.rule === "unknown-type" || i.rule === "relationship").map((i) => i.path)).size;
	const schemasDim: HealthDimension = {
		id: "schemas",
		label: "Schemas",
		score: ratio(Math.max(0, typed - badlyTyped), typed),
		good: Math.max(0, typed - badlyTyped),
		total: typed,
		detail:
			data.schemas === 0
				? "no schemas defined yet — nothing is validated"
				: `${badlyTyped} of ${typed} typed notes violate their schema or have none`,
		weight: weights.schemas ?? 1,
	};

	const continuity: HealthDimension = {
		id: "continuity",
		label: "Continuity",
		score: null,
		good: 0,
		total: 0,
		detail: "not implemented in this release — §15 of the BRD is deferred past the MVP",
		weight: weights.continuity ?? 1,
	};

	const dimensions = [structure, metadata, links, schemasDim, continuity];
	const scored = dimensions.filter((d) => d.score !== null && d.weight > 0);
	const weightSum = scored.reduce((sum, d) => sum + d.weight, 0);
	const overall = weightSum === 0 ? null : scored.reduce((sum, d) => sum + (d.score as number) * d.weight, 0) / weightSum;

	return {
		dimensions,
		overall,
		errors: issues.filter((i) => i.severity === "error").length,
		warnings: issues.filter((i) => i.severity === "warning").length,
		infos: issues.filter((i) => i.severity === "info").length,
	};
}

/** Block-character bar, the vault's own convention for showing a magnitude in a
 * place that has no chart. */
export function bar(fraction: number | null, width = 20): string {
	if (fraction === null) return "─".repeat(width);
	const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
}

export function percent(fraction: number | null): string {
	return fraction === null ? "—" : `${Math.round(fraction * 100)}%`;
}

/** Entities that mention nothing and are mentioned by nothing, for the
 * dashboard's "needs attention" list. Exported here rather than in the entity
 * engine because it is a presentation concern -- the top N, not the set. */
export function needsAttention(records: EntityRecord[], index: WorldIndex, limit = 8): EntityRecord[] {
	return records
		.filter((r) => r.type !== null && (index.backlinks.get(r.path)?.size ?? 0) === 0)
		.sort((a, b) => a.mtime - b.mtime)
		.slice(0, limit);
}
