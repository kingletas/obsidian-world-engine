import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type { RelationshipDef } from "../schema/types";
import { normaliseRelType } from "../relationships/relationship-engine";

export interface CreateRelationshipOptions {
	/** The note the relationship is declared on. */
	sourcePath: string;
	/** Relationship types the source's schema declares, offered first. */
	declared: RelationshipDef[];
	/** Every relationship type already used anywhere in the vault, so an
	 * unschema'd vault still gets a useful list instead of a blank box. */
	known: string[];
	relationshipProperty: string;
	/** Candidate targets: every entity in the vault. */
	targets: Array<{ path: string; title: string; type: string | null }>;
	onDone(): void;
}

/** Add one relationship to a frontmatter object in place, keeping the note's existing shape
 * or using the flat shape when it has none. */
export function addRelationship(
	frontmatter: Record<string, unknown>,
	relProperty: string,
	type: string,
	link: string
): { changed: boolean; reason?: string } {
	const normalised = normaliseRelType(type);
	const block = frontmatter[relProperty];

	// List form -- `- {target: ..., type: ...}`. Appended to in its own shape.
	if (Array.isArray(block)) {
		const exists = block.some((item) => {
			if (!item || typeof item !== "object") return false;
			const rec = item as Record<string, unknown>;
			return normaliseRelType(String(rec.type ?? "")) === normalised && String(rec.target ?? "") === link;
		});
		if (exists) return { changed: false, reason: "already declared" };
		block.push({ type: normalised, target: link });
		return { changed: true };
	}

	// Map form -- the nested block this note already carries stays its shape.
	if (block && typeof block === "object") {
		const map = block as Record<string, unknown>;
		const existing = map[normalised];

		if (Array.isArray(existing)) {
			if (existing.some((v) => String(v) === link)) return { changed: false, reason: "already declared" };
			existing.push(link);
		} else if (typeof existing === "string") {
			if (existing === link) return { changed: false, reason: "already declared" };
			map[normalised] = [existing, link];
		} else {
			map[normalised] = [link];
		}
		return { changed: true };
	}

	// No block: the flat shape.
	const existing = frontmatter[normalised];
	if (Array.isArray(existing)) {
		if (existing.some((v) => String(v) === link)) return { changed: false, reason: "already declared" };
		existing.push(link);
	} else if (typeof existing === "string") {
		if (existing === link) return { changed: false, reason: "already declared" };
		frontmatter[normalised] = [existing, link];
	} else {
		frontmatter[normalised] = [link];
	}
	return { changed: true };
}

export class CreateRelationshipModal extends Modal {
	private type = "";
	private targetPath = "";

	constructor(
		app: App,
		private options: CreateRelationshipOptions
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Create relationship" });
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: `Written into the properties of ${this.options.sourcePath}. Nothing is written to the target note — the reverse direction is inferred from the schema's \`inverse\`, not duplicated into a second file.`,
		});

		const types = [...new Set([...this.options.declared.map((d) => d.name), ...this.options.known])].sort();
		this.type = types[0] ?? "";

		new Setting(contentEl)
			.setName("Type")
			.setDesc(types.length ? "" : "No relationship types are declared or in use yet — type one below.")
			.addDropdown((dropdown) => {
				for (const type of types) {
					const def = this.options.declared.find((d) => d.name === type);
					dropdown.addOption(type, def?.target ? `${type} → ${def.target}` : type);
				}
				dropdown.addOption("__custom", "Other…");
				dropdown.setValue(this.type || "__custom").onChange((value) => {
					this.type = value === "__custom" ? "" : value;
					custom.settingEl.toggleClass("we-hidden", value !== "__custom");
				});
			});

		const custom = new Setting(contentEl).setName("Custom type").addText((text) =>
			text.setPlaceholder("member_of").onChange((value) => {
				this.type = value;
			})
		);
		custom.settingEl.toggleClass("we-hidden", types.length > 0);

		const targets = [...this.options.targets]
			.filter((t) => t.path !== this.options.sourcePath)
			.sort((a, b) => a.title.localeCompare(b.title));
		this.targetPath = targets[0]?.path ?? "";

		new Setting(contentEl).setName("Target").addDropdown((dropdown) => {
			for (const target of targets) dropdown.addOption(target.path, target.type ? `${target.title} — ${target.type}` : target.title);
			dropdown.setValue(this.targetPath).onChange((value) => {
				this.targetPath = value;
			});
		});

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText("Add")
				.setCta()
				.onClick(() => void this.apply())
		);
	}

	private async apply(): Promise<void> {
		const type = this.type.trim();
		if (!type || !this.targetPath) {
			new Notice("World Engine: pick a relationship type and a target.");
			return;
		}
		const source = this.app.vault.getAbstractFileByPath(this.options.sourcePath);
		const target = this.app.vault.getAbstractFileByPath(this.targetPath);
		if (!(source instanceof TFile) || !(target instanceof TFile)) {
			new Notice("World Engine: that note no longer exists.");
			return;
		}

		// `processFrontMatter` edits the properties without rewriting the rest of the note.
		const link = `[[${this.app.metadataCache.fileToLinktext(target, source.path)}]]`;
		let result: { changed: boolean; reason?: string } = { changed: false };
		await this.app.fileManager.processFrontMatter(source, (fm: Record<string, unknown>) => {
			result = addRelationship(fm, this.options.relationshipProperty, type, link);
		});

		new Notice(
			result.changed
				? `World Engine: ${normaliseRelType(type)} → ${target.basename}`
				: `World Engine: unchanged (${result.reason ?? "nothing to do"}).`
		);
		this.options.onDone();
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
