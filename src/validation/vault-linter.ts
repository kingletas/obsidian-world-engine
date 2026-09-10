// Runs the rules and shapes the result (§10); invalid YAML is reported by the indexer.

import type { Issue, Severity, WorldIndex } from "../core/types";
import type { CompiledSchemas } from "../schema/types";
import { relationshipTypes } from "../schema/schema-engine";
import { RULES, type Rule, type RuleContext } from "./rules";

export { RULES } from "./rules";
export type { Rule } from "./rules";

export interface LintOptions {
	/** Rule id -> enabled. A missing entry means enabled. */
	enabled?: Record<string, boolean>;
	/** Rule id -> severity override. §22 says the score is configurable; this is
	 * the half of that which decides what counts as an error in the first place. */
	severity?: Record<string, Severity>;
	ignoreProperties?: string[];
	dateProperties?: string[];
	/** Restrict findings to one note. The rules still run over the whole index --
	 * a duplicate id is only visible vault-wide -- and the results are filtered
	 * afterwards, so "validate this note" and "scan the vault" can never
	 * disagree about the same note. */
	only?: string;
	rules?: Rule[];
}

export interface LintResult {
	issues: Issue[];
	counts: Record<Severity, number>;
	/** Rule id -> number of findings, including rules that found nothing. */
	byRule: Record<string, number>;
	/** Findings the linter could not attribute to a rule run, i.e. carried in
	 * from the indexer (invalid YAML). */
	scannedNotes: number;
	durationMs: number;
}

const EMPTY_COUNTS = (): Record<Severity, number> => ({ error: 0, warning: 0, info: 0 });

export function lint(
	index: WorldIndex,
	schemas: CompiledSchemas,
	carried: Issue[] = [],
	options: LintOptions = {}
): LintResult {
	const started = Date.now();
	const ctx: RuleContext = {
		index,
		schemas,
		// A declared relationship kind written as a top-level property is not an unknown property.
		ignoreProperties: [...(options.ignoreProperties ?? []), ...relationshipTypes(schemas).keys()],
		dateProperties: options.dateProperties ?? ["date", "start_date", "end_date", "born", "died"],
	};

	const rules = options.rules ?? RULES;
	const byRule: Record<string, number> = {};
	let issues: Issue[] = [...carried];

	for (const rule of rules) {
		if (options.enabled && options.enabled[rule.id] === false) {
			byRule[rule.id] = 0;
			continue;
		}
		let found: Issue[];
		try {
			found = rule.run(ctx);
		} catch (error) {
			// §28: keep working when one note is malformed. A rule that throws must
			// not take the other eleven with it, and the failure must be visible
			// rather than showing up as a rule that quietly finds nothing.
			found = [
				{
					path: "",
					code: "WE000",
					rule: rule.id,
					severity: "error",
					message: `the \`${rule.title}\` check failed: ${error instanceof Error ? error.message : String(error)}`,
				},
			];
		}
		const override = options.severity?.[rule.id];
		if (override) found = found.map((issue) => ({ ...issue, severity: override }));
		byRule[rule.id] = found.length;
		issues.push(...found);
	}

	if (options.only) issues = issues.filter((issue) => issue.path === options.only);

	const counts = EMPTY_COUNTS();
	for (const issue of issues) counts[issue.severity] += 1;

	const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
	issues.sort((a, b) => rank[a.severity] - rank[b.severity] || a.path.localeCompare(b.path) || a.code.localeCompare(b.code));

	return { issues, counts, byRule, scannedNotes: index.entities.size, durationMs: Date.now() - started };
}

/** Group findings by note, in the order the results pane renders them. */
export function groupByPath(issues: Issue[]): Array<{ path: string; issues: Issue[] }> {
	const groups = new Map<string, Issue[]>();
	for (const issue of issues) {
		const list = groups.get(issue.path);
		if (list) list.push(issue);
		else groups.set(issue.path, [issue]);
	}
	const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
	const worst = (list: Issue[]): number => Math.min(...list.map((i) => rank[i.severity]));
	return [...groups.entries()]
		.map(([path, list]) => ({ path, issues: list }))
		.sort((a, b) => worst(a.issues) - worst(b.issues) || b.issues.length - a.issues.length || a.path.localeCompare(b.path));
}
