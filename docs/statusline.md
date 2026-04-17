# mrc-statusline

A Python script that renders a live status bar at the bottom of every mrc session.

## What it shows

```
[█████████░░░░░░░░░░░] 49% context · 5h 12% │ 7d 7% · add-context-progress-bar
```

| Segment | Source | Description |
|---------|--------|-------------|
| Context bar | `context_window.used_percentage` | 20-char block bar. Green < 60%, yellow 60–76%, red 77%+ (Claude reserves ~15% for compaction). |
| Rate limits | `rate_limits.five_hour`, `rate_limits.seven_day` | 5-hour and 7-day API usage. Dim green/yellow/red at the same thresholds. Labels in dim cyan. |
| Session name | `.mrc/session-names` file | Looked up by `session_id` from the statusline JSON. Omitted if unnamed. |

## How it works

Claude Code invokes the command in `settings.json → statusLine` on each UI refresh, piping a JSON payload to stdin. The script:

1. Reads `context_window.used_percentage` (falls back to computing from `current_usage` tokens if missing).
2. Reads `rate_limits` for 5h/7d bucket percentages.
3. Looks up the session name from `/workspace/.mrc/session-names` using the `session_id`.
4. Writes a single ANSI-colored line to stdout.

## Color thresholds

| Range | Color | Meaning |
|-------|-------|---------|
| 0–59% | Green | Normal usage |
| 60–76% | Yellow | Getting full |
| 77–100% | Red | Compaction imminent (Claude reserves ~15%) |

Rate limits use the same thresholds but rendered dim so they don't compete with the main bar.

## Installation (automatic)

The `entrypoint.sh` writes the `statusLine` config to `~/.claude/settings.json` on container start — but only if the user hasn't already set one. This means:

- **New containers**: get the default statusline automatically.
- **Existing config volumes**: get the default on next boot (if no custom statusline is set).
- **Custom `/statusline`**: always wins — the entrypoint won't overwrite it.

To reset to the default after customizing:

```bash
# Inside the container
claude config set statusLine '{"type":"command","command":"/usr/local/bin/mrc-statusline","padding":0}'
```

Or delete the `statusLine` key from `~/.claude/settings.json` and restart.

## Files changed

| File | Change |
|------|--------|
| `mrc-statusline` | New. The Python script (113 lines). |
| `Dockerfile` | `COPY mrc-statusline /usr/local/bin/` + `chmod +x`. |
| `entrypoint.sh` | Conditional `statusLine` injection into `settings.json`. |
| `CLAUDE.md` | Component count 7→8, new component description, new design decision. |
