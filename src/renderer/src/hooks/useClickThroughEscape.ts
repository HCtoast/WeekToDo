import { useEffect } from 'react'

/** 클릭 통과 중에도 마우스를 받아야 하는 요소에 붙이는 표식 */
export const ESCAPE_ATTR = 'data-escape-clickthrough'

/**
 * 클릭 통과가 켜진 동안 "통과를 되돌릴 수 있는 영역"만 살려둔다.
 *
 * `setIgnoreMouseEvents`는 창 전체에 걸리므로 영역별로 뺄 수가 없다.
 * 대신 `forward: true` 덕에 무시 중에도 마우스 이동은 렌더러에 들어오므로,
 * 포인터가 탈출 영역 위에 있는 동안만 무시를 잠시 꺼서 클릭이 닿게 한다.
 *
 * 이게 없으면 클릭 통과를 켜는 순간 설정 버튼도 같이 통과되어
 * 위젯 안에서는 되돌릴 방법이 사라진다.
 */
export function useClickThroughEscape(active: boolean): void {
  useEffect(() => {
    if (!active) return

    let interactive = false
    const set = (next: boolean): void => {
      if (next === interactive) return
      interactive = next
      void window.api.setInteractive(next)
    }

    const onMove = (e: MouseEvent): void => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      set(!!el?.closest(`[${ESCAPE_ATTR}]`))
    }
    // 포인터가 창 밖으로 나가면 다시 완전히 통과시킨다.
    const onLeave = (): void => set(false)

    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)

    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      // 클릭 통과가 꺼지는 경우의 창 상태는 applyWindowMode가 다시 잡는다.
      set(false)
    }
  }, [active])
}
