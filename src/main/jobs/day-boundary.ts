import { getLogicalDate } from '@shared/scheduler'
import { getAllSettings } from '@main/db/repositories/settings'
import { runRollover } from '@main/jobs/rollover'

/**
 * 논리적 날짜가 바뀌는 순간 이월을 돌린다.
 *
 * `setTimeout`으로 다음 경계까지 한 번에 재우지 않고 1분마다 날짜를 확인한다.
 * 이유: 절전/최대 절전에서 깨어나면 긴 타이머는 밀리거나 한참 뒤에 몰아서 뛴다.
 * 그러면 정작 아침에 컴퓨터를 켰을 때 이월이 안 되어 있다.
 * 폴링 비용은 1분에 한 번 날짜 문자열 비교라 무시할 수 있다.
 */
const CHECK_INTERVAL_MS = 60_000

let timer: NodeJS.Timeout | null = null
let lastSeenDate: string | null = null

export function startDayBoundaryJob(onRollover: () => void): void {
  const settings = getAllSettings()
  lastSeenDate = getLogicalDate(new Date(), settings.dayStartHour)

  timer = setInterval(() => {
    const today = getLogicalDate(new Date(), getAllSettings().dayStartHour)
    if (today === lastSeenDate) return

    lastSeenDate = today
    const result = runRollover()
    // 화면이 어제 날짜를 그리고 있으므로, 옮긴 게 없어도 다시 그려야 한다.
    onRollover()
    if (result.movedSlots > 0 || result.movedEvents > 0) {
      console.log(
        `[이월] ${result.today} — TODO ${result.movedSlots}건, 일정 ${result.movedEvents}건`,
      )
    }
  }, CHECK_INTERVAL_MS)
  timer.unref?.()
}

export function stopDayBoundaryJob(): void {
  if (timer) clearInterval(timer)
  timer = null
}
