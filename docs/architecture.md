# Architecture

About 4,000 lines of TypeScript, no runtime dependencies. One claim holds it together, and it is testable rather than aspirational: **the index is a cache; your Markdown is the data.**

## The shape

```text
Vault ──▶ core/parser.ts   ── frontmatter → a record
              │
              ▼
        core/indexer.ts    ── records, backlinks, the graph
              │            ◀── core/cache.ts (a snapshot, outside your vault)
              │
    ┌─────────┼──────────┬────────────────┬───────────────┐
    ▼         ▼          ▼                ▼               ▼
 schema/   entities/  relationships/   canon/        validation/
 validator engine     engine           engine        rules + vault-linter
    │         │          │                │               │
    └─────────┴──────────┴────────────────┴───────────────┘
                         │
                         ▼
              dashboard/dashboard-engine.ts ──▶ ui/
```

| Area | Responsibility |
|---|---|
| `core/parser.ts` | Frontmatter to a record. One place, so nothing downstream disagrees about a key |
| `core/indexer.ts` | The index, backlinks, incremental updates |
| `core/cache.ts` | The snapshot, and the fingerprint that decides when it is stale |
| `core/scope.ts` | The include/exclude allowlist |
| `schema/` | Schema loading, and validation against it |
| `entities/`, `relationships/`, `canon/` | The three domain engines |
| `validation/rules/` | The twelve linter checks |
| `dashboard/` | Scoring, and the dimensions it scores |
| `ui/` | The dashboard view, the health view, the two create modals |

## Four decisions worth knowing

### The index is a cache, and there is a test for it

`tests/cache.test.cjs` asserts that **an index restored from the snapshot is byte-for-byte the index you get by re-parsing the vault.**

If those ever disagree, the cache has become a second source of truth — a bug rather than a trade-off. **Do not weaken that test to make a change pass.**

The rest follows from it:

- Nothing writes to a note except three commands you invoke by hand.
- The snapshot lives in the plugin's own folder, not in your vault tree. Delete it and the next scan rebuilds it.
- Disable the plugin and nothing in your vault changes. Re-enable it and the whole index comes back from the vault.

### The fingerprint has to include the schema

The snapshot's fingerprint uses the **effective relationship kind set**, not just file mtimes.

This is subtler than it looks. A schema that declares a new relationship kind changes how notes *parse* — a key that was a stray property yesterday is a relationship today — so records parsed before that schema existed are wrong, even though not one note changed. Fingerprinting the schema is what invalidates them.

The general rule: **anything that changes how a record is derived belongs in the fingerprint**, not only the inputs it is derived from.

### Relationships are flat properties, because that is what Obsidian can render

Obsidian's Properties panel renders flat values as fields and link pills, and shows any nested mapping as raw JSON in an orange *unrecognized type* row.

So a nested `relationships:` block was unreadable **in the one panel frontmatter exists to populate.** 0.3.0 moved to top-level properties: every schema-declared kind is read as an inline relationship property, and the settings list covers only kinds no schema declares.

The parser, the linter and the validator all had to agree about this in the same change, or they would disagree with each other about the same key. That is the recurring hazard in this codebase — several components reading one frontmatter key — and it is why `core/parser.ts` is the only place a key is interpreted.

**Flatten relationships into properties** migrates existing blocks. Entries carrying metadata — list form, `{target:, since:}` — stay in the block and are named in the notice rather than being silently dropped.

### Scope is an allowlist, and it ships empty

`includeFolders` is applied before the exclude list. Empty means the whole vault.

**The reason is not performance.** A schema-and-validation engine is only meaningful over notes somebody has decided to structure. Pointed at a general-purpose vault it buries the readable signal under well over a thousand warnings; scoped to the project it was built for, the same vault gives a few hundred notes and almost nothing to fix. Noise is what makes people turn a linter off.

It ships **empty** rather than naming a folder, because a shipped folder name is one vault's folder — silently scoping every other install to a path that does not exist, which presents as *the index found nothing* rather than as a setting nobody set.

The prefix match guards against near-misses: `Fiction` must not match `Fiction Archive/note.md`. `core/scope.ts` does that with a trailing-slash test.

## The bug that produced `reserved.test.cjs`

`DashboardView.open(path, property?)` — the handler behind clicking a finding — silently overrode `View.open()`, the undocumented internal Obsidian calls to *attach* a view. Obsidian invoked it with an `HTMLElement`, the path lookup returned null, the method returned, and Obsidian's own `open` never ran. `onOpen()` never fired, `contentEl` was never attached, and the tab was blank.

**Three things pointed away from the cause.** The settings tab kept working, because it is registered separately from a view. The index was correct throughout — 317 records, 141 entities, 223 relationships, snapshot on disk — so nothing about the data was implicated. And `View.open` is not in the public typings, so `tsc` had nothing to conflict with and all twelve suites stayed green.

`tests/reserved.test.cjs` walks every member the views declare against a hand-maintained list of `Component` / `View` / `ItemView` members with the undocumented internals included, plus a proof that the guard fires. **The list is over-broad on purpose — a false positive costs a rename.**

A sibling plugin lost three releases to this same defect four days earlier. **The lesson was written down in a README and reached this plugin anyway**, which is the argument for a test rather than a note.

## Continuity is unscored, deliberately

The dashboard scores several dimensions and weights them. **Continuity is always unscored in this release**, because the checks behind it are not implemented — and a dimension nothing measures must not score 100%.

That is the general rule the dashboard follows: an unmeasured thing reports as unmeasured. A default of *perfect* on an absent check is how a scorecard becomes a lie.

## Testing

The suite `require()`s an esbuild bundle rather than the TypeScript sources, because the bundle is the only thing Obsidian ever loads.

Everything except `main.ts`, `settings.ts` and the UI files is pure — a function of an index and some options — so the tests drive the real code with hand-written notes and no app.
