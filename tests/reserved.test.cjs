// Nothing this plugin declares on a View subclass may shadow a member of the Obsidian
// class it extends.
const { suite, test, assert, done, load } = require("./harness.cjs");

/** Members of Component -> View -> ItemView, documented and undocumented. */
const RESERVED = new Set([
	// Component
	"load", "onload", "unload", "onunload", "addChild", "removeChild", "register",
	"registerEvent", "registerDomEvent", "registerInterval", "registerScopeEvent",
	// View / ItemView, public
	"app", "leaf", "containerEl", "contentEl", "titleEl", "icon", "navigation", "scope",
	"getViewType", "getDisplayText", "getIcon", "onOpen", "onClose", "getState", "setState",
	"getEphemeralState", "setEphemeralState", "onResize", "onPaneMenu", "getViewData",
	"setViewData",
	// View, internal but real -- these are the ones with teeth
	"open", "close", "onHeaderMenu", "onunloadFile", "onLoadFile", "onDelete", "onRename",
]);

/** The overrides that are the whole point of subclassing, and must not be flagged. */
const INTENDED = new Set(["getViewType", "getDisplayText", "getIcon", "onOpen", "onClose"]);

const members = (cls) => Object.getOwnPropertyNames(cls.prototype).filter((n) => n !== "constructor");
const clashes = (cls) => members(cls).filter((n) => RESERVED.has(n) && !INTENDED.has(n));

const { DashboardView } = load("ui-dashboard-view");
const { HealthView } = load("ui-health-view");

suite("reserved names");

test("DashboardView shadows no Obsidian View member", () => {
	assert.deepStrictEqual(clashes(DashboardView), []);
});

test("HealthView shadows no Obsidian View member", () => {
	assert.deepStrictEqual(clashes(HealthView), []);
});

test("the dashboard still declares the overrides it is supposed to", () => {
	for (const name of ["getViewType", "getDisplayText", "getIcon", "onOpen", "onClose"]) {
		assert.ok(members(DashboardView).includes(name), `missing ${name}`);
	}
});

// The guard is only worth having if it fires, so prove it does on the two names that
// actually bit -- `open` here, `scope` in the plugin this list came from.
test("the guard would catch `open` and `scope`", () => {
	assert.ok(RESERVED.has("open") && !INTENDED.has("open"));
	assert.ok(RESERVED.has("scope") && !INTENDED.has("scope"));
	const Fake = class { open() {} };
	assert.deepStrictEqual(clashes(Fake), ["open"]);
});

done();
