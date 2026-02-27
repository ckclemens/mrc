# 🎩 Mister Claude

A sandboxed Docker container for Claude Code with an iptables firewall.
Your code stays on the host, VS Code stays happy, and Claude stays in his room.

## What he can reach

- `api.anthropic.com` — his brain
- `registry.npmjs.org` — npm packages
- `github.com` — git operations
- `sentry.io`, `statsig.anthropic.com` — telemetry

Everything else is blocked. He'll get an immediate REJECT if he tries.

## Files

```
mrc                  # the command
Dockerfile           # his room
entrypoint.sh        # starts firewall, passes API key, launches claude
init-firewall.sh     # the lock on the door
.env                 # his API key (create this, not checked in)
```

## Prerequisites (macOS)

Install Colima (lightweight Docker runtime — no GUI, no license hassles):

```bash
brew install docker docker-buildx colima
```

Tell Docker where to find buildx:

```bash
mkdir -p ~/.docker
echo '{"cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]}' > ~/.docker/config.json
```

Start the VM (Apple Silicon optimized):

```bash
colima start --vm-type vz --mount-type virtiofs --cpu 4 --memory 8
```

Stop it when you're done to reclaim resources:

```bash
colima stop
```

## Setup

1. Clone this repo

2. Create a `.env` file with a dedicated API key:

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

3. Add `mrc` to your PATH:

   ```bash
   chmod +x mrc
   ln -s "$(pwd)/mrc" /usr/local/bin/mrc
   ```

## Usage

```bash
mrc ~/projects/my-app
mrc ~/projects/my-app -- -p "refactor the auth module"
mrc .
```

Run it from anywhere — the symlink resolves back to the repo.

First run builds the image (~2 min). After that he's ready in about 5 seconds
while the firewall sets up, then you're in the Claude Code CLI.

When you quit, the container disappears.

## Keeping secrets from Mister Claude

Create a `.sandboxignore` in your repo root:

```
.env
.env.local
terraform/
k8s/
secrets/
```

Files are masked with `/dev/null`. Directories appear empty.
He doesn't know what he's missing.

## Letting him visit new places

Edit the `ALLOWED_DOMAINS` array in `init-firewall.sh`:

```bash
ALLOWED_DOMAINS=(
    "api.anthropic.com"
    "registry.npmjs.org"
    "sentry.io"
    "statsig.anthropic.com"
    "statsig.com"
    "your-private-registry.com"   # add your own
)
```

Then rebuild: `docker rmi mister-claude`

## How it works

1. `mrc` builds the image, reads `.sandboxignore`, starts the container
2. The container runs `init-firewall.sh` as root (passwordless sudo)
3. Firewall fetches GitHub's IP ranges, resolves allowed domains, sets
   default policy to DROP, verifies `example.com` is blocked
4. Claude Code starts with `--dangerously-skip-permissions` (the container
   is the security boundary)
5. You're in the CLI

VS Code on the host sees all file changes instantly via the bind mount.
UID/GID matching means no permission weirdness.

## Customization

**Extra system tools:** Add to `apt-get install` in the Dockerfile.

**Different Node version:** Change `FROM node:22-slim`.

**Adjust Colima resources:** `colima stop && colima start --vm-type vz --mount-type virtiofs --cpu 6 --memory 16`

**Let him run free:** Change the ENTRYPOINT in the Dockerfile to
`ENTRYPOINT ["claude", "--dangerously-skip-permissions"]`