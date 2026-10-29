import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { imageryMiddleware } from './imageryProxy.js'
import { createAccessibilityMiddleware } from './accessibility.js'
import { createWeatherMiddleware } from './weather.js'

const root=resolve('dist')
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/geo+json','.pbf':'application/x-protobuf','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'}
const accessibilityMiddleware=createAccessibilityMiddleware()
const weatherMiddleware=createWeatherMiddleware()
const server=createServer((req,res)=>weatherMiddleware(req,res,()=>accessibilityMiddleware(req,res,()=>imageryMiddleware(req,res,async()=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
    const file=resolve(root,`.${pathname==='/'?'/index.html':pathname}`)
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return}
    const buffer=await readFile(file)
    res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Cache-Control':extname(file)==='.html'?'no-cache':'public, max-age=3600'})
    res.end(buffer)
  }catch{res.writeHead(404).end('Not found')}
}))))
server.once('close',()=>accessibilityMiddleware.close())
process.once('SIGINT',()=>{accessibilityMiddleware.close();server.close()})
process.once('SIGTERM',()=>{accessibilityMiddleware.close();server.close()})
const port=Number(process.env.PORT??4173),host=process.env.HOST??'127.0.0.1'
server.listen(port,host,()=>console.log(`Wuhan GIS: http://${host}:${port}`))
