import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'

const localEnv = fileURLToPath(new URL('../.env.local', import.meta.url))
const upstream = 'https://restapi.amap.com/v3/weather/weatherInfo'
const adcode = '420100'
const tenMinutes = 10 * 60 * 1000

export function readWeatherKey() {
  if (process.env.AMAP_WEATHER_KEY?.trim()) return process.env.AMAP_WEATHER_KEY.trim()
  try { return parseEnv(readFileSync(localEnv, 'utf8')).AMAP_WEATHER_KEY?.trim() || '' }
  catch { return '' }
}

export const shanghaiDate = timestamp => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(timestamp))

const number = value => typeof value === 'string' && !value.trim() || value == null || typeof value === 'boolean'
  ? null : Number.isFinite(Number(value)) ? Number(value) : null
const text = value => typeof value === 'string' ? value.slice(0, 100) : ''

class WeatherError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

function providerError(code) {
  const messages = {
    '10001': '高德天气 Key 无效，请检查服务端配置',
    '10003': '高德天气调用额度已用尽',
    '10004': '高德天气调用过于频繁，请稍后重试',
    '10005': '高德 Key 的 IP 白名单未放行当前服务',
    '10006': '高德 Key 的域名限制未放行当前服务',
    '10009': '高德 Key 类型不匹配，请使用 Web 服务类型 Key',
  }
  const safeCode = /^\d{5}$/.test(String(code)) ? String(code) : 'UNKNOWN'
  return new WeatherError(`AMAP_${safeCode}`, messages[safeCode] || '高德天气服务暂不可用，请稍后重试')
}

export function normalizeWeather(liveData, forecastData, timestamp) {
  const liveRecord = liveData?.lives?.find(item => String(item.adcode) === adcode)
  const temperature = number(liveRecord?.temperature_float) ?? number(liveRecord?.temperature)
  const live = liveRecord && temperature !== null ? {
    temperature, condition: text(liveRecord.weather), humidity: number(liveRecord.humidity),
    windDirection: text(liveRecord.winddirection), windPower: text(liveRecord.windpower), reportedAt: text(liveRecord.reporttime),
  } : null
  const forecast = forecastData?.forecasts?.find(item => String(item.adcode) === adcode)
  const date = shanghaiDate(timestamp)
  const cast = forecast?.casts?.find(item => item.date === date)
  const day = number(cast?.daytemp_float) ?? number(cast?.daytemp)
  const night = number(cast?.nighttemp_float) ?? number(cast?.nighttemp)
  const today = cast && day !== null && night !== null ? {
    date, low: Math.min(day, night), high: Math.max(day, night), dayTemperature: day, nightTemperature: night,
    dayCondition: text(cast.dayweather), nightCondition: text(cast.nightweather), reportedAt: text(forecast.reporttime),
  } : null
  return { city: '武汉市', adcode, provider: '高德天气', fetchedAt: new Date(timestamp).toISOString(), live, today }
}

export function createWeatherService({ key = readWeatherKey(), fetchWeather = fetch, now = Date.now, ttlMs = tenMinutes, timeoutMs = 10000 } = {}) {
  let cache, pending, lastError, retryAt = 0
  async function request(extension) {
    const url = new URL(upstream)
    url.search = new URLSearchParams({ key, city: adcode, extensions: extension, output: 'JSON' })
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetchWeather(url, { signal: AbortSignal.timeout(timeoutMs) })
        if (!response.ok) throw new WeatherError('WEATHER_UPSTREAM', '高德天气接口暂时无法连接')
        const data = await response.json()
        if (data.status !== '1') throw providerError(data.infocode)
        return data
      } catch (error) {
        if (error instanceof WeatherError) throw error
        if (attempt === 1) throw new WeatherError('WEATHER_NETWORK', '天气数据加载失败，请稍后重试')
      }
    }
  }
  const staleResult = error => {
    const timestamp = now()
    if (!cache || timestamp - cache.timestamp > 60 * 60 * 1000) throw error
    return { ...cache.value, today: cache.value.today?.date === shanghaiDate(timestamp) ? cache.value.today : null,
      stale: true, cached: true, warnings: [{ section: 'update', code: error.code, message: '更新失败，当前显示上次获取的天气数据' }] }
  }
  async function getWeather() {
    if (!key) throw new WeatherError('WEATHER_KEY_MISSING', '尚未配置高德天气 Key')
    const timestamp = now(), date = shanghaiDate(timestamp)
    if (cache && timestamp - cache.timestamp < (cache.value.warnings.length ? 30000 : ttlMs) && cache.date === date) return { ...cache.value, cached: true }
    if (timestamp < retryAt) return staleResult(lastError)
    if (pending) return pending
    pending = (async () => {
      const responses = await Promise.allSettled([request('base'), request('all')])
      const value = normalizeWeather(responses[0].status === 'fulfilled' ? responses[0].value : null,
        responses[1].status === 'fulfilled' ? responses[1].value : null, now())
      const warnings = []
      for (const [index, section] of ['live', 'today'].entries()) {
        if (!value[section]) {
          const error = responses[index].status === 'rejected' ? responses[index].reason
            : new WeatherError('WEATHER_NO_DATA', section === 'live' ? '实况温度暂不可用' : '今日预报暂不可用')
          warnings.push({ section, code: error.code, message: error.message })
        }
      }
      if (!value.live && !value.today) throw new WeatherError(warnings[0].code, warnings[0].message)
      const result = { ...value, warnings, stale: false, cached: false }
      cache = { timestamp: now(), date: shanghaiDate(now()), value: result }
      lastError = undefined; retryAt = 0
      return result
    })().catch(error => {
      lastError = error; retryAt = now() + 60 * 1000
      return staleResult(error)
    }).finally(() => { pending = undefined })
    return pending
  }
  return { getWeather }
}

export function createWeatherMiddleware(options) {
  const service = createWeatherService(options)
  return (req, res, next) => {
    if (new URL(req.url, 'http://localhost').pathname !== '/api/weather/wuhan') return next()
    const respond = (status, body) => {
      if (res.destroyed || res.writableEnded) return
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); respond(405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请使用 GET 请求' } }); return }
    service.getWeather().then(value => respond(200, value)).catch(error => respond(503, { error: {
      code: error.code || 'WEATHER_UNAVAILABLE', message: error instanceof WeatherError ? error.message : '天气服务暂不可用',
    } }))
  }
}

export function weatherPlugin() {
  const configure = server => { server.middlewares.use(createWeatherMiddleware()) }
  return { name: 'amap-wuhan-weather', configureServer: configure, configurePreviewServer: configure }
}
