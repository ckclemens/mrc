# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mister Claude (`mrc`) is a sandboxed Docker container launcher for Claude Code with an iptables firewall. It runs Claude Code inside a locked-down container where only whitelisted domains are reachable (api.anthropic.com, registry.npmjs.org, sentry.io, statsig endpoints).

## Architecture

The system has four components that execute in sequence:

1. **`mrc`** (bash) — Host-side launcher. Starts Colima if needed, builds the Docker image with the user's UID/GID, processes `.sandboxignore` to hide sensitive paths, creates a per-repo config volume (`mrc-config-<hash>`), and runs the container with the repo bind-mounted at `/workspace`.

2. **`Dockerfile`** — Builds on `node:22-slim`. Installs Claude Code via native binary download, creates a non-root `coder` user, and grants passwordless sudo only for the firewall script.

3. **`entrypoint.sh`** — Container startup. Waits for DNS (up to 30s), runs the firewall via sudo, restores Claude config from backups if needed, symlinks Claude's project store into `/workspace/.mrc/` for repo-local persistence, then starts `claude --dangerously-skip-permissions --continue`.

4. **`init-firewall.sh`** — Network lockdown. Preserves Docker's internal DNS NAT rules, resolves whitelisted domains to IPs via `dig`, populates an `ipset`, sets iptables default policy to DROP with explicit REJECT for immediate feedback, blocks all IPv6, and verifies by confirming `example.com` is unreachable.

## Key Design Decisions

- **Container is the security boundary** — Claude runs with `--dangerously-skip-permissions` because the Docker container + firewall provide isolation, not Claude's own permission system.
- **UID/GID matching** — The Docker image is built with the host user's UID/GID as build args so bind-mounted files have correct ownership.
- **Config persistence** — `~/.claude` is stored in a per-repo Docker volume (`mrc-config-<hash>`) that survives container restarts. A symlink maps `~/.claude.json` → `~/.claude/claude.json`. Each repo gets its own volume, keyed by an MD5 hash of the repo path, to avoid cross-project contamination.
- **Project-local memory** — Claude Code's project store (`~/.claude/projects/-workspace/`) is symlinked into `/workspace/.mrc/` so that memory, conversation history, and project settings live in the repo itself. This survives volume resets and travels with the project. `.mrc/` is auto-added to `.gitignore`.
- **Auto-resume** — The entrypoint passes `--continue` to Claude Code, so re-opening a repo automatically resumes the last conversation. A fresh conversation starts if no prior session exists.
- **Auto-update disabled** — `DISABLE_AUTOUPDATER=1` is set because the firewall blocks npm CDN hosts needed for updates. Rebuild the image (`docker rmi mister-claude`) to get a new Claude Code version.
- **`.sandboxignore`** — Files are masked with `/dev/null` (appear empty); directories get anonymous volume overlays (appear as empty dirs).

## Development Workflow

There is no build system, test suite, or linter. The project is four shell scripts and a Dockerfile.

**To test changes:** run `mrc` against a target repo and verify behavior. Force an image rebuild after Dockerfile or init-firewall.sh changes:

```bash
docker rmi mister-claude
mrc ~/some/repo
```

**To add allowed domains:** edit the `for domain in ...` loop in `init-firewall.sh`.

**To add system packages:** add to the `apt-get install` line in the Dockerfile.

## Conventions

- All bash scripts use `set -euo pipefail`
- User-facing output uses Spaceballs-themed messaging
- The launcher script handles macOS/Colima-specific concerns (auto-starting VM, DOCKER_HOST socket)
