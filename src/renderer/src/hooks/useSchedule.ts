import { useCallback, useEffect, useState } from 'react'
import type { Mutation, ScheduleData } from '@shared/ipc-contract'
import type { AppSettings } from '@shared/settings-schema'
import type { CategoryRow } from '@shared/types'
import { getSmallWidgetRange, getWeekRange } from '@shared/scheduler'

/**
 * 화면이 쓰는 데이터 전부를 한곳에서 불러오고, 쓰기 후 다시 불러온다.
 *
 * 낙관적 갱신은 드래그 중에만 하고(WeekGrid 내부의 draft),
 * 확정 후에는 반드시 서버 상태를 다시 읽는다 — 밀림 결과는 파생 계산이라
 * 화면에서 추측하면 실제 저장값과 어긋날 수 있다.
 */
export function useSchedule() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [schedule, setSchedule] = useState<ScheduleData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const s = await window.api.getSettings()
      setSettings(s)
      setCategories(await window.api.listCategories())

      // 표시 범위를 정하려면 논리적 오늘이 필요한데 그건 dayStartHour를 아는 메인이 판단한다.
      // 빈 배열로 한 번 물어 today만 받고, 그 기준으로 실제 범위를 다시 불러온다.
      const probe = await window.api.loadSchedule([])
      const dates =
        s.widgetSizeMode === 'small'
          ? getSmallWidgetRange(probe.today)
          : getWeekRange(probe.today, s.weekStartMode)

      setSchedule(await window.api.loadSchedule(dates))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void reload()
    // 트레이 메뉴처럼 창 밖에서 설정이 바뀌면 화면이 낡은 값을 들고 있게 된다.
    return window.api.onSettingsChanged(() => void reload())
  }, [reload])

  /**
   * 설정 변경은 즉시 화면에 반영하고(슬라이더가 끌리는 동안 끊기면 안 된다)
   * 저장은 뒤따라 보낸다. 저장이 실패하면 다시 읽어 되돌린다.
   */
  const setSetting = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((current) => (current ? { ...current, [key]: value } : current))
      try {
        await window.api.setSetting(key, value)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        await reload()
      }
    },
    [reload],
  )

  /**
   * 실패를 그대로 던지는 쓰기.
   *
   * 구글 저장처럼 **네트워크를 타는 조작**은 실패를 위젯 구석의 공용 배너가 아니라
   * 조작한 그 화면에서 바로 보여줘야 한다. 실패해도 로컬 상태는 손대지 않았으므로
   * 되돌리기가 따로 필요 없다 — 다시 읽으면 원래 값이다.
   */
  const mutateStrict = useCallback(
    async (mutation: Mutation) => {
      await window.api.mutate(mutation)
      await reload()
    },
    [reload],
  )

  const mutate = useCallback(
    async (mutation: Mutation) => {
      try {
        await mutateStrict(mutation)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [mutateStrict],
  )

  return { settings, categories, schedule, error, reload, mutate, mutateStrict, setSetting }
}
