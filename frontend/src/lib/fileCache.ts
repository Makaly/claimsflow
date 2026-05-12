/**
 * fileCache.ts
 * Stores raw file bytes in IndexedDB so blob URLs can be recreated after a
 * page reload. IndexedDB handles large binaries (PDFs, images) with no size
 * limit, unlike localStorage which tops out at ~5 MB.
 */

const DB_NAME = 'cic-file-cache'
const STORE   = 'files'
const DB_VER  = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest | void,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const t     = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    const req   = fn(store)
    t.oncomplete = () => resolve(req ? (req as IDBRequest).result : undefined)
    t.onerror    = () => reject(t.error)
  })
}

/** Save one File into IndexedDB under `${sessionId}/${file.name}` */
export async function cacheFile(sessionId: string, file: File): Promise<void> {
  const db  = await openDB()
  const buf = await file.arrayBuffer()
  await tx(db, 'readwrite', store =>
    store.put({ buf, type: file.type, name: file.name, size: file.size }, `${sessionId}/${file.name}`)
  )
  db.close()
}

/** Save multiple files (runs in parallel) */
export async function cacheFiles(sessionId: string, files: File[]): Promise<void> {
  await Promise.all(files.map(f => cacheFile(sessionId, f)))
}

interface CachedFile {
  name: string
  type: string
  size: number
  url: string   // fresh blob URL — valid for this page lifetime
}

/** Retrieve all files for a session as fresh blob URLs */
export async function restoreFiles(sessionId: string): Promise<Map<string, CachedFile>> {
  const db      = await openDB()
  const result  = new Map<string, CachedFile>()

  await new Promise<void>((resolve, reject) => {
    const t       = db.transaction(STORE, 'readonly')
    const store   = t.objectStore(STORE)
    const range   = IDBKeyRange.bound(`${sessionId}/`, `${sessionId}/\uffff`)
    const cursor  = store.openCursor(range)

    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) { resolve(); return }
      const { buf, type, name, size } = c.value as { buf: ArrayBuffer; type: string; name: string; size: number }
      const blob = new Blob([buf], { type })
      const url  = URL.createObjectURL(blob)
      result.set(name, { name, type, size, url })
      c.continue()
    }
    cursor.onerror = () => reject(cursor.error)
  })

  db.close()
  return result
}

/** Retrieve all files for a session as real File objects (usable for re-extraction) */
export async function restoreAsFiles(sessionId: string): Promise<File[]> {
  const db    = await openDB()
  const files: File[] = []

  await new Promise<void>((resolve, reject) => {
    const t      = db.transaction(STORE, 'readonly')
    const store  = t.objectStore(STORE)
    const range  = IDBKeyRange.bound(`${sessionId}/`, `${sessionId}/\uffff`)
    const cursor = store.openCursor(range)

    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) { resolve(); return }
      const { buf, type, name } = c.value as { buf: ArrayBuffer; type: string; name: string }
      files.push(new File([buf], name, { type }))
      c.continue()
    }
    cursor.onerror = () => reject(cursor.error)
  })

  db.close()
  return files
}

/**
 * Scan ALL cached entries for the first file matching `filename`.
 * Used as a fallback when the claim id changed (e.g. frontend id → DB UUID)
 * so the normal session-scoped lookup returns nothing.
 */
export async function restoreFileByName(filename: string): Promise<File | null> {
  const db = await openDB()
  let found: File | null = null

  await new Promise<void>((resolve, reject) => {
    const t      = db.transaction(STORE, 'readonly')
    const store  = t.objectStore(STORE)
    const cursor = store.openCursor()

    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) { resolve(); return }
      const key = String(c.key)
      // key format: "${sessionId}/${filename}"
      if (key.endsWith(`/${filename}`)) {
        const { buf, type, name } = c.value as { buf: ArrayBuffer; type: string; name: string }
        found = new File([buf], name, { type })
        resolve()   // stop scanning as soon as we find it
        return
      }
      c.continue()
    }
    cursor.onerror = () => reject(cursor.error)
  })

  db.close()
  return found
}

/** Delete all cached files for a session (call on reset / publish complete) */
export async function clearCachedFiles(sessionId: string): Promise<void> {
  const db    = await openDB()
  const keys: IDBValidKey[] = []

  await new Promise<void>((resolve, reject) => {
    const t       = db.transaction(STORE, 'readonly')
    const store   = t.objectStore(STORE)
    const range   = IDBKeyRange.bound(`${sessionId}/`, `${sessionId}/\uffff`)
    const cursor  = store.openCursor(range)
    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) { resolve(); return }
      keys.push(c.key)
      c.continue()
    }
    cursor.onerror = () => reject(cursor.error)
  })

  if (keys.length > 0) {
    await new Promise<void>((resolve, reject) => {
      const t     = db.transaction(STORE, 'readwrite')
      const store = t.objectStore(STORE)
      keys.forEach(k => store.delete(k))
      t.oncomplete = () => resolve()
      t.onerror    = () => reject(t.error)
    })
  }

  db.close()
}
