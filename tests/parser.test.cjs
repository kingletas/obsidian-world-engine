const { assert, suite, test, done, load } = require("./harness.cjs");
const { parseNote, stripFrontmatter, reresolveLinks, DEFAULT_PARSE_OPTIONS } = load("core-parser");
const { makeResolver, buildRecords } = require("./fixtures.cjs");

const resolve = makeResolver(["Characters/Mara Quill.md", "Characters/Isa Venn.md", "Items/Copper Compass.md"]);

function note(frontmatter, extra = {}) {
	return parseNote(
		{
			path: "Characters/Mara Quill.md",
			basename: "Mara Quill",
			frontmatter,
			links: extra.links ?? [],
			embeds: extra.embeds ?? [],
			tags: extra.tags ?? [],
			headings: 1,
			body: extra.body ?? "prose",
			mtime: 1,
			size: 2,
		},
		resolve,
		DEFAULT_PARSE_OPTIONS
	);
}

suite("parser");

test("normalises the type and keeps the raw form for messages", () => {
	const record = note({ type: "Story Thread" });
	assert.strictEqual(record.type, "story_thread");
	assert.strictEqual(record.rawType, "Story Thread");
});

test("reads `entity_type` when `type` is absent — the §2.1 drift case", () => {
	assert.strictEqual(note({ entity_type: "Character" }).type, "character");
});

test("a note with no frontmatter is still indexed", () => {
	const record = note(null);
	assert.strictEqual(record.type, null);
	assert.strictEqual(record.hasFrontmatter, false);
	assert.strictEqual(record.title, "Mara Quill");
});

test("`canon: true` is read only when `canon_status` is absent", () => {
	assert.strictEqual(note({ canon: true }).canon, "canon");
	// Both present and disagreeing: the real property wins, and the parser does
	// not quietly reconcile them.
	assert.strictEqual(note({ canon: true, canon_status: "draft" }).canon, "draft");
});

test("`established` is understood, because §11's own example writes it", () => {
	assert.strictEqual(note({ canon_status: "established" }).canon, "canon");
});

test("relationships parse from the map form", () => {
	const record = note({ relationships: { knows: ["[[Isa Venn]]"], possesses: "[[Copper Compass]]" } });
	assert.strictEqual(record.relationships.length, 2);
	const knows = record.relationships.find((r) => r.type === "knows");
	assert.strictEqual(knows.target, "Characters/Isa Venn.md");
	// A bare string, not a list, still produces one relationship.
	assert.strictEqual(record.relationships.find((r) => r.type === "possesses").target, "Items/Copper Compass.md");
});

test("relationships parse from the list form, with metadata", () => {
	const record = note({ relationships: [{ target: "[[Isa Venn]]", type: "knows", since: 1312, status: "active" }] });
	assert.strictEqual(record.relationships.length, 1);
	assert.deepStrictEqual(record.relationships[0].meta, { since: 1312, status: "active" });
});

test("an inline `location:` counts as a relationship — §39 writes events that way", () => {
	const record = note({ type: "event", location: "[[Grey Ford]]" });
	assert.strictEqual(record.relationships.length, 1);
	assert.strictEqual(record.relationships[0].type, "location");
	// It does not resolve in this fixture, and that is the point: it is still a
	// relationship, just a broken one.
	assert.strictEqual(record.relationships[0].target, null);
});

test("a non-link string in an inline property is not mistaken for a relationship", () => {
	assert.strictEqual(note({ type: "event", location: "somewhere vague" }).relationships.length, 0);
});

test("a table-escaped alias resolves — `[[Note\\|alias]]` is a link to Note", () => {
	// The backslash is the table escape, not part of the path. Resolving the raw
	// cache value made every linked row of every index note read as broken.
	const record = note({}, { links: [{ link: "Isa Venn\\|Isa" }] });
	assert.strictEqual(record.links[0].target, "Characters/Isa Venn.md");
});

test("an unresolvable link is recorded with target null, not dropped", () => {
	const record = note({}, { links: [{ link: "Nowhere" }] });
	assert.strictEqual(record.links.length, 1);
	assert.strictEqual(record.links[0].target, null);
});

test("frontmatter is stripped from the word count", () => {
	assert.strictEqual(stripFrontmatter("---\ntype: character\n---\nbody text\n"), "body text\n");
	assert.strictEqual(stripFrontmatter("no frontmatter"), "no frontmatter");
	// An unterminated block is returned whole rather than swallowing the file.
	assert.strictEqual(stripFrontmatter("---\nbroken"), "---\nbroken");
});

test("re-resolution fixes a target that changed after the snapshot was written", () => {
	const stale = note({ relationships: { knows: ["[[Isa Venn]]"] } });
	// Isa Venn has been moved. A record restored from the snapshot still points at
	// the old path until this runs.
	const moved = makeResolver(["Characters/Old/Isa Venn.md"]);
	const fixed = reresolveLinks(stale, moved);
	assert.strictEqual(stale.relationships[0].target, "Characters/Isa Venn.md");
	assert.strictEqual(fixed.relationships[0].target, "Characters/Old/Isa Venn.md");
});

test("the §37 fixture vault parses into seven records", () => {
	const records = buildRecords();
	assert.strictEqual(records.size, 7);
	assert.strictEqual(records.get("Characters/Mara Quill.md").relationships.length, 4);
});

done();
