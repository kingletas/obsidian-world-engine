// Bundles each pure module to CJS for the tests, and fails if `src/schemas.ts` has
// drifted from `schemas/*.yaml`.

import { build } from "esbuild";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(here, "build");
mkdirSync(out, { recursive: true });

const ENTRIES = [
	"core/parser.ts",
	"core/cache.ts",
	"core/graph.ts",
	"core/scope.ts",
	"core/types.ts",
	"schema/schema-engine.ts",
	"schema/validator.ts",
	"relationships/relationship-engine.ts",
	"relationships/flatten.ts",
	"canon/canon-engine.ts",
	"entities/entity-engine.ts",
	"entities/entity-types.ts",
	"validation/vault-linter.ts",
	"dashboard/dashboard-engine.ts",
	"ui/create-entity-modal.ts",
	"ui/create-relationship-modal.ts",
	"ui/dashboard-view.ts",
	"ui/health-view.ts",
	"schemas.ts",
];

// The UI modules import `obsidian`, so it is stubbed with an empty module at bundle time.
const stubObsidian = {
	name: "stub-obsidian",
	setup(b) {
		b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
		b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
			contents: `
				export class Modal { constructor(app) { this.app = app; } }
				export class Setting { setName() { return this; } setDesc() { return this; } addText() { return this; } addDropdown() { return this; } addButton() { return this; } addToggle() { return this; } addTextArea() { return this; } setHeading() { return this; } }
				export class Notice {}
				export class TFile {}
				export class ItemView { constructor(leaf) { this.leaf = leaf; } registerEvent() {} }
				export class WorkspaceLeaf {}
				export class Menu {}
				export const setIcon = () => {};
				export const normalizePath = (p) => p;
				export const parseYaml = () => null;
			`,
			loader: "js",
		}));
	},
};

for (const entry of ENTRIES) {
	const name = entry === "schemas.ts" ? "starter-schemas" : entry.replace(/[/]/g, "-").replace(/\.ts$/, "");
	await build({
		entryPoints: [join(root, "src", entry)],
		bundle: true,
		format: "cjs",
		platform: "node",
		target: "es2018",
		outfile: join(out, `${name}.cjs`),
		logLevel: "error",
		plugins: [stubObsidian],
	});
}

// --- the schemas/ <-> src/schemas.ts consistency check -----------------------

const files = readdirSync(join(root, "schemas")).filter((f) => f.endsWith(".yaml")).sort();
const lines = [
	"// Generated from the files in `schemas/` by `tests/build.mjs --schemas`.",
	"// Edit the YAML there, not this file: two copies that can drift are one copy",
	"// too many, and the check in the test suite fails if they do.",
	"",
	"export const STARTER_SCHEMAS: Record<string, string> = {",
];
for (const file of files) {
	lines.push(`\t${JSON.stringify(file)}: ${JSON.stringify(readFileSync(join(root, "schemas", file), "utf8"))},`);
}
lines.push("};", "");
const expected = lines.join("\n");
const target = join(root, "src", "schemas.ts");

if (process.argv.includes("--schemas")) {
	writeFileSync(target, expected);
	console.log("build: regenerated src/schemas.ts");
} else if (readFileSync(target, "utf8") !== expected) {
	console.error("build: src/schemas.ts has drifted from schemas/*.yaml. Run `node tests/build.mjs --schemas`.");
	process.exit(1);
}

console.log(`build\n  ok  ${ENTRIES.length} modules bundled`);
console.log(`  ok  src/schemas.ts matches ${files.length} schema files\n`);
