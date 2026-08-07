import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@renderer/App'
import CommandInput from '@renderer/components/CommandInput/CommandInput'
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
