import { Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { Indexer, type IndexerOptions } from "./core/indexer";
import type { Issue } from "./core/types";
import { lint, type LintResult } from "./validation/vault-linter";
import { DEFAULT_SETTINGS, WorldEngineSettingTab, type WorldEngineSettings } from "./settings";
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./ui/dashboard-view";
import { HealthView, VIEW_TYPE_HEALTH } from "./ui/health-view";
import { CreateEntityModal } from "./ui/create-entity-modal";
import { CreateRelationshipModal } from "./ui/create-relationship-modal";
import { flattenRelationships, type FlattenResult } from "./relationships/flatten";
import { BUILTIN_ENTITY_TYPES } from "./entities/entity-types";
import { STARTER_SCHEMAS } from "./schemas";
import { find, type EntityFilter } from "./entities/entity-engine";
import { stats, health } from "./dashboard/dashboard-engine";
import { describeScope } from "./core/scope";

export default class WorldEnginePlugin extends Plugin {
	settings: WorldEngineSettings = { ...DEFAULT_SETTINGS };
	indexer!: Indexer;

	private lastLint: LintResult | null = null;
	private statusEl: HTMLElement | null = null;
	private unsubscribeIndex: (() => void) | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		// The snapshot is a disposable cache and lives in the plugin folder, never in the vault tree.
		const snapshotPath = normalizePath(`${this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`}/index-snapshot.json`);
		this.indexer = new Indexer(this.app, this.indexerOptions(), snapshotPath);

		this.registerView(VIEW_TYPE_DASHBOARD, (leaf: WorkspaceLeaf) => new DashboardView(leaf, this));
		this.registerView(VIEW_TYPE_HEALTH, (leaf: WorkspaceLeaf) => new HealthView(leaf, this));

		this.registerCommands();
		this.addSettingTab(new WorldEngineSettingTab(this.app, this));
		this.addRibbonIcon("globe", "World Engine", () => void this.openDashboard("overview"));

		if (this.settings.showStatusBar) {
			this.statusEl = this.addStatusBarItem();
			this.statusEl.addClass("we-status");
			this.statusEl.onclick = () => void this.openDashboard("findings");
		}

		this.registerEvent(
			this.app.metadataCache.on("changed", (file: TFile) => {
				if (!this.settings.enabled || !this.settings.validateOnSave) return;
				this.indexer.queue(file.path);
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (!this.settings.enabled) return;
				this.indexer.remove(file.path);
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (!this.settings.enabled) return;
				// Removing the old record reassembles the graph, which re-resolves links to the new path.
				this.indexer.remove(oldPath);
				if (file instanceof TFile) this.indexer.queue(file.path);
			})
		);
		// Unsubscribed by hand in onunload, because registerEvent expects an EventRef, not a function.
		this.unsubscribeIndex = this.indexer.changed.on(() => this.afterIndex());

		this.app.workspace.onLayoutReady(() => {
			if (!this.settings.enabled || !this.settings.scanOnStartup) return;
			// `resolved` fires once the link map is complete. Building before that
			// makes every link in the vault look broken for the first few seconds,
			// which is a very convincing bug report about a plugin that is working.
			const ref = this.app.metadataCache.on("resolved", () => {
				this.app.metadataCache.offref(ref);
				void this.scan(true);
			});
			this.registerEvent(ref);
		});
	}

	onunload(): void {
		this.unsubscribeIndex?.();
		this.unsubscribeIndex = null;
		this.indexer.dispose();
	}

	// ---------------------------------------------------------------- settings

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<WorldEngineSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...(stored ?? {}),
			rules: { ...(stored?.rules ?? {}) },
			severity: { ...(stored?.severity ?? {}) },
			weights: { ...DEFAULT_SETTINGS.weights, ...(stored?.weights ?? {}) },
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.indexer.setOptions(this.indexerOptions());
	}

	private indexerOptions(): IndexerOptions {
		return {
			parse: {
				typeProperty: this.settings.typeProperty,
				canonProperty: this.settings.canonProperty,
				idProperty: this.settings.idProperty,
				titleProperty: this.settings.titleProperty,
				relationshipProperty: this.settings.relationshipProperty,
				inlineRelationshipTypes: this.settings.inlineRelationshipTypes,
				typeFallbacks: ["entity_type", "note_type"],
			},
			schemaFolder: this.settings.schemaFolder,
			includeFolders: this.settings.includeFolders,
			excludeFolders: this.settings.excludeFolders,
		};
	}

	// ------------------------------------------------------------------ index

	async scan(useSnapshot: boolean): Promise<void> {
		if (!this.settings.enabled) {
			new Notice("World Engine is turned off in settings.");
			return;
		}
		const started = Date.now();
		await this.indexer.build(useSnapshot && this.settings.useSnapshot);
		const result = this.relint();
		// The notice names the scope so a scoped count is not read as a whole-vault figure.
		new Notice(
			`World Engine: ${result.scannedNotes.toLocaleString()} notes in ${describeScope(this.indexer.scope())}, ${Date.now() - started}ms — ` +
				`${result.counts.error} errors, ${result.counts.warning} warnings, ${result.counts.info} info.`
		);
	}

	async rebuild(): Promise<void> {
		await this.indexer.clearSnapshot();
		await this.scan(false);
		new Notice("World Engine: index rebuilt from the vault. No Markdown was modified.");
	}

	/** Re-run the linter over the current index. Cheap enough to do on every
	 * index change: the rules are folds over maps already in memory. */
	relint(): LintResult {
		const state = this.indexer.state();
		this.lastLint = lint(state.index, state.schemas, state.carried, {
			enabled: this.settings.rules,
			severity: this.settings.severity,
			ignoreProperties: [this.settings.typeProperty, this.settings.idProperty, this.settings.relationshipProperty, "tags", "aliases", "cssclasses", "schema_version"],
			dateProperties: this.settings.dateProperties,
		});
		return this.lastLint;
	}

	issues(): Issue[] {
		return (this.lastLint ?? this.relint()).issues;
	}

	private afterIndex(): void {
		this.relint();
		this.updateStatus();
	}

	refresh(): void {
		this.relint();
		this.updateStatus();
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)) {
			const view = leaf.view;
			if (view instanceof DashboardView) view.render();
		}
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HEALTH)) {
			const view = leaf.view;
			if (view instanceof HealthView) view.render();
		}
	}

	private updateStatus(): void {
		if (!this.statusEl) return;
		const path = this.app.workspace.getActiveFile()?.path;
		const all = this.issues();
		const here = path ? all.filter((i) => i.path === path) : [];
		const errors = here.filter((i) => i.severity === "error").length;
		const warnings = here.filter((i) => i.severity === "warning").length;
		this.statusEl.setText(here.length === 0 ? "WE ✓" : `WE ${errors ? `${errors}✗ ` : ""}${warnings ? `${warnings}⚠` : `${here.length}`}`);
		this.statusEl.setAttr(
			"aria-label",
			here.length === 0 ? `World Engine: no findings here (${all.length} in the vault)` : `World Engine: ${here.length} findings in this note`
		);
	}

	// --------------------------------------------------------------- commands

	private registerCommands(): void {
		this.addCommand({ id: "scan-vault", name: "Scan vault", callback: () => void this.scan(true) });
		this.addCommand({ id: "rebuild-index", name: "Rebuild index", callback: () => void this.rebuild() });
		this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.openDashboard("overview") });
		this.addCommand({ id: "show-health", name: "Show vault health", callback: () => void this.openHealth() });
		this.addCommand({ id: "open-findings", name: "Show all findings", callback: () => void this.openDashboard("findings") });

		this.addCommand({
			id: "validate-note",
			name: "Validate current note",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.validateNote(file);
				return true;
			},
		});

		this.addCommand({ id: "create-entity", name: "Create entity", callback: () => this.openEntityModal() });

		this.addCommand({
			id: "create-relationship",
			name: "Create relationship",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) this.openRelationshipModal(file.path);
				return true;
			},
		});

		this.addCommand({ id: "flatten-relationships", name: "Flatten relationships into properties", callback: () => void this.flattenAll() });

		this.addCommand({ id: "create-starter-schemas", name: "Create starter schemas", callback: () => void this.writeStarterSchemas() });
		this.addCommand({ id: "reload-schemas", name: "Reload schemas", callback: () => void this.reloadSchemas() });
	}

	async validateNote(file: TFile): Promise<void> {
		await this.indexer.update(file);
		const state = this.indexer.state();
		const result = lint(state.index, state.schemas, state.carried, {
			enabled: this.settings.rules,
			severity: this.settings.severity,
			ignoreProperties: [this.settings.typeProperty, this.settings.idProperty, this.settings.relationshipProperty, "tags", "aliases", "cssclasses", "schema_version"],
			dateProperties: this.settings.dateProperties,
			only: file.path,
		});

		if (result.issues.length === 0) {
			const record = state.index.entities.get(file.path);
			new Notice(
				record?.type
					? `World Engine: ${file.basename} is a valid \`${record.type}\`.`
					: `World Engine: no findings. This note declares no \`${this.settings.typeProperty}\`, so no schema applies to it.`
			);
			return;
		}

		const lines = result.issues.slice(0, 6).map((issue) => `${issue.severity.toUpperCase()} ${issue.message}`);
		if (result.issues.length > 6) lines.push(`…and ${result.issues.length - 6} more.`);
		new Notice(`World Engine — ${file.basename}\n${lines.join("\n")}`, 10000);
		void this.openDashboard("findings");
	}

	/** Lift every indexed note's nested `relationships:` block into top-level
	 * list properties — the shape Obsidian's Properties panel renders as link
	 * pills instead of raw JSON. Runs through `processFrontMatter`, so open
	 * editors and unknown properties are safe, and entries that carry metadata
	 * (the list form, `{target:, since:}` values) are left in place and named
	 * rather than silently dropped. */
	async flattenAll(): Promise<void> {
		const state = this.indexer.state();
		const relProperty = this.settings.relationshipProperty;
		const paths = [...state.index.entities.values()]
			.filter((record) => record.props[relProperty] !== undefined)
			.map((record) => record.path);

		let notes = 0;
		let lifted = 0;
		const kept: string[] = [];
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			let result: FlattenResult = { changed: false, lifted: 0, kept: [] };
			await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				result = flattenRelationships(fm, relProperty);
			});
			if (result.changed) {
				notes += 1;
				lifted += result.lifted;
				this.indexer.queue(path);
			}
			for (const entry of result.kept) kept.push(`${file.basename}: ${entry.kind} — ${entry.reason}`);
		}

		const summary = `World Engine: ${lifted} relationships lifted into properties across ${notes} of ${paths.length} notes with a \`${relProperty}\` block.`;
		if (kept.length === 0) {
			new Notice(summary);
			return;
		}
		const lines = kept.slice(0, 5);
		if (kept.length > 5) lines.push(`…and ${kept.length - 5} more.`);
		new Notice(`${summary}\nLeft in place:\n${lines.join("\n")}`, 12000);
	}

	async openDashboard(tab: "overview" | "findings" | "entities" | "schemas"): Promise<void> {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0] ?? this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
		this.app.workspace.revealLeaf(leaf);
		const view = leaf.view;
		if (view instanceof DashboardView) view.setTab(tab);
	}

	async openHealth(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_HEALTH)[0];
		const leaf = existing ?? this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_HEALTH, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	openEntityModal(): void {
		const { schemas } = this.indexer.state();
		new CreateEntityModal(this.app, {
			schemas: schemas.byType,
			extraTypes: [...BUILTIN_ENTITY_TYPES],
			defaultCanon: this.settings.defaultCanonState,
			canonProperty: this.settings.canonProperty,
			typeProperty: this.settings.typeProperty,
			idProperty: this.settings.idProperty,
			onCreate: (file) => {
				void this.app.workspace.getLeaf("tab").openFile(file);
				this.indexer.queue(file.path);
			},
		}).open();
	}

	openRelationshipModal(sourcePath: string): void {
		const state = this.indexer.state();
		const record = state.index.entities.get(sourcePath);
		const schema = record?.type ? state.schemas.byType.get(record.type) : undefined;
		const known = new Set<string>();
		for (const entity of state.index.entities.values()) for (const ref of entity.relationships) known.add(ref.type);

		new CreateRelationshipModal(this.app, {
			sourcePath,
			declared: schema ? [...schema.relationships.values()] : [],
			known: [...known],
			relationshipProperty: this.settings.relationshipProperty,
			targets: [...state.index.entities.values()]
				.filter((r) => r.type !== null)
				.map((r) => ({ path: r.path, title: r.title, type: r.type })),
			onDone: () => this.indexer.queue(sourcePath),
		}).open();
	}

	// ---------------------------------------------------------------- schemas

	async reloadSchemas(): Promise<void> {
		const schemas = await this.indexer.loadSchemas();
		this.refresh();
		new Notice(
			schemas.problems.length
				? `World Engine: ${schemas.byType.size} schemas loaded, ${schemas.problems.length} problems — see the Schemas tab.`
				: `World Engine: ${schemas.byType.size} schemas loaded.`
		);
	}

	/** Write the bundled starter schemas. Never overwrites: a schema the user has
	 * edited is theirs, and "create" replacing their work would be exactly the
	 * silent data loss §28 forbids. */
	async writeStarterSchemas(): Promise<void> {
		const folder = normalizePath(this.settings.schemaFolder.replace(/\/+$/, ""));
		if (!(await this.app.vault.adapter.exists(folder))) {
			await this.app.vault.createFolder(folder).catch(() => undefined);
		}

		let written = 0;
		let skipped = 0;
		for (const [name, body] of Object.entries(STARTER_SCHEMAS)) {
			const path = normalizePath(`${folder}/${name}`);
			if (await this.app.vault.adapter.exists(path)) {
				skipped += 1;
				continue;
			}
			await this.app.vault.adapter.write(path, body);
			written += 1;
		}

		await this.reloadSchemas();
		new Notice(
			skipped === 0
				? `World Engine: wrote ${written} schemas to ${folder}.`
				: `World Engine: wrote ${written} schemas to ${folder}; left ${skipped} existing files alone.`
		);
	}

	// -------------------------------------------------------------------- API

	/** The beginnings of §30. Exposed on the plugin instance so another plugin can
	 * reach it through `app.plugins.plugins["world-engine"].api`. Read-only by
	 * design: nothing here can write to the vault. */
	get api() {
		return {
			entities: {
				all: () => [...this.indexer.state().index.entities.values()].filter((r) => r.type !== null),
				find: (filter: EntityFilter) => find(this.indexer.state().index, filter),
				get: (path: string) => this.indexer.state().index.entities.get(path) ?? null,
			},
			relationships: {
				of: (path: string) => this.indexer.state().index.entities.get(path)?.relationships ?? [],
				to: (path: string) => this.indexer.state().index.inbound.get(path) ?? [],
			},
			schema: {
				all: () => [...this.indexer.state().schemas.byType.values()],
				get: (type: string) => this.indexer.state().schemas.byType.get(type) ?? null,
			},
			canon: {
				statusOf: (path: string) => this.indexer.state().index.entities.get(path)?.canon ?? null,
			},
			validation: {
				issues: () => this.issues(),
				forNote: (path: string) => this.issues().filter((i) => i.path === path),
			},
			stats: () => {
				const state = this.indexer.state();
				const data = stats(state.index, state.schemas);
				return { ...data, health: health(state.index, this.issues(), data, this.settings.weights) };
			},
			rebuild: () => this.rebuild(),
		};
	}
}
