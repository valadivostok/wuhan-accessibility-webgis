// Locally authored city illustration for network failures. It is not survey data.
export function createSceneSvg() {
  let seed = 3871
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const buildings = []
  const roofs = ['#83918e', '#a8afaa', '#697b79', '#b0b4a9', '#829391', '#98a29b']
  for (let y = -350; y < 1900; y += 78) {
    for (let x = -400; x < 2800; x += 96) {
      // Leave a central park and a green river corridor through the illustration.
      if ((x > 1040 && x < 1430 && y > 390 && y < 1110) || Math.abs(y - (1280 - x * .23)) < 105) continue
      for (let k = 0; k < 4; k++) {
        const bx = x + 9 + (k % 2) * 40 + random() * 4
        const by = y + 9 + Math.floor(k / 2) * 29 + random() * 3
        const w = 20 + random() * 13, h = 13 + random() * 9, z = 5 + random() * 15
        const roof = roofs[Math.floor(random() * roofs.length)]
        buildings.push(`<path d="M${bx+5} ${by+h+4}h${w+z*.5}v${z*.7}h-${w+z*.5}Z" fill="#071217" opacity=".65"/><path d="M${bx} ${by}v${h}l${z*.5} ${z}v-${h}Z" fill="#394b50"/><path d="M${bx} ${by+h}h${w}l${z*.5} ${z}h-${w}Z" fill="#4e5d5e"/><rect x="${bx}" y="${by-z*.12}" width="${w}" height="${h}" fill="${roof}" stroke="#c2c6b1" stroke-opacity=".3" stroke-width=".6"/><path d="M${bx+3} ${by+3}h${w-6}" stroke="#e4e6d3" stroke-opacity=".3"/>`)
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600" viewBox="0 0 2400 1600"><defs><pattern id="street" width="96" height="78" patternUnits="userSpaceOnUse"><rect width="96" height="78" fill="#37484a"/><rect x="5" y="5" width="85" height="67" fill="#273c39"/><path d="M0 0H96V78" fill="none" stroke="#7b8880" stroke-opacity=".4" stroke-width="2"/></pattern><linearGradient id="water"><stop stop-color="#172c34"/><stop offset=".5" stop-color="#264a4f"/><stop offset="1" stop-color="#142f39"/></linearGradient></defs><rect width="2400" height="1600" fill="#253b40"/><g transform="rotate(-24 1200 800)"><rect x="-700" y="-800" width="4000" height="3300" fill="url(#street)"/><path d="M-400 1400Q650 1130 1150 1020T2900 570" fill="none" stroke="#3a6152" stroke-width="245"/><path d="M-400 1400Q650 1130 1150 1020T2900 570" fill="none" stroke="url(#water)" stroke-width="165"/>${buildings.join('')}<g fill="none"><path d="M-100 310H2700M-100 1200H2700M500 -500V1900M1760 -500V1900" stroke="#33434a" stroke-width="32"/><path d="M-100 310H2700M-100 1200H2700M500 -500V1900M1760 -500V1900" stroke="#9a9b8d" stroke-opacity=".6" stroke-width="22"/><path d="M-100 310H2700M-100 1200H2700M500 -500V1900M1760 -500V1900" stroke="#dbd8b6" stroke-opacity=".35" stroke-width="1.5"/></g><rect x="1050" y="405" width="375" height="695" rx="10" fill="#4a614e" stroke="#919984" stroke-width="12"/><path d="M1237 405V1100M1050 760H1425" stroke="#b8b7a2" stroke-width="17"/><g fill="#839280" stroke="#c1c1a9" stroke-width="2"><rect x="1080" y="450" width="120" height="180"/><rect x="1270" y="450" width="120" height="180"/><rect x="1080" y="820" width="120" height="180"/><rect x="1270" y="820" width="120" height="180"/></g><g fill="#90a092"><rect x="1075" y="680" width="140" height="45"/><rect x="1260" y="680" width="140" height="45"/></g><rect x="1165" y="725" width="150" height="60" fill="#b9b8a4" stroke="#e0dfc7" stroke-width="3"/><g fill="#416650"><circle cx="1140" cy="1040" r="22"/><circle cx="1330" cy="1040" r="22"/><circle cx="1140" cy="650" r="18"/><circle cx="1330" cy="650" r="18"/></g></g><rect width="2400" height="1600" fill="#061c27" opacity=".16"/></svg>`
}
