<template><section class="tech-panel data-panel"><header class="panel-heading"><h2><span class="heading-diamond">◈</span>{{ title }}</h2><span v-if="tag" class="panel-tag">{{ tag }}</span></header><div class="panel-body"><slot /></div></section></template>
<script setup>defineProps({title:String,tag:String})</script>
