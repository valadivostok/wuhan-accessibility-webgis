<template>
  <DashboardPanel title="武汉实时天气" tag="WEATHER" class="weather-panel" :aria-busy="loading">
    <div class="weather-metrics">
      <div class="weather-current"><span class="weather-label">{{ data?.stale || error && data ? '上次观测温度' : '实况温度' }}</span><div><strong>{{ temperature(data?.live?.temperature) }}</strong><span>°C</span><AppIcon :name="icon" /></div><small>{{ data?.live?.condition || (loading ? '正在加载…' : '实况暂不可用') }}</small></div>
      <div class="weather-daily" :title="data?.today ? `${data.today.date} 日间 ${data.today.dayTemperature}°C / 夜间 ${data.today.nightTemperature}°C` : ''"><span class="weather-label">今日温度范围</span><strong>{{ data?.today ? `${temperature(data.today.low)} – ${temperature(data.today.high)}` : '—' }}<small> °C</small></strong><small>日间 / 夜间预报</small></div>
    </div>
    <div class="weather-update"><span :title="reportedAt">高德 · {{ reportedAt ? `${reportedAt.slice(5,16)} 更新` : '等待天气数据' }}</span><button type="button" @click="refresh" :disabled="loading" aria-label="刷新武汉天气"><AppIcon name="reset" />{{ loading ? '更新中' : '刷新' }}</button></div>
    <p v-if="message" class="weather-message" role="status">{{ message }}</p>
  </DashboardPanel>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import DashboardPanel from './DashboardPanel.vue'
import AppIcon from './AppIcon.vue'

const data=ref(null), loading=ref(false), error=ref('')
let controller, timer
const reportedAt=computed(()=>data.value?.live?.reportedAt||data.value?.today?.reportedAt||'')
const message=computed(()=>error.value||(data.value?.stale?'更新失败，显示缓存观测；请留意更新时间':data.value?.warnings?.map(item=>item.message).join('；'))||'')
const temperature=value=>Number.isFinite(value)?Number.isInteger(value)?String(value):value.toFixed(1):'—'
const icon=computed(()=>{const value=data.value?.live?.condition??'';return /雪/.test(value)?'snow':/雨/.test(value)?'rain':/雾|霾/.test(value)?'fog':/晴/.test(value)?'sun':'cloud'})
async function refresh(){
  if(loading.value)return
  controller=new AbortController();loading.value=true;error.value=''
  try{
    const response=await fetch('/api/weather/wuhan',{signal:controller.signal,cache:'no-store'})
    if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('天气接口尚未启动，请重启本地服务')
    const value=await response.json()
    if(!response.ok)throw new Error(value.error?.message||'天气暂时无法更新')
    data.value=value
  }catch(reason){if(reason.name!=='AbortError')error.value=reason.message}
  finally{loading.value=false}
}
const visible=()=>{if(document.visibilityState==='visible')refresh()}
onMounted(()=>{refresh();timer=setInterval(visible,10*60*1000);document.addEventListener('visibilitychange',visible)})
onUnmounted(()=>{controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible)})
</script>
