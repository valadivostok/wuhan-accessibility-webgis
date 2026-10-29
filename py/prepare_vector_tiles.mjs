import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import GeoJSONVT from 'geojson-vt'
import vtpbf from 'vt-pbf'

const root = resolve(process.argv[2] ?? 'public/data/demo')
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
const indexes = {}
for (const key of ['boundary', 'water', 'landuse', 'roads', 'buildings']) {
  const data = JSON.parse(await readFile(join(root, `${key}.geojson`), 'utf8'))
  for (const feature of data.features) {
    const { osm_id, fclass } = feature.properties
    // Only rendering attributes enter the tiles. The complete provenance stays
    // in the source GeoJSON and manifest.
    const hash = String(osm_id).split('').reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0)
    feature.properties = key === 'buildings' ? { height: 12 + hash % 45 } : { fclass }
  }
  indexes[key] = new GeoJSONVT(data, { maxZoom: 14, indexMaxZoom: 8, tolerance: 2, buffer: 64 })
  console.log(`Indexed ${key}: ${data.features.length}`)
}
const xTile = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z)
const yTile = (lat, z) => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z)
const [west, south, east, north] = manifest.extent
let bytes = 0, count = 0
for (let z = 9; z <= 14; z++) {
  for (let x = xTile(west, z); x <= xTile(east, z); x++) {
    const folder = join(root, 'tiles', String(z), String(x))
    await mkdir(folder, { recursive: true })
    for (let y = yTile(north, z); y <= yTile(south, z); y++) {
      const layers = {}
      for (const [key, index] of Object.entries(indexes)) {
        if (key === 'buildings' && z < 14) continue
        const tile = index.getTile(z, x, y)
        if (tile?.features.length) layers[key] = tile
      }
      const buffer = vtpbf.fromGeojsonVt(layers, { version: 2 })
      await writeFile(join(folder, `${y}.pbf`), buffer)
      bytes += buffer.length
      count++
    }
  }
}
await writeFile(join(root, 'tiles.json'), JSON.stringify({ tilejson: '3.0.0', tiles: ['tiles/{z}/{x}/{y}.pbf'], minzoom: 9, maxzoom: 14, bounds: manifest.extent }))
console.log(`Generated ${count} tiles, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
