/**
 * JSON file-backed key/value store, replacing electron-store for the web build.
 *
 * Atomic writes: write to ${file}.tmp + rename — ensures the data file is
 * never half-written even if the process crashes mid-write.
 *
 * Optional encryption: when KIRO_STORE_KEY env var is set, the JSON payload is
 * AES-256-GCM encrypted (12-byte iv + 16-byte tag + ciphertext, base64-encoded
 * single line). Empty/unset key disables encryption (data stored as plain JSON).
 *
 * The interface mirrors electron-store enough to keep the migration mechanical:
 *   store.get(key, defaultValue?) / store.set(key, value) / store.has(key) /
 *   store.delete(key) / store.clear()
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getDataDir } from './dataDir'

interface StoreData {
  [key: string]: unknown
}

const ENC_PREFIX = 'enc1:'

function deriveKey(): Buffer | null {
  const raw = process.env.KIRO_STORE_KEY
  if (!raw || raw.trim() === '') return null
  // Hash whatever the user provided down to a stable 32-byte key.
  return crypto.createHash('sha256').update(raw).digest()
}

function serialize(data: StoreData): string {
  const json = JSON.stringify(data)
  const key = deriveKey()
  if (!key) return json
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ENC_PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')
}

function deserialize(raw: string): StoreData {
  if (!raw || raw.trim() === '') return {}
  if (raw.startsWith(ENC_PREFIX)) {
    const key = deriveKey()
    if (!key) throw new Error('Store is encrypted but KIRO_STORE_KEY is not set')
    const buf = Buffer.from(raw.slice(ENC_PREFIX.length), 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const ct = buf.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const pt = Buffer.concat([decipher.update(ct), decipher.final()])
    return JSON.parse(pt.toString('utf8'))
  }
  return JSON.parse(raw)
}

export class Store {
  private file: string
  private data: StoreData

  constructor(name = 'kiro-accounts') {
    this.file = path.join(getDataDir(), `${name}.json`)
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      this.data = deserialize(raw)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.data = {}
      } else {
        throw err
      }
    }
  }

  get<T = unknown>(key: string, defaultValue?: T): T {
    if (key in this.data) return this.data[key] as T
    return defaultValue as T
  }

  set(key: string, value: unknown): void {
    this.data[key] = value
    this.flush()
  }

  has(key: string): boolean {
    return key in this.data
  }

  delete(key: string): void {
    if (key in this.data) {
      delete this.data[key]
      this.flush()
    }
  }

  clear(): void {
    this.data = {}
    this.flush()
  }

  /** Bulk replace entire store payload (used by import-from-file). */
  replaceAll(snapshot: StoreData): void {
    this.data = { ...snapshot }
    this.flush()
  }

  /** Snapshot current store contents (used by export). */
  snapshot(): StoreData {
    return JSON.parse(JSON.stringify(this.data))
  }

  /** Path of the underlying file (mostly for diagnostics). */
  get path(): string {
    return this.file
  }

  private flush(): void {
    const payload = serialize(this.data)
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, payload, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(tmp, this.file)
  }
}

let singleton: Store | null = null

/** Process-wide default store (lazy). */
export function getStore(): Store {
  if (!singleton) singleton = new Store()
  return singleton
}

/** Test hook. */
export function _resetStoreForTest(): void {
  singleton = null
}
