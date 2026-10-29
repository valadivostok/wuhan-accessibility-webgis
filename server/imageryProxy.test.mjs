import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createImageryMiddleware } from './imageryProxy.js'

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check){for(let i=0;i<100;i++){if(check())return;await pause(10)}throw Error('Condition did not complete')}
async function fixture(options){
  const cacheDirectory=await mkdtemp(join(tmpdir(),'wuhan-imagery-test-'))
  const middleware=createImageryMiddleware({cacheDirectory,concurrency:1,...options})
  const server=createServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  return {middleware,cacheDirectory,url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))}
}
const jpeg=()=>{const buffer=new Uint8Array(512);buffer.set([255,216]);buffer.set([255,217],510);return new Response(buffer,{headers:{'Content-Type':'image/jpeg'}})}
function controlledFetch(){
  const calls=[]
  return {calls,fetchTile:(url,{signal})=>new Promise((resolve,reject)=>{
    const call={url,signal,finish:()=>resolve(jpeg())}
    calls.push(call)
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true})
  })}
}

test('leaving the view removes queued work and aborts obsolete upstream work',async()=>{
  const upstream=controlledFetch(),app=await fixture(upstream)
  try{
    const first=new AbortController(),queued=new AbortController()
    const a=fetch(`${app.url}/api/imagery/16/101/100.jpg`,{signal:first.signal}).catch(error=>error.name)
    await until(()=>upstream.calls.length===1)
    const b=fetch(`${app.url}/api/imagery/16/102/100.jpg`,{signal:queued.signal}).catch(error=>error.name)
    await until(()=>app.middleware.status().queued===1)
    queued.abort()
    await until(()=>app.middleware.status().queued===0)
    const current=fetch(`${app.url}/api/imagery/16/103/100.jpg`)
    await until(()=>app.middleware.status().queued===1)
    first.abort()
    await until(()=>upstream.calls.length===2)
    assert(upstream.calls[0].signal.aborted)
    assert(upstream.calls[1].url.endsWith('/16/100/103'))
    assert(!upstream.calls.some(call=>call.url.endsWith('/16/100/102')))
    assert.equal(app.middleware.status().active,1)
    upstream.calls[1].finish()
    assert.equal((await current).status,200)
    await Promise.all([a,b])
    await until(()=>app.middleware.status().pending===0)
  }finally{await app.close()}
})

test('shared requests survive one consumer leaving and then read from cache',async()=>{
  const upstream=controlledFetch(),app=await fixture(upstream)
  try{
    const abort=new AbortController()
    const a=fetch(`${app.url}/api/imagery/16/201/200.jpg`,{signal:abort.signal}).catch(error=>error.name)
    await until(()=>upstream.calls.length===1)
    const b=fetch(`${app.url}/api/imagery/16/201/200.jpg`)
    await pause(40)
    abort.abort();await pause(40)
    assert(!upstream.calls[0].signal.aborted)
    assert.equal(upstream.calls.length,1)
    upstream.calls[0].finish()
    const response=await b
    assert.equal(response.status,200)
    assert.equal(response.headers.get('content-type'),'image/jpeg')
    await response.arrayBuffer();await a
    const cached=await fetch(`${app.url}/api/imagery/16/201/200.jpg`)
    assert.equal(cached.status,200)
    assert.equal(upstream.calls.length,1)
    assert.equal((await fetch(`${app.url}/api/imagery/99/0/0.jpg`)).status,400)
  }finally{await app.close()}
})

test('HTML or error responses never become satellite tiles',async()=>{
  let calls=0
  const app=await fixture({fetchTile:async()=>{calls++;return new Response('<html>Unavailable</html>')}})
  try{
    const response=await fetch(`${app.url}/api/imagery/16/301/300.jpg`)
    assert.equal(response.status,502)
    assert.equal(response.headers.get('cache-control'),'no-store')
    assert.equal(calls,2)
  }finally{await app.close()}
})

test('a truncated disk cache entry is downloaded again',async()=>{
  let calls=0
  const app=await fixture({fetchTile:async()=>{calls++;return jpeg()}})
  try{
    const folder=join(app.cacheDirectory,'16','401')
    await mkdir(folder,{recursive:true})
    await writeFile(join(folder,'400.jpg'),new Uint8Array([255,216,255]))
    const response=await fetch(`${app.url}/api/imagery/16/401/400.jpg`)
    assert.equal(response.status,200)
    assert.equal((await response.arrayBuffer()).byteLength,512)
    assert.equal(calls,1)
  }finally{await app.close()}
})
