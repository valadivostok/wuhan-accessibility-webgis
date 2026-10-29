<template>
  <aside class="left-column floating-column geography-column" aria-label="全市基础地理概况">
    <DashboardPanel title="基本地情" tag="CITY GEOGRAPHY" class="overview-panel">
      <div class="hologram-metrics">
        <div><small>OSM 市界面积</small><strong>{{ manifest ? manifest.boundaryAreaKm2?.toLocaleString('zh-CN', {maximumFractionDigits:1}) ?? '—' : '—' }}</strong><span>km² · 市界几何面积</span><i></i></div>
        <div><small>已接入基础图层</small><strong>{{ manifest ? layerStats.length : '—' }}</strong><span>个 · 武汉范围</span><i></i></div>
      </div>
      <div class="location-row"><AppIcon name="pin" /><span>武汉市 · {{ format(recordTotal) }} 条要素记录</span><button class="icon-button" @click="$emit('fit-study-area')" :disabled="!manifest" aria-label="查看武汉市域"><AppIcon name="target" /></button></div>
    </DashboardPanel>
    <WeatherCard />
    <DashboardPanel title="基础图层概览" tag="LOCAL LAYERS" class="base-layers-panel">
      <button v-for="item in layerStats" :key="item.key" class="base-layer-record" :aria-pressed="!!layers[item.visibilityKey]" @click="$emit('toggle-layer', item.visibilityKey)">
        <i :style="{background:item.color}"></i><span>{{ item.name }}</span><strong>{{ format(item.count) }}</strong><small>条</small><span class="layer-record-state">{{ layers[item.visibilityKey] ? '显示' : '隐藏' }}</span>
      </button>
      <p class="panel-footnote">武汉市域记录数 · 点击切换地图图层</p>
    </DashboardPanel>
  </aside>

  <aside class="right-column floating-column geography-column" aria-label="全市设施与数据范围">
    <DashboardPanel title="武汉设施分布" tag="CITY FACILITIES" class="facilities-panel">
      <div class="facility-grid"><button v-for="item in facilities" :key="item.name" :class="['facility',{selected:selectedCategory===item.name}]" :aria-pressed="selectedCategory===item.name" @click="$emit('select-category',item.name)"><AppIcon :name="item.icon" /><span>{{ item.name }}<strong>{{ format(item.count) }}<small>处</small></strong></span></button></div>
      <p class="panel-footnote">{{ selectedCategory ? `当前筛选：${selectedCategory} · 点击取消` : '全市 OSM 设施记录 · 点击分类查看' }}</p>
    </DashboardPanel>
    <DashboardPanel title="市域范围与坐标" tag="STUDY AREA" class="extent-panel">
      <dl class="geography-facts"><div><dt>坐标系</dt><dd>WGS 84 / EPSG:4326</dd></div><div><dt>西界 / 东界</dt><dd>{{ coordinate(0) }} / {{ coordinate(2) }}° E</dd></div><div><dt>南界 / 北界</dt><dd>{{ coordinate(1) }} / {{ coordinate(3) }}° N</dd></div></dl>
      <button class="outline-button" @click="$emit('fit-study-area')" :disabled="!manifest"><AppIcon name="globe" />查看武汉全域<span>↗</span></button>
    </DashboardPanel>
    <DashboardPanel title="本地数据来源" tag="DATA SOURCE" class="source-panel">
      <div class="source-date"><span>原始数据日期</span><strong>{{ sourceDate }}</strong></div>
      <p>OpenStreetMap / Geofabrik</p><p class="panel-footnote">本机 GISdata · 湖北数据裁剪为武汉市域</p>
    </DashboardPanel>
  </aside>

  <section class="bottom-dashboard geography-dashboard" aria-label="全市基础数据统计">
    <DashboardPanel title="地理要素规模" tag="FEATURE RECORDS" class="geography-scale-panel">
      <div v-for="item in majorLayers" :key="item.key" class="geography-scale-row"><div><span>{{ item.name }}</span><strong>{{ format(item.count) }}<small>条</small></strong></div><div class="geography-scale-track"><i :style="{width:`${(item.count??0)/layerMax*100}%`,background:item.color}"></i></div></div>
    </DashboardPanel>
    <DashboardPanel title="全市设施类别构成" tag="CITY COMPOSITION" class="facility-composition-panel">
      <div class="composition-summary">全市设施记录<strong>{{ format(totalFacilities) }}<small>处</small></strong></div>
      <div class="facility-composition-bars"><div v-for="item in facilities" :key="item.name" :title="`${item.name}：${format(item.count)} 处`"><span>{{ format(item.count) }}</span><i :style="{'--record-fraction':item.count/facilityMax,background:item.color}"></i><small>{{ item.short??item.name }}</small></div></div>
    </DashboardPanel>
    <DashboardPanel title="用地记录面积占比" tag="OSM · CITY" class="land-panel">
      <div class="land-content"><div class="donut" :style="{background:landGradient}"><div><small>用地记录面积和</small><strong>{{ manifest?.landRecordAreaKm2 ?? '—' }}</strong><span>km² · 可重叠</span></div></div><div class="land-legend"><div v-for="item in manifest?.landUse??[]" :key="item.name"><i :style="{background:item.color}"></i><span>{{ item.name }}</span><strong>{{ item.value }}%</strong></div></div></div>
    </DashboardPanel>
    <DashboardPanel title="数据展示口径" tag="DATA NOTES" class="geography-notes-panel">
      <ul><li>各项数量统计武汉全市记录。</li><li>设施记录数不代表官方设施普查数量。</li><li>用地按记录面积汇总，可能重叠。</li><li>建筑轮廓真实，高度为示意值。</li></ul>
      <a v-if="manifest" :href="`${baseUrl}data/demo/manifest.json`" target="_blank" rel="noopener">查看数据来源与完整说明 ↗</a>
    </DashboardPanel>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import DashboardPanel from './DashboardPanel.vue'
import AppIcon from './AppIcon.vue'
import WeatherCard from './WeatherCard.vue'

const props=defineProps({manifest:Object,facilities:{type:Array,default:()=>[]},selectedCategory:String,layers:{type:Object,required:true}})
defineEmits(['fit-study-area','toggle-layer','select-category'])
const baseUrl=import.meta.env.BASE_URL
const definitions=[
  {key:'boundary',visibilityKey:'boundary',name:'行政边界',color:'#91fce0'},
  {key:'roads',visibilityKey:'roads',name:'道路路网',color:'#75b8c9'},
  {key:'buildings',visibilityKey:'buildings',name:'建筑轮廓',color:'#84cfb5'},
  {key:'water',visibilityKey:'water',name:'水域面',color:'#469cdb'},
  {key:'landuse',visibilityKey:'landuse',name:'土地利用',color:'#b4c77d'},
  {key:'pois',visibilityKey:'poi',name:'设施点位',color:'#e2bd78'},
]
const layerStats=computed(()=>definitions.map(item=>({...item,count:props.manifest?.counts[item.key]})))
const majorLayers=computed(()=>layerStats.value.filter(item=>!['boundary','pois'].includes(item.key)))
const layerMax=computed(()=>Math.max(1,...majorLayers.value.map(item=>item.count??0)))
const recordTotal=computed(()=>props.manifest?Object.values(props.manifest.counts).reduce((sum,n)=>sum+n,0):undefined)
const totalFacilities=computed(()=>props.manifest?props.facilities.reduce((sum,item)=>sum+item.count,0):undefined)
const facilityMax=computed(()=>Math.max(1,...props.facilities.map(item=>item.count)))
const sourceDate=computed(()=>props.manifest?.source_timestamp?.slice(0,10)??'—')
const coordinate=index=>props.manifest?.extent[index]?.toFixed(4)??'—'
const format=n=>Number.isFinite(n)?n.toLocaleString('zh-CN'):'—'
const landGradient=computed(()=>{let sum=0;const items=props.manifest?.landUse??[];return items.length?`conic-gradient(${items.map(item=>{const start=sum;sum+=item.value;return `${item.color} ${start}% ${sum}%`}).join(',')})`:'#24433e'})
</script>
