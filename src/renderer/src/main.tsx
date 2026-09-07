import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@renderer/App'
import CommandInput from '@renderer/components/CommandInput/CommandInput'
/* hctoast(디자인 토큰·유틸리티)를 먼저, global.css를 나중에.
   global.css의 body 규칙은 레이어 밖이라 Tailwind의 @layer base보다 항상 우선한다 —
   유리 배경(body { background: transparent })이 덮이지 않는다. */
import '@renderer/styles/hctoast.css'
import '@renderer/styles/global.css'

/**
 * 렌더러 진입점 두 가지가 같은 번들을 쓴다.
 *
 * 명령 입력은 위젯 위에 뜨는 별도 창이라 `?view=command`로 어느 쪽을 그릴지 고른다.
 * html을 따로 두지 않는 이유: 전역 스타일·preload 타입·빌드 설정을 한 벌로 유지하기 위함.
 */
const view = new URLSearchParams(location.search).get('view')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{view === 'command' ? <CommandInput /> : <App />}</StrictMode>,
)
