// 트레이/앱 아이콘을 lucide SVG에서 PNG로 굽는다.
//   node resources/gen-icon.mjs
//
// 손으로 픽셀을 찍는 대신 아이콘 세트를 쓰는 이유: 스트로크 두께와 여백이 일관되고,
// 나중에 아이콘을 바꾸고 싶으면 아래 ICON 이름만 갈면 된다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const here = dirname(fileURLToPath(import.meta.url))
const iconsDir = join(here, '../node_modules/lucide-static/icons')

/** 위젯의 정체를 한눈에 — 요일 칸이 있는 달력 + 시각 */
const ICON = 'calendar-clock.svg'

const ACCENT = '#7cb2ff'

/**
 * lucide SVG의 내부 path만 떼어 원하는 색·굵기로 다시 감싼다.
 *
 * 작업표시줄은 밝을 수도 어두울 수도 있다. 흰색 단색은 밝은 배경에서 사라지므로
 * 트레이에는 중간 채도의 파랑을 쓰고, 앱 아이콘에는 둥근 사각 배경을 깐다.
 */
function buildSvg({ stroke, strokeWidth, background }) {
  const raw = readFileSync(join(iconsDir, ICON), 'utf8')
  const inner = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim()

  const plate = background
    ? `<rect x="0" y="0" width="24" height="24" rx="5.5" fill="${background}"/>`
    : ''
  // 배경판이 있으면 아이콘을 조금 줄여 여백을 준다.
  const scale = background ? 0.72 : 0.92

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
${plate}
<g fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"
   stroke-linecap="round" stroke-linejoin="round"
   transform="translate(12 12) scale(${scale}) translate(-12 -12)">
${inner}
</g>
</svg>`
}

function render(svg, size, out) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, png)
  console.log(`${out} — ${size}px, ${png.length} bytes`)
}

// 트레이: 배경 없이 선만. 작게 그려지므로 획을 두껍게 해야 뭉개지지 않는다.
const traySvg = buildSvg({ stroke: ACCENT, strokeWidth: 2.4, background: null })
render(traySvg, 32, join(here, 'tray.png'))
render(traySvg, 64, join(here, 'tray@2x.png'))

// 앱/설치 프로그램: 둥근 사각 배경 위에 밝은 선. 256px는 electron-builder 권장 최소 크기.
const appSvg = buildSvg({ stroke: '#eaf1ff', strokeWidth: 2, background: '#22304a' })
render(appSvg, 256, join(here, 'icon.png'))
