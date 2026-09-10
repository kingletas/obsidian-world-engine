// A seven-note example vault: two characters, two locations, a faction, an item and an event.

const { load } = require("./harness.cjs");
const { parseNote, DEFAULT_PARSE_OPTIONS } = load("core-parser");

const NOTES = {
	"Characters/Mara Quill.md": {
		type: "character",
		id: "mara-quill",
		title: "Mara Quill",
		canon_status: "canon",
		status: "alive",
		species: "human",
		age: 24,
		relationships: {
			knows: ["[[Isa Venn]]"],
			possesses: ["[[Copper Compass]]"],
			member_of: ["[[Lantern Order]]"],
			located_at: ["[[Tern Harbour]]"],
		},
	},
	"Characters/Isa Venn.md": {
		type: "character",
		id: "isa-venn",
		title: "Isa Venn",
		canon_status: "established",
		status: "alive",
	},
	"Locations/Tern Harbour.md": { type: "location", id: "tern-harbour", title: "Tern Harbour", canon_status: "canon" },
	"Locations/Grey Ford.md": { type: "location", id: "grey-ford", title: "Grey Ford", canon_status: "draft" },
	"Factions/Lantern Order.md": { type: "faction", id: "lantern-order", title: "Lantern Order", canon_status: "canon" },
	"Items/Copper Compass.md": { type: "item", id: "copper-compass", title: "Copper Compass", canon_status: "provisional" },
	"Events/Battle of Grey Ford.md": {
		type: "event",
		id: "battle-grey-ford",
		title: "Battle of Grey Ford",
		date: "1312-05-09",
		location: "[[Grey Ford]]",
		participants: ["[[Mara Quill]]", "[[Isa Venn]]"],
		canon_status: "canon",
	},
};

/** Resolve by basename, the way Obsidian does for an unqualified wikilink. */
function makeResolver(paths) {
	const byBasename = new Map();
	for (const p of paths) byBasename.set(p.split("/").pop().replace(/\.md$/, ""), p);
	return (raw) => byBasename.get(raw.split("/").pop().replace(/\.md$/, "")) ?? null;
}

/** Build a records map from a `{path: frontmatter}` object. Body links are
 * passed separately because most tests do not need any. */
function buildRecords(notes = NOTES, extra = {}) {
	const paths = Object.keys(notes);
	const resolve = makeResolver(paths);
	const records = new Map();
	let mtime = 1_700_000_000_000;
	for (const [path, frontmatter] of Object.entries(notes)) {
		mtime += 1000;
		const options = extra.parseOptions ?? DEFAULT_PARSE_OPTIONS;
		records.set(
			path,
			parseNote(
				{
					path,
					basename: path.split("/").pop().replace(/\.md$/, ""),
					frontmatter,
					links: (extra.links ?? {})[path] ?? [],
					embeds: (extra.embeds ?? {})[path] ?? [],
					tags: [],
					headings: 1,
					body: (extra.bodies ?? {})[path] ?? `# ${path}\n\nSome prose here.`,
					mtime,
					size: 100,
				},
				resolve,
				options
			)
		);
	}
	return records;
}

module.exports = { NOTES, buildRecords, makeResolver };
