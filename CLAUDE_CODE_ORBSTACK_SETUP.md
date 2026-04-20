# Running Claude Code with mrc + OrbStack

How to run Claude Code using a forked version of [mrc (Mister Claude)](https://github.com/aisaacs/mrc) with OrbStack as the container runtime instead of Colima. This gives you a sandboxed, firewall-protected Claude Code environment with session management, clipboard support, and desktop notifications — on both your M5 Max and your daily driver.

**Why fork mrc:** mrc is built around Colima. OrbStack is faster on Apple Silicon, already installed on the M5 Max, and self-managing (no CLI start/stop needed). The fork swaps out the ~10 lines of Colima-specific logic for a simple Docker daemon check that works with OrbStack.

---

## Overview

| | M5 Max | Daily Driver |
|---|---|---|
| Container runtime | OrbStack (already installed) | OrbStack (install first) |
| mrc fork | Clone and symlink | Clone and symlink |
| API key | Add to `~/.zprofile` | Add to `~/.zprofile` |

---

## Part 1 — Fork and Modify mrc

Do this once on either machine, push the fork, then clone it on both.

**Step 1 — Fork mrc on GitHub**

Go to https://github.com/aisaacs/mrc and click Fork. Fork it to your personal `charley` GitHub account. Name it whatever you like — `mrc` is fine.

**Step 2 — Clone your fork**

```bash
cd ~/work
gh repo clone charley/mrc mrc
cd mrc
```

**Step 3 — Modify the mrc script to use OrbStack**

Open `mrc` in your editor. Find the section that handles Colima — it looks for `colima status`, starts Colima if it's not running, and passes Colima-specific flags. Replace all of that with a simple Docker daemon check.

The key changes are:

1. **Remove the Colima auto-start block.** Find anything that calls `colima start`, `colima status`, or `colima stop` and remove it.

2. **Replace with an OrbStack/Docker check.** Add this in its place:

```bash
# Check Docker daemon is available (OrbStack manages this automatically)
if ! docker info > /dev/null 2>&1; then
    echo "Docker is not running. Open OrbStack from your Applications folder and try again."
    exit 1
fi
```

3. **Remove Colima-specific flags.** Find any references to `--vm-type vz` or `--mount-type virtiofs` and remove them — these are Colima flags that don't apply to OrbStack.

4. **Remove the verbose Colima output section** if present (the `-v` flag that shows Colima startup logs).

**Step 4 — Test the modified script**

```bash
chmod +x mrc
./mrc .   # test against the current directory
```

If Claude Code launches, the modification worked.

**Step 5 — Commit and push**

```bash
git add mrc
git commit -m "Replace Colima with OrbStack Docker daemon check"
git push
```

---

## Part 2 — Set Up on the M5 Max

OrbStack is already installed and running. Just clone the fork and wire it up.

**Step 1 — Clone your fork (if not done above)**

```bash
cd ~/work
gh repo clone charley/mrc mrc
```

**Step 2 — Add mrc to your PATH**

```bash
chmod +x ~/work/mrc/mrc
sudo ln -s ~/work/mrc/mrc /usr/local/bin/mrc
```

**Step 3 — Store your API key**

```bash
echo 'export ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx' >> ~/.zprofile
source ~/.zprofile
```

**Step 4 — Create a .env file in the mrc repo**

```bash
echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" > ~/work/mrc/.env
```

**Step 5 — Test it**

```bash
cd ~/work/seo-aio-auditor
mrc .
```

Claude Code should launch inside a sandboxed container with your repo mounted at `/workspace`.

---

## Part 3 — Set Up on the Daily Driver

**Step 1 — Install OrbStack**

```bash
brew install orbstack
```

Open OrbStack from your Applications folder:
- Click Allow when it asks for networking permissions
- Wait for the green "running" status in the menu bar

Verify Docker is working:

```bash
docker run --rm hello-world
```

**Step 2 — Clone your mrc fork**

```bash
mkdir -p ~/work && cd ~/work
gh repo clone charley/mrc mrc
```

If `gh` isn't installed yet:

```bash
brew install gh
gh auth login
# Choose: GitHub.com → HTTPS → Paste an authentication token
# Paste your classic PAT (ghp_...) from 1Password
```

**Step 3 — Add mrc to your PATH**

```bash
chmod +x ~/work/mrc/mrc
sudo ln -s ~/work/mrc/mrc /usr/local/bin/mrc
```

**Step 4 — Store your API key**

```bash
echo 'export ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx' >> ~/.zprofile
source ~/.zprofile
echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" > ~/work/mrc/.env
```

**Step 5 — Test it**

```bash
cd ~/work/agent-platform
mrc .
```

---

## Daily Workflow

```bash
# Navigate to any repo
cd ~/work/agent-platform

# Launch Claude Code in a sandboxed container
mrc .

# Pass a prompt directly
mrc . -- -p "refactor the auth module"

# Start a new named session
mrc --new fix-bug-42

# List sessions
mrc sessions ls

# Resume a session
mrc sessions resume fix-bug-42
```

When you quit Claude Code the container is destroyed. Your files are untouched on the host — only the container is ephemeral. Sessions are saved in `.mrc/` inside the repo and resume automatically next time you open the same repo.

---

## Using Cursor as a GUI alongside mrc

Cursor works seamlessly alongside mrc because mrc bind-mounts your local repo into the container — your files are normal Mac files that Cursor can see and edit in real time. Any change Claude Code makes inside the container shows up instantly in Cursor, and any change you make in Cursor is immediately visible to Claude Code.

**Basic setup (open repo in Cursor, run mrc in Cursor's terminal):**

1. Open Cursor and open your repo folder (e.g. `~/work/agent-platform`)
2. Open the integrated terminal in Cursor: **View → Terminal** or **Ctrl+`**
3. Run mrc from there:
   ```bash
   mrc .
   ```

Claude Code runs in the terminal pane, Cursor shows the file tree and editor side by side. You can review diffs, navigate code, and edit files in Cursor while Claude Code works in the terminal — all against the same files.

**Recommended Cursor settings for this workflow:**

- **Auto Save:** Cursor → Settings → Files: Auto Save → set to `onFocusChange`. This means your edits save automatically when you switch to the terminal, so Claude Code always sees your latest changes.
- **Git integration:** Cursor's built-in git panel shows every change Claude Code makes as a diff. Use it to review and selectively stage or revert changes before committing.

**Splitting the view:**

For a comfortable layout, split Cursor into two panes — file editor on the left, terminal on the right:
- Drag the terminal pane up to give it more height, or drag it to the right side to run it alongside the editor

**Reviewing Claude's changes before committing:**

Since mrc runs with `--dangerously-skip-permissions`, Claude Code can edit files freely. Use Cursor's Source Control panel (**Ctrl+Shift+G**) to review every file Claude touched before committing. This is your main safety check — treat it like a code review on everything Claude produces.

---

## Keeping Secrets from Claude

Create a `.sandboxignore` file in any repo root to hide files and folders from Claude inside the container:

```
# Secrets
.env
.env.local
.env.production

# Infrastructure
terraform/
secrets/
```

Files are masked with `/dev/null` — they appear empty inside the container. Claude can't read them even while working in the repo.

---

## Firewall — What Claude Can and Can't Reach

mrc uses an iptables firewall that whitelists only the domains Claude actually needs:

| Domain | Purpose |
|---|---|
| `api.anthropic.com` | Claude API |
| `registry.npmjs.org` | npm packages |
| `sentry.io` | Telemetry |
| `statsig.anthropic.com` / `statsig.com` | Telemetry |

Everything else is blocked. If your agent work requires additional domains (e.g. a private registry), add them to `init-firewall.sh` in your fork and rebuild:

```bash
docker rmi mister-claude
mrc .   # rebuilds automatically
```

---

## Notifications

mrc sends a desktop notification when Claude finishes, needs permission, or shows the plan approval prompt.

**Install prerequisites:**

```bash
brew install terminal-notifier socat
```

**Allow notifications through Focus/Do Not Disturb:**

System Settings → Focus → Do Not Disturb → Allowed Notifications → Apps → Add → terminal-notifier

**Disable if not wanted:**

```bash
mrc --no-notify ~/work/agent-platform
mrc --no-sound ~/work/agent-platform   # notifications without sound
```

---

## Updating Claude Code

Claude Code's version is baked into the Docker image at build time. To update:

```bash
docker rmi mister-claude
mrc .   # rebuilds with the latest Claude Code from npm
```

---

## Troubleshooting

**`docker: command not found`**
OrbStack isn't running. Open OrbStack from Applications and wait for the green status indicator.

**`Docker is not running`**
Same — open OrbStack from Applications.

**Permission errors on mounted files**
The image builds with your UID/GID. If permissions are wrong, rebuild: `docker rmi mister-claude` and run `mrc .` again.

**`✗ Auto-update failed`**
Expected — auto-update is disabled inside the container. Rebuild the image manually (see Updating Claude Code above).

**Slow file access**
OrbStack uses VirtioFS for fast file sharing by default on Apple Silicon — no configuration needed.

**Sessions not resuming**
Check that `.mrc/` exists in the repo root. If it was deleted or gitignored incorrectly, mrc will start a fresh session.

---

*Last updated: 2026-04-19*
