// Loads the built main.js with a stubbed `obsidian` and checks the commands, view types
// and settings defaults are present.
const Module = require("module");
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const registered = { commands: [], views: [], ribbons: [], settingTabs: 0, events: 0 };

class Base {
	constructor(...args) {
		this._args = args;
	}
}

const stub = {
	Plugin: class extends Base {
		constructor(app, manifest) {
			super(app, manifest);
			this.app = app;
			this.manifest = manifest;
		}
		registerView(type) { registered.views.push(type); }
		addCommand(command) { registered.commands.push(command); }
		addRibbonIcon(icon, title) { registered.ribbons.push(title); }
		addSettingTab() { registered.settingTabs += 1; }
		addStatusBarItem() { return { addClass() {}, setText() {}, setAttr() {} }; }
		registerEvent(ref) {
			// registerEvent must receive an EventRef, because Obsidian calls `ref.e.offref(ref)` on unload.
			assert.strictEqual(typeof ref, "object", "registerEvent was given something that is not an EventRef");
			registered.events += 1;
		}
		async loadData() { return null; }
		async saveData() {}
	},
	ItemView: class extends Base { registerEvent() {} },
	PluginSettingTab: class extends Base {},
	Modal: class extends Base {},
	Menu: class { addItem() { return this; } showAtMouseEvent() {} },
	Setting: class {
		setName() { return this; }
		setDesc() { return this; }
		setHeading() { return this; }
		addToggle() { return this; }
		addDropdown() { return this; }
		addText() { return this; }
		addTextArea() { return this; }
		addButton() { return this; }
	},
	Notice: class {},
	TFile: class extends Base {},
	WorkspaceLeaf: class extends Base {},
	setIcon: () => {},
	normalizePath: (p) => p.replace(/\/+/g, "/"),
	parseYaml: () => null,
};

const orig = Module._load;
Module._load = function (request) {
	if (request === "obsidian") return stub;
	return orig.apply(this, arguments);
};

// package.json says "type":"module" but Obsidian requires a CJS bundle. Node
// needs the extension to agree before it will require() it; Obsidian loads
// main.js itself and does not care.
const bundle = path.resolve(__dirname, "..", "main.js");
assert.ok(fs.existsSync(bundle), "main.js is missing — run `npm run build` first");
const tmp = path.join(__dirname, "main.build.cjs");
fs.copyFileSync(bundle, tmp);
const mod = require(tmp);
fs.unlinkSync(tmp);

console.log("smoke");
let passed = 0;
const ok = (message) => {
	passed += 1;
	console.log(`  ok  ${message}`);
};

const Plugin = mod.default ?? mod;
assert.strictEqual(typeof Plugin, "function", "default export is not a class");
assert.strictEqual(Object.getPrototypeOf(Plugin), stub.Plugin, "does not extend Plugin");
ok("the bundle loads and extends Plugin");

// A minimal app. Every method the load path touches, and nothing else -- a stub
// that answers everything would hide a call that has no business being on the
// load path in the first place.
const app = {
	workspace: {
		onLayoutReady(fn) { this._ready = fn; },
		getActiveFile: () => null,
		getLeavesOfType: () => [],
		getLeaf: () => ({ setViewState() {}, openFile() {} }),
		getRightLeaf: () => null,
		revealLeaf() {},
		on: () => ({}),
	},
	metadataCache: { on: () => ({}), offref() {}, getFirstLinkpathDest: () => null, getFileCache: () => null },
	vault: {
		on: () => ({}),
		getMarkdownFiles: () => [],
		adapter: { async exists() { return false; }, async read() { return ""; }, async write() {}, async list() { return { files: [] }; }, async remove() {} },
	},
	fileManager: {},
};

const plugin = new Plugin(app, { id: "world-engine", dir: ".obsidian/plugins/world-engine" });

(async () => {
	await plugin.onload();

	// Every command §33 lists as MVP-scope, by id.
	const ids = registered.commands.map((c) => c.id).sort();
	for (const required of [
		"scan-vault",
		"validate-note",
		"open-dashboard",
		"show-health",
		"create-entity",
		"create-relationship",
		"rebuild-index",
		"create-starter-schemas",
	]) {
		assert.ok(ids.includes(required), `missing command \`${required}\` (have: ${ids.join(", ")})`);
	}
	ok(`${ids.length} commands registered, including every MVP command in §33`);

	// A command that needs a note must hide itself when there is none, rather
	// than being invocable and failing.
	for (const command of registered.commands) {
		if (!command.checkCallback) continue;
		assert.strictEqual(command.checkCallback(true), false, `\`${command.id}\` is available with no active file`);
	}
	ok("note-scoped commands hide themselves when there is no note");

	assert.deepStrictEqual(registered.views.sort(), ["world-engine-dashboard", "world-engine-health"]);
	assert.strictEqual(registered.settingTabs, 1);
	assert.strictEqual(registered.ribbons.length, 1);
	ok("both views, the settings tab and the ribbon icon are registered");

	assert.strictEqual(registered.events, 3, `expected 3 vault events, got ${registered.events}`);
	// The startup scan waits for `metadataCache.on("resolved")` rather than
	// running on layout-ready: building before the link map is complete makes
	// every link in the vault look broken for a few seconds.
	app.workspace._ready();
	assert.strictEqual(registered.events, 4, "the startup scan did not wait for the metadata cache to resolve");
	ok("the vault events that drive incremental indexing are registered, and startup waits for `resolved`");

	// Defaults must survive an empty data.json -- loadData() returns null above.
	assert.strictEqual(plugin.settings.enabled, true);
	assert.strictEqual(plugin.settings.schemaFolder, "Engine/Schemas");
	// Ships empty, because a default folder name would scope every install to a path that does not exist.
	assert.deepStrictEqual(plugin.settings.includeFolders, []);
	assert.deepStrictEqual(plugin.settings.excludeFolders, []);
	assert.deepStrictEqual(Object.keys(plugin.settings.weights).sort(), ["continuity", "links", "metadata", "schemas", "structure"]);
	ok("settings fall back to defaults when data.json is empty, and the default scope is unset");

	// A stored settings object written before `includeFolders` existed must not
	// crash. The scan notice and the dashboard header both name the scope, so
	// whatever it resolves to is visible rather than assumed.
	assert.strictEqual(typeof plugin.indexer.scope, "function");
	const scope = plugin.indexer.scope();
	assert.deepStrictEqual(scope.include, plugin.settings.includeFolders);
	ok("the indexer reports the scope it is actually using");

	// The public API surface §30 sketches. Checked as shape, not behaviour: a
	// renamed method here breaks another plugin silently.
	const api = plugin.api;
	for (const [group, methods] of Object.entries({
		entities: ["all", "find", "get"],
		relationships: ["of", "to"],
		schema: ["all", "get"],
		canon: ["statusOf"],
		validation: ["issues", "forNote"],
	})) {
		for (const method of methods) assert.strictEqual(typeof api[group][method], "function", `api.${group}.${method} is missing`);
	}
	assert.strictEqual(typeof api.stats, "function");
	ok("the read-only plugin API is complete");

	// An empty vault must produce an empty index and an empty finding list, not
	// a crash and not a divide-by-zero in the health score.
	assert.deepStrictEqual(api.entities.all(), []);
	assert.deepStrictEqual(api.validation.issues(), []);
	const data = api.stats();
	assert.strictEqual(data.totalNotes, 0);
	assert.strictEqual(data.health.overall, null, "an empty vault scored a health percentage");
	ok("an empty vault indexes to nothing without dividing by zero");

	const { STARTER_SCHEMAS } = require("./build/starter-schemas.cjs");
	assert.ok(Object.keys(STARTER_SCHEMAS).length >= 2);
	for (const [name, body] of Object.entries(STARTER_SCHEMAS)) {
		assert.match(name, /\.yaml$/);
		assert.ok(body.includes("version:"), `${name} declares no schema version`);
	}
	ok(`${Object.keys(STARTER_SCHEMAS).length} starter schemas are bundled into the plugin`);

	plugin.onunload();
	ok("unload is clean");

	console.log(`smoke: ${passed} passed\n`);
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
