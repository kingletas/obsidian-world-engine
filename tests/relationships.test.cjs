const { assert, suite, test, done, load } = require("./harness.cjs");
const { parseRelationships, buildInbound, normaliseRelType, linkText, looksLikeLink } = load("relationships-relationship-engine");
const { assemble } = load("core-graph");
const { related, orphans, brokenLinks } = load("entities-entity-engine");
const { addRelationship } = load("ui-create-relationship-modal");
const { flattenRelationships } = load("relationships-flatten");
const { buildRecords, makeResolver } = require("./fixtures.cjs");

const resolve = makeResolver(["Characters/Mara Quill.md", "Characters/Isa Venn.md"]);

suite("relationships");

test("type names normalise to snake_case from all three spellings", () => {
	for (const value of ["Member Of", "member-of", "memberOf", "member_of"]) {
		assert.strictEqual(normaliseRelType(value), "member_of");
	}
});

test("link text survives aliases, headings and markdown links", () => {
	assert.strictEqual(linkText("[[Isa Venn]]"), "Isa Venn");
	assert.strictEqual(linkText("[[Characters/Isa Venn|Isa]]"), "Characters/Isa Venn");
	assert.strictEqual(linkText("[[Isa Venn#Childhood]]"), "Isa Venn#Childhood");
	assert.strictEqual(linkText("[Isa Venn](Characters/Isa%20Venn.md)"), "Characters/Isa Venn.md");
	// A wikilink inside a table cell, where the pipe is escaped so the table does not split.
	assert.strictEqual(linkText("[[Prompts/2026-08-03-pdp-performance\\|prompt]]"), "Prompts/2026-08-03-pdp-performance");
	assert.strictEqual(linkText("[[Note\\|alias]]"), "Note");
	assert.ok(looksLikeLink("[[Isa Venn]]"));
	assert.ok(!looksLikeLink("Isa Venn"));
});

test("both frontmatter shapes produce the same edge", () => {
	const map = parseRelationships("a.md", { relationships: { knows: ["[[Isa Venn]]"] } }, resolve);
	const list = parseRelationships("a.md", { relationships: [{ type: "knows", target: "[[Isa Venn]]" }] }, resolve);
	assert.strictEqual(map[0].type, list[0].type);
	assert.strictEqual(map[0].target, list[0].target);
});

test("a map value that is an object carries metadata — the §12.1 form", () => {
	const refs = parseRelationships("a.md", { relationships: { knows: { target: "[[Isa Venn]]", since: 1312, status: "active" } } }, resolve);
	assert.strictEqual(refs.length, 1);
	assert.deepStrictEqual(refs[0].meta, { since: 1312, status: "active" });
});

test("a relationship block that is neither shape yields nothing rather than throwing", () => {
	assert.deepStrictEqual(parseRelationships("a.md", { relationships: "nonsense" }, resolve), []);
	assert.deepStrictEqual(parseRelationships("a.md", {}, resolve), []);
});

test("inverse edges are inferred, marked, and point the right way", () => {
	const types = new Map([["possesses", { inverse: "possessed_by" }]]);
	const refs = [{ from: "Characters/Mara Quill.md", type: "possesses", raw: "[[Compass]]", target: "Items/Compass.md", meta: {} }];
	const inbound = buildInbound(refs, types);

	const onItem = inbound.get("Items/Compass.md");
	assert.strictEqual(onItem.length, 1);
	assert.strictEqual(onItem[0].type, "possesses");
	assert.ok(!onItem[0].inferred, "the declared edge was marked inferred");

	const onCharacter = inbound.get("Characters/Mara Quill.md");
	assert.strictEqual(onCharacter[0].type, "possessed_by");
	assert.strictEqual(onCharacter[0].from, "Items/Compass.md");
	assert.strictEqual(onCharacter[0].inferred, true);
});

test("a type with no declared inverse produces no inferred edge", () => {
	const inbound = buildInbound([{ from: "a.md", type: "knows", raw: "[[B]]", target: "b.md", meta: {} }], new Map());
	assert.strictEqual(inbound.get("a.md"), undefined);
	assert.strictEqual(inbound.get("b.md").length, 1);
});

test("a relationship counts as a backlink, so a note reached only by one is not an orphan", () => {
	const index = assemble(buildRecords(), new Map());
	// Isa Venn has no body links and nothing links to her in prose -- only Mara Quill's
	// `knows:` relationship. She must not read as an orphan.
	assert.ok(!orphans(index).some((r) => r.path === "Characters/Isa Venn.md"));
	assert.ok(index.backlinks.get("Characters/Isa Venn.md").has("Characters/Mara Quill.md"));
});

test("the fixture vault's only broken link is the event's unresolved location", () => {
	const index = assemble(buildRecords(), new Map());
	assert.deepStrictEqual(brokenLinks(index), []);
	const battle = index.entities.get("Events/Battle of Grey Ford.md");
	// `location: "[[Grey Ford]]"` resolves; `participants` resolve too. All
	// four edges are real, which is what makes the §39 example a good fixture.
	assert.strictEqual(battle.relationships.filter((r) => r.target === null).length, 0);
	assert.strictEqual(battle.relationships.length, 3);
});

test("`related` answers from both ends", () => {
	const types = new Map([["possesses", { inverse: "possessed_by" }]]);
	const index = assemble(buildRecords(), types);
	const compass = related(index, "Items/Copper Compass.md");
	assert.strictEqual(compass.outgoing.length, 0);
	assert.strictEqual(compass.incoming[0].type, "possesses");
	const mara = related(index, "Characters/Mara Quill.md");
	assert.ok(mara.incoming.some((r) => r.type === "possessed_by" && r.inferred));
});

suite("addRelationship");

test("a note with no block gets the flat shape — the one the Properties panel renders", () => {
	const fm = {};
	assert.strictEqual(addRelationship(fm, "relationships", "Member Of", "[[Lantern Order]]").changed, true);
	assert.strictEqual(fm.relationships, undefined);
	assert.deepStrictEqual(fm.member_of, ["[[Lantern Order]]"]);
});

test("the flat shape appends, promotes a bare string, and refuses a duplicate", () => {
	const fm = { member_of: "[[Lantern Order]]" };
	addRelationship(fm, "relationships", "member_of", "[[The Glass Accord]]");
	assert.deepStrictEqual(fm.member_of, ["[[Lantern Order]]", "[[The Glass Accord]]"]);
	const result = addRelationship(fm, "relationships", "member_of", "[[The Glass Accord]]");
	assert.strictEqual(result.changed, false);
	assert.strictEqual(result.reason, "already declared");
});

test("appends to an existing list without disturbing the others", () => {
	const fm = { relationships: { knows: ["[[Isa Venn]]"], possesses: ["[[Compass]]"] } };
	addRelationship(fm, "relationships", "knows", "[[Tobin Ash]]");
	assert.deepStrictEqual(fm.relationships.knows, ["[[Isa Venn]]", "[[Tobin Ash]]"]);
	assert.deepStrictEqual(fm.relationships.possesses, ["[[Compass]]"]);
});

test("promotes a bare string to a list rather than replacing it", () => {
	const fm = { relationships: { knows: "[[Isa Venn]]" } };
	addRelationship(fm, "relationships", "knows", "[[Tobin Ash]]");
	assert.deepStrictEqual(fm.relationships.knows, ["[[Isa Venn]]", "[[Tobin Ash]]"]);
});

test("a duplicate is a no-op that says why", () => {
	const fm = { relationships: { knows: ["[[Isa Venn]]"] } };
	const result = addRelationship(fm, "relationships", "knows", "[[Isa Venn]]");
	assert.strictEqual(result.changed, false);
	assert.strictEqual(result.reason, "already declared");
	assert.deepStrictEqual(fm.relationships.knows, ["[[Isa Venn]]"]);
});

test("a note using the list form keeps the list form", () => {
	const fm = { relationships: [{ type: "knows", target: "[[Isa Venn]]", since: 1312 }] };
	addRelationship(fm, "relationships", "possesses", "[[Compass]]");
	assert.ok(Array.isArray(fm.relationships));
	assert.strictEqual(fm.relationships.length, 2);
	// The existing entry, metadata and all, is untouched.
	assert.deepStrictEqual(fm.relationships[0], { type: "knows", target: "[[Isa Venn]]", since: 1312 });
});

test("properties the plugin does not understand are left alone", () => {
	const fm = { type: "character", custom_thing: { nested: [1, 2] } };
	addRelationship(fm, "relationships", "knows", "[[Isa Venn]]");
	assert.deepStrictEqual(fm.custom_thing, { nested: [1, 2] });
	assert.strictEqual(fm.type, "character");
});

suite("flattenRelationships");

test("lifts every kind of a map block to top-level lists and removes the block", () => {
	const fm = { title: "Saltmarsh", relationships: { houses: ["[[Tern Harbour]]", "[[Pell Row]]"], founded_by: ["[[Saltmarsh's founder]]"] } };
	const result = flattenRelationships(fm, "relationships");
	assert.strictEqual(result.changed, true);
	assert.strictEqual(result.lifted, 3);
	assert.deepStrictEqual(result.kept, []);
	assert.deepStrictEqual(fm.houses, ["[[Tern Harbour]]", "[[Pell Row]]"]);
	assert.deepStrictEqual(fm.founded_by, ["[[Saltmarsh's founder]]"]);
	assert.strictEqual(fm.relationships, undefined);
	assert.strictEqual(fm.title, "Saltmarsh");
});

test("merges into an existing top-level value without duplicating", () => {
	const fm = { located_at: "[[Birchmoor]]", relationships: { located_at: ["[[Birchmoor]]", "[[Aldwick]]"] } };
	flattenRelationships(fm, "relationships");
	assert.deepStrictEqual(fm.located_at, ["[[Birchmoor]]", "[[Aldwick]]"]);
});

test("kind names normalise on the way up", () => {
	const fm = { relationships: { "Member Of": "[[Lantern Order]]" } };
	flattenRelationships(fm, "relationships");
	assert.deepStrictEqual(fm.member_of, ["[[Lantern Order]]"]);
});

test("metadata forms stay in the block and are named, not dropped", () => {
	const fm = { relationships: { knows: { target: "[[Isa Venn]]", since: 1312 }, houses: ["[[Pell Row]]"] } };
	const result = flattenRelationships(fm, "relationships");
	assert.deepStrictEqual(fm.houses, ["[[Pell Row]]"]);
	assert.deepStrictEqual(fm.relationships, { knows: { target: "[[Isa Venn]]", since: 1312 } });
	assert.strictEqual(result.kept.length, 1);
	assert.strictEqual(result.kept[0].kind, "knows");
});

test("the list form is left whole — its entries carry their own metadata", () => {
	const block = [{ type: "knows", target: "[[Isa Venn]]", since: 1312 }];
	const fm = { relationships: block };
	const result = flattenRelationships(fm, "relationships");
	assert.strictEqual(result.changed, false);
	assert.strictEqual(fm.relationships, block);
	assert.strictEqual(result.kept.length, 1);
});

test("a top-level collision that cannot merge is refused, not overwritten", () => {
	const fm = { founded: -199, relationships: { founded: ["[[Someone]]"] } };
	const result = flattenRelationships(fm, "relationships");
	assert.strictEqual(fm.founded, -199);
	assert.deepStrictEqual(fm.relationships, { founded: ["[[Someone]]"] });
	assert.strictEqual(result.kept.length, 1);
});

test("an empty block is removed", () => {
	const fm = { relationships: {} };
	const result = flattenRelationships(fm, "relationships");
	assert.strictEqual(result.changed, true);
	assert.strictEqual(fm.relationships, undefined);
});

done();
