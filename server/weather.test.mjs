import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createWeatherMiddleware, createWeatherService, normalizeWeather, shanghaiDate } from './weather.js'

const key = 'test-server-secret'
const timestamp = Date.parse('2026-10-29T04:00:00Z')
const live = { status: '1', lives: [{ adcode: '420100', temperature: '17', weather: '雾', humidity: '80', reporttime: '2026-10-29 12:00:00' }] }
const forecast = { status: '1', forecasts: [{ adcode: '420100', reporttime: '2026-10-29 11:00:00', casts: [
  { date: '2026-10-28', daytemp: '99', nighttemp: '88' },
  { date: '2026-10-29', daytemp: '20', nighttemp: '12', dayweather: '小雨', nightweather: '多云' },
] }] }
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })

test('normalization selects today in Shanghai and preserves zero/negative temperatures', () => {
  assert.equal(shanghaiDate(Date.parse('2026-10-29T16:01:00Z')), '2026-10-30')
  const result = normalizeWeather(live, forecast, timestamp)
  assert.equal(result.live.temperature, 17)
  assert.deepEqual([result.today.low, result.today.high], [12, 20])
  const zero = normalizeWeather({ status: '1', lives: [{ adcode: '420100', temperature_float: '0.0', temperature: '5' }] },
    { forecasts: [{ adcode: '420100', casts: [{ date: '2026-10-29', daytemp: '0', nighttemp: '-5' }] }] }, timestamp)
  assert.equal(zero.live.temperature, 0)
  assert.deepEqual([zero.today.low, zero.today.high], [-5, 0])
  assert.equal(normalizeWeather(live, forecast, Date.parse('2026-10-29T16:01:00Z')).today, null)
  assert.equal(normalizeWeather({ lives: [{ adcode: '420100', temperature: '' }] }, null, timestamp).live, null)
})

test('service combines live and forecast, coalesces requests and caches for ten minutes', async () => {
  let clock = timestamp, calls = 0
  const service = createWeatherService({ key, now: () => clock, fetchWeather: async url => {
    calls++
    assert.equal(url.origin, 'https://restapi.amap.com')
    assert.equal(url.searchParams.get('city'), '420100')
    assert.equal(url.searchParams.get('key'), key)
    return response(url.searchParams.get('extensions') === 'base' ? live : forecast)
  } })
  const results = await Promise.all([service.getWeather(), service.getWeather()])
  assert.equal(calls, 2)
  assert.equal(results[0].live.temperature, 17)
  assert.equal(results[0].today.low, 12)
  assert.equal(JSON.stringify(results).includes(key), false)
  assert.equal((await service.getWeather()).cached, true)
  clock += 10 * 60 * 1000 + 1
  await service.getWeather()
  assert.equal(calls, 4)
})

test('partial forecast failure still returns real current temperature', async () => {
  const service = createWeatherService({ key, now: () => timestamp, fetchWeather: async url =>
    response(url.searchParams.get('extensions') === 'base' ? live : { status: '0', infocode: '10003' }) })
  const result = await service.getWeather()
  assert.equal(result.live.temperature, 17)
  assert.equal(result.today, null)
  assert.equal(result.warnings[0].section, 'today')
})

test('transient forecast network errors are retried without losing the daily range', async () => {
  let forecastCalls = 0
  const service = createWeatherService({ key, now: () => timestamp, fetchWeather: async url => {
    if (url.searchParams.get('extensions') === 'base') return response(live)
    if (++forecastCalls === 1) throw new Error('Transient connection failure')
    return response(forecast)
  } })
  const result = await service.getWeather()
  assert.equal(forecastCalls, 2)
  assert.deepEqual([result.today.low, result.today.high], [12, 20])
  assert.deepEqual(result.warnings, [])
})

test('bad key is reported safely and failures use a one-minute backoff', async () => {
  let calls = 0
  const service = createWeatherService({ key, now: () => timestamp, fetchWeather: async () => {
    calls++; return response({ status: '0', infocode: '10009', info: key })
  } })
  await assert.rejects(service.getWeather(), error => error.code === 'AMAP_10009' && error.message.includes('Web 服务') && !error.message.includes(key))
  await assert.rejects(service.getWeather(), { code: 'AMAP_10009' })
  assert.equal(calls, 2)
})

test('stale cache is labeled, and yesterday is never displayed as today', async () => {
  let clock = Date.parse('2026-10-29T15:59:00Z'), offline = false
  const service = createWeatherService({ key, now: () => clock, fetchWeather: async url => {
    if (offline) throw new Error(key)
    return response(url.searchParams.get('extensions') === 'base' ? live : forecast)
  } })
  await service.getWeather()
  clock += 2 * 60 * 1000; offline = true
  const result = await service.getWeather()
  assert.equal(result.stale, true)
  assert.equal(result.today, null)
  assert.equal(result.live.temperature, 17)
  assert.equal(JSON.stringify(result).includes(key), false)
  clock += 61 * 60 * 1000
  await assert.rejects(service.getWeather(), { code: 'WEATHER_NETWORK' })
})

test('HTTP endpoint exposes only weather fields and handles method/configuration errors', async t => {
  const weather = createWeatherMiddleware({ key, now: () => timestamp, fetchWeather: async url => response(url.searchParams.get('extensions') === 'base' ? live : forecast) })
  const missing = createWeatherMiddleware({ key: '' })
  const server = createServer((req, res) => (req.headers['x-test-missing'] ? missing : weather)(req, res, () => res.writeHead(404).end()))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const url = `http://127.0.0.1:${server.address().port}/api/weather/wuhan`
  const valid = await fetch(url)
  assert.equal(valid.status, 200)
  assert.equal((await valid.text()).includes(key), false)
  assert.equal((await fetch(url, { method: 'POST' })).status, 405)
  const unavailable = await fetch(url, { headers: { 'x-test-missing': '1' } })
  assert.equal(unavailable.status, 503)
  assert.equal((await unavailable.json()).error.code, 'WEATHER_KEY_MISSING')
})
