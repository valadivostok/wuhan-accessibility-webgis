import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const service='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'
const isJpeg=buffer=>buffer.length>256&&buffer[0]===255&&buffer[1]===216&&buffer.at(-2)===255&&buffer.at(-1)===217

export function createImageryMiddleware({cacheDirectory=resolve('tmp/satellite-tiles'),fetchTile=fetch,concurrency=8,timeoutMs=8000}={}){
  const pending=new Map(),queue=[]
  let active=0
  const abortError=()=>new DOMException('No longer in view','AbortError')
  function pump(){
    while(active<concurrency&&queue.length){
      const entry=queue.pop()
      entry.signal.removeEventListener('abort',entry.cancel)
      if(entry.signal.aborted){entry.reject(abortError());continue}
      active++
      Promise.resolve().then(entry.run).then(entry.resolve,entry.reject).finally(()=>{active--;pump()})
    }
  }
  function limited(run,signal){
    return new Promise((resolve,reject)=>{
      if(signal.aborted){reject(abortError());return}
      const entry={run,signal,resolve,reject,cancel:()=>{
        const index=queue.indexOf(entry)
        if(index>=0){queue.splice(index,1);reject(abortError())}
      }}
      signal.addEventListener('abort',entry.cancel,{once:true})
      queue.push(entry)
      pump()
    })
  }
  function acquire(z,x,y){
    const key=`${z}/${x}/${y}`
    let job=pending.get(key)
    if(!job||job.controller.signal.aborted){
      job={controller:new AbortController(),consumers:0}
      const {signal}=job.controller
      job.promise=(async()=>{
        const folder=join(cacheDirectory,String(z),String(x)),file=join(folder,`${y}.jpg`)
        try{
          const cached=await readFile(file)
          signal.throwIfAborted()
          if(isJpeg(cached))return cached
        }catch(error){if(signal.aborted)throw error}
        return limited(async()=>{
          let failure
          for(let attempt=0;attempt<2;attempt++){
            signal.throwIfAborted()
            try{
              const response=await fetchTile(`${service}/${z}/${y}/${x}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)])})
              if(!response.ok)throw Error(`Upstream HTTP ${response.status}`)
              const buffer=Buffer.from(await response.arrayBuffer())
              signal.throwIfAborted()
              if(!isJpeg(buffer))throw Error('Upstream did not return a complete JPEG tile')
              await mkdir(folder,{recursive:true})
              await writeFile(file,buffer)
              return buffer
            }catch(error){if(signal.aborted)throw error;failure=error}
          }
          throw failure
        },signal)
      })().finally(()=>{if(pending.get(key)===job)pending.delete(key)})
      pending.set(key,job)
    }
    job.consumers++
    return {promise:job.promise,release(){if(--job.consumers===0)job.controller.abort(abortError())}}
  }
  function middleware(req,res,next){
    const path=new URL(req.url,'http://localhost').pathname
    if(!path.startsWith('/api/imagery/'))return next()
    const match=/^\/api\/imagery\/(\d{1,2})\/(\d+)\/(\d+)\.jpg$/.exec(path)
    if(!match||!['GET','HEAD'].includes(req.method)){res.writeHead(400).end('Invalid imagery tile request');return}
    const [z,x,y]=match.slice(1).map(Number)
    if(z<9||z>19||x<0||y<0||x>=2**z||y>=2**z){res.writeHead(400).end();return}
    const tile=acquire(z,x,y)
    let released=false
    const release=()=>{if(!released){released=true;tile.release()}}
    res.once('close',release)
    tile.promise.then(buffer=>{
      if(res.destroyed)return
      res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':buffer.length,'Cache-Control':'public, max-age=604800','X-Content-Type-Options':'nosniff'})
      res.end(req.method==='HEAD'?undefined:buffer)
    }).catch(error=>{
      if(!res.destroyed&&error.name!=='AbortError')res.writeHead(502,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({error:'Satellite imagery is temporarily unavailable'}))
    }).finally(release)
  }
  middleware.status=()=>({active,queued:queue.length,pending:pending.size})
  return middleware
}

export const imageryMiddleware=createImageryMiddleware()

export function imageryProxyPlugin(){
  return {name:'satellite-imagery-proxy',configureServer(server){server.middlewares.use(imageryMiddleware)},configurePreviewServer(server){server.middlewares.use(imageryMiddleware)}}
}
