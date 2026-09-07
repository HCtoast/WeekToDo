import { useCallback, useEffect, useState } from 'react'
import type { DateStr } from '@shared/types'
import type { AppSettings } from '@shared/settings-schema'
import type { PlacedBlock } from '@shared/scheduler'
import { toDayOffset } from '@shared/scheduler'
import { useSchedule } from '@renderer/hooks/useSchedule'
import { useClickThroughEscape } from '@renderer/hooks/useClickThroughEscape'
import WidgetChrome from '@renderer/components/WidgetChrome/WidgetChrome'
import WeekGrid from '@renderer/components/WeekGrid/WeekGrid'
import BacklogList from '@renderer/components/BacklogList/BacklogList'
import SelectionBar from '@renderer/components/SelectionBar/SelectionBar'
import SettingsPanel from '@renderer/components/SettingsPanel/SettingsPanel'
import HistoryPanel from '@renderer/components/HistoryPanel/HistoryPanel'
import TodoDetail from '@renderer/components/TodoDetail/TodoDetail'
import GoogleDetail from '@renderer/components/GoogleDetail/GoogleDetail'
import ContextMenu, { type ContextMenuState } from '@renderer/components/ContextMenu/ContextMenu'
import './App.css'

export default function App() {
  const { settings, categories, schedule, error, mutate, mutateStrict, setSetting } = useSchedule()
  const [selection, setSelection] = useState<{ block: PlacedBlock; date: DateStr } | null>(null)
  /** 그리드를 덮는 전체 화면 패널. 동시에 하나만 열린다. */
  const [panel, setPanel] = useState<'settings' | 'history' | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [googleDetailId, setGoogleDetailId] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [now, setNow] = useState(() => new Date())

  // 클릭 통과는 고정 모드에서만 걸린다 (이동 모드에서 통과하면 창을 잡을 수 없다).
  const clickThrough = settings?.clickThrough === true && settings.widgetMode === 'fixed'
  useClickThroughEscape(clickThrough)

  // 트레이의 "설정…" — 위젯을 못 만지는 상태에서의 탈출구.
  useEffect(() => window.api.onOpenSettings(() => setPanel('settings')), [])

  // 현재 시각 선은 분 단위면 충분하다.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  /**
   * 모양·창 설정은 저장만으로는 부족하고 CSS 변수와 실제 창에 적용해야 한다.
   * 창 쪽(setMovable / setIgnoreMouseEvents)은 메인만 할 수 있어 IPC로 넘긴다.
   */
  useEffect(() => {
    if (!settings) return
    // 유리 배경은 OS가 그리고, 여기서는 그 위에 얹는 틴트 농도만 정한다.
    document.documentElement.style.setProperty(
      '--widget-tint',
      `rgb(16 18 26 / ${settings.widgetOpacity}%)`,
    )
    // 창 모드(이동/고정·클릭 통과)와 화면 배율은 메인만 적용할 수 있다.
    void window.api.applyWindowMode()
  }, [settings])

  const select = useCallback((block: PlacedBlock | null, date: DateStr) => {
    setSelection(block ? { block, date } : null)
  }, [])

  /** 크기 모드는 저장과 함께 창 크기·위치도 바꿔야 하므로 메인이 처리한다. */
  const handleSet = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      if (key === 'widgetSizeMode') {
        void window.api.setSizeMode(value as AppSettings['widgetSizeMode'])
        return
      }
      void setSetting(key, value)
    },
    [setSetting],
  )

  // 상세는 id로 들고 있다가 매번 최신 목록에서 찾는다.
  // 객체를 그대로 쥐고 있으면 저장 후 다시 읽어도 화면이 옛 값을 보여준다.
  const detailTodo = schedule?.todos.find((t) => t.id === detailId) ?? null
  const detailGoogle = schedule?.googleEvents.find((e) => e.id === googleDetailId) ?? null
  // 상세에서 시간을 고치려면 그 TODO가 어느 슬롯에 놓여 있는지 알아야 한다.
  const detailSlot =
    schedule?.days
      .flatMap((d) => d.todoSlots.map((s) => ({ ...s, date: d.date })))
      .find((s) => s.meta?.todoId === detailId) ?? null
  const backlog =
    schedule?.backlogIds
      .map((id) => schedule.todos.find((t) => t.id === id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined) ?? []

  if (!settings) {
    return (
      <div className="widget hct">
        {error ? <p className="error">실패: {error}</p> : <p className="loading">불러오는 중…</p>}
      </div>
    )
  }

  const nowOffset = toDayOffset(
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    settings.dayStartHour,
  )

  return (
    <div
      className={[
        // hctoast 토큰의 스코프. 루트에 한 번 세워두면 하위 컴포넌트가 개별로 붙일 필요가 없다.
        // (Portal로 나가는 메뉴·모달만은 예외라 각 ui/* 컴포넌트가 스스로 다시 세운다)
        'widget hct',
        settings.widgetMode === 'move' && 'is-movable',
        clickThrough && 'is-click-through',
        // 유리(acrylic)가 아니면 창 뒤가 그대로 비친다. 편집 패널만 불투명하게 덮기 위한 표식.
        settings.backgroundEffect === 'clear' && 'is-clear-bg',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <WidgetChrome
        settings={settings}
        onSet={handleSet}
        onOpenSettings={() => setPanel((p) => (p === 'settings' ? null : 'settings'))}
        onOpenHistory={() => setPanel((p) => (p === 'history' ? null : 'history'))}
      />

      {error && <p className="error">실패: {error}</p>}

      {panel === 'settings' ? (
        <SettingsPanel settings={settings} onSet={handleSet} onClose={() => setPanel(null)} />
      ) : panel === 'history' ? (
        <HistoryPanel categories={categories} onClose={() => setPanel(null)} />
      ) : detailTodo ? (
        <TodoDetail
          todo={detailTodo}
          slot={
            detailSlot && {
              id: detailSlot.id,
              date: detailSlot.date,
              startTime: detailSlot.startTime,
              endTime: detailSlot.endTime,
            }
          }
          categories={categories}
          now={now}
          mutate={mutate}
          onClose={() => setDetailId(null)}
        />
      ) : detailGoogle ? (
        <GoogleDetail
          event={detailGoogle}
          // 구글 저장 실패는 이 패널 안에서 보여준다 (위젯 구석 배너로는 놓친다).
          mutate={mutateStrict}
          onClose={() => setGoogleDetailId(null)}
        />
      ) : schedule ? (
        <>
          <WeekGrid
            days={schedule.days}
            today={schedule.today}
            dayStartHour={settings.dayStartHour}
            moveUnitMinutes={settings.moveUnitMinutes}
            categories={categories}
            nowOffset={nowOffset}
            selectedId={selection?.block.id ?? null}
            onSelect={select}
            onContextMenu={setMenu}
            mutate={mutate}
          />

          {selection && (
            <SelectionBar
              block={selection.block}
              date={selection.date}
              categories={categories}
              mutate={mutate}
              onOpenDetail={setDetailId}
              onOpenGoogleDetail={setGoogleDetailId}
              onClose={() => setSelection(null)}
            />
          )}

          <BacklogList
            todos={backlog}
            categories={categories}
            now={now}
            mutate={mutate}
            onOpenDetail={(t) => setDetailId(t.id)}
          />
        </>
      ) : (
        <p className="loading">불러오는 중…</p>
      )}

      {menu && (
        <>
          {/* 바깥 클릭·Esc로 닫는 것은 Radix가 한다 — 예전의 전체화면 백드롭은
              z-index가 포털 메뉴보다 높아 메뉴를 덮어버리므로 걷어냈다. */}
          <ContextMenu
            state={menu}
            dayStartHour={settings.dayStartHour}
            moveUnitMinutes={settings.moveUnitMinutes}
            mutate={mutate}
            onOpenDetail={setDetailId}
            onOpenGoogleDetail={setGoogleDetailId}
            onClose={() => setMenu(null)}
          />
        </>
      )}
    </div>
  )
}
