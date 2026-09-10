# Security Policy

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private vulnerability reporting on this repository (*Security* → *Report a vulnerability*), or email **code@kingletas.com**.

Include what you did, what happened, and what you expected. A proof of concept is welcome but not required — a clear description of the flaw is more useful than a working exploit.

This is a personal project maintained by one person, so please expect a first response in days rather than hours. You will get an acknowledgement, an assessment, and credit in the changelog unless you would rather not be named.

## Supported versions

The latest release on `main` is the supported version. There are no long-term support branches; fixes ship forward.

## What it touches

This plugin builds an index over your notes and validates them against schemas you write. Its central claim is that **the index is a cache and your Markdown is the data** — which is a security property as much as a design one.

| Surface | What it means |
|---|---|
| **Your notes** | Every note in the indexed scope is parsed — frontmatter, type, canon state, relationships, links |
| **Note writes** | Three explicit commands: **Create entity**, **Create relationship**, **Flatten relationships into properties**. All go through Obsidian's own frontmatter API, so the rest of the file is untouched |
| **Schemas** | Plain YAML files in a vault folder. A schema decides what is valid, so anything that can write one can change what the plugin reports |
| **The index snapshot** | Written into the plugin's own folder, never into your vault tree |
| **The network** | Nothing. There is no network code in the bundle |

Three properties exist deliberately and should not be quietly removed:

- **Nothing writes to a note except the three commands you invoke by hand.** Validation, linting, indexing and the dashboard are all read-only. A validation pass that repaired what it found would be a validator you could not trust to report.
- **The index is a cache and is provably so.** `tests/cache.test.cjs` asserts that an index restored from the snapshot is byte-for-byte the index you get by re-parsing the vault. If those ever disagree, the cache has become a second source of truth — a bug, not a trade-off. Disable the plugin and nothing in your vault changes; re-enable it and the whole index comes back from the vault.
- **The snapshot lives outside your vault tree.** Delete it and the next scan rebuilds it. It is never something you have to keep, and never something a sync conflict can corrupt into a wrong answer about your notes.

## In scope

- A write that reaches a note outside the three explicit commands, or outside the configured folders
- A frontmatter write that damages the rest of the file rather than only the property it targets
- Frontmatter injection — a value that escapes YAML quoting and changes the meaning of the document
- A schema file that can cause anything other than validation results — path traversal through a schema path, or a schema that makes the indexer act
- Any network call reaching the bundle, by any path including a dependency
- The cache diverging from a fresh parse in a way that makes the plugin report something the vault does not say

## Out of scope

- Vulnerabilities in Obsidian itself, or in its plugin model. Report those to Obsidian
- Findings that require an attacker who already has your filesystem or write access to your vault — at that point the plugin is the least of it
- The plugin declining to do something you enabled deliberately


## If you are running it

- **Scope it before you use it.** `Indexed folders` is empty on install, which means the whole vault. A schema-and-validation engine pointed at a general-purpose vault mostly reports on notes nobody asked it about.
- **Treat your schema folder as configuration.** Anything that can write a schema decides what this plugin calls valid.
- **Version-control your vault, or back it up, before running Flatten relationships.** It is the one command that rewrites properties across many notes at once.
