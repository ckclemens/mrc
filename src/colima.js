import { execFileSync } from 'node:child_process'

/**
 * Ensure Docker is available via `docker info`. On macOS we expect
 * OrbStack to be the runtime and to manage the daemon automatically.
 *
 * Filename kept as colima.js to avoid rippling import-path churn through
 * mrc.js and any branches that still reference it; contents are OrbStack-aware.
 *
 * Returns false (we never auto-start or auto-stop a runtime now).
 */
export async function ensureDocker(_verbose) {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' })
    return false
  } catch {
    console.error("We've lost the bleeps, the sweeps, AND the creeps.")
    console.error('Error: Docker is not running. Open OrbStack from your Applications folder and try again.')
    process.exit(1)
  }
}
