import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

export const collection = features => ({ type: 'FeatureCollection', features })
const empty = () => collection([])
const vectorLayers = [
  { id: 'water', type: 'fill', paint: { 'fill-color': '#277c9a', 'fill-opacity': .25 } },
  { id: 'landuse', type: 'fill', paint: { 'fill-color': '#6dbe8c', 'fill-opacity': .2 } },
  { id: 'roads', type: 'line', minzoom: 11, paint: { 'line-color': '#86c2c5', 'line-opacity': .5, 'line-width': 1.2 } },
  { id: 'boundary', type: 'line', paint: { 'line-color': '#91fce0', 'line-width': 2 } },
  { id: 'buildings-flat', 'source-layer': 'buildings', type: 'fill', minzoom: 14, paint: { 'fill-color': '#9ad2c2', 'fill-opacity': .4 } },
  { id: 'buildings', type: 'fill-extrusion', minzoom: 14, paint: { 'fill-extrusion-color': '#83cabe', 'fill-extrusion-height': ['*', ['get', 'height'], 1.5], 'fill-extrusion-opacity': .92 } },
]

export async function createCityMap(container, callbacks, signal) {
  const { Map: MapLibreMap, Marker, setWorkerUrl, setWorkerCount } = await import('maplibre-gl')
  if (signal.aborted) return null
  setWorkerUrl(workerUrl)
  setWorkerCount(2)
  const map = new MapLibreMap({
    container, center: [114.395, 30.52], zoom: 15.6, bearing: -8.6, pitch: 45,
    minZoom: 9, maxZoom: 19, maxPitch: 70, attributionControl: false, aroundCenter: false,
    // Keep fill rate bounded on high-DPI screens and tile memory bounded while
    // navigating. Geometry decoding and tessellation run in MapLibre workers.
    pixelRatio: Math.min(devicePixelRatio, 2), maxTileCacheSize: 96,
    refreshExpiredTiles: false, renderWorldCopies: false,
    style: {
      version: 8, light: { anchor: 'viewport', color: '#e4fff5', intensity: .45, position: [1.5, 210, 45] },
      sources: {
        'imagery-overview': { type: 'raster', tiles: [new URL(`${import.meta.env.BASE_URL}data/satellite-overview/`,location.href).href+'{z}/{x}/{y}.jpg'], tileSize: 256, minzoom: 9, maxzoom: 11, bounds: [113.5,29.8,115.25,31.55] },
        imagery: { type: 'raster', tiles: [import.meta.env.VITE_IMAGERY_TILE_URL??new URL('/api/imagery/',location.href).href+'{z}/{x}/{y}.jpg'], tileSize: 256, minzoom: 9, maxzoom: 19, attribution: 'Imagery © Esri, Vantor, Earthstar Geographics' },
        street: { type: 'raster', tiles: [import.meta.env.VITE_OSM_TILE_URL??'https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
        local: { type: 'vector', tiles: [new URL(`${import.meta.env.BASE_URL}data/demo/tiles/`, location.href).href + '{z}/{x}/{y}.pbf'], minzoom: 9, maxzoom: 14, bounds: [113.696653,29.972873,115.076933,31.362241] },
        pois: { type: 'geojson', data: empty(), maxzoom: 14, tolerance: 1 },
        analysis: { type: 'geojson', data: empty() },
        'reachable-roads': { type: 'geojson', data: empty() },
        'study-area': { type: 'geojson', data: empty() },
        'radius-boundary': { type: 'geojson', data: empty() },
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#183338' } },
        // This self-hosted OSM base stays beneath online tiles. It has no
        // external dependency and remains sharp when raster requests fail.
        { id: 'base-landuse', type: 'fill', source: 'local', 'source-layer': 'landuse', paint: { 'fill-color': ['match',['get','fclass'],['forest','nature_reserve'],'#25483e',['park','grass','recreation_ground'],'#305c4e',['farmland','farmyard','orchard'],'#3b5141',['industrial','commercial'],'#34444e','#294148'], 'fill-opacity': .85 } },
        { id: 'base-water', type: 'fill', source: 'local', 'source-layer': 'water', paint: { 'fill-color': '#205971' } },
        { id: 'base-roads', type: 'line', source: 'local', 'source-layer': 'roads', paint: { 'line-color': ['match',['get','fclass'],['motorway','trunk','primary'],'#a8b5a0',['secondary','tertiary'],'#769391','#46656d'], 'line-width': ['interpolate',['linear'],['zoom'],9,.4,14,1.5,19,5] } },
        { id: 'street', type: 'raster', source: 'street', paint: { 'raster-saturation': -.15, 'raster-brightness-max': .85, 'raster-fade-duration': 120 } },
        { id: 'imagery-overview', type: 'raster', source: 'imagery-overview', layout: { visibility: 'none' }, paint: { 'raster-saturation': -.15, 'raster-brightness-max': .9, 'raster-fade-duration': 0 } },
        { id: 'imagery', type: 'raster', source: 'imagery', layout: { visibility: 'none' }, paint: { 'raster-saturation': -.15, 'raster-brightness-max': .9, 'raster-fade-duration': 120 } },
        ...vectorLayers.slice(0, 4).map(layer => ({ ...layer, source: 'local', 'source-layer': layer.id, layout: { visibility: layer.id === 'landuse' ? 'none' : 'visible' } })),
        { id: 'study-area', type: 'fill', source: 'study-area', paint: { 'fill-color': '#6e7f88', 'fill-opacity': .24 } },
        { id: 'analysis', type: 'fill', source: 'analysis', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': .32 } },
        { id: 'analysis-line', type: 'line', source: 'analysis', paint: { 'line-color': ['get', 'color'], 'line-width': 1.2 } },
        { id: 'radius-boundary', type: 'line', source: 'radius-boundary', paint: { 'line-color': '#e9f8ff', 'line-width': 2, 'line-dasharray': [4, 3] } },
        { id: 'reachable-roads', type: 'line', source: 'reachable-roads', paint: { 'line-color': '#97ffe6', 'line-width': 2, 'line-opacity': .85 } },
        ...vectorLayers.slice(4).map(layer => ({ ...layer, source: 'local', 'source-layer': 'buildings', layout: { visibility: layer.id === 'buildings-flat' ? 'none' : 'visible' } })),
        { id: 'pois', type: 'circle', source: 'pois', paint: { 'circle-radius': 4, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#e3fff5', 'circle-stroke-width': 1 } },
      ],
    },
  })
  let feedbackFrame,retryTimer
  const loadedImagery=new Set(),failedImagery=new Map(),retryCounts=new Map()
  const tileKey=tile=>`${tile.z}/${tile.x}/${tile.y}`
  const isImageryVisible=()=>map.getLayoutProperty('imagery','visibility')!=='none'
  const requiredImagery=()=>map.coveringTiles({tileSize:256,minzoom:9,maxzoom:19,roundZoom:true}).map(tile=>tile.canonical)
  const abort = () => {cancelAnimationFrame(feedbackFrame);clearTimeout(retryTimer);map.remove()}
  signal.addEventListener('abort', abort, { once: true })
  const basemapErrors=new Set()
  function updateImagery(){
    feedbackFrame=undefined
    if(signal.aborted||!isImageryVisible())return
    const required=requiredImagery(),complete=required.filter(tile=>loadedImagery.has(tileKey(tile))).length
    callbacks.onImageryProgress(required.length?Math.floor(complete/required.length*100):0)
    const failures=required.filter(tile=>failedImagery.has(tileKey(tile)))
    if(required.length&&complete===required.length&&map.isSourceLoaded('imagery'))callbacks.onBasemap('imagery')
    else if(failures.length){
      callbacks.onBasemapError('imagery')
      const retryable=failures.filter(tile=>(retryCounts.get(tileKey(tile))??0)<2)
      if(retryable.length&&!retryTimer)retryTimer=setTimeout(()=>{
        retryTimer=undefined
        if(signal.aborted||!isImageryVisible()||map.isMoving())return
        const current=new Set(requiredImagery().map(tileKey))
        const tiles=retryable.filter(tile=>current.has(tileKey(tile)))
        for(const tile of tiles){const key=tileKey(tile);failedImagery.delete(key);retryCounts.set(key,(retryCounts.get(key)??0)+1)}
        if(tiles.length){callbacks.onBasemapLoading('imagery');map.refreshTiles('imagery',tiles)}
      },1500)
    }else callbacks.onBasemapLoading('imagery')
  }
  function queueFeedback(){if(!feedbackFrame&&!signal.aborted)feedbackFrame=requestAnimationFrame(updateImagery)}
  map.on('error', event => {
    if(event.sourceId==='local')callbacks.onError(event.error?.message??event.error)
    if(event.sourceId==='imagery'){
      const tile=event.tile?.tileID?.canonical
      if(tile){loadedImagery.delete(tileKey(tile));failedImagery.set(tileKey(tile),tile)}
      queueFeedback()
    }else if(event.sourceId==='street'){
      basemapErrors.add(event.sourceId)
      callbacks.onBasemapError(event.sourceId)
    }
  })
  map.on('movestart',()=>{basemapErrors.clear();if(isImageryVisible()){callbacks.onBasemapLoading('imagery');callbacks.onImageryProgress(0)}})
  map.on('moveend',queueFeedback)
  map.on('idle',queueFeedback)
  map.on('styledata',queueFeedback)
  map.on('sourcedataloading',event=>{
    if(event.sourceId==='imagery'){
      const tile=event.tile?.tileID?.canonical
      if(tile)loadedImagery.delete(tileKey(tile))
      callbacks.onBasemapLoading('imagery')
      queueFeedback()
    }
  })
  map.on('sourcedata', event => {
    if (event.sourceId === 'local' && event.isSourceLoaded) callbacks.onVectors()
    if(event.sourceId==='imagery'){
      const tile=event.tile?.tileID?.canonical
      if(tile&&event.tile.state==='loaded'){loadedImagery.add(tileKey(tile));failedImagery.delete(tileKey(tile))}
      queueFeedback()
    }
    if (event.sourceId === 'street' && event.tile?.state === 'loaded' && event.isSourceLoaded && !basemapErrors.has(event.sourceId)) callbacks.onBasemap(event.sourceId)
  })
  await new Promise((resolve, reject) => {
    // Camera and local data must not wait for external raster servers.
    map.once('style.load', resolve)
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  })
  const element = document.createElement('div')
  element.className = 'start-marker'
  element.title = '分析起点'
  const marker = new Marker({ element }).setLngLat([114.395, 30.52]).addTo(map)
  map.on('click', event => {
    const facility = map.queryRenderedFeatures(event.point, { layers: ['pois'] })[0]
    callbacks.onClick(event.lngLat.toArray(), facility?.properties)
  })
  map.on('move', () => callbacks.onCamera(map.getPitch(), map.getBearing(), map.getZoom()))
  callbacks.onCamera(map.getPitch(), map.getBearing(), map.getZoom())
  return { map, marker }
}
