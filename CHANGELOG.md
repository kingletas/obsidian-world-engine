# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **A release workflow.** Pushing a tag equal to the manifest's version, such as `0.4.0`, builds and tests that commit, then publishes a GitHub release with `main.js`, `manifest.json` and `styles.css` attached, and the matching CHANGELOG section as its notes. It refuses a tag that disagrees with `manifest.json`, `package.json` or `versions.json`.

### Changed

- **CI runs `make check`**, the same gate a commit runs, on Ubuntu with Node 20 and 22. The macOS and Windows jobs are gone, and the manifest check now covers `versions.json` too.
- **`make install` and `make plan` need a vault named.** They used to default to a folder on the author's machine, which doesn't exist anywhere else. Run `make install VAULT=/path/to/test-vault`; without `VAULT` both stop with a usage message.
- **`Indexed folders` ships empty rather than naming one vault's project folder.** A folder name shipped as a default is shipped to every install, where it silently scopes the index to a path that does not exist — which presents as *the index found nothing* rather than as a setting nobody set. Scoping is still the first thing to do after installing; the settings tab says so.
- The repository gains a licence, a contributing guide, a security policy, an architecture document and CI that builds the artifact Obsidian actually loads.

## [0.3.0] — 2026-08-24

### Changed

- **Relationships live in flat properties, where Obsidian can render them.** The Properties panel renders flat values as fields and link pills, and shows any nested mapping as raw JSON in an orange *unrecognized type* row — so the nested `relationships:` block was unreadable in the one panel frontmatter exists to populate.
  - Every schema-declared relationship kind is now read as an inline, top-level relationship property. The settings list is only for kinds no schema declares.
  - **The snapshot fingerprint uses the effective kind set**, so a schema declaring a new kind invalidates records parsed without it.
  - The linter and validator treat a declared kind at the top level as a relationship rather than an unknown or stray property — otherwise they would disagree with the parser about the same key.
  - **Create relationship** writes the flat shape on a note with no block, and keeps appending in-shape on a note that has one.

### Added

- **Flatten relationships into properties.** Map-form blocks lift to top-level lists through `processFrontMatter`. Entries carrying metadata — list form, `{target:, since:}` — stay in the block and are named in the notice rather than being silently dropped.

## [0.2.1] — 2026-08-24

### Fixed

- **The dashboard was never opened, not never drawn.** `DashboardView.open(path, property?)` — the handler behind clicking a finding or an entity row — silently overrode `View.open()`, the undocumented internal Obsidian calls to *attach* a view. Obsidian invoked it with an `HTMLElement`, the path lookup returned null, the method returned, and Obsidian's own `open` never ran. `onOpen()` never fired, `contentEl` was never attached to the document, and the tab was blank.
  - **Three things pointed away from the cause.** The settings tab kept working, because it is registered separately from a view. The index was correct throughout, so nothing about the data was implicated. And `View.open` is not in the public typings, so `tsc` had nothing to conflict with and all twelve suites stayed green.
  - Renamed to `openNote`, with a docblock saying why it must not go back.
- **`tests/reserved.test.cjs` is the durable half.** Every member the views declare, checked against a hand-maintained list of `Component` / `View` / `ItemView` members with the undocumented internals included, plus a proof that the guard fires. The list is over-broad on purpose — a false positive costs a rename.
  - A sibling plugin lost three releases to this same defect four days earlier. **The lesson was written down in a README and reached this plugin anyway**, which is the argument for a test rather than a note.

## [0.2.0] — 2026-08-24

### Added

- **`includeFolders`: an allowlist applied before the existing exclude list.** Empty means the whole vault, so nothing changes for anyone who does not set it.
  - **The reason is not performance.** A schema-and-validation engine is only meaningful over notes somebody has decided to structure. Pointed at a general-purpose vault it buried the readable signal under well over a thousand warnings; scoped, the same vault gave a few hundred notes and almost nothing to fix.

## [0.1.1] — 2026-08-24

### Fixed

- Two defects the first real-vault scan found.
- The index emitter's unsubscribe is no longer handed to `registerEvent`, which expects a different shape.

## [0.1.0] — 2026-08-24

### Added

- **World Engine** — schemas, validation, a linter, entities, canon states and a dashboard.
  - **The index is a cache; your Markdown is the data.** Nothing writes to a note except commands you invoke by hand, the snapshot lives in the plugin's own folder rather than in your vault tree, and disabling the plugin changes nothing in your vault.
  - **There is a test for that last claim.** `tests/cache.test.cjs` asserts that an index restored from the snapshot is byte-for-byte the index you get by re-parsing the vault. If those ever disagree, the cache has become a second source of truth — a bug, not a trade-off.
  - Schemas are plain YAML in a vault folder: required and optional properties, types, enums, defaults, ranges, patterns, `extends` inheritance, versioning, and declared relationship types with inverses and cardinality.
  - Twelve linter checks, each with a code, an overridable severity and an off switch.
