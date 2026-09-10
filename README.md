<h1 align="center">🌍 World Engine</h1>

<p align="center">A schema, validation and continuity layer for a structured Obsidian vault.</p>

<p align="center">
  <img alt="Obsidian" src="https://img.shields.io/badge/obsidian-1.5.0%2B-7c3aed">
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-strict-2a6db2">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
</p>

---

Entities, relationships, canon states and vault health — with **Markdown and YAML frontmatter kept as the source of truth throughout**.

It was built from a private requirements document; the `§` references below point at that document and are kept as provenance for *why* a decision was made. You do not need it to read this.

**Scope it before you use it.** `Indexed folders` ships empty, which means the whole vault — and a schema-and-validation engine pointed at a general-purpose vault reports mostly on the parts nobody asked it about. See [First run](#first-run).

---

## The one claim everything else rests on

**The plugin's index is a cache. Your Markdown is the data.**

That is §43, and it is not a slogan here — it is a property you can check:

- Nothing this plugin does writes to a note except three explicit commands you invoke by hand (**Create entity**, **Create relationship**, **Flatten relationships into properties**), and both go through Obsidian's own frontmatter API so the rest of the file is untouched.
- The index snapshot lives in the plugin's own folder, not in your vault tree. Delete it and the next scan rebuilds it.
- Disable the plugin: nothing in your vault changes. Re-enable it: the whole index comes back from the vault.

There is a test for the last one — `tests/cache.test.cjs` asserts that an index restored from the snapshot is byte-for-byte the index you get by re-parsing the vault. If those ever disagree, the cache has become a second source of truth, and that is a bug rather than a trade-off.

---

## What it does

| | |
|---|---|
| **Schemas** (§8.1) | Plain YAML files in a vault folder. Required and optional properties, types, enums, defaults, ranges, patterns, `extends` inheritance, versioning, and declared relationship types with inverses and cardinality. |
| **Property validation** (§9) | Missing required properties, invalid enum values, wrong types, bad dates, out-of-range numbers, pattern mismatches — each finding names the property, the value found and the values expected. |
| **Vault linter** (§10) | Twelve checks over the whole vault, each with a code, a severity you can override, and an off switch. |
| **Entities** (§7.1) | Any note with a `type`. Twelve built-in types offered by the create command; a custom type is a first-class type. |
| **Relationships** (§12) | Both frontmatter shapes the BRD gives, plus relationship metadata, inferred inverse edges, and target-type and cardinality validation. |
| **Canon states** (§7.5, §11) | The six states, with aliases for the vocabulary a real vault drifts into, reported so the drift is visible. |
| **Dashboard** (§18) | Counts by type, canon breakdown, relationship and link statistics, recent changes, most-connected entities, and the full findings list with filters. |
| **Vault health** (§22) | A weighted score across four measurable dimensions, each shown with the counts it came from. |
| **Incremental indexing** (§27) | A full pass on startup that yields to the UI every 250 files, then single-file updates on change. |
| **Scope** | An allowlist of folders. Only what you point it at is indexed; links still resolve vault-wide. |
| **Read-only API** (§30) | `app.plugins.plugins["world-engine"].api` — entities, relationships, schemas, canon, findings, statistics. |

### What it deliberately does not do

The BRD is 46 sections; the MVP is one of four stages (§45). Not in this release, and not stubbed either:

- **The continuity engine** (§15). Six independent inference problems, each needing the timeline, the relationship graph and canon state to be correct first. Its health dimension shows `—`, never a percentage: a dimension nothing measures must not score full marks.
- **Timelines** (§14), **story threads** (§16), **the knowledge graph** (§13), **semantic search** (§21) and **any AI** (§21.1). The `story_thread`, `chapter` and `book` schemas ship anyway, so threads written now are indexed and validated from the day a tracker arrives rather than needing a migration.

---

## Scope — point it at what you have structured

**By default the engine indexes one folder, not the vault.** Settings → *Indexed folders* takes a comma-separated allowlist; *Excluded folders* is applied afterwards and subtracts from it. An empty allowlist means the whole vault, which is what earlier versions did unconditionally.

This is not a performance setting. A schema-and-validation engine is only meaningful over notes somebody has decided to structure, and pointed at a general-purpose vault it reports mostly on the parts nobody asked it about — a whole-vault scan of several thousand notes can return **well over a thousand warnings**, with the readable signal in a small fraction of them. Scoped to the one project it was built for, the same vault returns **a few hundred notes and almost nothing to fix**.

**Links still resolve vault-wide.** A note inside the scope linking to one outside it is not a broken link; the scope decides what is *checked*, never what is *reachable*.

**The scope is named everywhere a count appears** — in the scan notice and on the dashboard header — because a number with no denominator on it reads as a whole-vault figure, and a scoped count and a whole-vault count look equally like "the vault" at a glance.

Changing the scope needs a rescan: the index only covers what was in scope when it was built. The snapshot fingerprint includes the scope, so a stale one is discarded rather than producing an index silently missing everything the old scope excluded.

---

## Commands

| Command | What it does |
|---|---|
| `World Engine: Scan vault` | Full index pass, then lint. |
| `World Engine: Rebuild index` | Discards the snapshot and re-reads every note. |
| `World Engine: Validate current note` | Findings for the active note, as a notice and in the dashboard. |
| `World Engine: Open dashboard` | Overview, findings, entities and schemas. |
| `World Engine: Show vault health` | The §22 panel, in the right sidebar. |
| `World Engine: Show all findings` | The dashboard, on the findings tab. |
| `World Engine: Create entity` | New note, seeded from its schema. |
| `World Engine: Create relationship` | Adds one relationship to the active note's frontmatter. |
| `World Engine: Flatten relationships into properties` | Lifts every nested `relationships:` block into top-level list properties — the shape the Properties panel renders. |
| `World Engine: Create starter schemas` | Writes the bundled schemas. Never overwrites an existing file. |
| `World Engine: Reload schemas` | Re-reads the schema folder. |

---

## Writing a schema

A schema file is a YAML mapping of `TypeName: definition`. Start with `Create starter schemas`, then edit `Engine/Schemas/core.yaml`.

```yaml
Character:
  extends: entity
  folder: Characters
  version: 1
  additionalProperties: true
  required:
    - status
  properties:
    status:
      type: enum
      values: [alive, dead, unknown]
      default: alive
    age:
      type: number
      min: 0
  relationships:
    knows:
      target: character
      inverse: knows
    located_at:
      target: location
      cardinality: one
```

Property types: `string`, `number`, `integer`, `boolean`, `date`, `enum`, `list`, `link`, `links`, `any`. A bare `age: number` is valid shorthand. `values:` without `type: enum` is an enum. A name in `required:` with no entry under `properties:` means "must be present, any value".

**Three defaults worth knowing about, all chosen for a vault that already has notes in it:**

- **`additionalProperties` is `true`.** A new schema does not light up every note in the folder over properties it has not heard of. Set it to `false` once a type is under control.
- **Relationship validation only runs when a schema declares relationships.** An empty `relationships:` block would otherwise flag every edge in the vault the day it was created.
- **An unrecognised `type` is reported once, at INFO, and the note is not validated.** It is a note the schemas do not cover, not a broken note.

### Inheritance

`extends` resolves across files and in any order; the child wins on every key it declares. A missing parent and a circular `extends` are both reported as schema problems, and the child still compiles without inheritance rather than disappearing. Schema problems get their own section at the top of the Schemas tab, because a schema that will not compile silently stops validating its whole entity type — which looks exactly like a clean vault.

---

## Relationships

Both shapes the BRD gives are accepted, because a real vault contains both — usually because the map form was written first and one entry later needed a `since`:

```yaml
relationships:            relationships:
  knows:                    - target: "[[Isa Venn]]"
    - "[[Isa Venn]]"          type: knows
  possesses:                  since: 1312
    - "[[Copper Compass]]"    status: active
```

**The flat shape — a top-level list property — is the preferred way to author one:**

```yaml
member_of:
  - "[[The Glass Accord]]"
houses:
  - "[[Tern Harbour]]"
  - "[[Pell Row]]"
```

Obsidian's Properties panel renders flat values as editable fields and link pills, and shows anything nested as raw JSON in an orange "unrecognized type" row — so the nested block, while valid YAML, is unreadable in the one panel frontmatter exists to populate.

Every relationship kind any schema declares is read from the top level automatically; the *Inline relationship properties* setting exists only for kinds no schema declares (`location:` and `participants:` are configured out of the box, because §39's own event example writes them there). **Create relationship** writes the flat shape on a note with no `relationships:` block, and keeps appending in-shape on a note that has one.

**Flatten relationships into properties** (command) migrates a vault: it lifts every map-form `relationships:` block into top-level list properties through `processFrontMatter` and removes the emptied block. Entries that carry metadata — the list form, or a `{target:, since:}` value — have nowhere flat to put the metadata, so they stay in the block and the notice names them rather than silently dropping them.

**Inverse edges are inferred, never written.** Declaring `possesses` with `inverse: possessed_by` means the item can answer "who has me" without a second copy of the fact living in the item's file. Writing to the other note would be the silent Markdown modification §28 forbids, and it would fight the user every time they deleted one half on purpose.

**A relationship counts as a backlink.** In a vault held together by frontmatter rather than prose, an event that names its location and its participants has no body links at all — treating it as an orphan would make the orphan check useless exactly where it matters most.

---

## The linter

| Code | Check | Default |
|---|---|---|
| `WE001` | Broken links | warning |
| `WE002` | Dead embeds | warning |
| `WE003` | Duplicate entity IDs | error |
| `WE004` | Duplicate entities | warning |
| `WE005` | Orphan notes | info |
| `WE006` | Empty notes | info |
| `WE007` | Untyped notes in an entity folder | info |
| `WE008` | Types with no schema | info |
| `WE009` | Canon state | warning / info |
| `WE010` | Broken relationships | warning |
| `WE011` | Invalid dates | warning |
| `WE012` | Invalid YAML | error |
| `WE1xx` | Schema violations | warning / info |

Severities follow §10.2's example where it gives one. Where it does not: **ERROR** means the vault contradicts itself, **WARNING** means a note is wrong, **INFO** means the vault is drifting.

Two rules are folder-relative rather than vault-wide on purpose. `WE007` only fires in a folder where most notes already declare a type — a vault is mostly not entities, and flagging every journal note would bury everything else. `WE005` only applies to typed notes, for the same reason.

`WE012` is not a lint rule at all: by the time the index exists, Obsidian's own parser has already failed and a note with broken frontmatter is indistinguishable from a note with none. The check lives in the indexer, the one layer that can see the raw text, and reports through the same shape.

**Validating one note still runs every rule over the whole vault, then filters.** A duplicate id is only visible vault-wide; scoping the rules instead of the output would make "validate this note" silently blind to it, and the two commands would disagree about the same note.

---

## Vault health

Four measurable dimensions and one that is not:

- **Structure** — orphaned, empty and duplicated notes, over all notes.
- **Metadata** — unrecognised canon states, bad dates, missing types where the folder expects one.
- **Links** — links and relationships that resolve, over all of them.
- **Schemas** — typed notes that validate, **over typed notes**, not over the vault. A vault that is 90% journal would otherwise score 10% forever.
- **Continuity** — `—`. Not implemented.

Weights are configurable, including 0 to drop a dimension. Every dimension shows the counts it was computed from, because §22 asks that the score never hide the underlying issues, and a score with no denominator attached is a number nobody can act on.

---

## Development

```bash
npm install && npm test
```

`npm test` bundles each pure module for Node, checks that `src/schemas.ts` still matches `schemas/*.yaml`, builds the plugin, and runs 128 assertions across thirteen suites. `npm run dev` watches; `npm run build` typechecks and produces `main.js`.

The test fixture is a seven-note example vault with invented names — two characters, two locations, a faction, an item and an event, shaped like the BRD's examples in §12 and §37–§40. One character is deliberately written `canon_status: established`, the seventh state §11's example uses and §11's table does not list; the fixture's one expected finding is that alias, and nothing else.

### Layout

Appendix A's structure, plus `core/graph.ts` and `core/types.ts`:

```text
src/
├── main.ts                    plugin, commands, API
├── settings.ts
├── schemas.ts                 generated from schemas/*.yaml
├── core/       types · parser · indexer · graph · cache · events
├── schema/     types · schema-engine · validator
├── entities/   entity-engine · entity-types
├── relationships/  relationship-engine
├── validation/ vault-linter · rules/
├── canon/      canon-engine
├── dashboard/  dashboard-engine
└── ui/         dashboard-view · health-view · create-entity-modal · create-relationship-modal
```

### One rule about naming, learned the expensive way

**Never name a method after something on `View`, and do not trust the compiler to tell you.** `DashboardView.open()` — the handler behind clicking a finding or an entity row — silently overrode `View.open()`, the undocumented internal Obsidian calls to attach a view. Obsidian handed it an `HTMLElement` where it expected a path, the file lookup failed, and it returned.

Obsidian's own `open` never ran: `onOpen()` never fired, `contentEl` was never attached, and the dashboard tab rendered nothing. The settings tab kept working the whole time, because a settings tab is registered separately from a view — which made a view that was never opened look like a view that could not draw.

**`View.open` is not in the public typings**, so `tsc` had nothing to conflict with and every one of the twelve suites stayed green. `tests/reserved.test.cjs` now checks every member `DashboardView` and `HealthView` declare against a hand-maintained list of `Component`/`View`/`ItemView` members, undocumented ones included. The list is deliberately over-broad: a false positive costs a rename.

This is the second plugin here to ship the same defect — a sibling lost three releases to it — which is the argument for the test rather than the note.

**Everything except `core/indexer.ts`, `main.ts`, `settings.ts` and `ui/` is pure** — no `obsidian` import, no app object, driven by plain data. That is what makes the suite possible without a running Obsidian, and it is worth preserving: the moment a rule needs the app to decide something, it stops being testable.

Timeline, thread and continuity engines have no directories yet. An empty folder promising a feature is worse than an honest absence.

---

## First run

1. **Set `Indexed folders`** to the subtree you have actually structured. Empty means the whole vault, and on a general-purpose vault that buries the readable signal under warnings about notes nobody structured. Noise is what makes people turn a linter off.
2. **Write a schema.** They are plain YAML files in the folder named by `Schema folder`. Without one, validation has nothing to check against.
3. **Run the scan** and open the dashboard.

---

## Install

```bash
git clone https://github.com/kingletas/obsidian-world-engine && cd obsidian-world-engine && npm ci && npm run build
```

```bash
cp main.js manifest.json styles.css "$YOUR_VAULT/.obsidian/plugins/world-engine/"
```

Then enable it in **Settings → Community plugins**. Do the enabling through Obsidian's own UI rather than by editing `community-plugins.json`: the running app rewrites that file from memory when it exits, so a hand-edit made while Obsidian is open is discarded.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers the toolchain and the rules that are not obvious from the code. [`docs/architecture.md`](docs/architecture.md) explains how the pieces fit together. [`SECURITY.md`](SECURITY.md) covers vulnerability reports.

## License

[MIT](LICENSE) © Luis Tineo
