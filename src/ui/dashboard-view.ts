import { ItemView, Menu, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type WorldEnginePlugin from "../main";
import { bar, health, percent, stats, type DashboardStats } from "../dashboard/dashboard-engine";
import { groupByPath } from "../validation/vault-linter";
import { typeLabel } from "../entities/entity-types";
import type { Issue, Severity } from "../core/types";
import { describeScope } from "../core/scope";

export const VIEW_TYPE_DASHBOARD = "world-engine-dashboard";

type Tab = "overview" | "findings" | "entities" | "schemas";

export class DashboardView extends ItemView {
	private tab: Tab = "overview";
	private filter: { severity: Severity | "all"; rule: string | "all"; text: string } = {
		severity: "all",
		rule: "all",
		text: "",
	};
	private typeFilter = "";

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: WorldEnginePlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_DASHBOARD;
	}

	getDisplayText(): string {
		return "World Engine";
	}

	getIcon(): string {
		return "globe";
	}

	private unsubscribe: (() => void) | null = null;

	async onOpen(): Promise<void> {
		// The emitter is not Obsidian's, so this cannot go through registerEvent
		// -- that wants an EventRef. Unsubscribing by hand in onClose is the whole
		// contract, and forgetting it leaks a render into a detached pane.
		this.unsubscribe = this.plugin.indexer.changed.on(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	setTab(tab: Tab): void {
		this.tab = tab;
		this.render();
	}

	render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("world-engine");

		if (!this.plugin.settings.enabled) {
			root.createEl("p", { cls: "we-empty", text: "World Engine is turned off in settings. Your Markdown is untouched either way." });
			return;
		}

		const state = this.plugin.indexer.state();
		const issues = this.plugin.issues();
		const data = stats(state.index, state.schemas);

		this.renderHeader(root, data);
		this.renderTabs(root);

		const body = root.createDiv({ cls: "we-body" });
		if (this.tab === "overview") this.renderOverview(body, data, issues);
		else if (this.tab === "findings") this.renderFindings(body, issues);
		else if (this.tab === "entities") this.renderEntities(body, data);
		else this.renderSchemas(body);
	}

	private renderHeader(root: HTMLElement, data: DashboardStats): void {
		const header = root.createDiv({ cls: "we-header" });
		const title = header.createDiv({ cls: "we-title" });
		setIcon(title.createSpan({ cls: "we-title-icon" }), "globe");
		title.createSpan({ text: "World Engine" });

		const meta = header.createDiv({ cls: "we-header-meta" });
		meta.createSpan({
			text: this.plugin.indexer.isBuilding()
				? "indexing…"
				: `${data.entityNotes.toLocaleString()} entities in ${data.totalNotes.toLocaleString()} notes`,
		});
		// Always shown, including for a whole-vault scope. A number whose
		// denominator is invisible is the thing this label exists to prevent.
		meta.createSpan({ cls: "we-pill", text: describeScope(this.plugin.indexer.scope()) });

		const actions = header.createDiv({ cls: "we-actions" });
		const scan = actions.createEl("button", { text: "Scan vault" });
		scan.onclick = () => void this.plugin.scan(true);
		const rebuild = actions.createEl("button", { text: "Rebuild index" });
		rebuild.onclick = () => void this.plugin.rebuild();
	}

	private renderTabs(root: HTMLElement): void {
		const tabs = root.createDiv({ cls: "we-tabs" });
		const entries: Array<[Tab, string]> = [
			["overview", "Overview"],
			["findings", "Findings"],
			["entities", "Entities"],
			["schemas", "Schemas"],
		];
		for (const [id, label] of entries) {
			const el = tabs.createEl("button", { text: label, cls: this.tab === id ? "we-tab is-active" : "we-tab" });
			el.onclick = () => this.setTab(id);
		}
	}

	private renderOverview(body: HTMLElement, data: DashboardStats, issues: Issue[]): void {
		const report = health(this.plugin.indexer.state().index, issues, data, this.plugin.settings.weights);

		const top = body.createDiv({ cls: "we-cards" });
		this.card(top, "Overall health", percent(report.overall), `${report.errors} errors · ${report.warnings} warnings · ${report.infos} info`);
		this.card(top, "Canon", percent(data.canon.establishedRatio), `${data.canon.established} of ${data.canon.stated} stated · ${data.canon.unset} unset`);
		this.card(top, "Relationships", data.relationships.toLocaleString(), `${data.relationshipTypes.length} types · ${data.brokenRelationships} broken`);
		this.card(top, "Links", data.links.toLocaleString(), `${data.brokenLinks} broken · ${data.orphans} orphans`);

		this.section(body, "Vault health");
		const healthTable = body.createEl("table", { cls: "we-table" });
		for (const dimension of report.dimensions) {
			const row = healthTable.createEl("tr");
			row.createEl("td", { text: dimension.label, cls: "we-dim" });
			row.createEl("td", { text: bar(dimension.score, 18), cls: "we-bar" });
			row.createEl("td", { text: percent(dimension.score), cls: "we-num" });
			row.createEl("td", { text: dimension.detail, cls: "we-detail" });
		}

		this.section(body, "Entities by type");
		if (data.byType.length === 0) {
			body.createEl("p", { cls: "we-empty", text: "No note declares a `type` yet. Run “Create entity” or add `type:` to a note's properties." });
		} else {
			const max = Math.max(...data.byType.map((t) => t.count));
			const table = body.createEl("table", { cls: "we-table" });
			for (const entry of data.byType) {
				const row = table.createEl("tr", { cls: "we-clickable" });
				row.createEl("td", { text: typeLabel(entry.type), cls: "we-dim" });
				row.createEl("td", { text: bar(entry.count / max, 14), cls: "we-bar" });
				row.createEl("td", { text: entry.count.toLocaleString(), cls: "we-num" });
				row.onclick = () => {
					this.typeFilter = entry.type;
					this.setTab("entities");
				};
			}
		}

		this.section(body, "Canon");
		const canonTable = body.createEl("table", { cls: "we-table" });
		const canonTotal = Math.max(1, data.canon.stated + data.canon.unset);
		for (const [state, count] of Object.entries(data.canon.byState)) {
			const row = canonTable.createEl("tr");
			row.createEl("td", { text: state, cls: "we-dim" });
			row.createEl("td", { text: bar(count / canonTotal, 14), cls: "we-bar" });
			row.createEl("td", { text: String(count), cls: "we-num" });
		}
		const unsetRow = canonTable.createEl("tr");
		unsetRow.createEl("td", { text: "(unset)", cls: "we-dim we-muted" });
		unsetRow.createEl("td", { text: bar(data.canon.unset / canonTotal, 14), cls: "we-bar" });
		unsetRow.createEl("td", { text: String(data.canon.unset), cls: "we-num" });

		this.section(body, "Recent changes");
		const recent = body.createEl("ul", { cls: "we-list" });
		for (const entry of data.recent) {
			const item = recent.createEl("li", { cls: "we-clickable" });
			item.createSpan({ text: entry.title });
			if (entry.type) item.createSpan({ cls: "we-pill", text: typeLabel(entry.type) });
			item.onclick = () => void this.openNote(entry.path);
		}

		if (data.mostConnected.length) {
			this.section(body, "Most connected");
			const list = body.createEl("ul", { cls: "we-list" });
			for (const entry of data.mostConnected) {
				const item = list.createEl("li", { cls: "we-clickable" });
				item.createSpan({ text: entry.title });
				item.createSpan({ cls: "we-pill", text: `${entry.degree}` });
				item.onclick = () => void this.openNote(entry.path);
			}
		}
	}

	private renderFindings(body: HTMLElement, issues: Issue[]): void {
		const controls = body.createDiv({ cls: "we-controls" });

		const severity = controls.createEl("select");
		for (const [value, label] of [
			["all", "All severities"],
			["error", "Errors"],
			["warning", "Warnings"],
			["info", "Info"],
		]) {
			const option = severity.createEl("option", { text: label });
			option.value = value;
		}
		severity.value = this.filter.severity;
		severity.onchange = () => {
			this.filter.severity = severity.value as Severity | "all";
			this.render();
		};

		const rule = controls.createEl("select");
		const ruleIds = ["all", ...new Set(issues.map((i) => i.rule))].sort();
		for (const id of ruleIds) {
			const option = rule.createEl("option", { text: id === "all" ? "All checks" : id });
			option.value = id;
		}
		rule.value = this.filter.rule;
		rule.onchange = () => {
			this.filter.rule = rule.value;
			this.render();
		};

		const search = controls.createEl("input", { type: "search", placeholder: "Filter by path or message" });
		search.value = this.filter.text;
		search.oninput = () => {
			this.filter.text = search.value;
			this.renderFindingsList(list, issues);
		};

		const list = body.createDiv({ cls: "we-findings" });
		this.renderFindingsList(list, issues);
	}

	private renderFindingsList(container: HTMLElement, issues: Issue[]): void {
		container.empty();
		const needle = this.filter.text.trim().toLowerCase();
		const filtered = issues.filter((issue) => {
			if (this.filter.severity !== "all" && issue.severity !== this.filter.severity) return false;
			if (this.filter.rule !== "all" && issue.rule !== this.filter.rule) return false;
			if (needle && !`${issue.path} ${issue.message}`.toLowerCase().includes(needle)) return false;
			return true;
		});

		container.createEl("p", {
			cls: "we-count",
			text: `${filtered.length.toLocaleString()} of ${issues.length.toLocaleString()} findings`,
		});

		if (filtered.length === 0) {
			container.createEl("p", { cls: "we-empty", text: "Nothing to report." });
			return;
		}

		for (const group of groupByPath(filtered)) {
			const section = container.createDiv({ cls: "we-group" });
			const heading = section.createDiv({ cls: "we-group-head we-clickable" });
			heading.createSpan({ text: group.path || "(vault)" });
			heading.createSpan({ cls: "we-pill", text: String(group.issues.length) });
			if (group.path) heading.onclick = () => void this.openNote(group.path);

			for (const issue of group.issues) {
				const row = section.createDiv({ cls: `we-issue we-${issue.severity}` });
				row.createSpan({ cls: "we-sev", text: issue.severity.toUpperCase() });
				row.createSpan({ cls: "we-code", text: issue.code });
				row.createSpan({ cls: "we-msg", text: issue.message });
				if (issue.hint) row.createDiv({ cls: "we-hint", text: issue.hint });
				if (group.path) {
					row.addClass("we-clickable");
					row.onclick = () => void this.openNote(group.path, issue.property);
				}
			}
		}
	}

	private renderEntities(body: HTMLElement, data: DashboardStats): void {
		const controls = body.createDiv({ cls: "we-controls" });
		const select = controls.createEl("select");
		const allOption = select.createEl("option", { text: "All types" });
		allOption.value = "";
		for (const entry of data.byType) {
			const option = select.createEl("option", { text: `${typeLabel(entry.type)} (${entry.count})` });
			option.value = entry.type;
		}
		select.value = this.typeFilter;
		select.onchange = () => {
			this.typeFilter = select.value;
			this.render();
		};

		const search = controls.createEl("input", { type: "search", placeholder: "Filter by name" });

		const list = body.createDiv({ cls: "we-entities" });
		const draw = (): void => {
			list.empty();
			const needle = search.value.trim().toLowerCase();
			const records = [...this.plugin.indexer.state().index.entities.values()]
				.filter((r) => r.type !== null)
				.filter((r) => !this.typeFilter || r.type === this.typeFilter)
				.filter((r) => !needle || r.title.toLowerCase().includes(needle))
				.sort((a, b) => a.title.localeCompare(b.title));

			list.createEl("p", { cls: "we-count", text: `${records.length.toLocaleString()} entities` });
			for (const record of records) {
				const row = list.createDiv({ cls: "we-entity we-clickable" });
				row.createSpan({ cls: "we-entity-name", text: record.title });
				row.createSpan({ cls: "we-pill", text: typeLabel(record.type as string) });
				if (record.canon) row.createSpan({ cls: `we-pill we-canon-${record.canon}`, text: record.canon });
				const inbound = this.plugin.indexer.state().index.backlinks.get(record.path)?.size ?? 0;
				row.createSpan({ cls: "we-muted", text: `${record.relationships.length} out · ${inbound} in` });
				row.onclick = () => void this.openNote(record.path);
				row.oncontextmenu = (event: MouseEvent) => {
					const menu = new Menu();
					menu.addItem((item) =>
						item
							.setTitle("Add a relationship")
							.setIcon("link")
							.onClick(() => this.plugin.openRelationshipModal(record.path))
					);
					menu.showAtMouseEvent(event);
				};
			}
		};
		search.oninput = draw;
		draw();
	}

	private renderSchemas(body: HTMLElement): void {
		const { schemas } = this.plugin.indexer.state();

		if (schemas.problems.length) {
			this.section(body, "Schema problems");
			body.createEl("p", {
				cls: "we-empty",
				text: "A schema that will not compile silently stops validating its entity type, so these are listed before anything else.",
			});
			for (const problem of schemas.problems) {
				const row = body.createDiv({ cls: "we-issue we-error" });
				row.createSpan({ cls: "we-code", text: problem.schema ?? "file" });
				row.createSpan({ cls: "we-msg", text: `${problem.source}: ${problem.message}` });
			}
		}

		this.section(body, `Schemas (${schemas.byType.size})`);
		if (schemas.byType.size === 0) {
			const empty = body.createDiv({ cls: "we-empty" });
			empty.createSpan({ text: `No schemas in ${this.plugin.settings.schemaFolder}. ` });
			const button = empty.createEl("button", { text: "Create starter schemas" });
			button.onclick = () => void this.plugin.writeStarterSchemas();
			return;
		}

		const counts = stats(this.plugin.indexer.state().index, schemas).byType;
		for (const schema of [...schemas.byType.values()].sort((a, b) => a.type.localeCompare(b.type))) {
			const card = body.createDiv({ cls: "we-schema" });
			const head = card.createDiv({ cls: "we-schema-head we-clickable" });
			head.createSpan({ cls: "we-entity-name", text: schema.rawType });
			head.createSpan({ cls: "we-pill", text: `v${schema.version}` });
			head.createSpan({ cls: "we-pill", text: `${counts.find((c) => c.type === schema.type)?.count ?? 0} notes` });
			head.createSpan({ cls: "we-muted", text: schema.source });
			head.onclick = () => void this.openNote(schema.source);

			const table = card.createEl("table", { cls: "we-table" });
			for (const def of schema.properties.values()) {
				const row = table.createEl("tr");
				row.createEl("td", { text: def.name, cls: "we-dim" });
				row.createEl("td", { text: def.kind, cls: "we-muted" });
				row.createEl("td", { text: def.required ? "required" : "", cls: "we-muted" });
				row.createEl("td", { text: def.values ? def.values.join(" | ") : (def.description ?? ""), cls: "we-detail" });
			}
			for (const def of schema.relationships.values()) {
				const row = table.createEl("tr");
				row.createEl("td", { text: def.name, cls: "we-dim" });
				row.createEl("td", { text: "relationship", cls: "we-muted" });
				row.createEl("td", { text: def.cardinality, cls: "we-muted" });
				row.createEl("td", { text: [def.target ? `→ ${def.target}` : "", def.inverse ? `inverse: ${def.inverse}` : ""].filter(Boolean).join(" · "), cls: "we-detail" });
			}
		}
	}

	private card(parent: HTMLElement, label: string, value: string, detail: string): void {
		const card = parent.createDiv({ cls: "we-card" });
		card.createDiv({ cls: "we-card-label", text: label });
		card.createDiv({ cls: "we-card-value", text: value });
		card.createDiv({ cls: "we-card-detail", text: detail });
	}

	private section(parent: HTMLElement, title: string): void {
		parent.createEl("h3", { cls: "we-section", text: title });
	}

	/** Open a note, and put the cursor on the property a finding is about. The
	 * line is found by searching the frontmatter rather than stored on the issue:
	 * a line number captured at index time is wrong the moment the user edits the
	 * file, and a finding that scrolls to the wrong line is worse than one that
	 * does not scroll at all.
	 *
	 * **Not called `open`.** `View` has an undocumented internal `open()` that Obsidian
	 * calls to attach the view; naming this one `open` silently overrode it, Obsidian
	 * handed it an HTMLElement where this expects a path, the lookup failed and it
	 * returned -- so `onOpen()` never ran, `contentEl` was never attached, and the
	 * dashboard rendered into a detached element. `View.open` is not in the public
	 * typings, so there was nothing for `tsc` to complain about. `tests/reserved.test.cjs`
	 * now checks every member this class declares against the real member list. */
	private async openNote(path: string, property?: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.openFile(file);
		if (!property) return;
		const text = await this.app.vault.cachedRead(file);
		const lines = text.split("\n");
		const needle = new RegExp(`^\\s*${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`);
		const line = lines.findIndex((l) => needle.test(l));
		if (line < 0) return;
		const editor = this.app.workspace.activeEditor?.editor;
		editor?.setCursor({ line, ch: 0 });
		editor?.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
	}
}
