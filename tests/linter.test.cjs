const { assert, suite, test, done, load } = require("./harness.cjs");
const { lint, groupByPath, RULES } = load("validation-vault-linter");
const { compileSchemas } = load("schema-schema-engine");
const { assemble } = load("core-graph");
const { buildRecords, NOTES } = require("./fixtures.cjs");

const NO_SCHEMAS = { byType: new Map(), problems: [] };

const SCHEMAS = compileSchemas([
	{
		source: "Engine/Schemas/core.yaml",
		data: {
			character: { required: ["status"], properties: { status: { type: "enum", values: ["alive", "dead", "unknown"] } } },
			location: { properties: {} },
			faction: { properties: {} },
			item: { properties: {} },
			event: { required: ["date"], properties: { date: { type: "date" } } },
		},
	},
]);

const index = (notes, extra) => assemble(buildRecords(notes, extra), new Map());
const ruleIds = (result) => [...new Set(result.issues.map((i) => i.rule))].sort();
const forRule = (result, rule) => result.issues.filter((i) => i.rule === rule);

suite("linter");

test("the §37 fixture vault produces exactly the one finding it earns", () => {
	const result = lint(index(), SCHEMAS);
	assert.strictEqual(result.scannedNotes, 7);
	// Isa Venn is written `canon_status: established` -- §11's own spelling, which
	// is not one of §11's own six states. One INFO, and nothing else: no broken
	// links, no schema violations, no orphans.
	assert.strictEqual(result.issues.length, 1, JSON.stringify(result.issues, null, 2));
	assert.strictEqual(result.issues[0].rule, "canon-state");
	assert.strictEqual(result.issues[0].severity, "info");
});

test("every rule reports a count, including the ones that found nothing", () => {
	const result = lint(index(), SCHEMAS);
	for (const rule of RULES) assert.ok(rule.id in result.byRule, `${rule.id} reported no count`);
});

test("a duplicate id is an ERROR on both notes and names the other", () => {
	const notes = { ...NOTES, "Characters/Mara Quill Copy.md": { type: "character", id: "mara-quill", title: "Mara Quill the Second", status: "alive", canon_status: "draft" } };
	const found = forRule(lint(index(notes), SCHEMAS), "duplicate-ids");
	assert.strictEqual(found.length, 2);
	assert.ok(found.every((i) => i.severity === "error"));
	assert.match(found[0].hint, /Mara Quill Copy|Mara Quill\.md/);
});

test("a duplicate title of the same type is a WARNING, and a different type is not", () => {
	const same = { ...NOTES, "Characters/Mara Quill 2.md": { type: "character", id: "mara-quill-2", title: "Mara Quill", status: "alive" } };
	assert.strictEqual(forRule(lint(index(same), SCHEMAS), "duplicate-entities").length, 2);

	const different = { ...NOTES, "Locations/Mara Quill.md": { type: "location", id: "mara-quill-place", title: "Mara Quill" } };
	assert.strictEqual(forRule(lint(index(different), SCHEMAS), "duplicate-entities").length, 0);
});

test("a broken link is found and quoted back as the user typed it", () => {
	const result = lint(index(NOTES, { links: { "Characters/Mara Quill.md": [{ link: "Nowhere At All" }] } }), SCHEMAS);
	const found = forRule(result, "broken-links");
	assert.strictEqual(found.length, 1);
	assert.match(found[0].message, /\[\[Nowhere At All\]\]/);
});

test("a broken embed is a dead embed, not a broken link — they are separate rules", () => {
	const result = lint(index(NOTES, { embeds: { "Characters/Mara Quill.md": [{ link: "missing.png" }] } }), SCHEMAS);
	assert.strictEqual(forRule(result, "broken-links").length, 0);
	const found = forRule(result, "dead-embeds");
	assert.strictEqual(found.length, 1);
	assert.match(found[0].message, /missing embedded file/);
});

test("a broken relationship is reported with its type and its target", () => {
	const notes = { ...NOTES, "Characters/Mara Quill.md": { ...NOTES["Characters/Mara Quill.md"], relationships: { knows: ["[[Someone Missing]]"] } } };
	const found = forRule(lint(index(notes), SCHEMAS), "broken-relationships");
	assert.strictEqual(found.length, 1);
	assert.match(found[0].message, /`knows` points at `Someone Missing`/);
});

test("an unrecognised canon state is a WARNING; an alias is INFO", () => {
	const notes = {
		"a.md": { type: "character", title: "A", status: "alive", canon_status: "mostly true" },
		"b.md": { type: "character", title: "B", status: "alive", canon_status: "established" },
	};
	const found = forRule(lint(index(notes), SCHEMAS), "canon-state");
	assert.strictEqual(found.find((i) => i.path === "a.md").severity, "warning");
	assert.strictEqual(found.find((i) => i.path === "b.md").severity, "info");
});

test("a bad date is caught even with no schema declaring it", () => {
	const notes = { "e.md": { type: "event", title: "E", date: "the third age" } };
	const result = lint(index(notes), NO_SCHEMAS);
	assert.strictEqual(forRule(result, "invalid-dates").length, 1);
});

test("orphans need a type — an untyped note that links nowhere is not an orphan", () => {
	const notes = {
		"Characters/Alone.md": { type: "character", title: "Alone", status: "alive" },
		"Journal/Tuesday.md": { note: "no type here" },
	};
	const found = forRule(lint(index(notes), SCHEMAS), "orphan-notes");
	assert.deepStrictEqual(found.map((i) => i.path), ["Characters/Alone.md"]);
});

test("`missing-type` fires only where the folder is mostly typed", () => {
	const notes = {
		"Characters/A.md": { type: "character", title: "A", status: "alive" },
		"Characters/B.md": { type: "character", title: "B", status: "alive" },
		"Characters/C.md": { title: "C" },
		"Journal/1.md": {},
		"Journal/2.md": {},
	};
	const found = forRule(lint(index(notes), SCHEMAS), "missing-type");
	assert.deepStrictEqual(found.map((i) => i.path), ["Characters/C.md"]);
});

test("`unknown-type` stays silent when there are no schemas at all", () => {
	assert.strictEqual(forRule(lint(index(), NO_SCHEMAS), "unknown-type").length, 0);
	const notes = { "x.md": { type: "airship", title: "X" } };
	assert.strictEqual(forRule(lint(index(notes), SCHEMAS), "unknown-type").length, 1);
});

test("a note whose type has no schema is not also reported as a schema violation", () => {
	const notes = { "x.md": { type: "airship", title: "X" } };
	assert.deepStrictEqual(ruleIds(lint(index(notes), SCHEMAS)), ["orphan-notes", "unknown-type"]);
});

test("a disabled rule reports zero and contributes nothing", () => {
	const notes = { "Characters/Alone.md": { type: "character", title: "Alone", status: "alive" } };
	const result = lint(index(notes), SCHEMAS, [], { enabled: { "orphan-notes": false } });
	assert.strictEqual(result.byRule["orphan-notes"], 0);
	assert.strictEqual(forRule(result, "orphan-notes").length, 0);
});

test("a severity override moves every finding of that rule", () => {
	const notes = { "Characters/Alone.md": { type: "character", title: "Alone", status: "alive" } };
	const result = lint(index(notes), SCHEMAS, [], { severity: { "orphan-notes": "error" } });
	assert.strictEqual(forRule(result, "orphan-notes")[0].severity, "error");
	assert.strictEqual(result.counts.error, 1);
});

test("`only` filters the output without changing what the rules saw", () => {
	const notes = {
		"a.md": { type: "character", id: "dup", title: "A", status: "alive" },
		"b.md": { type: "character", id: "dup", title: "B", status: "alive" },
	};
	const scoped = lint(index(notes), SCHEMAS, [], { only: "a.md" });
	// A duplicate id is only visible vault-wide. Scoping the *rules* to one note
	// would make "validate this note" silently blind to it; scoping the output
	// keeps the two commands agreeing about the same note.
	assert.strictEqual(forRule(scoped, "duplicate-ids").length, 1);
	assert.ok(scoped.issues.every((i) => i.path === "a.md"));
});

test("carried findings from the indexer are counted and sorted with the rest", () => {
	const carried = [{ path: "bad.md", code: "WE012", rule: "invalid-yaml", severity: "error", message: "frontmatter will not parse" }];
	const result = lint(index(), SCHEMAS, carried);
	assert.strictEqual(result.counts.error, 1);
	assert.strictEqual(result.issues[0].rule, "invalid-yaml");
});

test("a rule that throws is reported and the others still run", () => {
	const exploding = { id: "boom", code: "WEX", title: "Boom", description: "", defaultSeverity: "error", run() { throw new Error("nope"); } };
	const result = lint(index(), SCHEMAS, [], { rules: [exploding, ...RULES] });
	const failure = result.issues.find((i) => i.rule === "boom");
	assert.match(failure.message, /the `Boom` check failed: nope/);
	assert.ok("broken-links" in result.byRule, "the remaining rules did not run");
});

test("findings sort errors first, and group by note worst-first", () => {
	const notes = {
		"a.md": { type: "character", id: "dup", title: "A", status: "alive" },
		"b.md": { type: "character", id: "dup", title: "B", status: "alive" },
		"c.md": { type: "character", title: "C", status: "alive" },
	};
	const result = lint(index(notes), SCHEMAS);
	assert.strictEqual(result.issues[0].severity, "error");
	const groups = groupByPath(result.issues);
	assert.ok(groups[0].issues.some((i) => i.severity === "error"));
});

done();
