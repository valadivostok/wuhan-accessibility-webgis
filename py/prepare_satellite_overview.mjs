import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const output=resolve('public/data/satellite-overview'),cache=resolve('tmp/satellite-tiles')
const source='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
const bounds=[113.5,29.8,115.25,31.55],minzoom=9,maxzoom=11
const xTile=(lon,z)=>Math.floor((lon+180)/360*2**z)
const yTile=(lat,z)=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z)
const tasks=[]
for(let z=minzoom;z<=maxzoom;z++)for(let x=xTile(bounds[0],z);x<=xTile(bounds[2],z);x++)for(let y=yTile(bounds[3],z);y<=yTile(bounds[1],z);y++)tasks.push({z,x,y})
let cursor=0,done=0,bytes=0
await Promise.all(Array.from({length:6},async()=>{
  while(cursor<tasks.length){
    const {z,x,y}=tasks[cursor++],folder=join(output,String(z),String(x)),file=join(folder,`${y}.jpg`)
    let buffer
    for(const candidate of [file,join(cache,String(z),String(x),`${y}.jpg`)]){
      try{const data=await readFile(candidate);if(data[0]===255&&data[1]===216){buffer=data;break}}catch{}
    }
    if(!buffer)for(let attempt=0;attempt<3;attempt++){
      try{
        const response=await fetch(`${source}/tile/${z}/${y}/${x}`,{signal:AbortSignal.timeout(10000)})
        if(!response.ok)throw Error(`HTTP ${response.status}`)
        buffer=Buffer.from(await response.arrayBuffer())
        if(buffer[0]!==255||buffer[1]!==216)throw Error('Expected JPEG')
        break
      }catch(error){if(attempt===2)throw error}
    }
    await mkdir(folder,{recursive:true});await writeFile(file,buffer)
    bytes+=buffer.length;done++
    if(done%25===0||done===tasks.length)console.log(`${done}/${tasks.length} satellite overview tiles`)
  }
}))
await writeFile(join(output,'metadata.json'),JSON.stringify({bounds,minzoom,maxzoom,source,tiles:tasks.length,bytes,cachedAt:new Date().toISOString(),attribution:'Imagery © Esri, Vantor, Earthstar Geographics'},null,2))
