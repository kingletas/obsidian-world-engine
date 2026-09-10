// Canon states (§7.5, §11) and the aliases that map drifted values onto them.

export const CANON_STATES = ["idea", "draft", "provisional", "canon", "retired", "non-canon"] as const;

export type CanonState = (typeof CANON_STATES)[number];

/** States that count as "settled" for the dashboard's canon percentage. */
export const ESTABLISHED_STATES: readonly CanonState[] = ["canon"];

const ALIASES: Record<string, CanonState> = {
	established: "canon",
	confirmed: "canon",
	final: "canon",
	true: "canon",
	yes: "canon",
	noncanon: "non-canon",
	non_canon: "non-canon",
	"not-canon": "non-canon",
	excluded: "non-canon",
	false: "non-canon",
	no: "non-canon",
	wip: "draft",
	drafting: "draft",
	tentative: "provisional",
	likely: "provisional",
	proposed: "idea",
	concept: "idea",
	deprecated: "retired",
	removed: "retired",
};

/** Normalise a raw canon value. Returns null when nothing sensible can be made
 * of it -- the caller decides whether that is a finding. */
export function normaliseCanon(value: unknown): CanonState | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim().toLowerCase().replace(/\s+/g, "-").replace(/_/g, "_");
	if (!text) return null;
	if ((CANON_STATES as readonly string[]).includes(text)) return text as CanonState;
	const alias = ALIASES[text] ?? ALIASES[text.replace(/-/g, "_")];
	return alias ?? null;
}

/** True when the value was understood only through an alias. The linter reports
 * these at INFO: they work, but the vault is drifting into two vocabularies for
 * one property, which is problem §2.1 describes. */
export function isCanonAlias(value: unknown): boolean {
	if (value === null || value === undefined) return false;
	const text = String(value).trim().toLowerCase().replace(/\s+/g, "-");
	return !(CANON_STATES as readonly string[]).includes(text) && normaliseCanon(value) !== null;
}

export interface CanonStats {
	byState: Record<string, number>;
	/** Notes that declare no canon state at all. */
	unset: number;
	/** Notes carrying a canon state, established or not. */
	stated: number;
	established: number;
	/** established / stated, 0 when nothing is stated. Deliberately not
	 * established/total: a vault where most notes are not worldbuilding at all
	 * would otherwise report 4% canon forever. */
	establishedRatio: number;
}

export function canonStats(states: Array<string | null>): CanonStats {
	const byState: Record<string, number> = {};
	for (const state of CANON_STATES) byState[state] = 0;
	let unset = 0;
	for (const state of states) {
		if (!state) {
			unset += 1;
			continue;
		}
		byState[state] = (byState[state] ?? 0) + 1;
	}
	const stated = states.length - unset;
	const established = ESTABLISHED_STATES.reduce((sum, s) => sum + (byState[s] ?? 0), 0);
	return {
		byState,
		unset,
		stated,
		established,
		establishedRatio: stated === 0 ? 0 : established / stated,
	};
}
