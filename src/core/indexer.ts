// The only file that reads Obsidian's metadata; full passes yield every `CHUNK`
// files so the UI never blocks.

import { type App, type CachedMetadata, TFile, parseYaml } from "obsidian";
import { emptyIndex, type EntityRecord, type Issue, type WorldIndex } from "./types";
import { DEFAULT_PARSE_OPTIONS, parseNote, reresolveLinks, stripFrontmatter, type ParseInput, type ParseOptions } from "./parser";
import { fingerprint, readSnapshot, reusable, toSnapshot, type Snapshot } from "./cache";
import { Emitter } from "./events";
import { compileSchemas, relationshipTypes, type RawSchemaFile } from "../schema/schema-engine";
import { inScope, type Scope } from "./scope";
import { assemble } from "./graph";
import type { CompiledSchemas } from "../schema/types";

const CHUNK = 250;

export interface IndexerOptions {
	parse: ParseOptions;
	schemaFolder: string;
	/** Allowlist. Empty means the whole vault. */
	includeFolders: string[];
	/** Subtractive, applied after the allowlist. */
	excludeFolders: string[];
}

export const DEFAULT_INDEXER_OPTIONS: IndexerOptions = {
	parse: DEFAULT_PARSE_OPTIONS,
	schemaFolder: "Engine/Schemas",
	includeFolders: [],
	excludeFolders: [],
};

export interface IndexState {
	index: WorldIndex;
	schemas: CompiledSchemas;
	/** Findings the index itself produced, not a lint rule: invalid frontmatter.
	 * Obsidian silently hands back `frontmatter: undefined` for a note whose YAML
	 * will not parse, which is indistinguishable from a note that has none -- so
	 * the raw text is checked here, the one place that can see it. */
	carried: Issue[];
}

export class Indexer {
	readonly changed = new Emitter<IndexState>();

	private index: WorldIndex = emptyIndex();
	private schemas: CompiledSchemas = { byType: new Map(), problems: [] };
	private carried = new Map<string, Issue[]>();
	private options: IndexerOptions;
	private building = false;
	private pending = new Set<string>();
	/** Snapshot write, coalesced. */
	private flushTimer: number | null = null;
	/** Re-index of queued paths, coalesced. Kept separate from `flushTimer`:
	 * sharing one handle made a pending snapshot write silently swallow the
	 * re-index that was supposed to happen first. */
	private drainTimer: number | null = null;

	constructor(
		private app: App,
		options: IndexerOptions,
		private snapshotPath: string
	) {
		this.options = options;
	}

	state(): IndexState {
		return { index: this.index, schemas: this.schemas, carried: [...this.carried.values()].flat() };
	}

	setOptions(options: IndexerOptions): void {
		this.options = options;
	}

	isBuilding(): boolean {
		return this.building;
	}

	/** The snapshot is keyed on this. Scope is part of it: widening the scope
	 * with a snapshot that only ever saw the narrow one would produce an index
	 * silently missing every note the old scope excluded. The *effective* parse
	 * options are used, not the configured ones — snapshot records carry parsed
	 * relationships, so a schema declaring a new kind must invalidate records
	 * parsed before that kind was read from the top level. */
	private fingerprint(): string {
		return fingerprint([this.effectiveParse(), this.scope(), this.options.schemaFolder]);
	}

	/** Parse options with every schema-declared relationship kind treated as an
	 * inline (top-level) relationship property. The flat shape is the one
	 * Obsidian's Properties panel can render — the nested block shows there as
	 * raw JSON — so declaring a kind in a schema is all it takes to write it as
	 * a top-level property; the settings list is for kinds no schema declares. */
	private effectiveParse(): ParseOptions {
		const declared = [...relationshipTypes(this.schemas).keys()];
		const inline = [...new Set([...this.options.parse.inlineRelationshipTypes, ...declared])].sort();
		return { ...this.options.parse, inlineRelationshipTypes: inline };
	}

	scope(): Scope {
		return { include: this.options.includeFolders, exclude: this.options.excludeFolders };
	}

	private included(file: TFile): boolean {
		if (file.extension !== "md") return false;
		if (file.path.startsWith(".")) return false;
		return inScope(file.path, this.scope());
	}

	private resolver = (raw: string, fromPath: string): string | null => {
		const dest = this.app.metadataCache.getFirstLinkpathDest(raw.split("#")[0].split("^")[0].trim(), fromPath);
		return dest ? dest.path : null;
	};

	/** Build one record. Reads the file body only for the counts; the properties
	 * always come from Obsidian's parse, so there is never a second YAML reader
	 * to disagree with the first. */
	private async record(file: TFile): Promise<{ record: EntityRecord; issues: Issue[] }> {
		const cache: CachedMetadata | null = this.app.metadataCache.getFileCache(file);
		const text = await this.app.vault.cachedRead(file);
		const issues: Issue[] = [];

		let frontmatter = (cache?.frontmatter ?? null) as Record<string, unknown> | null;
		if (!frontmatter && text.startsWith("---")) {
			// Parse the raw block only to name the error; the result is never used as properties.
			const end = text.indexOf("\n---", 3);
			if (end > 0) {
				const body = text.slice(4, end);
				try {
					parseYaml(body);
					// It parses but Obsidian produced no properties, so it is not an error and the result is discarded.
				} catch (error) {
					issues.push({
						path: file.path,
						code: "WE012",
						rule: "invalid-yaml",
						severity: "error",
						message: `frontmatter will not parse: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
						hint: "Obsidian shows no properties for this note either. Nothing here is indexed until the YAML is valid.",
					});
				}
			}
		}

		const input: ParseInput = {
			path: file.path,
			basename: file.basename,
			frontmatter,
			links: (cache?.links ?? []).map((l) => ({ link: l.link, displayText: l.displayText })),
			embeds: (cache?.embeds ?? []).map((l) => ({ link: l.link, displayText: l.displayText })),
			tags: [
				...(cache?.tags ?? []).map((t) => t.tag),
				...toTagList(frontmatter?.tags ?? frontmatter?.tag),
			],
			headings: cache?.headings?.length ?? 0,
			body: stripFrontmatter(text),
			mtime: file.stat.mtime,
			size: file.stat.size,
		};

		return { record: parseNote(input, this.resolver, this.effectiveParse()), issues };
	}

	/** Full rebuild. `useSnapshot` is false for the explicit "Rebuild index"
	 * command -- the point of that command is to distrust the cache. */
	async build(useSnapshot: boolean): Promise<IndexState> {
		if (this.building) return this.state();
		this.building = true;
		try {
			await this.loadSchemas();

			const files = this.app.vault.getMarkdownFiles().filter((f) => this.included(f));
			const current = new Map(files.map((f) => [f.path, { mtime: f.stat.mtime, size: f.stat.size }]));
			const byPath = new Map(files.map((f) => [f.path, f]));

			const records = new Map<string, EntityRecord>();
			this.carried = new Map();

			let toParse: TFile[] = files;
			if (useSnapshot) {
				const snapshot = await this.readSnapshot();
				if (snapshot) {
					const { keep, stale } = reusable(snapshot, current);
					for (const record of keep) records.set(record.path, reresolveLinks(record, this.resolver));
					toParse = stale.map((path) => byPath.get(path)).filter((f): f is TFile => f !== undefined);
				}
			}

			for (let i = 0; i < toParse.length; i += 1) {
				const { record, issues } = await this.record(toParse[i]);
				records.set(record.path, record);
				if (issues.length) this.carried.set(record.path, issues);
				if (i % CHUNK === CHUNK - 1) await yieldToUi();
			}

			this.index = assemble(records, this.relationshipTypes());
			await this.writeSnapshot();
			this.changed.emit(this.state());
			return this.state();
		} finally {
			this.building = false;
		}
	}

	/** Re-index one file and patch the derived maps. */
	async update(file: TFile): Promise<void> {
		if (!this.included(file)) return;
		if (file.path.startsWith(this.options.schemaFolder.replace(/\/+$/, "") + "/")) {
			await this.loadSchemas();
		}
		const { record, issues } = await this.record(file);
		this.index.entities.set(record.path, record);
		if (issues.length) this.carried.set(record.path, issues);
		else this.carried.delete(record.path);
		this.reassemble();
	}

	remove(path: string): void {
		if (!this.index.entities.delete(path)) return;
		this.carried.delete(path);
		this.reassemble();
	}

	/** Rebuilding the two derived maps is O(relationships) and runs on every
	 * single-file change. That is deliberate: keeping them patched in place means
	 * four cases (added, removed, retargeted, renamed) and a bug in any of them
	 * leaves a phantom backlink that survives until the next full rebuild. The
	 * maps are small enough that the honest version wins. */
	private reassemble(): void {
		this.index = assemble(this.index.entities, this.relationshipTypes());
		this.scheduleSnapshot();
		this.changed.emit(this.state());
	}

	/** Coalesce a burst of edits into one write. Typing in a note fires `modify`
	 * on every keystroke Obsidian debounces; writing the snapshot each time would
	 * make the plugin the busiest thing in the vault. */
	private scheduleSnapshot(): void {
		if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
		this.flushTimer = window.setTimeout(() => {
			this.flushTimer = null;
			void this.writeSnapshot();
		}, 5000);
	}

	/** Queue a file for re-indexing, debounced. */
	queue(path: string): void {
		this.pending.add(path);
		if (this.drainTimer !== null) return;
		this.drainTimer = window.setTimeout(() => void this.drain(), 400);
	}

	private async drain(): Promise<void> {
		this.drainTimer = null;
		const paths = [...this.pending];
		this.pending.clear();
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) await this.update(file);
			else this.remove(path);
		}
	}

	async loadSchemas(): Promise<CompiledSchemas> {
		const folder = this.options.schemaFolder.replace(/\/+$/, "");
		const files: RawSchemaFile[] = [];
		if (folder) {
			let listing: { files: string[] } | null = null;
			try {
				listing = await this.app.vault.adapter.list(folder);
			} catch {
				listing = null; // No schema folder yet is the normal state of a fresh vault.
			}
			for (const path of listing?.files ?? []) {
				if (!/\.(ya?ml)$/i.test(path)) continue;
				try {
					const raw = await this.app.vault.adapter.read(path);
					files.push({ source: path, data: parseYaml(raw) });
				} catch (error) {
					files.push({ source: path, data: null });
					this.schemaReadError(path, error);
				}
			}
		}
		this.schemas = compileSchemas(files);
		for (const problem of this.readErrors) this.schemas.problems.push(problem);
		this.readErrors = [];
		return this.schemas;
	}

	private readErrors: Array<{ source: string; message: string }> = [];

	private schemaReadError(path: string, error: unknown): void {
		this.readErrors.push({
			source: path,
			message: `could not be read as YAML: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
		});
	}

	relationshipTypes(): ReturnType<typeof relationshipTypes> {
		return relationshipTypes(this.schemas);
	}

	private async readSnapshot(): Promise<Snapshot | null> {
		try {
			if (!(await this.app.vault.adapter.exists(this.snapshotPath))) return null;
			const raw = await this.app.vault.adapter.read(this.snapshotPath);
			return readSnapshot(raw, this.fingerprint());
		} catch {
			return null; // Any doubt resolves to a rebuild.
		}
	}

	async writeSnapshot(): Promise<void> {
		try {
			await this.app.vault.adapter.write(this.snapshotPath, JSON.stringify(toSnapshot(this.index, this.fingerprint())));
		} catch {
			// A snapshot that cannot be written is a lost optimisation, not a lost
			// vault. Nothing here is worth interrupting the user for.
		}
	}

	async clearSnapshot(): Promise<void> {
		try {
			if (await this.app.vault.adapter.exists(this.snapshotPath)) await this.app.vault.adapter.remove(this.snapshotPath);
		} catch {
			/* see writeSnapshot */
		}
	}

	dispose(): void {
		if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
		if (this.drainTimer !== null) window.clearTimeout(this.drainTimer);
	}
}

function toTagList(value: unknown): string[] {
	if (!value) return [];
	const items = Array.isArray(value) ? value : String(value).split(/[,\s]+/);
	return items.filter((v) => typeof v === "string" && v.trim()).map((v) => String(v).trim());
}

function yieldToUi(): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, 0));
}
