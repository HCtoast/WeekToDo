-- 002 — 구글 종일 일정
--
-- 공휴일·예비군처럼 시각이 없는 일정이 흔하다. 이런 항목은 하루를 통째로 차지하므로
-- 시간 그리드에 블록으로 놓을 수 없고, 로컬 큐를 미는 장애물로 취급해서도 안 된다
-- ("종일 예비군"이 있다고 그날 저녁 큐가 사라지면 안 된다).
-- 따로 표시하고 밀림 계산에서는 제외하기 위해 플래그를 둔다.
ALTER TABLE google_event_cache ADD COLUMN is_all_day INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_google_cache_all_day ON google_event_cache (date, is_all_day);
