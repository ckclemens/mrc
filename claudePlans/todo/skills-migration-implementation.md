# Shared-skills migration — mrc implementation plan

**Status:** Designed, ready to implement. Paused 2026-04-19, resume 2026-04-20.
**Origin:** `handoff-docs/skills-migration-handoff.md` (written by the RP-diet session).
**Session context:** This is the mrc-side session. The RP-side session will generalize `save-context` and push it to the new skills repo once mrc plumbing is live.

---

## The goal (one sentence)

Every time mrc starts, it clones-or-pulls the user's shared skills git repo(s) on the host, bind-mounts them into the container, and symlinks each skill into `~/.claude/skills/<name>` so Claude Code picks them up automatically — no per-repo duplication.

---

## Locked-in decisions

| Decision | Choice | Why |
|---|---|---|
| Host path | `~/.mrc-skills/<url-slug>/` per repo | Unambiguous; no collision with per-repo `/workspace/.mrc/` |
| Mount | `-v ~/.mrc-skills:/opt/mrc-skills:ro` | Whole parent dir; container iterates children |
| Container wiring | Symlinks from mounted clone into the persistent volume's `~/.claude/skills/` | Matches `linkOrMigrate` idiom; allows user-override real dirs to coexist (option B from design discussion) |
| Flags | `--skills-repo` (additive), `--no-skills`, `--no-skills-update` | Additive lets multi-repo from day 1 |
| Default URL | Hardcoded `https://github.com/awchang56/claude-skills` | User is the only user for now; revisit if mrc ever goes public |
| Sync model | Synchronous clone-or-pull before container launch; fail-open | User wants startup to block on sync; offline mode still works with cached clone |
| Scope | Plumbing + multi-repo support; no pinning, no background pull | |
| V1 target skill | Just `save-context` (RP session handles generalization) | Narrow blast radius; validates pipeline |
| Skills repo URL | `https://github.com/awchang56/claude-skills` (already created, public, has `skills/.gitkeep`) | |
| Default-vs-explicit precedence | **Replace**: if user sets any `--skills-repo`, the hardcoded default is dropped | Gives user full control; user who wants both must re-add the default explicitly. Alternative (augment) considered and rejected — leaves no way to opt out of the default without `--no-skills`. |

---

## Skipped for follow-up

- **Rebuild-needed tracker** — when baked-into-image files (Dockerfile, entrypoint.sh, init-firewall.sh, container/*, clipboard-shim.sh) have mtimes newer than `docker inspect --format {{.Created}}`, warn with a list and suggest `mrc --rebuild`. Follow-on after skills lands because the skills migration itself requires a rebuild.
- **Pinning (`--skills-ref <sha-or-tag>`)** — ~2-line add if/when a skill update breaks.
- **Background pull** — only if synchronous pull starts to feel sluggish.
- **Cross-repo skill-name collision warning** — currently first-wins silent. Add warning if it becomes a real problem.
- **Investigate skill split (generic methodology vs RP-specific wrapper)** — RP session hasn't finished iterating on investigate yet; defer.

---

## Bugs found during design review (must fix as part of implementation)

1. **`readMrcrc` whitespace bug** — currently pushes each *line* as a single flag (`src/config.js:10-14`). A line `--skills-repo https://...` becomes one arg `'--skills-repo https://...'` which the switch can't match. **Fix:** split each line on whitespace. Safe for existing `--no-sound`-style entries; incidentally fixes latent `--new <name>` bug.
2. **Avoid `git clone --depth 1`** — if the skills repo ever gets force-pushed (squash/rebase), shallow `pull --ff-only` fails every session. Skills repos are tiny; do a regular clone.

---

## File-by-file implementation plan

### 1. `src/config.js`
- Fix `readMrcrc` to split each line on whitespace:
  ```js
  if (line) flags.push(...line.split(/\s+/))
  ```
- In `parseArgs` initial `config` object, add:
  ```js
  skillsRepos: [],            // additive
  noSkills: false,
  noSkillsUpdate: false,
  ```
- Add to switch:
  ```js
  case '--skills-repo':
    if (argv[i + 1]) config.skillsRepos.push(argv[++i])
    break
  case '--no-skills':        config.noSkills = true; break
  case '--no-skills-update': config.noSkillsUpdate = true; break
  ```

### 2. `src/skills.js` (new)

```js
import { existsSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { dbg } from './output.js'

const SKILLS_HOME = join(homedir(), '.mrc-skills')

// https://github.com/awchang56/claude-skills      → awchang56-claude-skills
// git@github.com:awchang56/claude-skills.git      → awchang56-claude-skills
function urlSlug(url) {
  const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/)
  if (!m) return url.replace(/[^a-z0-9]/gi, '-').toLowerCase()
  return `${m[1]}-${m[2]}`.toLowerCase()
}

// Clone-or-pull each configured skills repo. Returns { path, status, repos, count }.
// Fail-open: any single repo failure warns but doesn't abort.
export function ensureSkills(urls, { noUpdate = false } = {}) {
  if (!urls || urls.length === 0) return { path: null, status: 'disabled', repos: [], count: 0 }

  const syncedRepos = []
  let anyFailure = false

  for (const url of urls) {
    const slug = urlSlug(url)
    const dst = join(SKILLS_HOME, slug)
    try {
      if (!existsSync(dst)) {
        console.log(`  ↓ Cloning skills: ${url}`)
        execFileSync('git', ['clone', '--quiet', url, dst], { stdio: 'pipe', timeout: 30_000 })
      } else if (!noUpdate) {
        dbg(`pulling ${slug}`)
        execFileSync('git', ['-C', dst, 'pull', '--ff-only', '--quiet'], { stdio: 'pipe', timeout: 15_000 })
      }
      syncedRepos.push({ url, slug, path: dst })
    } catch (e) {
      const msg = (e.stderr?.toString() || e.message || 'unknown').split('\n')[0].trim()
      if (existsSync(dst)) {
        console.log(`  ! Skills update failed for ${slug}: ${msg}. Using cached copy.`)
        syncedRepos.push({ url, slug, path: dst })
      } else {
        console.log(`  ! Skills clone failed for ${url}: ${msg}`)
        anyFailure = true
      }
    }
  }

  // Count skills across all repos
  let count = 0
  for (const r of syncedRepos) {
    try {
      const skillsDir = join(r.path, 'skills')
      if (!existsSync(skillsDir)) continue
      count += readdirSync(skillsDir).filter(n => {
        try { return statSync(join(skillsDir, n)).isDirectory() } catch { return false }
      }).length
    } catch {}
  }

  const status = syncedRepos.length === 0 ? 'unavailable'
               : anyFailure ? 'partial'
               : noUpdate ? 'cached'
               : 'synced'

  return { path: SKILLS_HOME, status, repos: syncedRepos, count }
}
```

### 3. `mrc.js`

- Add import: `import { ensureSkills } from './src/skills.js'`
- Hardcode default URL. After global+repo flag merge, **before** `parseArgs`, prepend the default:
  - Actually cleaner approach: default inside `parseArgs` — initialize `skillsRepos: ['https://github.com/awchang56/claude-skills']` as the default, but ONLY if user hasn't added explicit ones. Requires a sentinel or post-parse logic.
  - **Simpler:** put default directly in mrc.js after parseArgs:
    ```js
    if (config.skillsRepos.length === 0) {
      config.skillsRepos.push('https://github.com/awchang56/claude-skills')
    }
    ```
  - This means `--no-skills` still disables entirely, and users can add more repos via `.mrcrc`.
- After `buildImage` / `checkImageAge`, before proxies:
  ```js
  const skills = config.noSkills
    ? { path: null, status: 'disabled', repos: [], count: 0 }
    : ensureSkills(config.skillsRepos, { noUpdate: config.noSkillsUpdate })
  if (skills.path) {
    volumes.push('-v', `${skills.path}:/opt/mrc-skills:ro`)
  }
  ```
- Banner line (after Firewall line):
  ```js
  const skillsLine = skills.status === 'disabled' ? 'disabled'
    : skills.status === 'unavailable' ? 'unavailable'
    : skills.status === 'cached' ? `cached (${skills.count})`
    : skills.status === 'partial' ? `partial (${skills.count})`
    : `synced (${skills.count}) from ${skills.repos.map(r => r.slug).join(', ')}`
  console.log(`  → Skills:    ${skillsLine}`)
  ```
- Update help text:
  ```
    --skills-repo <url>  Add a shared-skills repo to sync (additive; hardcoded default
                         awchang56/claude-skills is dropped if any --skills-repo is set)
    --no-skills          Disable shared-skills sync entirely
    --no-skills-update   Skip git pull this session (use cached clone)
  ```

### 4. `container/container-setup.js`

Add a new section **1c** (between existing 1b video-analysis and section 2 restore-claude.json):

```js
// 1c. Shared skills — symlink each skill from mounted repo clones into ~/.claude/skills/.
// Layout: /opt/mrc-skills/<repo-slug>/skills/<skill-name>/SKILL.md
// Preserves user-override real directories; cleans stale symlinks from removed skills.
const SKILLS_MOUNT = '/opt/mrc-skills'
const SKILLS_DST = join(CLAUDE_DIR, 'skills')

// Stale-symlink cleanup: any symlink in ~/.claude/skills/ pointing into the mount
// whose target doesn't exist (skill removed, or mount gone entirely).
try {
  if (existsSync(SKILLS_DST)) {
    for (const entry of readdirSync(SKILLS_DST)) {
      const path = join(SKILLS_DST, entry)
      try {
        if (!lstatSync(path).isSymbolicLink()) continue
        const target = readlinkSync(path)
        if (target.startsWith(SKILLS_MOUNT + '/') && !existsSync(path)) {
          rmSync(path)
        }
      } catch {}
    }
  }
} catch {}

// Create symlinks for each skill across all mounted repos.
// First-wins on name collisions (alphabetical repo-slug order).
if (existsSync(SKILLS_MOUNT)) {
  mkdirSync(SKILLS_DST, { recursive: true })
  const repoSlugs = readdirSync(SKILLS_MOUNT).filter(n => {
    try { return statSync(join(SKILLS_MOUNT, n)).isDirectory() } catch { return false }
  }).sort()

  for (const slug of repoSlugs) {
    const skillsDir = join(SKILLS_MOUNT, slug, 'skills')
    if (!existsSync(skillsDir)) continue

    for (const name of readdirSync(skillsDir)) {
      const src = join(skillsDir, name)
      const dst = join(SKILLS_DST, name)
      try {
        if (!statSync(src).isDirectory()) continue
      } catch { continue }

      if (!existsSync(dst)) {
        symlinkSync(src, dst)
        continue
      }
      // Already a symlink? Leave it (first-wins).
      try {
        if (lstatSync(dst).isSymbolicLink()) continue
      } catch { continue }
      // Real dir at this name — user override, leave alone.
    }
  }
}
```

Also add `readlinkSync` to the imports at the top:
```js
import { ..., readlinkSync, ... } from 'node:fs'
```

### 5. `CLAUDE.md`

Add a new component to the "Architecture" section (after component 8, the statusline) and a bullet to "Key Design Decisions":

**New component:**
> 9. **Shared skills sync** — Host-side. On each `mrc` invocation, clones/pulls each configured `--skills-repo` into `~/.mrc-skills/<url-slug>/`. The parent directory is bind-mounted read-only into the container at `/opt/mrc-skills/`. `container-setup.js` symlinks each skill subdirectory into `~/.claude/skills/<name>` so Claude Code reads them as user-level skills. Fail-open if offline — cached clone is used.

**New design decision bullet:**
> - **Shared skills via git** — Skills are source-of-truth'd in external git repos rather than duplicated per-project. On every mrc start, configured repos are cloned or fast-forward pulled on the host, bind-mounted read-only, and symlinked into the Claude Code skills directory. Multiple repos can be added via additive `--skills-repo` flags in `~/.mrcrc`. If the user sets any `--skills-repo`, the hardcoded default is dropped (they must re-add it to get both). First-wins on same-named skills across repos. User-installed real directories in `~/.claude/skills/` are preserved.

### 6. `README.md`

Add a short section under Configuration documenting the feature:

> ### Shared skills
>
> mrc auto-syncs skill definitions from one or more git repos and makes them
> available as Claude Code skills in every session. By default, skills come from
> `github.com/awchang56/claude-skills`. Override or add more repos in `~/.mrcrc`:
>
> ```
> # Replace the default
> --skills-repo https://github.com/you/your-skills
>
> # Or add multiple (if you set any, the default is dropped —
> # re-add it if you want both)
> --skills-repo https://github.com/awchang56/claude-skills
> --skills-repo https://github.com/your-org/team-skills
> ```
>
> Clones live at `~/.mrc-skills/<owner>-<repo>/` on the host. Each session does
> a `git pull --ff-only` (fail-open if offline). Add `--no-skills-update` to
> skip the pull, or `--no-skills` to disable entirely.

---

## Expected first-run behavior after implementation

1. User rebuilds: `docker rmi mister-claude && mrc <repo>`
2. mrc clones `awchang56/claude-skills` into `~/.mrc-skills/awchang56-claude-skills/`
3. Banner shows: `Skills: synced (0) from awchang56-claude-skills` (zero because repo only has `.gitkeep` until RP session pushes save-context)
4. Container starts, `container-setup.js` sees empty `skills/` subdir, no-op on symlinks
5. Pipeline is alive but there's nothing to land yet

Once RP session pushes `skills/save-context/SKILL.md`:
- Next mrc start pulls the new commit
- Banner: `Skills: synced (1) from awchang56-claude-skills`
- `~/.claude/skills/save-context` is a symlink to the mounted clone
- Claude Code picks up the skill automatically

---

## Testing checklist

- [ ] Fresh mrc run with no `~/.mrc-skills/` — clones cleanly
- [ ] Subsequent run — fast-forward pulls
- [ ] Simulate offline — banner shows `cached`, clone still usable
- [ ] `--no-skills` flag — no mount, no symlinks, cleanup removes stale links
- [ ] `--no-skills-update` — uses cached clone, skips pull
- [ ] Two `--skills-repo` entries — both get synced, both appear in banner
- [ ] User creates real dir at `~/.claude/skills/foo` inside container — not overwritten by symlink
- [ ] After pushing a skill to the repo, it appears in next mrc session
- [ ] After deleting a skill from the repo, its symlink is cleaned up on next run
- [ ] Rebuild required — confirm `docker rmi mister-claude` → next mrc picks up container-setup.js changes

---

## Coordinate with RP-side session

Per the handoff doc, once mrc side lands, steps must happen **in this order** — skipping ahead risks losing the working copy before the replacement is live:

1. **(mrc session)** Write a ready-to-paste handoff-back at `handoff-docs/skills-migration-mrc-done.md` summarizing:
   - What shipped (flags, mount shape, symlink behavior)
   - Where to push generalized skills (`https://github.com/awchang56/claude-skills`, path `skills/save-context/SKILL.md`)
   - How to verify the sync worked (banner shows `synced (1)`, skill is invokable in a fresh mrc session)
   - What RP session should update in RP's CLAUDE.md (RP-specific session-context conventions: `docs/context/` location, `claudePlans/` dir, `/commit-doc` existence, autodoc pipeline footer)
   - Explicit ordering (steps 3–5 below)
2. **(User)** Paste the handoff-back into the RP-side session.
3. **(RP session)** Generalize `save-context/SKILL.md` (strip RP-specific refs per handoff lines 28-40) and push to `https://github.com/awchang56/claude-skills` at `skills/save-context/SKILL.md`.
4. **(RP session)** Run mrc once in the RP repo to verify: banner shows `Skills: synced (1)`, the skill is reachable, output looks right. Do NOT proceed until this is confirmed.
5. **(RP session)** Only then: delete `/workspace/.claude/skills/save-context/` in the RP repo, and update RP's CLAUDE.md with the RP-specific conventions the generalized skill expects.

---

## Open question to answer before/during implementation

- None locked — go straight to coding from this plan when resumed.

## Questions to flag with user on resume

- Confirm the hardcoded default URL is still correct (`https://github.com/awchang56/claude-skills`)
- Any last-minute scope changes?
