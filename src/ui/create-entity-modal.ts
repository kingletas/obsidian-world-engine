import { App, Modal, Notice, Setting, TFile, normalizePath } from "obsidian";
import type { EntitySchema, PropertyDef } from "../schema/types";
import { defaultFolder, typeLabel } from "../entities/entity-types";

/** Everything the modal needs, so it can be constructed without the plugin. */
export interface CreateEntityOptions {
	schemas: Map<string, EntitySchema>;
	/** Types with no schema, offered anyway -- §8.1 requires custom types and a
	 * picker that only lists schemas would make the first entity impossible. */
	extraTypes: string[];
	defaultCanon: string;
	canonProperty: string;
	typeProperty: string;
	idProperty: string;
	onCreate(file: TFile): void;
}

/** Turn a title into an id: lowercase, non-alphanumerics to hyphens (`Battle of Grey Ford` -> `battle-of-grey-ford`). */
export function slugify(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** The starting value for a property in a new note. A schema default wins; an
 * enum with no default offers its first value; everything else is left empty so
 * the user fills it in rather than inheriting a placeholder that looks like data. */
export function seedValue(def: PropertyDef, defaultCanon: string): unknown {
	if (def.default !== undefined) return def.default;
	if (def.name === "canon_status") return defaultCanon;
	if (def.kind === "enum" && def.values?.length) return def.values[0];
	if (def.kind === "list" || def.kind === "links") return [];
	return "";
}

/** Build the frontmatter for a new entity. Pure, so the test can assert on the
 * exact block that reaches the file. */
export function entityFrontmatter(
	type: string,
	title: string,
	schema: EntitySchema | undefined,
	options: { defaultCanon: string; typeProperty: string; idProperty: string; canonProperty: string }
): Record<string, unknown> {
	const fm: Record<string, unknown> = {};
	fm[options.typeProperty] = schema?.rawType ?? type;
	fm[options.idProperty] = slugify(title);
	fm.title = title;
	if (schema) {
		for (const def of schema.properties.values()) {
			if (def.name === options.typeProperty || def.name === options.idProperty || def.name === "title") continue;
			fm[def.name] = seedValue(def, options.defaultCanon);
		}
		if (schema.version !== 1) fm.schema_version = schema.version;
	}
	if (fm[options.canonProperty] === undefined) fm[options.canonProperty] = options.defaultCanon;
	return fm;
}

/** Serialise frontmatter without a YAML library. Only the shapes this modal
 * produces are handled -- strings, numbers, booleans and flat lists -- because
 * that is all a seeded note ever contains, and a half-implemented emitter that
 * silently mangles a nested value would be worse than none. */
export function toYaml(fm: Record<string, unknown>): string {
	const quote = (value: string): string => {
		if (value === "") return '""';
		if (/^[\w .'\/-]+$/.test(value) && !/^\d+$/.test(value)) return value;
		return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	};
	const lines: string[] = [];
	for (const [key, value] of Object.entries(fm)) {
		if (Array.isArray(value)) {
			lines.push(`${key}:`);
			for (const item of value) lines.push(`  - ${quote(String(item))}`);
			if (value.length === 0) lines[lines.length - 1] = `${key}: []`;
			continue;
		}
		if (typeof value === "boolean" || typeof value === "number") {
			lines.push(`${key}: ${value}`);
			continue;
		}
		lines.push(`${key}: ${quote(String(value ?? ""))}`);
	}
	return `---\n${lines.join("\n")}\n---\n`;
}

export class CreateEntityModal extends Modal {
	private type = "";
	private title = "";
	private folder = "";

	constructor(
		app: App,
		private options: CreateEntityOptions
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Create entity" });

		// Declared before the type dropdown because the dropdown's handler writes
		// into it: picking a type retargets the folder field.
		let folderText: { setValue(value: string): unknown } | null = null;

		const types = [
			...new Set([...this.options.schemas.keys(), ...this.options.extraTypes]),
		].sort();
		this.type = types[0] ?? "character";

		new Setting(contentEl).setName("Type").addDropdown((dropdown) => {
			for (const type of types) {
				const schema = this.options.schemas.get(type);
				dropdown.addOption(type, schema ? `${schema.rawType} (schema)` : typeLabel(type));
			}
			dropdown.setValue(this.type).onChange((value) => {
				this.type = value;
				this.folder = this.options.schemas.get(value)?.folder ?? defaultFolder(value);
				folderText?.setValue(this.folder);
			});
		});

		new Setting(contentEl).setName("Name").addText((text) =>
			text.setPlaceholder("Mara Quill").onChange((value) => {
				this.title = value;
			})
		);

		this.folder = this.options.schemas.get(this.type)?.folder ?? defaultFolder(this.type);
		new Setting(contentEl)
			.setName("Folder")
			.setDesc("Created if it does not exist.")
			.addText((text) => {
				folderText = text;
				text.setValue(this.folder).onChange((value) => {
					this.folder = value;
				});
			});

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText("Create")
				.setCta()
				.onClick(() => void this.create())
		);
	}

	private async create(): Promise<void> {
		const title = this.title.trim();
		if (!title) {
			new Notice("World Engine: the entity needs a name.");
			return;
		}
		const folder = normalizePath(this.folder.trim() || defaultFolder(this.type));
		const path = normalizePath(`${folder}/${title}.md`);

		if (this.app.vault.getAbstractFileByPath(path)) {
			// §28: never silently overwrite. Opening the existing note is almost
			// always what the user wanted anyway.
			new Notice(`World Engine: ${path} already exists — opening it instead.`);
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) this.options.onCreate(existing);
			this.close();
			return;
		}

		if (!this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder).catch(() => undefined);
		}

		const schema = this.options.schemas.get(this.type);
		const fm = entityFrontmatter(this.type, title, schema, {
			defaultCanon: this.options.defaultCanon,
			typeProperty: this.options.typeProperty,
			idProperty: this.options.idProperty,
			canonProperty: this.options.canonProperty,
		});

		const file = await this.app.vault.create(path, `${toYaml(fm)}\n# ${title}\n\n`);
		this.options.onCreate(file);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
