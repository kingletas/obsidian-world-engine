import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type WorldEnginePlugin from "./main";
import { DEFAULT_PARSE_OPTIONS } from "./core/parser";
import { RULES } from "./validation/vault-linter";
import type { Severity } from "./core/types";
import { DEFAULT_WEIGHTS, type Weights } from "./dashboard/dashboard-engine";
import { describeScope } from "./core/scope";

export interface WorldEngineSettings {
	enabled: boolean;
	scanOnStartup: boolean;
	validateOnSave: boolean;
	useSnapshot: boolean;
	schemaFolder: string;
	/** Allowlist. Empty means the whole vault. */
	includeFolders: string[];
	excludeFolders: string[];
	typeProperty: string;
	canonProperty: string;
	idProperty: string;
	titleProperty: string;
	relationshipProperty: string;
	inlineRelationshipTypes: string[];
	dateProperties: string[];
	defaultCanonState: string;
	/** Rule id -> enabled. Absent means enabled. */
	rules: Record<string, boolean>;
	/** Rule id -> severity override. */
	severity: Record<string, Severity>;
	weights: Weights;
	showStatusBar: boolean;
}

export const DEFAULT_SETTINGS: WorldEngineSettings = {
	enabled: true,
	scanOnStartup: true,
	validateOnSave: true,
	useSnapshot: true,
	schemaFolder: "Engine/Schemas",
	// Empty means the whole vault; a default folder name would scope every other install
	// to a path that does not exist.
	includeFolders: [],
	excludeFolders: [],
	typeProperty: DEFAULT_PARSE_OPTIONS.typeProperty,
	canonProperty: DEFAULT_PARSE_OPTIONS.canonProperty,
	idProperty: DEFAULT_PARSE_OPTIONS.idProperty,
	titleProperty: DEFAULT_PARSE_OPTIONS.titleProperty,
	relationshipProperty: DEFAULT_PARSE_OPTIONS.relationshipProperty,
	inlineRelationshipTypes: [...DEFAULT_PARSE_OPTIONS.inlineRelationshipTypes],
	dateProperties: ["date", "start_date", "end_date", "born", "died"],
	defaultCanonState: "draft",
	rules: {},
	severity: {},
	weights: { ...DEFAULT_WEIGHTS },
	showStatusBar: true,
};

/** Split a comma-or-newline list the way a settings field is actually typed. */
export function parseList(value: string): string[] {
	return value
		.split(/[,\n]/)
		.map((part) => part.trim())
		.filter(Boolean);
}

export class WorldEngineSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: WorldEnginePlugin
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("General").setHeading();

		new Setting(containerEl)
			.setName("Enable World Engine")
			.setDesc("Turning this off stops all indexing and validation. It changes nothing in your Markdown — the index is a cache, and the vault is unaffected either way.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
					this.plugin.settings.enabled = value;
					await this.plugin.saveSettings();
					if (value) void this.plugin.scan(true);
				})
			);

		new Setting(containerEl)
			.setName("Scan the vault on startup")
			.setDesc("Builds the index when Obsidian finishes loading. Off means nothing is indexed until you run a command.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.scanOnStartup).onChange(async (value) => {
					this.plugin.settings.scanOnStartup = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Validate on save")
			.setDesc("Re-checks a note when it changes and updates the status bar count.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.validateOnSave).onChange(async (value) => {
					this.plugin.settings.validateOnSave = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Reuse the index snapshot")
			.setDesc("Startup reuses the cached index for files whose size and modification time are unchanged. Off re-parses everything every time. The snapshot never affects results — it is discarded on any mismatch.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.useSnapshot).onChange(async (value) => {
					this.plugin.settings.useSnapshot = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Status bar")
			.setDesc("Show the current note's finding count in the status bar.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showStatusBar).onChange(async (value) => {
					this.plugin.settings.showStatusBar = value;
					await this.plugin.saveSettings();
					new Notice("World Engine: reload Obsidian to apply the status bar change.");
				})
			);

		new Setting(containerEl).setName("Schemas").setHeading();

		new Setting(containerEl)
			.setName("Schema folder")
			.setDesc("Vault-relative folder holding .yaml schema files. Every schema is a plain YAML file you can edit, diff and commit.")
			.addText((text) =>
				text.setValue(this.plugin.settings.schemaFolder).onChange(async (value) => {
					this.plugin.settings.schemaFolder = value.trim() || DEFAULT_SETTINGS.schemaFolder;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Starter schemas")
			.setDesc("Writes a schema for each built-in entity type into the schema folder. Existing files are never overwritten.")
			.addButton((button) =>
				button.setButtonText("Create starter schemas").onClick(() => void this.plugin.writeStarterSchemas())
			);

		new Setting(containerEl).setName("Scope").setHeading();
		const scopeDesc = containerEl.createEl("p", { cls: "setting-item-description" });
		scopeDesc.setText(`Currently indexing ${describeScope(this.plugin.indexer.scope())}.`);

		new Setting(containerEl)
			.setName("Indexed folders")
			.setDesc(
				"Comma-separated, one folder per entry, vault-relative. Only notes under these folders are indexed at all. " +
					"Leave empty to index the whole vault. Links still resolve vault-wide, so a note in scope can link out of it without reading as broken."
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("empty = the whole vault")
					.setValue(this.plugin.settings.includeFolders.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.includeFolders = parseList(value);
						await this.plugin.saveSettings();
						scopeDesc.setText(`Currently indexing ${describeScope(this.plugin.indexer.scope())}. Rescan to apply.`);
					})
			);

		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc("Comma-separated, applied after the allowlist so a folder can be carved out of an indexed tree.")
			.addTextArea((text) =>
				text.setValue(this.plugin.settings.excludeFolders.join(", ")).onChange(async (value) => {
					this.plugin.settings.excludeFolders = parseList(value);
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Rescan after changing the scope")
			.setDesc("The index only covers what was in scope when it was built, so a scope change needs a rescan to take effect.")
			.addButton((button) => button.setButtonText("Scan now").onClick(() => void this.plugin.scan(true)));

		new Setting(containerEl).setName("Properties").setHeading();

		const props: Array<[keyof WorldEngineSettings, string, string]> = [
			["typeProperty", "Type property", "Frontmatter key holding the entity type."],
			["canonProperty", "Canon property", "Frontmatter key holding the canon state."],
			["idProperty", "ID property", "Frontmatter key holding the unique id."],
			["titleProperty", "Title property", "Frontmatter key holding the display title. Falls back to the filename."],
			["relationshipProperty", "Relationships property", "Frontmatter key holding the relationship block."],
		];
		for (const [key, name, desc] of props) {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((text) =>
					text.setValue(String(this.plugin.settings[key])).onChange(async (value) => {
						(this.plugin.settings as unknown as Record<string, unknown>)[key] = value.trim() || String(DEFAULT_SETTINGS[key]);
						await this.plugin.saveSettings();
					})
				);
		}

		new Setting(containerEl)
			.setName("Inline relationship properties")
			.setDesc("Top-level properties that hold links and should count as relationships — `location`, `participants`. Comma-separated. Every relationship kind a schema declares is already read this way; list only kinds no schema declares.")
			.addTextArea((text) =>
				text.setValue(this.plugin.settings.inlineRelationshipTypes.join(", ")).onChange(async (value) => {
					this.plugin.settings.inlineRelationshipTypes = parseList(value);
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Date properties")
			.setDesc("Properties checked for a date shape even where no schema declares them. Comma-separated.")
			.addTextArea((text) =>
				text.setValue(this.plugin.settings.dateProperties.join(", ")).onChange(async (value) => {
					this.plugin.settings.dateProperties = parseList(value);
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Default canon state")
			.setDesc("Written into notes created by the entity command.")
			.addDropdown((dropdown) => {
				for (const state of ["idea", "draft", "provisional", "canon"]) dropdown.addOption(state, state);
				dropdown.setValue(this.plugin.settings.defaultCanonState).onChange(async (value) => {
					this.plugin.settings.defaultCanonState = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName("Linter rules").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Each check can be turned off, or reported at a different severity. Severity is what the health score counts, so lowering one lowers what it reports — the findings themselves do not change.",
		});

		for (const rule of RULES) {
			new Setting(containerEl)
				.setName(`${rule.title} (${rule.code})`)
				.setDesc(rule.description)
				.addDropdown((dropdown) => {
					dropdown.addOption("default", `Default (${rule.defaultSeverity})`);
					for (const severity of ["error", "warning", "info"]) dropdown.addOption(severity, severity);
					dropdown.setValue(this.plugin.settings.severity[rule.id] ?? "default").onChange(async (value) => {
						if (value === "default") delete this.plugin.settings.severity[rule.id];
						else this.plugin.settings.severity[rule.id] = value as Severity;
						await this.plugin.saveSettings();
						this.plugin.refresh();
					});
				})
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.rules[rule.id] !== false).onChange(async (value) => {
						this.plugin.settings.rules[rule.id] = value;
						await this.plugin.saveSettings();
						this.plugin.refresh();
					})
				);
		}

		new Setting(containerEl).setName("Health score weights").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Weight each dimension in the overall score. A weight of 0 drops it entirely. Continuity is always unscored in this release — §15 of the BRD is not implemented, and a dimension nothing measures must not score 100%.",
		});

		for (const id of Object.keys(DEFAULT_WEIGHTS)) {
			new Setting(containerEl)
				.setName(id.charAt(0).toUpperCase() + id.slice(1))
				.addText((text) =>
					text
						.setPlaceholder("1")
						.setValue(String(this.plugin.settings.weights[id] ?? 1))
						.onChange(async (value) => {
							const parsed = Number(value);
							this.plugin.settings.weights[id] = Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
							await this.plugin.saveSettings();
							this.plugin.refresh();
						})
				);
		}

		new Setting(containerEl).setName("Index").setHeading();

		new Setting(containerEl)
			.setName("Rebuild the index")
			.setDesc("Discards the snapshot and re-reads every note. Nothing in the vault is modified.")
			.addButton((button) => button.setButtonText("Rebuild").onClick(() => void this.plugin.rebuild()));
	}
}
