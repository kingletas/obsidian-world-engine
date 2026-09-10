# From nothing to a working World Engine

By the end of this page you'll have built the plugin from source, installed it in a throwaway vault, created your first entity, and seen it on the dashboard.

## Contents

- [What this is](#what-this-is)
- [What you need](#what-you-need)
- [Step 1: get the code and build it](#step-1-get-the-code-and-build-it)
- [Step 2: make a throwaway vault](#step-2-make-a-throwaway-vault)
- [Step 3: install the plugin into it](#step-3-install-the-plugin-into-it)
- [Step 4: turn it on and create your first entity](#step-4-turn-it-on-and-create-your-first-entity)
- [Where to go next](#where-to-go-next)

## What this is

World Engine is an Obsidian plugin for vaults that describe a world: characters, places, events and how they relate. You write schemas in plain YAML that say what a character note should contain, and the plugin checks your notes against them.

An *entity* is a note with a type, such as a character or a location. The plugin keeps an index of your entities, but the index is only a cache. Your Markdown files stay the real data, and deleting the index loses nothing.

## What you need

- Obsidian 1.5 or newer.
- git, Node.js 20 or 22 with npm, and GNU make.

Check the command-line tools are there:

```bash
node --version && npm --version && make --version | head -1 && git --version
```

```text
v20.20.2
10.8.2
GNU Make 4.3
git version 2.43.0
```

Your version numbers will differ. What matters is that Node starts with `v20` or `v22`, and none of the four says `command not found`.

## Step 1: get the code and build it

```bash
git clone https://github.com/kingletas/obsidian-world-engine
cd obsidian-world-engine
npm ci
```

The clone from GitHub is not verified: the repository wasn't published when this page was written, so the run below cloned a local copy instead. Everything after the clone was run for real.

`npm ci` installs exactly the package versions recorded in `package-lock.json`. It should end like this:

```text
added 17 packages, and audited 18 packages in 962ms

1 package is looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

Now build the plugin and run its tests:

```bash
make check
```

This type-checks the code, bundles it into `main.js`, and runs the test suite against that bundle. The end of a good run looks like this:

```text
smoke
  ok  the bundle loads and extends Plugin
  ...
  ok  2 starter schemas are bundled into the plugin
  ok  unload is clean
smoke: 11 passed


  the bundle builds and the suite passes
```

If it stops with `sh: 1: tsc: not found`, you skipped `npm ci`. Run it and try again.

## Step 2: make a throwaway vault

Try the plugin in an empty vault first, so you can see what it does before pointing it at notes you care about.

1. Open Obsidian and choose **Create new vault**.
2. Call it `obsidian-sandbox` and put it in your home folder.

Obsidian creates a hidden `.obsidian` folder inside it. That's where plugins live.

This step is not verified here: it happens in Obsidian's window, which this page's test run didn't open.

## Step 3: install the plugin into it

Obsidian loads a plugin from `<vault>/.obsidian/plugins/<plugin id>/`, and it needs three files there: `main.js`, `manifest.json` and `styles.css`. From the `obsidian-world-engine` folder, copy them in:

```bash
VAULT=~/obsidian-sandbox
mkdir -p "$VAULT/.obsidian/plugins/world-engine"
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/world-engine/"
ls "$VAULT/.obsidian/plugins/world-engine"
```

```text
main.js
manifest.json
styles.css
```

If you see those three names, the files are in place.

You may notice a `make install` target. It hands the copy to a helper script that isn't part of this repository, so on your machine the copy above is the way to do it.

## Step 4: turn it on and create your first entity

1. In Obsidian, open **Settings → Community plugins**.
2. If you see **Restricted mode**, turn it off.
3. Find **World Engine** in the list of installed plugins and switch it on.

Turn plugins on through Obsidian's settings, not by editing `community-plugins.json`. Obsidian rewrites that file from memory when it quits, so a hand edit can vanish.

Now give it something to check:

1. Open the command palette and run **World Engine: Create starter schemas**. This writes two YAML schema files into `Engine/Schemas` in your vault. It never overwrites a file that's already there.
2. Run **World Engine: Create entity**. Pick the type **character**, give it a made-up name such as `Mara Quill`, and confirm. A new note appears with the frontmatter the schema asks for.
3. Run **World Engine: Scan vault**, then **World Engine: Open dashboard**.

The dashboard lists your new character. If a note breaks its schema, the finding names the property, the value it found and the values it expected.

In a real vault, set **Indexed folders** in the plugin's settings before you scan. Left empty, it indexes the whole vault and reports on notes you never meant it to check.

This step is not verified here either. The test suite checks the commands, the starter schemas and entity creation without Obsidian, but nobody clicked through it in Obsidian during this page's test run.

## Where to go next

- [README](../README.md) covers schemas, relationships, canon states and vault health.
- [docs/architecture.md](architecture.md) explains how the pieces fit together.
- [CONTRIBUTING.md](../CONTRIBUTING.md) covers development and pull requests.
