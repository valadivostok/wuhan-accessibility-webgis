import GeoJSON from 'ol/format/GeoJSON'
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style'

export const localLayerDefinitions = [
  { key: 'boundary', label: '武汉市界', visible: true },
  { key: 'roads', label: '道路路网', visible: true, minZoom: 11 },
  { key: 'water', label: '水域', visible: true },
  { key: 'landuse', label: '土地利用', visible: false },
  { key: 'buildings', label: '建筑轮廓', visible: true, minZoom: 14 },
]

export const emptyFacilities = [
  { name: '轨道车站', short: '轨道', icon: 'train', color: '#00c9f5' },
  { name: '公交站', short: '公交', icon: 'bus', color: '#27c1ff' },
  { name: '商业设施', short: '商业', icon: 'building', color: '#ffbd55' },
  { name: '学校', short: '学校', icon: 'school', color: '#309aff' },
  { name: '医疗设施', short: '医疗', icon: 'hospital', color: '#ff5770' },
  { name: '公园绿地', short: '公园', icon: 'tree', color: '#2bdaaa' },
  { name: '餐饮美食', short: '餐饮', icon: 'food', color: '#efaa48' },
  { name: '住宿酒店', short: '酒店', icon: 'building', color: '#8584ff' },
].map(item => ({ ...item, count: 0, unit: '处' }))

export const localStyles = {
  boundary: new Style({ stroke: new Stroke({ color: '#91fce0', width: 3 }) }),
  roads: new Style({ stroke: new Stroke({ color: '#86c2c58a', width: 1.2 }) }),
  water: new Style({ fill: new Fill({ color: '#277c9a55' }), stroke: new Stroke({ color: '#55bddb88', width: 1 }) }),
  landuse: new Style({ fill: new Fill({ color: '#6dbe8c35' }), stroke: new Stroke({ color: '#8dc49b66', width: 0.6 }) }),
  buildings: new Style({ fill: new Fill({ color: '#9ad2c255' }), stroke: new Stroke({ color: '#c4efda99', width: 0.7 }) }),
}

const poiStyles = new Map(emptyFacilities.map(item => [item.name, new Style({
  image: new CircleStyle({ radius: 5, fill: new Fill({ color: item.color }), stroke: new Stroke({ color: '#e3fff5', width: 1 }) }),
})]))
export const poiStyle = feature => poiStyles.get(feature.get('category'))

export async function loadDemoData(signal) {
  const read = async file => {
    const response = await fetch(`${import.meta.env.BASE_URL}data/demo/${file}`, { signal, cache: file === 'manifest.json' ? 'no-cache' : 'default' })
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`)
    return response.json()
  }
  const manifest = await read('manifest.json')
  const format = new GeoJSON()
  // Large display layers are pre-tiled and streamed by the WebGL renderer.
  // Only POIs are needed on the main thread for exact dashboard statistics.
  const entries = await Promise.all(['pois'].map(async key => {
    const json = await read(`${key}.geojson`)
    if (json.type !== 'FeatureCollection' || json.features?.length !== manifest.counts[key]) {
      throw new Error(`${key}: 数据与清单不一致`)
    }
    return [key, format.readFeatures(json, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' })]
  }))
  return { manifest, features: Object.fromEntries(entries) }
}
