const { assert, suite, test, done, load } = require("./harness.cjs");
const { stats, health, bar, percent, DEFAULT_WEIGHTS } = load("dashboard-dashboard-engine");
const { lint } = load("validation-vault-linter");
const { compileSchemas } = load("schema-schema-engine");
const { assemble } = load("core-graph");
const { find, countByType, orphans, brokenLinks, entities } = load("entities-entity-engine");
const { typeLabel, defaultFolder } = load("entities-entity-types");
const { buildRecords, NOTES } = require("./fixtures.cjs");

const SCHEMAS = compileSchemas([
	{
		source: "s.yaml",
		data: {
			character: { required: ["status"], properties: { status: { type: "enum", values: ["alive", "dead", "unknown"] } } },
			location: { properties: {} },
			faction: { properties: {} },
			item: { properties: {} },
			event: { required: ["date"], properties: { date: { type: "date" } } },
		},
	},
]);

const index = assemble(buildRecords(), new Map());
const data = stats(index, SCHEMAS);

suite("entity queries");

test("only typed notes count as entities", () => {
	const mixed = assemble(buildRecords({ ...NOTES, "Journal/Tuesday.md": { mood: "fine" } }), new Map());
	assert.strictEqual(mixed.entities.size, 8);
	assert.strictEqual(entities(mixed).length, 7);
});

test("filters combine with AND, the way §23's example reads", () => {
	assert.strictEqual(find(index, { type: "character" }).length, 2);
	assert.strictEqual(find(index, { type: "character", canon: "canon" }).length, 2);
	assert.strictEqual(find(index, { type: "character", props: { status: "alive" } }).length, 2);
	assert.strictEqual(find(index, { type: "character", props: { status: "dead" } }).length, 0);
	// `established` on Isa Venn normalises to canon, so filtering by either spelling
	// finds her -- the whole point of normalising at parse time.
	assert.strictEqual(find(index, { canon: "established", type: "character" }).length, 2);
});

test("filtering by folder, text and relationship", () => {
	assert.strictEqual(find(index, { folder: "Locations" }).length, 2);
	assert.strictEqual(find(index, { text: "quill" }).length, 1);
	assert.strictEqual(find(index, { relationship: "possesses" }).length, 1);
	assert.strictEqual(find(index, { relatedTo: "Items/Copper Compass.md" }).length, 1);
});

test("counts by type are ordered by size", () => {
	const counts = [...countByType(index).entries()];
	assert.deepStrictEqual(counts[0], ["character", 2]);
	assert.strictEqual(counts.length, 5);
});

test("type labels and default folders match §37's vault", () => {
	assert.strictEqual(typeLabel("story_thread"), "Story Thread");
	assert.strictEqual(defaultFolder("character"), "Characters");
	assert.strictEqual(defaultFolder("faction"), "Factions");
	// A type already plural is not pluralised twice.
	assert.strictEqual(defaultFolder("species"), "Species");
});

suite("dashboard");

test("the fixture vault's statistics are the ones you can count by hand", () => {
	assert.strictEqual(data.totalNotes, 7);
	assert.strictEqual(data.entityNotes, 7);
	assert.strictEqual(data.relationships, 7);
	assert.strictEqual(data.brokenRelationships, 0);
	assert.strictEqual(data.brokenLinks, 0);
	assert.strictEqual(data.schemas, 5);
	assert.strictEqual(data.typedWithoutSchema, 0);
	assert.deepStrictEqual(orphans(index).map((r) => r.path), []);
	assert.deepStrictEqual(brokenLinks(index), []);
});

test("canon is reported over stated states, with the unset count beside it", () => {
	assert.strictEqual(data.canon.stated, 7);
	assert.strictEqual(data.canon.unset, 0);
	assert.strictEqual(data.canon.established, 5);
	assert.ok(Math.abs(data.canon.establishedRatio - 5 / 7) < 1e-9);
});

test("recent changes are newest first", () => {
	const times = data.recent.map((r) => r.mtime);
	assert.deepStrictEqual(times, [...times].sort((a, b) => b - a));
});

test("continuity is never scored, and never counted into the overall", () => {
	const report = health(index, lint(index, SCHEMAS).issues, data);
	const continuity = report.dimensions.find((d) => d.id === "continuity");
	assert.strictEqual(continuity.score, null);
	assert.match(continuity.detail, /not implemented/);
	// A dimension nothing measures must not pull the average up to 100%.
	const scored = report.dimensions.filter((d) => d.score !== null);
	const mean = scored.reduce((sum, d) => sum + d.score, 0) / scored.length;
	assert.ok(Math.abs(report.overall - mean) < 1e-9);
});

test("every dimension carries the counts its score came from", () => {
	const report = health(index, lint(index, SCHEMAS).issues, data);
	for (const dimension of report.dimensions) {
		assert.ok(dimension.detail.length > 0, `${dimension.id} has no detail`);
		if (dimension.score !== null) assert.ok(dimension.total > 0, `${dimension.id} scored with a zero denominator`);
	}
});

test("a weight of 0 drops a dimension from the overall", () => {
	const issues = lint(index, SCHEMAS).issues;
	const withLinks = health(index, issues, data, DEFAULT_WEIGHTS);
	const withoutLinks = health(index, issues, data, { ...DEFAULT_WEIGHTS, links: 0 });
	const links = withLinks.dimensions.find((d) => d.id === "links");
	assert.strictEqual(links.score, 1);
	assert.ok(withoutLinks.overall <= withLinks.overall);
});

test("broken links pull the link score down proportionally", () => {
	const broken = assemble(buildRecords(NOTES, { links: { "Characters/Mara Quill.md": [{ link: "A" }, { link: "B" }] } }), new Map());
	const brokenData = stats(broken, SCHEMAS);
	const report = health(broken, lint(broken, SCHEMAS).issues, brokenData);
	const links = report.dimensions.find((d) => d.id === "links");
	assert.strictEqual(links.total, 9);
	assert.strictEqual(links.good, 7);
	assert.ok(links.score < 1);
});

test("the schema dimension is measured against typed notes, not the whole vault", () => {
	const notes = { ...NOTES };
	for (let i = 0; i < 50; i += 1) notes[`Journal/${i}.md`] = { mood: "fine" };
	const wide = assemble(buildRecords(notes), new Map());
	const report = health(wide, lint(wide, SCHEMAS).issues, stats(wide, SCHEMAS));
	const schemas = report.dimensions.find((d) => d.id === "schemas");
	assert.strictEqual(schemas.total, 7);
	assert.strictEqual(schemas.score, 1);
});

test("a vault with no schemas says so instead of scoring zero silently", () => {
	const report = health(index, [], data, DEFAULT_WEIGHTS);
	const empty = health(index, [], { ...data, schemas: 0 }, DEFAULT_WEIGHTS);
	assert.match(empty.dimensions.find((d) => d.id === "schemas").detail, /no schemas defined/);
	assert.ok(report.overall !== null);
});

test("the bar and percentage renderers say `—` rather than 100% for an unscored value", () => {
	assert.strictEqual(percent(null), "—");
	assert.strictEqual(percent(1), "100%");
	assert.strictEqual(percent(0.826), "83%");
	assert.strictEqual(bar(0.5, 10), "█████░░░░░");
	assert.strictEqual(bar(null, 4), "────");
});

done();
