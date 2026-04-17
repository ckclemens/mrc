import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function resolveContextDir(scriptDir) {
  if (existsSync(join(scriptDir, 'Dockerfile'))) return scriptDir

  const shareDir = join(process.env.HOME || '/root', '.local', 'share', 'mrc')
  if (existsSync(join(shareDir, 'Dockerfile'))) return shareDir

  if (process.env.MRC_HOME && existsSync(join(process.env.MRC_HOME, 'Dockerfile'))) {
    return process.env.MRC_HOME
  }

  console.error(`
  ✗ Can't find the Docker context (no Dockerfile).

  If you installed mrc from a release, reinstall:
    curl -fsSL https://aisaacs.github.io/mrc/install.sh | bash

  Or set MRC_HOME to the directory containing the Dockerfile.
  `)
  process.exit(1)
}
