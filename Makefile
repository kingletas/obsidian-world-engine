# World Engine — an Obsidian plugin
#
# Run `make` with no arguments for the list.
#
# Obsidian loads a plugin out of <vault>/.obsidian/plugins/world-engine/, so the built
# bundle is an artefact and this tree is the source. Edit here, then install --
# never the other way round.

SHELL       := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# The vault to install into. There is no default: point it at a throwaway test
# vault, never your real one, as `make install VAULT=/path/to/test-vault`.
VAULT ?=

.PHONY: help
help: ## Show this help
	@echo
	@echo "  World Engine — an Obsidian plugin"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "    \033[36m%-12s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "  install and plan need a vault: VAULT=/path/to/test-vault"
	@echo

# --- install ----------------------------------------------------------------

.PHONY: install
install: require-vault ## Build and install into VAULT
	@OBSIDIAN_VAULT="$(VAULT)" obsidian-plugin-install "$(CURDIR)"

.PHONY: plan
plan: require-vault ## What install would build and copy, changing nothing
	@OBSIDIAN_VAULT="$(VAULT)" obsidian-plugin-install -n "$(CURDIR)"

.PHONY: require-vault
require-vault:
	@if [ -z "$(VAULT)" ]; then \
		echo "usage: make install VAULT=/path/to/test-vault" >&2; \
		echo "       make plan VAULT=/path/to/test-vault" >&2; \
		exit 2; \
	fi

# --- build ------------------------------------------------------------------

.PHONY: build
build: ## Type-check and produce the production bundle
	@npm run build

.PHONY: dev
dev: ## Rebuild on change
	@npm run dev

# --- checks -----------------------------------------------------------------

.PHONY: test
test: ## The suite
	@npm test

.PHONY: check
check: build test ## Everything a commit has to pass
	@echo
	@echo "  the bundle builds and the suite passes"
