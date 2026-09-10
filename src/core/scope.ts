// Which files the engine indexes: `include` is an allowlist where empty means the whole
// vault, and `exclude` is subtracted from it afterwards.

export interface Scope {
	include: string[];
	exclude: string[];
}

/** Normalise a folder as typed in settings: strip surrounding whitespace, a
 * leading `/` and any trailing `/`. `""` and `/` both mean the vault root and
 * are dropped, because an allowlist containing the root is not an allowlist. */
export function normaliseFolder(folder: string): string {
	return folder.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

export function normaliseScope(scope: Scope): Scope {
	return {
		include: scope.include.map(normaliseFolder).filter(Boolean),
		exclude: scope.exclude.map(normaliseFolder).filter(Boolean),
	};
}

function under(path: string, folder: string): boolean {
	// `path === folder` covers a folder named as a file path, which cannot
	// happen for a note but costs nothing. The `/` guard is what stops
	// `Fiction` from matching `Fiction Archive/note.md`.
	return path === folder || path.startsWith(folder + "/");
}

/** True when a vault-relative path is in scope. Expects an already-normalised
 * scope; `inScope` normalises for callers that have not. */
export function inScope(path: string, scope: Scope): boolean {
	const { include, exclude } = normaliseScope(scope);
	if (include.length > 0 && !include.some((f) => under(path, f))) return false;
	return !exclude.some((f) => under(path, f));
}

/** One line naming the scope for the dashboard header and the scan notice, so a scoped
 * count is never read as a whole-vault count. */
export function describeScope(scope: Scope): string {
	const { include, exclude } = normaliseScope(scope);
	if (include.length === 0) {
		return exclude.length === 0 ? "the whole vault" : `the whole vault except ${exclude.length} folder${exclude.length === 1 ? "" : "s"}`;
	}
	const head = include.length === 1 ? include[0] : `${include.length} folders`;
	return exclude.length === 0 ? head : `${head}, less ${exclude.length} excluded`;
}
