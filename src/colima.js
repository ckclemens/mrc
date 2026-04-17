import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spinner, dbg } from './output.js'

/**
 * Ensure Docker is available. On macOS, starts Colima if needed.
 * Returns true if we started Colima (so we can stop it on exit).
 */
export async function ensureDocker(verbose) {
  const hasColima = (() => {
    try { execFileSync('which', ['colima'], { stdio: 'ignore' }); return true } catch { return false }
  })()

  if (hasColima) {
    // Set DOCKER_HOST if not already set
    if (!process.env.DOCKER_HOST) {
      process.env.DOCKER_HOST = `unix://${join(process.env.HOME, '.colima/default/docker.sock')}`
    }

    // Check if Colima is running
    try {
      execFileSync('colima', ['status'], { stdio: 'ignore' })
      return false  // already running
    } catch {
      // Need to start Colima
      console.log('🎩 Preparing ship for Ludicrous Speed...')
      const flags = ['--vm-type', 'vz', '--mount-type', 'virtiofs', '--cpu', '4', '--memory', '8']
      await spinner(
        new Promise((resolve, reject) => {
          try {
            execFileSync('colima', ['start', ...flags], {
              stdio: verbose ? 'inherit' : 'ignore',
            })
            resolve()
          } catch (e) { reject(e) }
        })
      )
      console.log('  ✓ Ship ready. All bleeps, sweeps, and creeps accounted for.')
      return true
    }
  }

  // No Colima — check Docker directly
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' })
    return false
  } catch {
    console.error("We've lost the bleeps, the sweeps, AND the creeps.")
    console.error('Error: Docker is not running and Colima is not installed.')
    process.exit(1)
  }
}
