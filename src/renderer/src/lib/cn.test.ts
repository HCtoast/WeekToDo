import { describe, expect, it } from 'vitest'
import { cn } from '@renderer/lib/cn'

/**
 * cn은 hctoast의 커스텀 유틸리티를 tailwind-merge에 등록해 둔다.
 * 등록이 빠지면 **조용히** 클래스가 사라진다 — 화면이 깨질 뿐 오류는 안 난다.
 * 특히 `text-*`가 위험하다. 타이포(`text-body-sm`)와 색(`text-fg-on-danger`)이
 * 이름만 보면 같은 접두사라, 한 그룹으로 묶이면 뒤엣것만 남고 앞엣것이 버려진다.
 *
 * 실제로 이 조합은 danger 버튼에서 쓰인다 — 색이 버려지면 파스텔 배경 위에
 * 밝은 글자가 얹혀 읽히지 않는다.
 *
 * 실제로 등록을 빼보고 확인한 것:
 * - `font-size` 등록을 빼면 → `text-label-sm`이 색 그룹으로 빨려 들어가
 *   `text-fg-on-danger`를 밀어낸다. **이게 진짜 방어선이다.**
 * - `text-color` 등록을 빼도 지금은 통과한다 (tailwind-merge 기본 색 그룹이 받아준다).
 *   의도를 드러내는 값이라 남겨두지만, 이것만 믿으면 안 된다.
 */
describe('cn — 커스텀 유틸리티 그룹 등록', () => {
  it('타이포와 글자색이 함께 살아남는다', () => {
    // ui/button의 danger + sm 조합에서 그대로 나오는 순서
    const out = cn('bg-danger text-fg-on-danger', 'text-label-sm')
    expect(out).toContain('text-fg-on-danger')
    expect(out).toContain('text-label-sm')
    expect(out).toContain('bg-danger')
  })

  it('타이포끼리는 뒤엣것만 남는다', () => {
    const out = cn('text-body', 'text-body-sm')
    expect(out).toContain('text-body-sm')
    expect(out).not.toMatch(/(^|\s)text-body(\s|$)/)
  })

  it('글자색끼리는 뒤엣것만 남는다', () => {
    const out = cn('text-fg', 'text-danger')
    expect(out).toContain('text-danger')
    expect(out).not.toMatch(/(^|\s)text-fg(\s|$)/)
  })

  it('배경색·테두리색도 각자 그룹이다', () => {
    const out = cn('bg-surface border-border', 'bg-surface-raised border-border-strong')
    expect(out).toContain('bg-surface-raised')
    expect(out).toContain('border-border-strong')
    expect(out).not.toMatch(/(^|\s)bg-surface(\s|$)/)
    expect(out).not.toMatch(/(^|\s)border-border(\s|$)/)
  })

  it('icon-*는 크기 유틸리티와 충돌한다 — 뒤엣것이 이긴다', () => {
    expect(cn('icon-sm', 'size-6')).toBe('size-6')
    expect(cn('size-6', 'icon-sm')).toBe('icon-sm')
  })

  it('변형(variant)이 붙으면 서로 다른 규칙으로 본다', () => {
    // 메뉴 항목: 평소엔 danger 색, 커서가 올라오면 배경이 danger로 뒤집힌다
    const out = cn(
      'data-[highlighted]:bg-action-soft data-[highlighted]:text-fg',
      'text-danger data-[highlighted]:bg-danger data-[highlighted]:text-fg-on-danger',
    )
    expect(out).toContain('text-danger')
    expect(out).toContain('data-[highlighted]:bg-danger')
    expect(out).toContain('data-[highlighted]:text-fg-on-danger')
    expect(out).not.toContain('data-[highlighted]:bg-action-soft')
  })

  it('나중에 준 크기가 기본 크기를 덮는다', () => {
    // 설정 패널이 원본 h-10을 h-7로 줄여 쓰는 방식
    const out = cn('h-10 px-4 text-body', 'h-7 px-2.5 text-body-sm')
    expect(out).toBe('h-7 px-2.5 text-body-sm')
  })
})
