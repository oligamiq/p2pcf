const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,DELETE,OPTIONS',
  'Access-Control-Max-Age': '86400'
}

const IPV4_REGEX = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/

const IPV6_REGEX = /(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))/

const RATE_LIMITING_SAMPLING_RATE = 100.0

// CREATE TABLE rooms_entries (
//   room_id TEXT NOT NULL,
//   entry_index INTEGER NOT NULL,
//   entry_data TEXT NOT NULL,
//   expire_at INTEGER NOT NULL,
//   PRIMARY KEY (room_id, entry_index)
// );

// CREATE TABLE join_counts (
//   year_month TEXT NOT NULL,
//   origin TEXT NOT NULL,
//   count INTEGER NOT NULL,
//   PRIMARY KEY (year_month, origin)
// );

// CREATE TABLE rooms (
//   room_id TEXT NOT NULL PRIMARY KEY,
//   max_index INTEGER NOT NULL,
//   expire_at INTEGER NOT NULL
// );

// CREATE TABLE room_live (
//   room_id TEXT NOT NULL PRIMARY KEY,
//   expire_at INTEGER
// );

function validatePayload (headers, payload) {
  if (
    !payload.r ||
    payload.r.length < 4 ||
    payload.r.length > 64 ||
    !payload.r.match(/^[A-Za-z0-9_-]+$/)
  ) {
    return new Response('Bad room id' + payload.r, { status: 400, headers })
  }

  if (payload.d) {
    if (
      !payload.x ||
      typeof payload.x !== 'number' ||
      payload.x > 24 * 60 * 60 * 1000
    ) {
      return new Response('Bad expiration', { status: 400, headers })
    }

    // Validate timestamp - note date is of last I/O in worker
    if (
      !payload.t ||
      typeof payload.t !== 'number' ||
      Math.abs(payload.t - new Date().getTime()) > 10 * 60 * 1000
    ) {
      return new Response('Bad timestamp', { status: 400, headers })
    }

    if (!payload.k || payload.k.length > 64) {
      return new Response('Bad context id', { status: 400, headers })
    }

    // Registering an entry
    const d = payload.d

    if (d.length !== 6) {
      return new Response('Bad data length', { status: 400, headers })
    }

    // Validate session id + client id + context id
    if (!d[0] || d[0].length > 64) {
      return new Response('Bad session id', { status: 400, headers })
    }

    if (!d[1] || d[1].length > 64) {
      return new Response('Bad client id', { status: 400, headers })
    }

    if (typeof d[2] !== 'boolean') {
      return new Response('Bad is symmetric', { status: 400, headers })
    }

    if (!d[3] || d[3].length !== 44) {
      return new Response('Bad dtls', { status: 400, headers })
    }

    if (!d[4] || typeof d[4] !== 'number') {
      return new Response('Bad joined at timestamp', { status: 400, headers })
    }

    if (
      !d[5] ||
      typeof d[5] !== 'object' ||
      d[5].find(ip => !ip.match(IPV4_REGEX) && !ip.match(IPV6_REGEX))
    ) {
      return new Response('Bad reflexive IPs', { status: 400, headers })
    }

    try {
      atob(d[3])
    } catch (e) {
      return new Response('Bad base64 encoding', { status: 400, headers })
    }
  }
}

function check_d1_result (result) {
  if (result.success) {
    return result
  }

  console.error(`Failed to fetch d1: ${result}`)
}

function getRandomString (length) {
  let result = ''
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const charactersLength = characters.length
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength))
  }

  return result
}

function b64toBlob (b64Data, contentType = '', sliceSize = 512) {
  const byteCharacters = atob(b64Data)
  const byteArrays = []

  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize)

    const byteNumbers = new Array(slice.length)
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i)
    }

    const byteArray = new Uint8Array(byteNumbers)
    byteArrays.push(byteArray)
  }

  const blob = new Blob(byteArrays, { type: contentType })
  return blob
}

function getEntryDeleteKey (entry) {
  return entry[entry.length - 1]
}

function getEntryContextId (entry) {
  return entry[entry.length - 2]
}

function getEntryPackages (entry) {
  return entry[entry.length - 3]
}

function getEntryTimestamp (entry) {
  return entry[entry.length - 4]
}

function getEntrySessionId (entry) {
  return entry[0]
}

function getEntryPayloadLength (entry) {
  return entry.length - 3
}

async function handleGet (request, env) {
  const hasStore = !!getStore(env)

  return new Response(
    `<html><body style="font-size: 24px; padding: 18px; font-family: Arial, sans-serif"">Hello from P2PCF<br/><div style=\"line-height: 28px; margin-top: 8px; font-size: 0.8em\">${
      hasStore
        ? '&#128077; R2 bucket is configured properly, ready to serve.'
        : '&#10060; Couldn\'t find a configured R2 bucket.<br/>Make sure you <a href="https://github.com/gfodor/p2pcf/blob/master/INSTALL.md#set-up-the-r2-bucket" target="_blank">created a bucket</a> and <a href="https://github.com/gfodor/p2pcf/blob/master/INSTALL.md#bind-the-worker-to-r2" target="_blank">connected the worker to it</a>.'
    }</div></body></html>`,
    {
      headers: {
        'Content-Type': 'text/html'
      }
    }
  )
}

async function handleOptions (request, env) {
  const headers = request.headers

  if (
    headers.get('Origin') !== null &&
    headers.get('Access-Control-Request-Method') !== null &&
    headers.get('Access-Control-Request-Headers') !== null
  ) {
    const respHeaders = {
      ...corsHeaders,
      'Access-Control-Allow-Headers': request.headers.get(
        'Access-Control-Request-Headers'
      )
    }

    return new Response(null, {
      headers: respHeaders
    })
  } else {
    // Handle standard OPTIONS request.
    // If you want to allow other HTTP Methods, you can do that here.
    return new Response(null, {
      headers: {
        Allow: 'GET, POST, DELETE, OPTIONS'
      }
    })
  }
}

async function lookupEntries (roomId, store) {
  const maxIndex = await store.prepare(
    `SELECT max_index FROM rooms WHERE room_id = ?`
  ).bind(roomId).first() ?? -1;

  const entries_data = ((await store.prepare(
    `SELECT entry_index, entry_data FROM rooms_entries WHERE room_id = ?`
  ).bind(roomId).all().then(check_d1_result))?.results ?? []).map(r => {
    return { index: r.entry_index, data: JSON.parse(r.entry_data) }
  })

  const max_id = Math.max(...entries_data.map(r => r.index), -1)

  const entries = new Array(max_id + 1).fill(null)
  for (const entry of entries_data) {
    entries[entry.index] = entry.data
  }

  return [entries, maxIndex]
}

function getStore (env) {
  let store = null

  for (const obj of Object.values(env)) {
    if (obj.prepare && obj.batch && obj.exec) {
      store = obj
      break
    }
  }

  return store
}

async function handleDelete (request, env, context) {
  const headers = { ...corsHeaders, Vary: 'Origin' }
  const payload = await request.json()

  if (!payload.dk) {
    return new Response('Missing delete key', { status: 400, headers })
  }

  const errorResponse = validatePayload(headers, payload)
  if (errorResponse) return errorResponse

  const roomId = payload.r
  const store = getStore(env)

  const [entries, maxIndex] = await lookupEntries(roomId, store)

  for (let i = 0; i < entries.length; i++) {
    if (entries[i] === null) continue

    const entry = entries[i]
    const entrySessionId = getEntrySessionId(entry)
    const entryContextId = getEntryContextId(entry)
    const entryDeleteKey = getEntryDeleteKey(entry)

    if (
      payload.k === entryContextId &&
      payload.d[0] === entrySessionId &&
      payload.dk === entryDeleteKey
    ) {
      context.waitUntil(
        store.prepare(
          `DELETE FROM rooms_entries WHERE room_id = ? AND entry_index = ?`
        ).bind(roomId, i).run().then(check_d1_result)
      )

      if (maxIndex === i) {
        const now = new Date().getTime()

        context.waitUntil(
          store.prepare(
            `UPDATE rooms SET max_index = ?, expire_at = ? WHERE room_id = ?`
          ).bind(i - 1, now + 8 * 60 * 60 * 1000, roomId).run().then(check_d1_result)
        )
      }

      return new Response('{}', { status: 200, headers })
    }
  }

  return new Response('No delete key', { status: 404, headers })
}

async function handlePost (request, env, context) {
  const headers = { ...corsHeaders, Vary: 'Origin' }

  const payload = await request.json()
  const errorResponse = validatePayload(headers, payload)

  if (errorResponse) return errorResponse
  const store = getStore(env)

  const roomId = payload.r
  const now = new Date().getTime()

  // Check if the room exists
  const nextVacuumPromise = store.prepare(
    `SELECT expire_at FROM room_live WHERE room_id = ?`
  ).bind(roomId).first()

  const [entries, maxIndex] = await lookupEntries(roomId, store)

  const contextId = payload.k
  let deleteKeyForEntry = null

  if (payload.d && payload.p) {
    // This is the timestamp on the session side of this data set if this changes, we write to the store
    const timestamp = payload.t
    const packages = payload.p
    deleteKeyForEntry = getRandomString(24)

    let shouldSave = true

    // Need to save the entry if it doesn't exist already.
    for (let i = 0; i < entries.length; i++) {
      if (entries[i] === null) continue

      const entry = entries[i]
      const entryContextId = getEntryContextId(entry)
      const entryTimestamp = getEntryTimestamp(entry)
      const entryDeleteKey = getEntryDeleteKey(entry)

      if (contextId === entryContextId) {
        deleteKeyForEntry = entryDeleteKey

        if (entryTimestamp === timestamp) {
          shouldSave = false
        }

        break
      }
    }

    if (shouldSave) {
      let saved = false

      // Entry is the payload plus additional data that isn't directly returned to the session.
      const newEntry = [
        ...payload.d,
        timestamp,
        packages,
        contextId,
        deleteKeyForEntry
      ]

      // Cap expiration to 15 minutes
      const expireIn = Math.min(15 * 60 * 1000, payload.x)
      const expireAt = now + expireIn

      // First search for an exisitng one
      for (let i = 0; i < entries.length; i++) {
        if (entries[i] === null) continue

        const entry = entries[i]

        const entryContextId = getEntryContextId(entry)
        if (entryContextId !== contextId) continue

        if (saved) {
          // Duplicate, weird

          console.warn("Duplicate entry for context id " + contextId + " at index " + i + " in room " + roomId)

          context.waitUntil(
            store.prepare(
              `DELETE FROM rooms_entries WHERE room_id = ? AND entry_index = ?`
            ).bind(roomId, i).run().then(check_d1_result)
          )
          entries[i] = null
        } else {
          context.waitUntil(
            store.prepare(
              `UPDATE rooms_entries SET entry_data = ?, expire_at = ? WHERE room_id = ? AND entry_index = ?`
            ).bind(JSON.stringify(newEntry), expireAt, roomId, i).run().then(check_d1_result)
          )
          entries[i] = newEntry
          saved = true
        }
      }

      // Could not find an existing slot to replace, so look for an empty slot or add to the end.
      if (!saved) {
        // Look for a null slot
        for (let i = 0; i < entries.length; i++) {
          if (entries[i] !== null) continue
          context.waitUntil(
            store.prepare(
              `UPDATE rooms_entries SET entry_data = ?, expire_at = ? WHERE room_id = ? AND entry_index = ?`
            ).bind(JSON.stringify(newEntry), expireAt, roomId, i).run().then(check_d1_result)
          )
          entries[i] = newEntry
          saved = true
          break
        }

        // Otherwise push a new entry
        if (!saved) {
          entries.push(newEntry)
          context.waitUntil(
            store.prepare(
              `INSERT INTO rooms_entries (room_id, entry_index, entry_data, expire_at) VALUES (?, ?, ?, ?)`
            ).bind(roomId, entries.length - 1, JSON.stringify(newEntry), expireAt).run().then(check_d1_result)
          )
        }
      }
    }

    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i] === null) continue

      // max index always increases, rely on expiration to lower watermark
      if (maxIndex < i) {
        context.waitUntil(
          store.prepare(
            `UPDATE rooms SET max_index = ?, expire_at = ? WHERE room_id = ?`
          ).bind(i, now + 8 * 60 * 60 * 1000, roomId).run().then(check_d1_result)
        )
        break
      }
    }
  }

  // Build the peer payload, list and the packages.
  const map = new Map()
  const packages = []

  for (let i = 0; i < entries.length; i++) {
    if (entries[i] === null) continue

    const entry = entries[i]
    const entryContextId = getEntryContextId(entry)
    if (contextId === entryContextId) continue

    const timestamp = getEntryTimestamp(entry)

    // Get the earliest entry for a given context id.
    if (!map.has(entryContextId)) {
      map.set(entryContextId, entry.slice(0, getEntryPayloadLength(entry)))
    } else {
      const existing = map.get(entryContextId)

      if (existing[existing.length - 1] < timestamp) {
        map.set(entryContextId, entry.slice(0, getEntryPayloadLength(entry)))
      }
    }

    // Add to the packages due to this session.
    if (payload.d) {
      const sessionId = payload.d[0]
      const entryPackages = getEntryPackages(entry)

      for (let j = 0; j < entryPackages.length; j++) {
        // Package was meant for this session
        if (entryPackages[j][0] === sessionId) {
          packages.push(entryPackages[j])
        }
      }
    }
  }

  const peers = [...map.values()]
  const responseData = { ps: peers, pk: packages }

  if (deleteKeyForEntry) {
    responseData.dk = deleteKeyForEntry
  }

  // Check for vacuum
  const nextVacuumPromiseValue = await nextVacuumPromise

  if (
    !nextVacuumPromiseValue ||
    now > nextVacuumPromiseValue
  ) {
    // Add a random delay and re-check to avoid stampede.
    context.waitUntil(
      new Promise(res => {
        setTimeout(async () => {
          const now = new Date().getTime()
          const nextVacuum = await store.prepare(
            `SELECT expire_at FROM room_live WHERE room_id = ?`
          ).bind(roomId).first()

          if (
            !nextVacuum ||
            now > nextVacuum
          ) {
            // Vacuum
            await store.prepare(
              `INSERT INTO room_live (room_id, expire_at) VALUES (?, ?)`
            ).bind(roomId, now + 30 * 1000).run().then(check_d1_result)

            const removed = (await store.prepare(
              `DELETE FROM rooms_entries WHERE room_id = ? AND expire_at < ? RETURNING entry_index`
            ).bind(roomId, now).all().then(check_d1_result)).results.length

            console.log(
              'Vacuumed room ' +
                roomId +
                '. Removed ' +
                (removed + 1) +
                ' keys.'
            )
          }

          res()
        }, Math.floor(Math.random() * 10 * 1000))
      })
    )
  }

  return new Response(JSON.stringify(responseData), { status: 200, headers })
}

async function getResponseIfDisallowed (request, env) {
  // No CORS header, so can't do anything
  const origin = request.headers.get('origin')
  if (!origin) return null

  let originQuota = env.ORIGIN_QUOTA ? parseInt(env.ORIGIN_QUOTA) : 10000

  if (env.ALLOWED_ORIGINS) {
    if (!env.ORIGIN_QUOTA) {
      originQuota = 0
    }

    if (env.ALLOWED_ORIGINS.split(',').includes(origin)) {
      return null
    }
  }

  if (originQuota === 0) {
    return new Response('Unauthorized', { status: 401 })
  }

  const store = getStore(env)

  const d = new Date()
  const currentCount = await store.prepare(
    `SELECT count FROM join_counts WHERE year_month = ? AND origin = ?`
  ).bind(`${d.getYear()}-${d.getMonth()}`, origin).first() ?? 0

  if (currentCount >= originQuota) {
    return new Response('Over quota', { status: 429 })
  }

  // Do 1 out of RATE_LIMITING_SAMPLING_RATE sampling
  if (Math.random() < 1.0 / RATE_LIMITING_SAMPLING_RATE) {
    if (currentCount === 0) {
      await store.prepare(
        `INSERT INTO join_counts (year_month, origin, count) VALUES (?, ?, ?)`
      ).bind(`${d.getYear()}-${d.getMonth()}`, origin, Math.floor(RATE_LIMITING_SAMPLING_RATE)).run().then(check_d1_result)
    } else {
      await store.prepare(
        `UPDATE join_counts SET count = ? WHERE year_month = ? AND origin = ?`
      ).bind(currentCount + Math.floor(RATE_LIMITING_SAMPLING_RATE), `${d.getYear()}-${d.getMonth()}`, origin).run().then(check_d1_result)
    }
  }
}

export default {
  async fetch (request, env, context) {
    const disallowedResponse = await getResponseIfDisallowed(request, env)

    if (disallowedResponse) {
      return disallowedResponse
    }

    if (request.method === 'GET') {
      return handleGet(request, env, context)
    }

    if (request.method === 'OPTIONS') {
      return handleOptions(request, env, context)
    }

    if (request.headers.get('content-type') !== 'application/json')
      return new Response('Expected content-type application/json', {
        status: 400
      })

    if (
      request.headers.get('x-worker-method') === 'DELETE' ||
      request.method === 'DELETE'
    ) {
      return await handleDelete(request, env, context)
    }

    if (request.method === 'POST') {
      return await handlePost(request, env, context)
    }

    return new Response('Method not allowed', { status: 405 })
  }
}
