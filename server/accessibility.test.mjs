import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createAccessibilityMiddleware, validateRequest } from './accessibility.js'

const valid = { origin: [114.395, 30.52], minutes: 15, mode: 'walk', speedKmh: 5 }
test('input validation rejects invalid coordinates, times and mode speeds', () => {
  assert.equal(validateRequest(valid), null)
  for (const patch of [{ origin: [181, 30] }, { origin: ['114', 30] }, { minutes: 0 }, { minutes: 61 }, { minutes: '15' }, { minutes: NaN }, { mode: 'bus' }, { speedKmh: 0 }, { mode: 'bike', speedKmh: 5 }]) assert.ok(validateRequest({ ...valid, ...patch }))
  assert.ok(validateRequest(null)); assert.ok(validateRequest([]))
})

test('radius mode uses a spatial radius and still requires a travel speed', () => {
  const request = { origin: valid.origin, constraint: 'radius', radiusKm: 5, mode: 'walk', speedKmh: 5 }
  assert.equal(validateRequest(request), null)
  for (const radiusKm of [0, 21, '5', NaN, null, true]) assert.ok(validateRequest({ ...request, radiusKm }))
  assert.ok(validateRequest({ ...request, speedKmh: 0 }))
  assert.ok(validateRequest({ ...request, constraint: 'distance' }))
})

test('API validates requests and reports missing Python as a recoverable error', async t => {
  const middleware = createAccessibilityMiddleware({ executable: 'definitely-no-python-executable' })
  const server = createServer((req, res) => middleware(req, res, () => res.writeHead(404).end()))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { middleware.close(); server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}`, url = base + '/api/accessibility/isochrones'
  const post = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  assert.equal((await fetch(base + '/other')).status, 404)
  assert.equal((await fetch(url)).status, 405)
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 415)
  assert.equal((await post('{')).status, 400)
  assert.equal((await post(JSON.stringify({ ...valid, minutes: 0 }))).status, 400)
  assert.equal((await post('x'.repeat(5000))).status, 413)
  const failed = await post(JSON.stringify(valid))
  assert.equal(failed.status, 503)
  assert.equal((await failed.json()).error.code, 'WORKER_UNAVAILABLE')
})
