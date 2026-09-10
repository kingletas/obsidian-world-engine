const { assert, suite, test, done, load } = require("./harness.cjs");
const { fingerprint, readSnapshot, reusable, toSnapshot, SNAPSHOT_VERSION } = load("core-cache");
const { assemble } = load("core-graph");
const { entityFrontmatter, toYaml, slugify, seedValue } = load("ui-create-entity-modal");
const { compileSchemas } = load("schema-schema-engine");
const { buildRecords, NOTES } = require("./fixtures.cjs");

const index = assemble(buildRecords(), new Map(), 12345);
const FP = fingerprint({ typeProperty: "type" });

const statsOf = (records) => new Map([...records.values()].map((r) => [r.path, { mtime: r.mtime, size: r.size }]));

suite("cache");

test("a snapshot round-trips through JSON", () => {
	const snapshot = readSnapshot(JSON.stringify(toSnapshot(index, FP)), FP);
	assert.strictEqual(snapshot.version, SNAPSHOT_VERSION);
	assert.strictEqual(snapshot.records.length, 7);
	assert.strictEqual(snapshot.builtAt, 12345);
});

test("every kind of doubt resolves to a rebuild", () => {
	const good = JSON.stringify(toSnapshot(index, FP));
	assert.strictEqual(readSnapshot("not json at all", FP), null, "garbage was trusted");
	assert.strictEqual(readSnapshot(good, "different-fingerprint"), null, "a settings change did not invalidate it");
	assert.strictEqual(readSnapshot(JSON.stringify({ ...JSON.parse(good), version: 999 }), FP), null, "a future version was trusted");
	assert.strictEqual(readSnapshot(JSON.stringify({ version: SNAPSHOT_VERSION, fingerprint: FP }), FP), null, "a snapshot with no records was trusted");
	assert.strictEqual(readSnapshot("null", FP), null);
});

test("the fingerprint moves when any parse setting moves", () => {
	assert.strictEqual(fingerprint({ a: 1 }), fingerprint({ a: 1 }));
	assert.notStrictEqual(fingerprint({ canonProperty: "canon_status" }), fingerprint({ canonProperty: "state" }));
});

test("an unchanged vault reuses every record and parses nothing", () => {
	const snapshot = toSnapshot(index, FP);
	const { keep, stale } = reusable(snapshot, statsOf(index.entities));
	assert.strictEqual(keep.length, 7);
	assert.deepStrictEqual(stale, []);
});

test("a file whose mtime or size moved is re-parsed", () => {
	const snapshot = toSnapshot(index, FP);
	const current = statsOf(index.entities);
	current.set("Characters/Mara Quill.md", { mtime: 999, size: 100 });
	current.set("Characters/Isa Venn.md", { mtime: current.get("Characters/Isa Venn.md").mtime, size: 4242 });
	const { keep, stale } = reusable(snapshot, current);
	assert.strictEqual(keep.length, 5);
	assert.deepStrictEqual(stale.sort(), ["Characters/Isa Venn.md", "Characters/Mara Quill.md"]);
});

test("a new file is stale and a deleted one is simply dropped", () => {
	const snapshot = toSnapshot(index, FP);
	const current = statsOf(index.entities);
	current.delete("Items/Copper Compass.md");
	current.set("Characters/New.md", { mtime: 1, size: 1 });
	const { keep, stale } = reusable(snapshot, current);
	assert.strictEqual(keep.length, 6);
	assert.deepStrictEqual(stale, ["Characters/New.md"]);
	assert.ok(!keep.some((r) => r.path === "Items/Copper Compass.md"));
});

test("Appendix B: an index rebuilt from the vault equals one restored from cache", () => {
	// Restoring the snapshot must produce the same records as parsing the vault again.
	const restored = readSnapshot(JSON.stringify(toSnapshot(index, FP)), FP);
	const rebuilt = assemble(buildRecords(), new Map(), 12345);
	const byPath = new Map(restored.records.map((r) => [r.path, r]));
	for (const [path, fresh] of rebuilt.entities) {
		assert.deepStrictEqual(byPath.get(path), fresh, `${path} differs between a rebuild and the cache`);
	}
	assert.strictEqual(byPath.size, rebuilt.entities.size);
});

suite("entity creation");

test("ids are slugs, matching the BRD's own examples", () => {
	assert.strictEqual(slugify("Battle of Grey Ford"), "battle-of-grey-ford");
	assert.strictEqual(slugify("The Ferryman's Debt"), "the-ferryman-s-debt");
	assert.strictEqual(slugify("  Mara Quill  "), "mara-quill");
});

test("a new note is seeded from its schema, with an enum's first value", () => {
	const schema = compileSchemas([
		{ source: "s.yaml", data: { Character: { required: ["status"], properties: { status: { type: "enum", values: ["alive", "dead"] }, age: { type: "number" }, canon_status: { type: "enum", values: ["idea", "draft", "canon"] } } } } },
	]).byType.get("character");

	const fm = entityFrontmatter("character", "Mara Quill", schema, { defaultCanon: "draft", typeProperty: "type", idProperty: "id", canonProperty: "canon_status" });
	assert.strictEqual(fm.type, "Character");
	assert.strictEqual(fm.id, "mara-quill");
	assert.strictEqual(fm.title, "Mara Quill");
	assert.strictEqual(fm.status, "alive");
	assert.strictEqual(fm.canon_status, "draft");
	// Everything else is left blank so the user fills it in rather than
	// inheriting a placeholder that looks like data.
	assert.strictEqual(fm.age, "");
});

test("a type with no schema still gets a usable note", () => {
	const fm = entityFrontmatter("airship", "The Marigold", undefined, { defaultCanon: "idea", typeProperty: "type", idProperty: "id", canonProperty: "canon_status" });
	assert.deepStrictEqual(fm, { type: "airship", id: "the-marigold", title: "The Marigold", canon_status: "idea" });
});

test("a schema default beats the enum's first value", () => {
	assert.strictEqual(seedValue({ name: "status", kind: "enum", required: true, values: ["alive", "dead"], default: "unknown" }, "draft"), "unknown");
	assert.deepStrictEqual(seedValue({ name: "tags", kind: "list", required: false }, "draft"), []);
});

test("the emitted YAML is the block that reaches the file", () => {
	const yaml = toYaml({ type: "Character", id: "mara-quill", title: "Mara Quill", age: 24, alive: true, tags: [], aliases: ["The Clerk"], note: "" });
	assert.strictEqual(
		yaml,
		'---\ntype: Character\nid: mara-quill\ntitle: Mara Quill\nage: 24\nalive: true\ntags: []\naliases:\n  - The Clerk\nnote: ""\n---\n'
	);
});

test("a value that would break YAML is quoted", () => {
	assert.strictEqual(toYaml({ a: "yes: no" }), '---\na: "yes: no"\n---\n');
	assert.strictEqual(toYaml({ a: "[[Link]]" }), '---\na: "[[Link]]"\n---\n');
	// A bare number as a string keeps its quotes, or YAML reads it back as a
	// number and the note's id changes type between write and read.
	assert.strictEqual(toYaml({ a: "1312" }), '---\na: "1312"\n---\n');
});

done();
