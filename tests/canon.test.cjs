const { assert, suite, test, done, load } = require("./harness.cjs");
const { normaliseCanon, isCanonAlias, canonStats, CANON_STATES } = load("canon-canon-engine");

suite("canon");

test("the six states pass through unchanged", () => {
	for (const state of CANON_STATES) assert.strictEqual(normaliseCanon(state), state);
	assert.strictEqual(CANON_STATES.length, 6);
});

test("§7.5's uppercase spelling is understood", () => {
	assert.strictEqual(normaliseCanon("CANON"), "canon");
	assert.strictEqual(normaliseCanon("NON-CANON"), "non-canon");
});

test("`established` maps to canon and is flagged as an alias", () => {
	// §11's table lists six states and its own example then writes a seventh.
	// It has to work, and it has to be reported, or the vault ends up with two
	// vocabularies for one property and no signal that it happened.
	assert.strictEqual(normaliseCanon("established"), "canon");
	assert.ok(isCanonAlias("established"));
	assert.ok(!isCanonAlias("canon"));
});

test("booleans map, because `canon: true` predates `canon_status` everywhere", () => {
	assert.strictEqual(normaliseCanon(true), "canon");
	assert.strictEqual(normaliseCanon(false), "non-canon");
});

test("an unrecognised value is null, not a guess", () => {
	assert.strictEqual(normaliseCanon("mostly true"), null);
	assert.strictEqual(normaliseCanon(""), null);
	assert.strictEqual(normaliseCanon(null), null);
	assert.strictEqual(normaliseCanon(undefined), null);
});

test("the ratio is over stated states, not over every note", () => {
	// Four notes, two of them stating a canon state, one of those canon. A ratio
	// over all four would say 25% and would fall every time an untyped note was
	// added; over stated states it says 50%, which is the question being asked.
	const stats = canonStats(["canon", "draft", null, null]);
	assert.strictEqual(stats.stated, 2);
	assert.strictEqual(stats.unset, 2);
	assert.strictEqual(stats.established, 1);
	assert.strictEqual(stats.establishedRatio, 0.5);
});

test("a vault with no canon states anywhere reports 0, not NaN", () => {
	const stats = canonStats([null, null]);
	assert.strictEqual(stats.establishedRatio, 0);
	assert.strictEqual(stats.byState.canon, 0);
});

done();
