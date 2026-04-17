import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'

/**
 * Recursively find .sandboxignore files and return Docker volume flags
 * to hide the listed paths from the container.
 */
export function processSandboxignores(repoPath) {
  const volumes = []
  const ignoreFiles = findSandboxignores(repoPath)

  for (const ignoreFile of ignoreFiles) {
    const ignoreDir = dirname(ignoreFile)
    const relDir = relative(repoPath, ignoreDir)

    const content = readFileSync(ignoreFile, 'utf8')
    for (let line of content.split('\n')) {
      line = line.replace(/#.*$/, '').trim().replace(/\/+$/, '')
      if (!line) continue

      // Reject absolute paths and traversal
      if (line.startsWith('/') || line.includes('..')) {
        console.error(`  → Ignored:   ${line} (absolute or traversal paths not allowed)`)
        continue
      }

      const relPath = relDir ? join(relDir, line) : line
      const hostPath = join(repoPath, relPath)
      const containerPath = `/workspace/${relPath}`

      try {
        const stat = statSync(hostPath)
        if (stat.isFile()) {
          volumes.push('-v', `/dev/null:${containerPath}:ro`)
          console.log(`  → Cloaked:   ${relPath} (file)`)
        } else if (stat.isDirectory()) {
          volumes.push('-v', containerPath)
          console.log(`  → Cloaked:   ${relPath} (dir)`)
        }
      } catch {
        console.log(`  → Not found: ${relPath} (we ain't found shit)`)
      }
    }
  }
  return volumes
}

function findSandboxignores(dir, results = []) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.mrc' || entry.name === 'node_modules') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) findSandboxignores(full, results)
      else if (entry.name === '.sandboxignore') results.push(full)
    }
  } catch {}
  return results.sort()
}
