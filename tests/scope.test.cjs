const { assert, suite, test, done, load } = require("./harness.cjs");
const { inScope, normaliseFolder, normaliseScope, describeScope } = load("core-scope");

const BOOK = "Fiction/First Book";

suite("scope");

test("an empty allowlist means the whole vault", () => {
	assert.ok(inScope("anything/at/all.md", { include: [], exclude: [] }));
	assert.ok(inScope("README.md", { include: [], exclude: [] }));
});

test("an allowlist admits its own tree and nothing else", () => {
	const scope = { include: [BOOK], exclude: [] };
	assert.ok(inScope(`${BOOK}/World/Characters/Mara Quill.md`, scope));
	assert.ok(inScope(`${BOOK}/Chapters/01 Chapter One.md`, scope));
	assert.ok(!inScope("Reports/BRDs/anything.md", scope));
	assert.ok(!inScope("Fiction/Second Book/Premise.md", scope));
});

test("the folder itself is in scope, and a sibling with the same prefix is not", () => {
	const scope = { include: ["Fiction"], exclude: [] };
	assert.ok(inScope("Fiction", scope));
	assert.ok(inScope("Fiction/00 Inbox/note.md", scope));
	// The `/` guard. Without it this matches, and an allowlist that leaks into
	// the folder next door is worse than no allowlist.
	assert.ok(!inScope("Fiction Archive/note.md", scope));
});

test("exclude is subtractive and applies inside an included tree", () => {
	const scope = { include: [BOOK], exclude: [`${BOOK}/Archive`] };
	assert.ok(inScope(`${BOOK}/World/Characters/Mara Quill.md`, scope));
	assert.ok(!inScope(`${BOOK}/Archive/superseded.md`, scope));
});

test("exclude still works with no allowlist at all", () => {
	const scope = { include: [], exclude: ["Archive", "Meta/Templates"] };
	assert.ok(inScope("Reports/README.md", scope));
	assert.ok(!inScope("Archive/Imported/Deployment plan.md", scope));
	assert.ok(!inScope("Meta/Templates/Meeting.md", scope));
});

test("several folders may be allowed at once", () => {
	const scope = { include: [BOOK, "Reports"], exclude: [] };
	assert.ok(inScope(`${BOOK}/World/Locations/Saltmarsh.md`, scope));
	assert.ok(inScope("Reports/Findings/x.md", scope));
	assert.ok(!inScope("Journal/2026/08/2026-08-24.md", scope));
});

test("folders are normalised the way a settings field is actually typed", () => {
	assert.strictEqual(normaliseFolder("  /Reports/  "), "Reports");
	assert.strictEqual(normaliseFolder("Reports"), "Reports");
	// The vault root in an allowlist is not an allowlist, so it is dropped
	// rather than silently admitting everything under a rule that claims not to.
	assert.deepStrictEqual(normaliseScope({ include: ["", "/", "  "], exclude: [] }).include, []);
	assert.ok(inScope("anywhere.md", { include: ["", "/"], exclude: [] }));
});

test("a trailing slash in settings does not break the match", () => {
	assert.ok(inScope(`${BOOK}/World/README.md`, { include: [`${BOOK}/`], exclude: [] }));
});

test("the scope description says what is being counted", () => {
	assert.strictEqual(describeScope({ include: [], exclude: [] }), "the whole vault");
	assert.strictEqual(describeScope({ include: [], exclude: ["Archive"] }), "the whole vault except 1 folder");
	assert.strictEqual(describeScope({ include: [BOOK], exclude: [] }), BOOK);
	assert.strictEqual(describeScope({ include: [BOOK, "Reports"], exclude: [] }), "2 folders");
	assert.strictEqual(describeScope({ include: [BOOK], exclude: ["a", "b"] }), `${BOOK}, less 2 excluded`);
});

done();
