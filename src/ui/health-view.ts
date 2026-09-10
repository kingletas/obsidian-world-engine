import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type WorldEnginePlugin from "../main";
import { bar, health, percent, stats } from "../dashboard/dashboard-engine";
import { RULES } from "../validation/vault-linter";

export const VIEW_TYPE_HEALTH = "world-engine-health";

/** The §22 panel, on its own so it can live in the right sidebar next to a note
 * while the dashboard occupies the main pane. It shows the score and, directly
 * underneath, the counts the score came from -- §22's "should never hide the
 * underlying issues" is the only requirement this view has. */
export class HealthView extends ItemView {
	private unsubscribe: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: WorldEnginePlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_HEALTH;
	}

	getDisplayText(): string {
		return "Vault health";
	}

	getIcon(): string {
		return "activity";
	}

	async onOpen(): Promise<void> {
		this.unsubscribe = this.plugin.indexer.changed.on(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("world-engine");

		const state = this.plugin.indexer.state();
		const issues = this.plugin.issues();
		const data = stats(state.index, state.schemas);
		const report = health(state.index, issues, data, this.plugin.settings.weights);

		const header = root.createDiv({ cls: "we-header" });
		const title = header.createDiv({ cls: "we-title" });
		setIcon(title.createSpan({ cls: "we-title-icon" }), "activity");
		title.createSpan({ text: "Vault health" });

		const overall = root.createDiv({ cls: "we-overall" });
		overall.createDiv({ cls: "we-overall-value", text: percent(report.overall) });
		overall.createDiv({
			cls: "we-overall-detail",
			text: `${report.errors} errors · ${report.warnings} warnings · ${report.infos} info · ${data.totalNotes.toLocaleString()} notes indexed`,
		});

		const table = root.createEl("table", { cls: "we-table" });
		for (const dimension of report.dimensions) {
			const row = table.createEl("tr");
			row.createEl("td", { text: dimension.label, cls: "we-dim" });
			row.createEl("td", { text: bar(dimension.score, 16), cls: "we-bar" });
			row.createEl("td", { text: percent(dimension.score), cls: "we-num" });
			const detail = table.createEl("tr").createEl("td", { cls: "we-detail", text: dimension.detail });
			detail.colSpan = 3;
			if (dimension.weight === 0) row.addClass("we-muted");
		}

		root.createEl("h3", { cls: "we-section", text: "By check" });
		const byRule = new Map<string, number>();
		for (const issue of issues) byRule.set(issue.rule, (byRule.get(issue.rule) ?? 0) + 1);

		const ruleTable = root.createEl("table", { cls: "we-table" });
		const known = new Set(RULES.map((r) => r.id));
		const rows = [
			...RULES.map((rule) => ({ id: rule.id, title: rule.title, count: byRule.get(rule.id) ?? 0, off: this.plugin.settings.rules[rule.id] === false })),
			// Findings whose rule id is not in RULES come from the indexer
			// (invalid YAML) or from the validator's sub-rules. Listing them under
			// their own name is better than not listing them at all.
			...[...byRule.entries()]
				.filter(([id]) => !known.has(id))
				.map(([id, count]) => ({ id, title: id, count, off: false })),
		].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));

		for (const entry of rows) {
			const row = ruleTable.createEl("tr", { cls: entry.off ? "we-muted" : "" });
			row.createEl("td", { text: entry.title, cls: "we-dim" });
			row.createEl("td", { text: entry.off ? "off" : entry.count.toLocaleString(), cls: "we-num" });
		}

		const actions = root.createDiv({ cls: "we-actions" });
		const findings = actions.createEl("button", { text: "Open findings" });
		findings.onclick = () => void this.plugin.openDashboard("findings");
		const rescan = actions.createEl("button", { text: "Scan vault" });
		rescan.onclick = () => void this.plugin.scan(true);
	}
}
