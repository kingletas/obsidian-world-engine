const { assert, suite, test, done, load } = require("./harness.cjs");
const { compileSchemas, normaliseType, relationshipTypes } = load("schema-schema-engine");

const file = (data, source = "Engine/Schemas/test.yaml") => ({ source, data });

suite("schema-engine");

test("compiles the §8.1 example verbatim", () => {
	const { byType, problems } = compileSchemas([
		file({
			Character: {
				required: ["name", "status"],
				properties: {
					name: { type: "string" },
					age: { type: "number" },
					status: { type: "enum", values: ["alive", "dead", "unknown"] },
				},
			},
		}),
	]);
	assert.deepStrictEqual(problems, []);
	const schema = byType.get("character");
	assert.strictEqual(schema.rawType, "Character");
	assert.strictEqual(schema.properties.get("name").required, true);
	assert.strictEqual(schema.properties.get("age").required, false);
	assert.deepStrictEqual(schema.properties.get("status").values, ["alive", "dead", "unknown"]);
});

test("a name in `required:` with no `properties:` entry still requires the property", () => {
	const { byType } = compileSchemas([file({ Character: { required: ["name"] } })]);
	const def = byType.get("character").properties.get("name");
	assert.strictEqual(def.required, true);
	assert.strictEqual(def.kind, "any");
});

test("a bare `age: number` shorthand compiles", () => {
	const { byType } = compileSchemas([file({ Character: { properties: { age: "number" } } })]);
	assert.strictEqual(byType.get("character").properties.get("age").kind, "number");
});

test("`values:` without `type: enum` is still an enum", () => {
	const { byType } = compileSchemas([file({ Character: { properties: { status: { values: ["alive", "dead"] } } } })]);
	assert.strictEqual(byType.get("character").properties.get("status").kind, "enum");
});

test("an unknown property type is a reported problem, not a silent pass", () => {
	const { byType, problems } = compileSchemas([file({ Character: { properties: { age: { type: "integerish" } } } })]);
	assert.strictEqual(problems.length, 1);
	assert.match(problems[0].message, /unknown type/);
	assert.strictEqual(byType.get("character").properties.get("age").kind, "any");
});

test("`extends` merges the parent, and the child wins on every key it declares", () => {
	const { byType } = compileSchemas([
		file({
			entity: { properties: { title: { type: "string" }, canon_status: { type: "enum", values: ["draft"] } } },
			character: { extends: "entity", properties: { canon_status: { type: "enum", values: ["canon"] } }, folder: "Characters" },
		}),
	]);
	const character = byType.get("character");
	assert.ok(character.properties.has("title"), "did not inherit the parent's property");
	assert.deepStrictEqual(character.properties.get("canon_status").values, ["canon"]);
	assert.strictEqual(character.folder, "Characters");
});

test("`extends` resolves across files and regardless of order", () => {
	const { byType, problems } = compileSchemas([
		file({ character: { extends: "entity", properties: {} } }, "b.yaml"),
		file({ entity: { properties: { title: { type: "string" } } } }, "a.yaml"),
	]);
	assert.deepStrictEqual(problems, []);
	assert.ok(byType.get("character").properties.has("title"));
});

test("a missing parent is reported and the child still compiles", () => {
	const { byType, problems } = compileSchemas([file({ character: { extends: "nothing" } })]);
	assert.strictEqual(problems.length, 1);
	assert.match(problems[0].message, /not defined anywhere/);
	assert.ok(byType.has("character"), "the child was dropped along with its broken parent");
});

test("a circular `extends` is reported instead of hanging", () => {
	const { byType, problems } = compileSchemas([file({ a: { extends: "b" }, b: { extends: "a" } })]);
	assert.ok(problems.some((p) => /circular/.test(p.message)));
	assert.strictEqual(byType.size, 2);
});

test("a type defined twice is reported and the later definition wins", () => {
	const { byType, problems } = compileSchemas([
		file({ character: { properties: { a: "string" } } }, "one.yaml"),
		file({ character: { properties: { b: "string" } } }, "two.yaml"),
	]);
	assert.strictEqual(problems.length, 1);
	assert.strictEqual(byType.get("character").source, "two.yaml");
});

test("a file that is not a mapping is reported, not thrown", () => {
	const { problems } = compileSchemas([file(["not", "a", "mapping"])]);
	assert.strictEqual(problems.length, 1);
});

test("relationship definitions carry an inverse and a cardinality", () => {
	const { byType } = compileSchemas([
		file({ character: { relationships: { possesses: { target: "Item", inverse: "possessed_by" }, located_at: { target: "location", cardinality: "one" } } } }),
	]);
	const rels = byType.get("character").relationships;
	assert.strictEqual(rels.get("possesses").target, "item");
	assert.strictEqual(rels.get("possesses").inverse, "possessed_by");
	assert.strictEqual(rels.get("possesses").cardinality, "many");
	assert.strictEqual(rels.get("located_at").cardinality, "one");
	assert.strictEqual(relationshipTypes({ byType, problems: [] }).get("located_at").cardinality, "one");
});

test("type names normalise the three ways a vault spells them", () => {
	assert.strictEqual(normaliseType("Story Thread"), "story_thread");
	assert.strictEqual(normaliseType("story-thread"), "story_thread");
	assert.strictEqual(normaliseType("StoryThread"), "story_thread");
});

test("the shipped starter schemas compile with no problems", () => {
	// The real files, read through the same YAML parser Obsidian uses is not
	// available here -- so this asserts the compiler's half only, against the
	// object a YAML parse would produce for the shapes they use.
	const { byType, problems } = compileSchemas([
		file({
			entity: { required: ["title"], properties: { title: { type: "string" }, canon_status: { type: "enum", values: ["idea", "draft", "canon"] } } },
			character: { extends: "entity", required: ["status"], properties: { status: { type: "enum", values: ["alive", "dead", "unknown"] } }, relationships: { knows: { target: "character", inverse: "knows" } } },
		}),
	]);
	assert.deepStrictEqual(problems, []);
	assert.strictEqual(byType.get("character").properties.get("title").required, true);
});

done();
