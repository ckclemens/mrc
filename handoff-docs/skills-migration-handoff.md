# Skills migration handoff — mrc session

Written by a Claude session running in the RP diet repo (`/workspace`). The user wants to move his "shared skills" out of per-repo duplication and into a single skills repo that mrc auto-mounts into every session. This doc briefs the mrc-side session.

## Goal

Make a shared-skills workflow that is **as automatic as possible**:

- One git repo holds the source-of-truth for all skills.
- mrc clones it on first run and pulls on session start (or similar) — no per-repo copy, no manual sync.
- Skills land at a path Claude Code already reads (`~/.claude/skills/` inside the session).
- Skills are generic — any RP-specific context is supplied by the project's own `CLAUDE.md`, not baked in.

## Current state (RP repo, `/workspace/.claude/skills/`)

Four skills exist. Three are tagged `# ⚠️ SHARED SKILL — duplicated across repos (diet and mono)` in their frontmatter — that duplication is exactly what this migration kills.

### Migration classification

| Skill | Migrate? | Why |
|---|---|---|
| `save-context` | **Yes — primary** | Core workflow (session handoff doc). Only lightly RP-flavored. |
| `investigate` | **Maybe — split** | Methodology is generic and valuable everywhere; tool deps are RP-specific (Bugsnag scripts, RP_CS_Docs MCP, `claudePlans/investigations/`). Consider: generic methodology skill in shared repo, RP-specific tool invocations as a thin wrapper/extension that stays in-repo. |
| `commit-doc` | **No — RP-local** | Entire purpose is feeding the RP autodoc pipeline (writes to `docs/context/`, specific frontmatter schema, pipeline opens GitHub issues at >75 docs, etc.). The "generate a commit message" core *is* generic but the rest is coupled. Not worth splitting for v1. |
| `backfill-context` | **No — RP-local** | Same as commit-doc — exists to populate `docs/context/` for the autodoc pipeline. |

### RP-specific references in `save-context` (to strip when generalizing)

Source: `/workspace/.claude/skills/save-context/SKILL.md`

- Line 2-4: `SHARED SKILL` header comment about duplication across "diet and mono" repos — delete entirely
- Line 6, 13, 43, 51, 69, 143, 152, 170, 177: `docs/context/` as hardcoded path — make this a sensible default but allow the project's CLAUDE.md to override (e.g., a convention line like "session context lives at `./notes/sessions/`")
- Line 51: example feature-area filenames `pantry-v2.md`, `food-db-asset-pack.md`, `app-freeze-investigation.md` — replace with generic examples
- Line 57: `OPThreadPool::doWork()` investigation example — replace with a generic crash/investigation example
- Line 69: `claudePlans/` reference — remove (RP-only directory)
- Line 88, 91: frontmatter examples `feature_area: pantry-v2`, `affects_screens: [Pantry, MealAlt]` — generalize
- Line 143: `/commit-doc` handoff hint — remove or make conditional on the skill being present
- Line 181: autodoc pipeline footer (`docs/**` paths-ignore note) — remove entirely; RP-specific

The skill's *structure* (steps 1–6, frontmatter schema, pickup-prompt generation) is all generic and should survive intact.

### Full file to read

Before editing, the mrc session should read:
- `/workspace/.claude/skills/save-context/SKILL.md` (the file to generalize)
- `/workspace/.claude/skills/investigate/SKILL.md` (optional: if tackling the split)

Both files are readable from this host since `/workspace` is mounted. If mrc runs in an isolated container that doesn't mount `/workspace`, the RP-side session can paste the file contents when asked.

## Proposed architecture (for mrc to implement)

### Skills repo
- New public or private git repo (user to decide). Name TBD — e.g., `aisaacs/claude-skills`.
- Layout: one directory per skill, each with `SKILL.md`. Mirrors what Claude Code already expects at `~/.claude/skills/`.
  ```
  claude-skills/
  ├── README.md
  └── skills/
      ├── save-context/
      │   └── SKILL.md
      └── ...
  ```

### mrc integration (the "automatic" part)
Open questions for the mrc session to answer by reading its own source:

1. **Where does mrc currently put `~/.claude/skills/`?** Is it a volume mount from the host, a baked-in dir in the image, or empty by default?
2. **What's the right hook point for auto-clone/pull?** Container build? Container start? First `mrc` invocation? Each `mrc` invocation?
3. **How is the skills repo URL configured?** `.mrcrc` in user home? An mrc CLI flag? Hardcoded default with override?
4. **Pull frequency tradeoff.** Pull on every session start = always fresh, ~1s startup delay and a network hop. Pull daily or on-demand = faster but can go stale. User wants "automatic" — probably every session start is right, with a flag to skip.

Rough shape regardless of answers:
```
on mrc session start:
  if ~/.mrc/skills/ doesn't exist: git clone <skills-repo> ~/.mrc/skills/
  else: cd ~/.mrc/skills/ && git pull --ff-only (fail open if offline)
  mount ~/.mrc/skills/skills/ → ~/.claude/skills/ inside the container
```

### After mrc side is ready
The RP-side session (me) will:
1. Delete `/workspace/.claude/skills/save-context/` (now provided via mrc).
2. Add a short note to `/workspace/CLAUDE.md` describing RP-specific session-context conventions (`docs/context/` location, `claudePlans/` planning dir, `/commit-doc` skill exists, autodoc pipeline) so the generic save-context skill picks them up as project context.
3. Optionally repeat for `investigate` if we go with the split.
4. Leave `commit-doc` and `backfill-context` alone — RP-local.

## Questions the mrc session should bring back

- Concrete answer on where to put the skills repo clone and how to mount it.
- Whether the skills repo should be public or private, and URL.
- Confirmation of the pull frequency / flag name.
- Any reason to package this as an mrc "feature flag" (opt-in) vs. always-on default.

Once those are answered, ping the RP-side session (me) to do the cleanup and CLAUDE.md update in lockstep with the first generalized skill landing in the new repo.

## Non-goals for v1

- Don't generalize `commit-doc` / `backfill-context` yet.
- Don't build a "marketplace" or publishing UX — this is just a git repo mrc clones.
- Don't version skills (no semver). If the user wants a skill pinned to a commit, that's a follow-up.
