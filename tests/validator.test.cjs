const { assert, suite, test, done, load } = require("./harness.cjs");
const { compileSchemas } = load("schema-schema-engine");
const { validateEntity, looksLikeDate, CODES } = load("schema-validator");
const { buildRecords } = require("./fixtures.cjs");

const SCHEMAS = compileSchemas([
	{
		source: "Engine/Schemas/core.yaml",
		data: {
			Character: {
				required: ["name", "status"],
				properties: {
					name: { type: "string" },
					age: { type: "number", min: 0, max: 5000 },
					status: { type: "enum", values: ["alive", "dead", "unknown"] },
					born: { type: "date" },
					id: { type: "string", pattern: "[a-z0-9-]+" },
					aliases: { type: "list", items: "string" },
				},
				relationships: {
					knows: { target: "character", inverse: "knows" },
					located_at: { target: "location", cardinality: "one" },
				},
			},
		},
	},
]).byType;

const schema = SCHEMAS.get("character");

function record(props, relationships = []) {
	return { path: "Characters/Mara Quill.md", basename: "Mara Quill", type: "character", rawType: "character", id: null, title: "Mara Quill", canon: null, rawCanon: null, props, hasFrontmatter: true, relationships, links: [], tags: [], mtime: 0, size: 0, bodyChars: 10, words: 2, headings: 1 };
}

const codes = (issues) => issues.map((i) => i.code);

suite("validator");

test("the BRD's own failing example produces the BRD's own message", () => {
	const issues = validateEntity(record({ name: "Mara Quill", status: "deceased" }), schema);
	assert.strictEqual(issues.length, 1);
	assert.strictEqual(issues[0].code, CODES.invalidValue);
	assert.match(issues[0].message, /invalid value `deceased`/);
	assert.match(issues[0].hint, /`alive`, `dead`, `unknown`/);
});

test("a missing required property is one warning naming the property", () => {
	const issues = validateEntity(record({ name: "Mara Quill" }), schema);
	assert.deepStrictEqual(codes(issues), [CODES.missingRequired]);
	assert.strictEqual(issues[0].property, "status");
});

test("an empty string counts as missing — a seeded template must not validate clean", () => {
	const issues = validateEntity(record({ name: "", status: "alive" }), schema);
	assert.deepStrictEqual(codes(issues), [CODES.missingRequired]);
});

test("wrong casing on an enum is INFO, not a failure", () => {
	const issues = validateEntity(record({ name: "Mara Quill", status: "Alive" }), schema);
	assert.strictEqual(issues.length, 1);
	assert.strictEqual(issues[0].severity, "info");
	assert.match(issues[0].message, /differs in case/);
});

test("a wrong type is reported with what was found", () => {
	const issues = validateEntity(record({ name: "Mara Quill", status: "alive", age: "seventeen" }), schema);
	assert.deepStrictEqual(codes(issues), [CODES.wrongType]);
	assert.match(issues[0].message, /expected number, found string/);
});

test("numeric bounds are checked in both directions", () => {
	assert.deepStrictEqual(codes(validateEntity(record({ name: "M", status: "alive", age: -1 }), schema)), [CODES.outOfRange]);
	assert.deepStrictEqual(codes(validateEntity(record({ name: "M", status: "alive", age: 9000 }), schema)), [CODES.outOfRange]);
	assert.deepStrictEqual(codes(validateEntity(record({ name: "M", status: "alive", age: 24 }), schema)), []);
});

test("a pattern is anchored — a partial match does not pass", () => {
	assert.deepStrictEqual(codes(validateEntity(record({ name: "M", status: "alive", id: "Mara Quill 01" }), schema)), [CODES.patternMismatch]);
	assert.deepStrictEqual(codes(validateEntity(record({ name: "M", status: "alive", id: "mara-quill-01" }), schema)), []);
});

test("list item types are checked", () => {
	const issues = validateEntity(record({ name: "M", status: "alive", aliases: ["The Clerk", 12] }), schema);
	assert.deepStrictEqual(codes(issues), [CODES.wrongType]);
});

test("dates accept the shapes a worldbuilding vault actually contains", () => {
	for (const value of ["1312-05-09", "1312-05", "1312", "-500", 1312, new Date("2020-01-01")]) {
		assert.ok(looksLikeDate(value), `rejected ${String(value)}`);
	}
	// Full ISO 8601, which is what an importer writes.
	for (const value of [
		"2023-06-19T18:41:25.343000+00:00",
		"2024-03-21T14:37:30.785Z",
		"2023-08-11T12:57:55",
		"2023-08-11 12:57",
		"2023-08-11T12:57:55+0200",
	]) {
		assert.ok(looksLikeDate(value), `rejected ${String(value)}`);
	}
	for (const value of ["circa 1200", "3E 452", "", "next tuesday", "2025/02/20", "02/21/2025", "{{date:YYYY-MM-DD}}"]) {
		assert.ok(!looksLikeDate(value), `accepted ${String(value)}`);
	}
});

test("a bad date is reported as a date problem, not a generic type problem", () => {
	const issues = validateEntity(record({ name: "M", status: "alive", born: "circa 1200" }), schema);
	assert.deepStrictEqual(codes(issues), [CODES.invalidDate]);
});

test("undeclared properties are silent by default and reported when closed", () => {
	const open = validateEntity(record({ name: "M", status: "alive", mood: "grim" }), schema);
	assert.deepStrictEqual(codes(open), []);

	const closed = { ...schema, additionalProperties: false };
	const issues = validateEntity(record({ name: "M", status: "alive", mood: "grim", tags: ["x"] }), closed, { ignoreProperties: ["tags"] });
	assert.deepStrictEqual(codes(issues), [CODES.unknownProperty]);
	assert.strictEqual(issues[0].property, "mood");
});

test("a declared relationship kind written as a top-level property is not an unknown property", () => {
	// The flat shape -- `located_at: ["[[Birchmoor]]"]` at the top level -- is the
	// only one Obsidian's Properties panel renders. The schema declares the kind,
	// so a closed schema must not report it as a stray property.
	const closed = { ...schema, additionalProperties: false };
	const issues = validateEntity(record({ name: "M", status: "alive", located_at: ["[[Birchmoor]]"] }), closed);
	assert.deepStrictEqual(codes(issues), []);
});

test("a `one` relationship declared twice is a finding", () => {
	const rels = [
		{ from: "a", type: "located_at", raw: "[[Tern Harbour]]", target: "Locations/Tern Harbour.md", meta: {} },
		{ from: "a", type: "located_at", raw: "[[Grey Ford]]", target: "Locations/Grey Ford.md", meta: {} },
	];
	const issues = validateEntity(record({ name: "M", status: "alive" }, rels), schema);
	assert.deepStrictEqual(codes(issues), [CODES.cardinality]);
});

test("a relationship pointing at the wrong entity type is a finding", () => {
	const rels = [{ from: "a", type: "located_at", raw: "[[Isa Venn]]", target: "Characters/Isa Venn.md", meta: {} }];
	const issues = validateEntity(record({ name: "M", status: "alive" }, rels), schema, { typeOf: () => "character" });
	assert.deepStrictEqual(codes(issues), [CODES.wrongRelTarget]);
});

test("an undeclared relationship type is INFO, not an error", () => {
	const rels = [{ from: "a", type: "despises", raw: "[[Isa Venn]]", target: "Characters/Isa Venn.md", meta: {} }];
	const issues = validateEntity(record({ name: "M", status: "alive" }, rels), schema);
	assert.deepStrictEqual(codes(issues), [CODES.unknownRelType]);
	assert.strictEqual(issues[0].severity, "info");
});

test("a schema declaring no relationships never flags any", () => {
	const bare = { ...schema, relationships: new Map() };
	const rels = [{ from: "a", type: "anything", raw: "[[X]]", target: null, meta: {} }];
	assert.deepStrictEqual(codes(validateEntity(record({ name: "M", status: "alive" }, rels), bare)), []);
});

test("the §38 example character validates clean", () => {
	const mara = buildRecords().get("Characters/Mara Quill.md");
	const permissive = compileSchemas([
		{ source: "s.yaml", data: { character: { required: ["status"], properties: { status: { type: "enum", values: ["alive", "dead", "unknown"] }, age: { type: "number" }, species: { type: "string" } } } } },
	]).byType.get("character");
	assert.deepStrictEqual(codes(validateEntity(mara, permissive)), []);
});

test("validation never mutates the record it is given", () => {
	const input = record({ name: "M", status: "Alive", age: "x" });
	const before = JSON.stringify(input);
	validateEntity(input, schema);
	assert.strictEqual(JSON.stringify(input), before);
});

done();
