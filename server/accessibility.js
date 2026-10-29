import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const endpoint = '/api/accessibility/isochrones'
export const pythonExecutable = () => process.env.GIS_PYTHON || [
  resolve(root, '.venv/Scripts/python.exe'), resolve(root, '.venv/bin/python'),
].find(existsSync) || 'python'

export function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '请求必须是 JSON 对象'
  const { origin, minutes, mode, speedKmh, constraint = 'time', radiusKm } = value
  if (!Array.isArray(origin) || origin.length !== 2 || !origin.every(Number.isFinite) || Math.abs(origin[0]) > 180 || Math.abs(origin[1]) > 90) return '起点必须是 WGS84 经度、纬度'
  if (!['time', 'radius'].includes(constraint)) return '请选择时间约束或半径范围内时间分区'
  if (constraint === 'time' && (!Number.isFinite(minutes) || minutes < 1 || minutes > 60)) return '时间须为 1–60 分钟'
  if (constraint === 'radius' && (!Number.isFinite(radiusKm) || radiusKm < .1 || radiusKm > 20)) return '分析半径须为 0.1–20 km'
  const range = { walk: [3, 7], bike: [8, 25], car: [15, 60] }[mode]
  if (!range) return '请选择步行、骑行或驾车'
  if (!Number.isFinite(speedKmh) || speedKmh < range[0] || speedKmh > range[1]) return `当前方式速度须为 ${range[0]}–${range[1]} km/h`
  return null
}

export function createAccessibilityMiddleware({ executable = pythonExecutable(), timeoutMs = 120000 } = {}) {
  let child, sequence = 0
  const pending = new Map()
  const respond = (res, status, payload) => {
    if (res.destroyed || res.writableEnded) return
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  function failAll(message) {
    for (const { res, timer } of pending.values()) {
      clearTimeout(timer)
      respond(res, 503, { error: { code: 'WORKER_UNAVAILABLE', message } })
    }
    pending.clear()
  }
  function start() {
    if (child) return child
    const process = spawn(executable, ['-u', resolve(root, 'py/accessibility.py')], {
      cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    })
    child = process
    createInterface({ input: process.stdout }).on('line', line => {
      try {
        const reply = JSON.parse(line), item = pending.get(reply.id)
        if (!item) return
        clearTimeout(item.timer)
        pending.delete(reply.id)
        const status = !reply.error ? 200 : ['NETWORK_MISSING', 'COMPUTE_ERROR'].includes(reply.error.code) ? 503 : 422
        respond(item.res, status, reply.error ? { error: reply.error } : reply.result)
      } catch (error) { console.error('可达性服务响应格式错误', error.message) }
    })
    process.stderr.on('data', data => console.error(`[accessibility] ${data.toString().trim()}`))
    process.stdin.on('error', () => { if (child === process) failAll('计算进程连接中断，请重试') })
    process.on('error', error => {
      console.error('可达性服务无法启动', error.message)
      if (child === process) { child = undefined; failAll('无法启动 Python，请安装依赖并设置 GIS_PYTHON，详见 README') }
    })
    process.on('exit', () => {
      if (child === process) { child = undefined; failAll('计算进程已停止，请检查 Python 依赖后重试') }
    })
    return process
  }
  const middleware = (req, res, next) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    if (pathname !== endpoint) return next()
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return respond(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请使用 POST 请求' } })
    }
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return respond(res, 415, { error: { code: 'INVALID_INPUT', message: '请使用 application/json' } })
    let body = '', tooLarge = false
    req.setEncoding('utf8')
    req.on('data', chunk => {
      if (tooLarge) return
      body += chunk
      if (body.length > 4096) { tooLarge = true; body = ''; respond(res, 413, { error: { code: 'TOO_LARGE', message: '请求体过大' } }) }
    })
    req.on('end', () => {
      if (tooLarge) return
      let request
      try { request = JSON.parse(body) } catch { return respond(res, 400, { error: { code: 'INVALID_JSON', message: 'JSON 格式错误' } }) }
      const invalid = validateRequest(request)
      if (invalid) return respond(res, 400, { error: { code: 'INVALID_INPUT', message: invalid } })
      // Keep requests bounded; one cached graph serves requests sequentially.
      if (pending.size >= 3) return respond(res, 429, { error: { code: 'BUSY', message: '计算服务繁忙，请稍后重试' } })
      const id = ++sequence, worker = start()
      const timer = setTimeout(() => {
        const item = pending.get(id)
        if (!item) return
        respond(res, 504, { error: { code: 'TIMEOUT', message: '计算超时，请缩小时间范围后重试' } })
        pending.delete(id)
        // A timed-out computation must not keep blocking later requests.
        if (child === worker) child = undefined
        worker.kill()
        failAll('计算进程已重置，请重试')
      }, timeoutMs)
      pending.set(id, { res, timer })
      res.on('close', () => {
        const item = pending.get(id)
        if (item) {
          clearTimeout(item.timer); pending.delete(id)
          if (!pending.size && child === worker) { child = undefined; worker.kill() }
        }
      })
      worker.stdin.write(JSON.stringify({ id, request }) + '\n')
    })
  }
  middleware.close = () => { failAll('计算服务已关闭'); child?.kill(); child = undefined }
  return middleware
}

export function accessibilityPlugin() {
  let middleware
  const configure = server => {
    middleware = createAccessibilityMiddleware()
    server.middlewares.use(middleware)
    server.httpServer?.once('close', () => middleware.close())
  }
  return { name: 'local-network-accessibility', configureServer: configure, configurePreviewServer: configure, closeBundle() { middleware?.close() } }
}
