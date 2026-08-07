import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  parseSetting,
  resolveSettings,
  serializeSetting,
} from '@shared/settings-schema'

describe('parseSetting', () => {
  it('행이 없으면 기본값을 돌려준다', () => {
    expect(parseSetting('dayStartHour', null)).toBe(6)
    expect(parseSetting('weekStartMode', null)).toBe('yesterday')
  })

  it('정상 JSON은 그대로 읽는다', () => {
    expect(parseSetting('dayStartHour', '4')).toBe(4)
    expect(parseSetting('weekStartMode', '"monday"')).toBe('monday')
    expect(parseSetting('autoAnchorOnLaunch', 'false')).toBe(false)
  })

  it('깨진 JSON은 기본값으로 되돌린다', () => {
    expect(parseSetting('dayStartHour', '{{{')).toBe(6)
  })

  // DB는 사용자가 직접 고칠 수도 있고 구버전 값이 남을 수도 있으므로 신뢰하지 않는다.
  it('범위를 벗어나거나 타입이 다른 값은 기본값으로 되돌린다', () => {
    expect(parseSetting('dayStartHour', '24')).toBe(6)
    expect(parseSetting('dayStartHour', '-1')).toBe(6)
    expect(parseSetting('dayStartHour', '"6"')).toBe(6)
    expect(parseSetting('moveUnitMinutes', '45')).toBe(30)
    expect(parseSetting('weekStartMode', '"friday"')).toBe('yesterday')
  })

  it('요일 앵커는 7개 요일이 모두 유효해야 통과한다', () => {
    const full = JSON.stringify({
      mon: '19:00',
      tue: '20:00',
      wed: '19:00',
      thu: '19:00',
      fri: '18:30',
      sat: '13:00',
      sun: '13:00',
    })
    expect(parseSetting('weekdayAnchorTimes', full).tue).toBe('20:00')

    // 하나라도 빠지거나 형식이 틀리면 통째로 기본값
    expect(parseSetting('weekdayAnchorTimes', '{"mon":"19:00"}')).toEqual(
      DEFAULT_SETTINGS.weekdayAnchorTimes,
    )
    expect(parseSetting('weekdayAnchorTimes', JSON.stringify({ ...JSON.parse(full), mon: '25:00' })))
      .toEqual(DEFAULT_SETTINGS.weekdayAnchorTimes)
    expect(parseSetting('weekdayAnchorTimes', JSON.stringify({ ...JSON.parse(full), mon: '9:00' })))
      .toEqual(DEFAULT_SETTINGS.weekdayAnchorTimes)
  })

  // 위치는 하나만 — 크기 모드를 바꿔도 좌상단은 그대로여야 한다.
  it('widgetPosition은 x, y만 받는다', () => {
    expect(parseSetting('widgetPosition', '{"x":300,"y":200}')).toEqual({ x: 300, y: 200 })
    expect(parseSetting('widgetPosition', 'null')).toBeNull()
    expect(parseSetting('widgetPosition', '{"x":300}')).toBeNull()
  })

  // 크기 모드별로 위치까지 저장하던 예전 값이 DB에 남아 있어도 앱이 깨지면 안 된다.
  it('예전 형식을 만나도 쓸 수 있는 값만 살린다', () => {
    // 옛 단일 형식은 x, y가 있으니 그대로 통과시킨다 (남는 width/height는 쓰지 않는다).
    expect(parseSetting('widgetPosition', '{"x":0,"y":0,"width":460,"height":640}')).toMatchObject({
      x: 0,
      y: 0,
    })
    // 크기 모드별 형식에는 x, y가 없으므로 "위치 없음"으로 떨어진다.
    expect(
      parseSetting('widgetPosition', '{"small":{"x":0,"y":0,"width":1,"height":1},"large":null}'),
    ).toBeNull()
  })

  it('widgetSize는 크기 모드별로 width/height를 받는다', () => {
    const sizes = '{"small":{"width":460,"height":640},"large":null}'
    expect(parseSetting('widgetSize', sizes).small).toEqual({ width: 460, height: 640 })
    expect(parseSetting('widgetSize', '{"small":{"width":460},"large":null}')).toEqual(
      DEFAULT_SETTINGS.widgetSize,
    )
  })

  // 창 크기는 그대로인데 내용만 커지므로 범위를 좁게 잡는다.
  it('uiScale은 100~150 사이의 5 단위만 받는다', () => {
    expect(parseSetting('uiScale', '125')).toBe(125)
    expect(parseSetting('uiScale', '150')).toBe(150)
    expect(parseSetting('uiScale', '170')).toBe(100)
    expect(parseSetting('uiScale', '90')).toBe(100)
    expect(parseSetting('uiScale', '123')).toBe(100)
  })
})

describe('serializeSetting', () => {
  it('왕복해도 값이 보존된다', () => {
    expect(parseSetting('moveUnitMinutes', serializeSetting('moveUnitMinutes', 20))).toBe(20)
  })

  // 이동 단위를 10~50분으로 바꾸기 전의 값(15/60)이 DB에 남아 있을 수 있다.
  it('없어진 이동 단위는 기본값으로 되돌아간다', () => {
    expect(parseSetting('moveUnitMinutes', '15')).toBe(DEFAULT_SETTINGS.moveUnitMinutes)
    expect(parseSetting('moveUnitMinutes', '60')).toBe(DEFAULT_SETTINGS.moveUnitMinutes)
    expect(parseSetting('moveUnitMinutes', '40')).toBe(40)
  })

  // 잘못된 값은 저장 시점에 막는다. 나중에 조용히 기본값으로 되돌아가면 원인을 찾기 어렵다.
  it('유효하지 않은 값은 저장을 거부한다', () => {
    expect(() => serializeSetting('dayStartHour', 99)).toThrow()
  })
})

describe('resolveSettings', () => {
  it('override 행만 기본값 위에 얹는다', () => {
    const s = resolveSettings([
      { key: 'dayStartHour', value: '4' },
      { key: 'widgetOpacity', value: '60' },
    ])
    expect(s.dayStartHour).toBe(4)
    expect(s.widgetOpacity).toBe(60)
    expect(s.weekStartMode).toBe('yesterday')
    expect(s.moveUnitMinutes).toBe(30)
  })

  it('모르는 키는 무시한다', () => {
    const s = resolveSettings([{ key: 'fixedAnchorTime', value: '"19:00"' }])
    expect(s).toEqual(DEFAULT_SETTINGS)
  })
})
