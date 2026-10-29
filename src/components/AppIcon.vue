<template><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-for="(path,i) in (paths[name] || paths.pin)" :key="i" :d="path" /></svg></template>
<script setup>
defineProps({name:String})
const paths={
  sun:['M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z','M12 2v2M12 20v2M2 12h2M20 12h2M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2'],
  cloud:['M7 18a5 5 0 1 1 1-10 6 6 0 0 1 11 2 4 4 0 1 1 0 8H7Z'],
  rain:['M6 15a4 4 0 1 1 1-8 5 5 0 0 1 10 1 4 4 0 1 1 2 7','M7 18l-1 3M13 17l-1 3M19 18l-1 3'],
  snow:['M12 2v20M3 7l18 10M3 17 21 7M9 4l3 3 3-3M9 20l3-3 3 3M4 10l4-1-1-4M20 14l-4 1 1 4M4 14l4 1-1 4M20 10l-4-1 1-4'],
  fog:['M4 5h16M2 10h20M5 15h14M3 20h18'],
  globe:['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z','M3 12h18M5 6h14M5 18h14M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z'],pin:['M19 10c0 6-7 11-7 11S5 16 5 10a7 7 0 0 1 14 0Z','M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],layers:['m12 3 10 6-10 6L2 9l10-6Z','m2 13 10 6 10-6M2 17l10 6 10-6'],target:['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z','M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM12 1v4M12 19v4M1 12h4M19 12h4'],expand:['M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5'],walk:['M15 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z','m7 12 3-4 4 1 3 4h3M12 9l-2 7-4 5M10 16l5 1 1 5'],bike:['M9 17a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM23 17a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z','m5 17 5-9 5 9H5M10 8h6l3 9M15 4h3l1 4M8 5h4'],car:['m4 10 2-6h12l2 6M3 10h18v9H3v-9ZM6 14h2M16 14h2M5 19v2M19 19v2'],train:['M7 3h10a3 3 0 0 1 3 3v12H4V6a3 3 0 0 1 3-3ZM4 11h16M12 3v8M7 15h1M16 15h1M8 18l-3 4M16 18l3 4M7 21h10'],bus:['M5 3h14v16H5V3ZM5 11h14M8 15h1M15 15h1M7 19v3M17 19v3M2 7v5M22 7v5'],building:['M3 21h18M5 21V5l8-2v18M13 9h6v12M8 7v1M8 11v1M8 15v1M16 12v1M16 16v1'],school:['m2 9 10-6 10 6-10 6L2 9ZM5 11v7l7 3 7-3v-7M22 9v8M12 15v6'],hospital:['M4 21V5h16v16H4ZM9 3h6v7H9V3ZM7 6h10M9 21v-6h6v6'],tree:['m12 2-6 8h3l-5 8h16l-5-8h3l-6-8ZM12 18v4'],food:['M5 2v7M2 2v7h6V2M5 9v13M17 22V2c-6 3-6 11 0 11'],navigation:['m12 2 8 19-8-5-8 5 8-19Z'],reset:['M3 11a9 9 0 1 1 2 7M3 4v7h7'],play:['m8 4 13 8-13 8V4Z']}
</script>
