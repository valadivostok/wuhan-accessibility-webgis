<template>
  <div class="dashboard city-dashboard">
    <section class="scene-map" aria-label="武汉可达性全屏地图" :aria-busy="!vectorsLoaded">
      <div id="map" ref="mapElement"></div>
      <div class="scene-vignette"></div>
    </section>

    <header class="city-header">
      <a class="city-brand" href="/"><AppIcon name="globe" /><span>时空可达性<small>WUHAN CITY OBSERVATORY</small></span></a>
      <div class="city-title"><h1>武汉市时空可达性分析平台</h1><span>  SPATIAL INTELLIGENCE</span></div>
      <div class="city-clock"><time>{{ clockText }}</time><span><i class="live-dot"></i>{{ dataState === 'ready' ? '本地 GIS 数据' : dataStatus }}<button class="icon-button" @click="toggleFullscreen" :aria-label="fullscreen ? '退出全屏' : '进入全屏'"><AppIcon name="expand" /></button></span></div>
    </header>

    <nav class="city-nav" aria-label="分析视图">
      <button v-for="tab in viewTabs" :key="tab.key" :class="{ active: activeView === tab.key }" :aria-pressed="activeView === tab.key" @click="setView(tab.key)">{{ tab.label }}<small>{{ tab.en }}</small></button>
    </nav>
    <div class="workspace-label"><span class="live-dot"></span>{{ currentView.label }}<small>武汉市 / OSM 本地数据</small></div>
    <form class="basemap-form glass-surface" aria-label="地图切换" @submit.prevent>
      <label for="basemap-type">地图切换</label>
      <select id="basemap-type" v-model="basemap"><option value="imagery">影像图</option><option value="vector">矢量图</option></select>
    </form>
    <div v-if="basemap==='imagery'&&layers.base" :class="['imagery-feedback',{failed:basemapStates.imagery==='error'}]" role="status">{{ basemapStates.imagery==='ready'?'高清卫星影像已加载':basemapStates.imagery==='error'?'高清影像未加载完整 · 显示卫星概览':'正在加载高清卫星影像 · '+imageryProgress+'%' }}</div>
    <section class="dimension-control glass-surface" aria-label="地图维度">
      <div class="dimension-tabs"><button :class="{ active: !is3d }" :aria-pressed="!is3d" @click="setDimension(false)">2D 平面</button><button :class="{ active: is3d }" :aria-pressed="is3d" @click="setDimension(true)">3D 立体</button></div>
      <template v-if="is3d"><label for="building-height">建筑立体感 <span>{{ heightScale.toFixed(1) }}×</span></label><input id="building-height" type="range" min="0.5" max="3" step="0.1" v-model.number="heightScale" /><div class="camera-angles">俯仰 {{ Math.round(pitch) }}° · 方位 {{ Math.round(bearing) }}°</div><small>按住右键：上下俯仰 / 左右旋转</small><small>{{ !layers.buildings ? '请开启建筑轮廓图层' : buildingZoomVisible ? '真实建筑轮廓 · 高度为示意值' : '放大地图至 14 级以上查看建筑' }}</small></template>
    </section>

    <CityOverview v-if="isOverview" :manifest="dataManifest" :facilities="facilities" :selected-category="selectedCategory" :layers="layers" @fit-study-area="fitStudyArea" @select-category="selectCategory" @toggle-layer="key=>layers[key]=!layers[key]" />

    <aside v-if="!isOverview" class="left-column floating-column" :class="{ 'with-reach-panel': activeView === 'accessibility' }">
      <DashboardPanel title="基本地情" tag="CITY PROFILE" class="overview-panel">
        <div class="hologram-metrics"><div><small>武汉设施记录</small><strong>{{ dataState === 'ready' ? totalFacilities : '—' }}</strong><span>OSM 点及面 · 单位：处</span><i></i></div><div><small>设施分类数量</small><strong>08</strong><span>单位：类</span><i></i></div></div>
        <div class="location-row"><AppIcon name="pin" /><span>{{ startName }}</span><button class="icon-button" @click="centerOnStart" aria-label="定位到起点"><AppIcon name="target" /></button></div>
      </DashboardPanel>

      <DashboardPanel v-if="activeView === 'accessibility'" title="空间可达性" tag="ACCESSIBILITY" class="reach-panel">
        <div class="accessibility-row"><div class="gauge" :style="{ '--gauge': `${Math.min(100,isRadius?radiusKm/20*100:threshold/60*100)}%` }"><span><strong>{{ (isRadius ? radiusKm : threshold) || '—' }}</strong><small>{{ isRadius ? '分析半径 / km' : '分钟阈值' }}</small></span></div><div class="stacked-metrics"><span>{{ isRadius ? '有时间分区面积' : '等时圈近似面积' }}<strong>{{ analysisArea }}<small>km²</small></strong></span><span>可达路网长度<strong>{{ analysisResult?.metadata.reachableRoadKm.toFixed(1) ?? '—' }}<small>km</small></strong></span></div></div>
        <div class="mode-tabs"><button v-for="m in modes" :key="m.key" :class="{ active: travelMode === m.key }" @click="travelMode = m.key"><AppIcon :name="m.icon" />{{ m.label }}</button></div>
      </DashboardPanel>

      <DashboardPanel title="等时圈内设施占比" tag="AREA / CITY" class="ranking-panel">
        <div class="rank-row" v-for="(f,i) in rankedFacilities.slice(0,3)" :key="f.name"><div><span><em>0{{ i+1 }}</em>{{ f.name }}</span><strong>{{ analysisResult ? f.percent : '—' }}<small>%</small></strong></div><div class="rank-track"><span :style="{ width: `${f.percent}%` }"></span></div></div>
        <button class="outline-button" @click="activeView === 'accessibility' ? controlsOpen = !controlsOpen : setView('accessibility')"><AppIcon name="layers" />{{ controlsOpen ? '收起分析参数' : '配置分析参数' }}<span>{{ controlsOpen ? '−' : '+' }}</span></button>
      </DashboardPanel>
    </aside>

    <aside v-if="!isOverview" class="right-column floating-column">
      <DashboardPanel title="武汉设施分布" tag="OSM RECORDS" class="facilities-panel">
        <div class="facility-grid"><button v-for="item in facilities" :key="item.name" :class="['facility', {selected: selectedCategory === item.name}]" @click="selectCategory(item.name)" :aria-pressed="selectedCategory === item.name"><AppIcon :name="item.icon" /><span>{{ item.name }}<strong>{{ item.count }}<small>{{ item.unit }}</small></strong></span></button></div>
        <p class="panel-footnote">{{ selectedCategory ? `当前筛选：${selectedCategory} · 点击取消` : '全市 OSM 记录数 · 点击分类筛选真实点位' }}</p>
      </DashboardPanel>

      <DashboardPanel title="附近设施时间估算" tag="DISTANCE ESTIMATE" class="destinations-panel"><div class="destination-list"><button v-for="(place,i) in destinations" :key="i" @click="focusDestination(place)"><span class="destination-icon"><AppIcon :name="place.icon" /></span><span>{{ place.name }}</span><strong>{{ Math.max(1, Math.round(place.distance/1000/speed*60)) }}<small>分钟</small></strong><span class="destination-arrow">›</span></button></div><p class="panel-footnote">真实设施 · 按直线距离 / 速度估算，非路径时间</p></DashboardPanel>

      <DashboardPanel title="生活圈设施覆盖" tag="LIVING CIRCLE" class="living-panel"><div class="living-metrics"><button v-for="t in [5,15,30]" :key="t" :class="{active:!isRadius&&threshold===t}" @click="chooseTime(t)"><span>{{ t }}分钟</span><strong>{{ totalCovered(t) }}</strong><small>圈内设施 / 处</small></button></div></DashboardPanel>
    </aside>

    <button class="layer-trigger" @click="layersOpen = !layersOpen" :aria-expanded="layersOpen"><AppIcon name="layers" />图层目录<span>{{ layersOpen ? '‹' : '›' }}</span></button>
    <aside v-if="layersOpen" class="layer-tree glass-surface">
      <header><AppIcon name="layers" />场景图层<button class="icon-button" @click="layersOpen=false" aria-label="关闭图层目录">×</button></header>
      <template v-if="!isOverview"><div class="tree-group">⌄　空间分析图层</div><label><input type="checkbox" v-model="layers.isochrone" />{{ isRadius ? '圈内时间分区' : '路网等时圈' }}</label><label><input type="checkbox" v-model="layers.reachableRoads" />可达路段</label></template>
      <div class="tree-group">⌄　武汉本地图层</div><label v-for="item in localLayerDefinitions" :key="item.key" :title="item.minZoom ? `缩放级别 > ${item.minZoom} 时显示` : item.label"><input type="checkbox" v-model="layers[item.key]" />{{ item.label }}<small>{{ dataManifest?.counts[item.key]?.toLocaleString() ?? '—' }}</small></label>
      <label><input type="checkbox" v-model="layers.poi" />设施点位<small>{{ dataManifest?.counts.pois?.toLocaleString() ?? '—' }}</small></label>
      <button class="study-area-button" @click="fitStudyArea" :disabled="dataState!=='ready'">查看武汉全域</button>
      <div class="tree-status" role="status">{{ dataStatus }}<a v-if="dataManifest" :href="`${baseUrl}data/demo/manifest.json`" target="_blank" rel="noopener" title="查看来源文件、数据时点和统计口径">数据说明 ↗</a></div>
      <div class="tree-group">⌄　基础地理场景</div><label><input type="checkbox" v-model="layers.base" />{{ basemap === 'imagery' ? '影像图' : '矢量图' }}</label><div class="tree-status"><i class="live-dot"></i>{{ sceneStatus }}</div>
    </aside>

    <div class="scene-caption"><span>WUHAN · LOCAL GIS</span><strong>{{ activeView === 'overview' ? '城市空间，全景洞察' : currentView.label }}</strong><small>{{ dataState === 'ready' ? '真实本地矢量 · 拖动探索 / 点击设施查看来源' : dataStatus }}</small></div>

    <div class="scene-legend" v-if="!isOverview && layers.isochrone && analysisResult"><span>{{ isRadius ? `${radiusKm} km 内到达时间` : '路网等时圈' }}</span><div v-for="(t,i) in ringTimes" :key="t"><i :style="{ background: ringColors[i] }"></i>{{ isRadius ? `${i ? ringTimes[i-1] : 0}–${t}` : t }}<small>min</small></div><div v-if="isRadius"><i style="background:#6e7f88"></i>无路网时间</div></div>
    <div class="scene-tools"><button @click="zoomMap(1)" aria-label="放大地图">+</button><button @click="zoomMap(-1)" aria-label="缩小地图">−</button><button @click="centerOnStart" aria-label="回到起点"><AppIcon name="target" /></button><button @click="rotateMap" aria-label="旋转地图视角"><AppIcon name="navigation" /></button><button @click="resetStart" aria-label="重置场景"><AppIcon name="reset" /></button></div>
    <div class="map-coordinate">{{ coordinateText }}<span>{{ isOverview ? '拖动浏览 / 点击设施查看信息' : '点击地图设置分析起点' }}</span></div>
    <div class="basemap-attribution"><a v-if="basemap==='imagery'&&layers.base" href="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" target="_blank" rel="noopener">影像 © Esri / Vantor / Earthstar Geographics · </a><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors · ODbL</a></div>

    <form v-if="controlsOpen && !isOverview" class="settings-panel glass-surface" aria-label="分析参数" @submit.prevent="runAnalysis">
      <header><span>可达性分析参数</span><button type="button" class="icon-button" @click="controlsOpen=false" aria-label="关闭分析参数">×</button></header>
      <div class="algorithm-selector" role="group" aria-label="算法模式"><button type="button" :class="{active:!isRadius}" :aria-pressed="!isRadius" @click="analysisMode='time'">模式一 · 时间约束</button><button type="button" :class="{active:isRadius}" :aria-pressed="isRadius" @click="analysisMode='radius'">模式二 · 半径约束</button></div>
      <p class="algorithm-mode">{{ isRadius ? '固定半径区域内，按到达时间分区' : '给定时间，求路网可达范围' }}</p>
      <div class="control-label"><label for="speed">{{ currentMode.label }}{{ travelMode === 'car' ? '基准' : '' }}速度设置</label><strong>{{ speed }}<small> km/h</small></strong></div>
      <input id="speed" :key="travelMode" class="speed-slider" type="range" v-model.number="speed" :min="currentMode.min" :max="currentMode.max" :step="1" :style="{'--progress':`${(speed-currentMode.min)/(currentMode.max-currentMode.min)*100}%`}" />
      <div class="range-labels"><span>{{ currentMode.min }}</span><span>{{ currentMode.max }}</span></div>
      <template v-if="isRadius"><div class="control-label"><label for="radius-km">分析半径（km）</label><span class="muted">0.1–20 km</span></div><input id="radius-km" class="time-input" type="number" min="0.1" max="20" step="any" required v-model.number="radiusKm" /><div class="time-options"><button type="button" v-for="r in [.5,1,3,5,10,20]" :key="r" :class="{active:radiusKm===r}" @click="radiusKm=r">{{ r }}</button></div></template>
      <template v-else><div class="control-label"><label for="time-minutes">时间阈值（分钟）</label><span class="muted">1–60 分钟</span></div><input id="time-minutes" class="time-input" type="number" min="1" max="60" step="1" required v-model.number="threshold" /><div class="time-options"><button type="button" v-for="t in times" :key="t" :class="{active:threshold===t}" @click="threshold=t">{{ t }}</button></div></template>
      <div class="start-controls"><AppIcon name="pin" /><input v-model="startName" aria-label="起点名称" placeholder="输入起点名称" /></div>
      <p class="analysis-status" :class="{error:analysisError}" role="status" aria-live="polite">{{ analysisStatus }}</p>
      <p class="analysis-method">时间按道路成本计算；面域为 {{ analysisResult?.metadata.gridMeters ?? 30 }} 米点阵近似，路外步行接驳≤90米。{{ isRadius ? '灰色表示无路网时间；允许道路绕出半径再返回。' : '' }}</p>
      <p v-if="isRadius&&analysisResult" class="analysis-method">分析区 {{ analysisResult.metadata.studyAreaKm2.toFixed(2) }} km² · 无路网时间 {{ analysisResult.metadata.unclassifiedAreaKm2.toFixed(2) }} km²</p>
      <button type="submit" class="analyze-button" :disabled="analyzing"><AppIcon :name="analyzing ? 'reset' : 'play'" :class="{spinning:analyzing}" />{{ analyzing ? '正在计算路网时间…' : isRadius ? '生成圈内时间分区' : '生成等时圈' }}<span>→</span></button>
      <button type="button" class="export-analysis" :disabled="!analysisResult || analyzing" @click="exportAnalysis">导出 GeoJSON</button>
    </form>

    <section v-if="!isOverview" class="bottom-dashboard">
      <DashboardPanel title="等时圈面积变化" tag="NETWORK ISOCHRONES" class="population-panel"><div class="chart-caption">时间阈值 / 近似面域<strong>{{ analysisArea }}<span>km²</span></strong></div><p v-if="!analysisResult" class="chart-empty">生成等时圈后显示各时段的近似面积</p><svg v-else class="line-chart" viewBox="0 0 400 150" role="img" aria-label="不同时间阈值下的路网等时圈近似面积"><defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#55f2d7" stop-opacity=".5"/><stop offset="1" stop-color="#55f2d7" stop-opacity=".02"/></linearGradient></defs><g class="chart-grid"><line v-for="i in 4" :key="i" x1="32" x2="385" :y1="17+(i-1)*35" :y2="17+(i-1)*35" /></g><path :d="areaPath" fill="url(#areaGradient)"/><polyline :points="areaPoints" fill="none" stroke="#a1f3df" stroke-width="2"/><g v-for="(v,i) in areaSeries" :key="i"><circle :cx="chartX(i)" :cy="122-v/areaMax*105" r="3" fill="#d5fff4"/><text :x="chartX(i)" :y="112-v/areaMax*105" class="point-label">{{ v.toFixed(2) }}</text><text :x="chartX(i)" y="143" class="tick-label">{{ ringTimes[i] }}分钟</text></g></svg></DashboardPanel>
      <DashboardPanel title="等时圈内设施记录" tag="OSM / ISOCHRONES" class="bar-panel"><p v-if="!analysisResult" class="chart-empty">设施按生成的近似面域统计</p><div class="bar-legend"><span v-for="(t,i) in barTimes" :key="t"><i :style="{background:barColors[i]}"></i>{{ t }}分钟</span></div><div v-if="analysisResult" class="bar-chart"><div class="bar-y"><span v-for="i in 4" :key="i">{{ Math.round(barMax*(4-i)/3) }}</span></div><div class="bar-plot"><div class="bar-group" v-for="f in facilities.slice(0,7)" :key="f.name"><div class="bar-columns"><span v-for="(t,i) in barTimes" :key="t" :style="{height:`${coveredCount(f.name,t)/barMax*100}%`,background:barColors[i]}" :title="`${f.name} · ${t}分钟近似等时圈内：${coveredCount(f.name,t)}处设施`"></span></div><span class="bar-x">{{ f.short || f.name }}</span></div></div></div></DashboardPanel>
      <DashboardPanel title="用地记录面积占比" tag="OSM · CITY" class="land-panel"><div class="land-content"><div class="donut" :style="{background:landGradient}"><div><small>全市记录面积和</small><strong>{{ dataManifest?.landRecordAreaKm2 ?? '—' }}</strong><span>km² · 可重叠</span></div></div><div class="land-legend"><div v-for="item in landUse" :key="item.name"><i :style="{background:item.color}"></i><span>{{ item.name }}</span><strong>{{ item.value }}%</strong></div></div></div></DashboardPanel>
      <DashboardPanel title="生活圈运行态势" tag="URBAN INSIGHTS" class="insights-panel"><div class="insight-primary"><span><small>当前出行方式</small><strong>{{ currentMode.label }}</strong></span><span><small>出行速度</small><strong>{{ speed }}<em>km/h</em></strong></span></div><div class="insight-secondary"><div><span>{{ isRadius ? '分析半径' : '时间阈值' }}</span><strong>{{ isRadius ? radiusKm : threshold }}<small>{{ isRadius ? 'km' : '分钟' }}</small></strong></div><div><span>示范设施</span><strong>{{ totalFacilities }}<small>处</small></strong></div></div><button class="insight-action" @click="setView('accessibility')">进入可达性分析<span>↗</span></button></DashboardPanel>
    </section>

    <footer class="city-footer"><span><i class="live-dot"></i>本地数据 © OpenStreetMap contributors · ODbL 1.0</span><span>{{ isOverview ? '武汉市域基础地理数据 · 全市记录统计' : '本地路网时间成本 · 圈面为点阵近似 · 未接入人口数据' }}</span><span>WUHAN SPATIAL INTELLIGENCE</span></footer>
    <div v-if="notice" class="notice" role="status"><AppIcon name="target" />{{ notice }}</div>
  </div>
</template>


<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import GeoJSON from 'ol/format/GeoJSON'
import { fromLonLat, toLonLat } from 'ol/proj'
import { getDistance } from 'ol/sphere'
import { emptyFacilities, localLayerDefinitions, loadDemoData } from './demoData'
import DashboardPanel from './components/DashboardPanel.vue'
import AppIcon from './components/AppIcon.vue'
import CityOverview from './components/CityOverview.vue'
import { createCityMap, collection } from './mapScene'

const times = [5, 10, 15, 20, 30, 60]
const analysisMode=ref('time'), radiusKm=ref(5)
const isRadius=computed(()=>analysisMode.value==='radius')
const baseUrl=import.meta.env.BASE_URL
const modes = [{key:'walk',label:'步行',icon:'walk',speed:5,min:3,max:7},{key:'bike',label:'骑行',icon:'bike',speed:15,min:8,max:25},{key:'car',label:'驾车',icon:'car',speed:35,min:15,max:60}]
const travelMode=ref('walk'), threshold=ref(15), speed=ref(5), analyzing=ref(false), startName=ref('东湖片区 · 示范起点'), selectedCategory=ref(''), fullscreen=ref(false), notice=ref(''), now=ref(new Date()), mapElement=ref(null)
const layers=ref({base:true,isochrone:false,reachableRoads:true,poi:true,...Object.fromEntries(localLayerDefinitions.map(item=>[item.key,item.visible]))})
const analysisResult=shallowRef(null), analysisError=ref('')
const analysisStatus=computed(()=>analyzing.value?'沿路网计算通行时间，首次计算需加载路网…':analysisError.value||(!analysisResult.value?(isRadius.value?'选择起点，输入半径后生成圈内时间分区':'点击地图选择起点，输入时间后生成等时圈'):`已完成 · 接入道路 ${analysisResult.value.metadata.snapDistanceMeters} 米 · ${analysisResult.value.metadata.elapsedMs} ms`))
const dataManifest=shallowRef(null), poiFeatures=shallowRef([]), dataState=ref('loading')
const dataStatus=computed(()=>dataState.value==='ready'?`武汉本地数据 · ${totalFacilities.value}处设施`:dataState.value==='error'?'本地数据加载失败':'正在加载武汉本地数据')
const dataAbort=new AbortController()
const basemap=ref('vector'), activeView=ref('overview'), controlsOpen=ref(false), layersOpen=ref(true)
const isOverview=computed(()=>activeView.value==='overview')
const is3d=ref(true), heightScale=ref(1.5), buildingZoomVisible=ref(false)
const pitch=ref(45), bearing=ref(-8.6)
const vectorsLoaded=ref(false)
const coordinateText=ref('114.3950° E  /  30.5200° N')
const viewTabs=[{key:'overview',label:'全市概况',en:'CITY OVERVIEW'},{key:'accessibility',label:'可达性分析',en:'ACCESSIBILITY'},{key:'facilities',label:'设施分布',en:'URBAN FACILITIES'},{key:'coverage',label:'生活圈评估',en:'LIVING CIRCLE'}]
const currentView=computed(()=>viewTabs.find(tab=>tab.key===activeView.value))
const basemapStates=ref({street:'loading',imagery:'loading'})
const imageryProgress=ref(0)
const sceneStatus=computed(()=>{
  if(!layers.value.base)return '底图已关闭'
  const imagery=basemap.value==='imagery',status=basemapStates.value[imagery?'imagery':'street']
  return status==='ready'?(imagery?'高清卫星影像已加载':'矢量图 · OpenStreetMap 已加载'):status==='error'?(imagery?'高清未完整加载 · 卫星概览':'在线底图不可用 · 显示本地矢量'):(imagery?'高清影像加载中 · '+imageryProgress.value+'%':'本地矢量 · 在线底图加载中')
})
const currentMode=computed(()=>modes.find(m=>m.key===travelMode.value))
const clockText=computed(()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now.value))
const facilities=computed(()=>dataManifest.value?.facilities??emptyFacilities)
const totalFacilities=computed(()=>facilities.value.reduce((n,f)=>n+f.count,0))
const barColors=['#4b7996','#51a3be','#53ceca','#9be9cb']
const ringColors=['#fb5e68','#ffad43','#e7d64e','#2ed8b0','#218bff','#8c9dff']
const ringTimes=computed(()=>analysisResult.value?.features.map(f=>f.properties.minutes)??[])
const coverageCounts=computed(()=>Object.fromEntries((analysisResult.value?.features??[]).map(f=>{
  const polygon=f.geometry?geoJsonFormat.readGeometry(f.geometry,{dataProjection:'EPSG:4326',featureProjection:'EPSG:3857'}):null
  const counts=Object.fromEntries(facilities.value.map(f=>[f.name,0]))
  if(polygon)for(const feature of poiFeatures.value)if(polygon.intersectsCoordinate(feature.getGeometry().getCoordinates()))counts[feature.get('category')]++
  return [f.properties.minutes,counts]
})))
const coveredCount=(name,t)=>coverageCounts.value[t]?.[name]??0
const totalCovered=t=>coverageCounts.value[t]?Object.values(coverageCounts.value[t]).reduce((a,b)=>a+b,0):'—'
const barTimes=computed(()=>ringTimes.value.slice(-4))
const barMax=computed(()=>Math.max(1,...barTimes.value.flatMap(t=>Object.values(coverageCounts.value[t]??{}))))
const areaSeries=computed(()=>analysisResult.value?.features.map(f=>f.properties.areaKm2)??[])
const areaMax=computed(()=>Math.max(.01,...areaSeries.value))
const chartX=i=>40+i*335/Math.max(1,areaSeries.value.length-1)
const areaPoints=computed(()=>areaSeries.value.map((v,i)=>`${chartX(i)},${122-v/areaMax.value*105}`).join(' '))
const areaPath=computed(()=>areaSeries.value.length?`M40,122 L${areaPoints.value.replaceAll(' ',' L')} L${chartX(areaSeries.value.length-1)},122 Z`:'')
const analysisArea=computed(()=>analysisResult.value?.features.at(-1).properties.areaKm2.toFixed(2)??'—')
const landUse=computed(()=>dataManifest.value?.landUse??[])
const landGradient=computed(()=>{let sum=0;return landUse.value.length?`conic-gradient(${landUse.value.map(l=>{let start=sum;sum+=l.value;return `${l.color} ${start}% ${sum}%`}).join(',')})`:'#24433e'})
const rankedFacilities=computed(()=>facilities.value.map(f=>({...f,percent:f.count?Math.round(coveredCount(f.name,isRadius.value?ringTimes.value.at(-1):threshold.value)/f.count*100):0})).sort((a,b)=>b.percent-a.percent).slice(0,4))
const destinations=computed(()=>{
  const origin=toLonLat(startCoordinate.value)
  return poiFeatures.value.filter(f=>f.get('name')).map(f=>({name:f.get('name'),coordinate:f.getGeometry().getCoordinates(),icon:facilities.value.find(c=>c.name===f.get('category'))?.icon??'pin',distance:getDistance(origin,toLonLat(f.getGeometry().getCoordinates()))})).sort((a,b)=>a.distance-b.distance).slice(0,5)
})
let map, startMarker, clockTimer, noticeTimer, analysisAbort, analysisSequence=0
let poiGeoJson=collection([])
const geoJsonFormat=new GeoJSON()
const startCoordinate=ref(fromLonLat([114.395,30.52]))
const notify=message=>{notice.value=message;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.value='',3500)}
function refreshAnalysisLayers(){
  if(!map)return
  const features=(analysisResult.value?.timeBands?.features??analysisResult.value?.features??[]).map((f,i)=>({...f,properties:{...f.properties,color:ringColors[i]}})).filter(f=>f.geometry).reverse()
  map.getSource('analysis')?.setData(collection(features))
  map.getSource('study-area')?.setData(analysisResult.value?.studyArea??collection([]))
  map.getSource('radius-boundary')?.setData(analysisResult.value?.radiusBoundary??collection([]))
  map.getSource('reachable-roads')?.setData(analysisResult.value?.reachableRoads??collection([]))
  startMarker?.setLngLat(toLonLat(startCoordinate.value))
}
function invalidateAnalysis(){
  analysisSequence++
  analysisAbort?.abort()
  analyzing.value=false
  analysisResult.value=null
  analysisError.value=''
  refreshAnalysisLayers()
}
function updatePois(){
  map?.getSource('pois')?.setData(collection(poiGeoJson.features.filter(f=>!selectedCategory.value||selectedCategory.value===f.properties.category)))
}
async function initLocalData(){
  try{
    const {manifest,features}=await loadDemoData(dataAbort.signal)
    if(dataAbort.signal.aborted)return
    dataManifest.value=manifest
    poiFeatures.value=features.pois
    poiGeoJson=geoJsonFormat.writeFeaturesObject(features.pois,{featureProjection:'EPSG:3857',dataProjection:'EPSG:4326'})
    for(const feature of poiGeoJson.features)feature.properties.color=manifest.facilities.find(f=>f.name===feature.properties.category)?.color??'#83cabe'
    updatePois()
    dataState.value='ready'
  }catch(error){if(error.name!=='AbortError'){dataState.value='error';console.error('本地演示数据加载失败',error);notify('本地数据加载失败，请运行 npm run prepare:data 后刷新')}}
}
async function initMap(){
  const scene=await createCityMap(mapElement.value,{
    onVectors:()=>vectorsLoaded.value=true,
    onBasemap:id=>basemapStates.value[id]='ready',
    onBasemapLoading:id=>basemapStates.value[id]='loading',
    onImageryProgress:value=>imageryProgress.value=value,
    onBasemapError:id=>basemapStates.value[id]='error',
    onError:error=>{console.error('本地瓦片加载失败',error);notify('本地瓦片加载失败，请运行 npm run prepare:tiles 后刷新')},
    onCamera:(p,b,z)=>{pitch.value=p;bearing.value=b;buildingZoomVisible.value=z>=14},
    onClick:(coordinate,facility)=>{
      if(isOverview.value){
        coordinateText.value=`${coordinate[0].toFixed(4)}° E  /  ${coordinate[1].toFixed(4)}° N`
        if(facility)notify(`${facility.name||'未命名设施'} · ${facility.category} · OSM ${facility.osm_type}/${facility.osm_id}`)
        return
      }
      startCoordinate.value=fromLonLat(coordinate)
      coordinateText.value=`${coordinate[0].toFixed(4)}° E  /  ${coordinate[1].toFixed(4)}° N`
      startName.value=facility?.name||`自选起点 ${coordinate[0].toFixed(3)}, ${coordinate[1].toFixed(3)}`
      controlsOpen.value=true
      notify(facility?`已设为起点：${facility.name||facility.category} · OSM ${facility.osm_type}/${facility.osm_id}`:isRadius.value?'已更新起点 · 输入半径后生成圈内时间分区':'已更新起点 · 输入时间后生成路网等时圈')
    },
  },dataAbort.signal)
  if(!scene)return
  map=scene.map
  startMarker=scene.marker
  if(!is3d.value)setDimension(false)
  syncLayerVisibility()
  map.setPaintProperty('buildings','fill-extrusion-height',['*',['get','height'],heightScale.value])
  refreshAnalysisLayers()
  updatePois()
}
function centerOnStart(){map?.easeTo({center:toLonLat(startCoordinate.value),duration:500})}
function fitStudyArea(){if(!map||!dataManifest.value)return;const [w,h]=[mapElement.value.clientWidth,mapElement.value.clientHeight];map.fitBounds(dataManifest.value.extent,{padding:{top:Math.min(h*.24,200),right:Math.min(w*.25,390),bottom:Math.min(h*.33,280),left:Math.min(w*.25,390)},pitch:0,duration:500})}
function zoomMap(delta){if(map)map.easeTo({zoom:map.getZoom()+delta,duration:250})}
function resetStart(){startCoordinate.value=fromLonLat([114.395,30.52]);startName.value='东湖片区 · 示范起点';coordinateText.value='114.3950° E  /  30.5200° N';map?.easeTo({center:toLonLat(startCoordinate.value),zoom:15.6,bearing:-8.6,pitch:is3d.value?45:0,duration:500})}
function selectCategory(name){selectedCategory.value=selectedCategory.value===name?'':name;updatePois()}
function focusDestination(place){if(!map)return;map.easeTo({center:toLonLat(place.coordinate),duration:500});notify(`${place.name} · 真实设施位置，时间按直线距离和速度估算`)}
async function runAnalysis(){
  if(analyzing.value)return
  if(isRadius.value){if(!Number.isFinite(radiusKm.value)||radiusKm.value<.1||radiusKm.value>20){analysisError.value='请输入 0.1–20 km 半径';return}}
  else if(!Number.isFinite(threshold.value)||threshold.value<1||threshold.value>60){analysisError.value='请输入 1–60 分钟';return}
  analysisAbort?.abort()
  analysisAbort=new AbortController()
  const sequence=++analysisSequence
  analyzing.value=true
  analysisError.value=''
  try{
    const request={origin:toLonLat(startCoordinate.value),constraint:analysisMode.value,mode:travelMode.value,speedKmh:speed.value,...(isRadius.value?{radiusKm:radiusKm.value}:{minutes:threshold.value})}
    const response=await fetch('/api/accessibility/isochrones',{method:'POST',headers:{'Content-Type':'application/json'},signal:analysisAbort.signal,body:JSON.stringify(request)})
    if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('可达性接口未启动，请重启 npm run dev 或使用 npm start')
    const result=await response.json()
    if(!response.ok)throw new Error(result.error?.message||`计算失败（${response.status}）`)
    if(sequence!==analysisSequence)return
    analysisResult.value=result
    layers.value.isochrone=true
    refreshAnalysisLayers()
    if(map){
      const outer=result.radiusBoundary?.features[0]??result.features.at(-1)
      const extent=outer.geometry?geoJsonFormat.readGeometry(outer.geometry).getExtent():null
      const [w,h]=[mapElement.value.clientWidth,mapElement.value.clientHeight]
      if(extent)map.fitBounds(extent,{padding:{top:Math.min(h*.2,165),right:Math.min(w*.24,380),bottom:Math.min(h*.3,270),left:Math.min(w*.24,380)},duration:400,maxZoom:15})
    }
    notify(`已生成${currentMode.value.label} ${isRadius.value?`${radiusKm.value} km 半径内时间分区`:`${threshold.value}分钟等时圈`} · 可达路网 ${result.metadata.reachableRoadKm.toFixed(1)} km`)
  }catch(error){
    if(error.name!=='AbortError'&&sequence===analysisSequence){analysisError.value=error.message;notify(error.message)}
  }finally{if(sequence===analysisSequence)analyzing.value=false}
}
function exportAnalysis(){
  if(!analysisResult.value)return
  const result=analysisResult.value
  const exported=result.timeBands?{...result,cumulativeIsochrones:collection(result.features),features:result.timeBands.features}:result
  const url=URL.createObjectURL(new Blob([JSON.stringify(exported)],{type:'application/geo+json'}))
  const link=document.createElement('a');link.href=url;link.download=`wuhan-${travelMode.value}-${isRadius.value?`radius-${radiusKm.value}km`:`${threshold.value}min`}.geojson`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
function chooseTime(t){if(isRadius.value){notify('当前卡片统计固定半径内的累计时间分区');return}threshold.value=t;setView('accessibility')}
function setView(key){activeView.value=key;controlsOpen.value=key==='accessibility';layers.value.isochrone=key==='accessibility'||key==='coverage';if(key==='facilities'){layers.value.poi=true;layersOpen.value=true}if(key==='overview'){selectedCategory.value='';updatePois()}if(key==='coverage'&&!analysisResult.value){controlsOpen.value=true;notify('请先生成路网等时圈，再查看生活圈设施覆盖')}}
function rotateMap(){if(map)map.easeTo({bearing:map.getBearing()+30,duration:600})}
function syncLayerVisibility(){
  if(!map)return
  const visible=(id,value)=>map.setLayoutProperty(id,'visibility',value?'visible':'none')
  const showAnalysis=!isOverview.value&&layers.value.isochrone
  for(const key of ['boundary','roads','water','landuse','pois','analysis','analysis-line'])visible(key,key==='pois'?layers.value.poi:key.startsWith('analysis')?showAnalysis:layers.value[key])
  visible('reachable-roads',layers.value.reachableRoads&&showAnalysis)
  visible('study-area',showAnalysis)
  visible('radius-boundary',showAnalysis)
  if(startMarker)startMarker.getElement().style.display=isOverview.value?'none':''
  visible('buildings',layers.value.buildings&&is3d.value)
  visible('buildings-flat',layers.value.buildings&&!is3d.value)
  for(const id of ['base-landuse','base-water','base-roads'])visible(id,layers.value.base&&basemap.value==='vector')
  visible('street',layers.value.base&&basemap.value==='vector')
  visible('imagery',layers.value.base&&basemap.value==='imagery')
  visible('imagery-overview',layers.value.base&&basemap.value==='imagery')
}
function setDimension(enabled){
  is3d.value=enabled
  if(!map)return
  if(enabled){
    layers.value.buildings=true
    map.setMaxPitch(70)
    map.dragRotate.enable()
    map.touchZoomRotate.enableRotation()
    map.touchPitch.enable()
  }else{
    map.setMaxPitch(0)
    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()
    map.touchPitch.disable()
  }
  map.easeTo({pitch:enabled?45:0,duration:350})
  syncLayerVisibility()
}
watch(heightScale,()=>map?.setPaintProperty('buildings','fill-extrusion-height',['*',['get','height'],heightScale.value]))
async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{notify('当前浏览器不支持全屏，请使用 F11')}}
const onFullscreen=()=>fullscreen.value=!!document.fullscreenElement
watch(travelMode,()=>{speed.value=currentMode.value.speed})
watch([threshold,speed,travelMode,startCoordinate,analysisMode,radiusKm],invalidateAnalysis,{flush:'sync'})
watch(basemap,syncLayerVisibility)
watch(activeView,syncLayerVisibility)
watch(layers,syncLayerVisibility,{deep:true})
onMounted(async()=>{
  clockTimer=setInterval(()=>now.value=new Date(),1000)
  document.addEventListener('fullscreenchange',onFullscreen)
  await nextTick()
  try{await Promise.all([initMap(),initLocalData()])}catch(error){if(error.name!=='AbortError'){console.error(error);notify('三维地图初始化失败，请检查浏览器 WebGL 支持')}}
})
onUnmounted(()=>{dataAbort.abort();analysisAbort?.abort();map?.remove();clearInterval(clockTimer);clearTimeout(noticeTimer);document.removeEventListener('fullscreenchange',onFullscreen)})
</script>
