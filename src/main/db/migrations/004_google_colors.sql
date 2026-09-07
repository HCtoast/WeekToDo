-- ── 구글 일정의 색을 캐시에 담는다 ──────────────────────────────────────────
--
-- 왜:
-- 예전에는 구글 블록이 CSS에 박힌 고정 파랑이었다. 그 파랑이 'cat-dev'(개발·자기계발)와
-- 거의 같은 색이라 나란히 놓으면 출처를 구분할 수 없었다. 무채색으로 바꿨더니 이번에는
-- 구글 캘린더에서 색으로 나눠 둔 구분(파란 회사 일정 / 노란 개인 일정)이 통째로 사라졌다.
--
-- 그래서 색을 가져오되 **hue만 살리고 채도는 눌러서** 쓴다 (shared/google-colors.ts).
-- 규칙: 색이 진하면 내 것(옮길 수 있다), 흐리면 외부에서 온 것(읽기 전용).
--
-- 두 칸인 이유: 구글은 일정 하나하나에 색을 칠할 수도 있고(color_id) 칠하지 않으면
-- 캘린더 기본색을 따른다(calendar_color). 우선순위는 color_id → calendar_color → 무채색.
--
-- 둘 다 NULL 허용이다 — 색을 안 쓰는 캘린더도 있고, 이 컬럼이 생기기 전에 동기화된
-- 행은 다음 동기화 때까지 비어 있다. 그때는 예전처럼 무채색으로 그려진다.

ALTER TABLE google_event_cache ADD COLUMN color_id TEXT NULL;
ALTER TABLE google_event_cache ADD COLUMN calendar_color TEXT NULL;
