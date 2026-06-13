/**
 * Resolve the application data directory.
 *
 * Web service replaces Electron's app.getPath('userData'). Honor:
 *   1. process.env.KIRO_DATA_DIR — explicit override (e.g. inside Docker volume)
 *   2. ~/.kiro-web              — sensible default for Linux/Mac/Windows
 *
 * The directory is created on first access (idempotent).
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

let cached: string | null = null

export function getDataDir(): string {
  if (cached) return cached
  const dir = process.env.KIRO_DATA_DIR && process.env.KIRO_DATA_DIR.trim()
    ? process.env.KIRO_DATA_DIR.trim()
    : path.join(os.homedir(), '.kiro-web')
  fs.mkdirSync(dir, { recursive: true })
  cached = dir
  return dir
}

/** Reset for tests. */
export function _resetDataDirForTest(): void {
  cached = null
}
