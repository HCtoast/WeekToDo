-- 001_init — 초기 스키마
-- 한 번 커밋된 마이그레이션은 수정하지 않는다. 변경이 필요하면 002_*.sql을 추가할 것.
--
-- 규약
--   date        'YYYY-MM-DD' (dayStartHour 기준 논리적 날짜)
--   *_time      'HH:MM'
--   created_at  ISO 8601 문자열
--   boolean     0/1 INTEGER

-- ── 카테고리 ────────────────────────────────────────────────────────────────
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  -- 'hsl(H S% L%)' 정규 형식. hue는 고정하고 lightness만 렌더링 시점에 파생시킨다.
  base_color  TEXT NOT NULL,
  -- 강제 정렬 규칙이 아니라 "새로 만든 항목을 뭘로 미리 채워둘지"에 대한 힌트.
  priority    INTEGER NOT NULL,
  -- 1이면 이 카테고리의 로컬 이벤트에 완료 체크박스를 노출한다.
  completable INTEGER NOT NULL DEFAULT 0 CHECK (completable IN (0, 1)),
  created_at  TEXT NOT NULL
);

-- ── 앵커 ────────────────────────────────────────────────────────────────────
-- 요일 기본값(settings.weekdayAnchorTimes)에 대한 override 기록.
-- 기본값대로인 날은 행을 만들지 않는다 — 행이 없다고 앵커가 없는 것이 아니다.
CREATE TABLE anchors (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL UNIQUE,
  anchor_time TEXT NOT NULL,
  -- autostart: 부팅 후 시작앱으로 자동 실행된 시각(30분 올림)
  -- manual   : "지금부터" 버튼 또는 사용자의 직접 조정. autostart보다 우선한다.
  source      TEXT NOT NULL CHECK (source IN ('manual', 'autostart')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ── 로컬 이벤트 (앵커 기준 상대 순서 큐) ──────────────────────────────────────
-- 절대 시각을 저장하지 않는다. 표시 시각 = 앵커 + 앞 항목들의 누적 소요시간.
CREATE TABLE local_events (
  id               TEXT PRIMARY KEY,
  date             TEXT NOT NULL,
  title            TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  order_index      INTEGER NOT NULL,
  category_id      TEXT NULL REFERENCES categories(id) ON DELETE SET NULL,
  -- 1인 동안만 드래그로 순서/소요시간 변경 가능 (평소엔 고정, 실수 방지)
  is_held          INTEGER NOT NULL DEFAULT 0 CHECK (is_held IN (0, 1)),
  completed        INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  completed_at     TEXT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX idx_local_events_date ON local_events (date, order_index);

-- ── TODO ────────────────────────────────────────────────────────────────────
CREATE TABLE todos (
  id                     TEXT PRIMARY KEY,
  title                  TEXT NOT NULL,
  description            TEXT NULL,
  url                    TEXT NULL,
  -- 원본 의도 기록용. 카운트다운은 항상 deadline_computed 하나만 본다.
  deadline_type          TEXT NULL CHECK (deadline_type IN ('absolute', 'relative')),
  deadline_absolute      TEXT NULL,
  deadline_relative_days INTEGER NULL,
  deadline_computed      TEXT NULL,
  -- 시간이 지나도 자동으로 1이 되지 않는다. 완료는 사용자의 명시적 체크로만.
  completed              INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  completed_at           TEXT NULL,
  -- 히스토리 화면에 노출할지. 저장 자체는 항상 하므로 데이터는 지워지지 않는다.
  include_in_history     INTEGER NOT NULL DEFAULT 1 CHECK (include_in_history IN (0, 1)),
  category_id            TEXT NULL REFERENCES categories(id) ON DELETE SET NULL,
  -- null이면 categories.priority로 정렬. 사용자가 한 번 드래그하면 값이 채워지고
  -- 그 뒤로는 카테고리 우선순위보다 이 값이 항상 우선한다.
  backlog_order          INTEGER NULL,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE INDEX idx_todos_backlog ON todos (completed, backlog_order);
CREATE INDEX idx_todos_history ON todos (completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX idx_todos_deadline ON todos (deadline_computed) WHERE deadline_computed IS NOT NULL;

-- ── TODO 시간대 배치 ────────────────────────────────────────────────────────
-- 겹침을 허용한다. 충돌/밀림 로직의 대상이 아니다.
CREATE TABLE todo_time_slots (
  id         TEXT PRIMARY KEY,
  todo_id    TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL
);

CREATE INDEX idx_todo_slots_date ON todo_time_slots (date);
CREATE INDEX idx_todo_slots_todo ON todo_time_slots (todo_id);

-- ── 구글 캘린더 캐시 (읽기 전용 미러) ────────────────────────────────────────
-- 동기화 때 구글 필드만 덮어쓴다. is_held / created_at_original은 로컬 소유이므로
-- upsert에서 반드시 보존할 것.
CREATE TABLE google_event_cache (
  google_event_id     TEXT PRIMARY KEY,
  calendar_id         TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT NULL,
  location            TEXT NULL,
  date                TEXT NOT NULL,
  start_time          TEXT NOT NULL,
  end_time            TEXT NOT NULL,
  is_recurring        INTEGER NOT NULL DEFAULT 0 CHECK (is_recurring IN (0, 1)),
  recurrence_rule     TEXT NULL,
  is_held             INTEGER NOT NULL DEFAULT 0 CHECK (is_held IN (0, 1)),
  -- 밀림/이동 undo 대비 원본 시작시각 백업
  created_at_original TEXT NULL,
  last_synced_at      TEXT NOT NULL
);

CREATE INDEX idx_google_cache_date ON google_event_cache (date);

-- ── 설정 ────────────────────────────────────────────────────────────────────
-- 기본값에서 벗어난 값만 저장한다. 기본값의 출처는 shared/settings-schema.ts 하나뿐이므로
-- 여기에 시드하지 않는다 (새 키 추가 시 마이그레이션이 필요 없다는 이점도 있다).
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── 시드: 기본 카테고리 ──────────────────────────────────────────────────────
-- 시드 id는 uuid가 아니라 고정 문자열이다. 코드에서 안정적으로 참조하기 위함
-- (예: historyExcludedCategoryIds 기본값, AI 분류 fallback의 '기타').
-- 사용자가 새로 만드는 카테고리는 uuid를 쓴다.
INSERT INTO categories (id, name, base_color, priority, completable, created_at) VALUES
  ('cat-assignment', '과제',        'hsl(356 68% 56%)', 1, 1, '1970-01-01T00:00:00.000Z'),
  ('cat-daily',      '일상',        'hsl(145 52% 46%)', 2, 0, '1970-01-01T00:00:00.000Z'),
  ('cat-dev',        '개발·자기계발', 'hsl(212 70% 55%)', 3, 0, '1970-01-01T00:00:00.000Z'),
  ('cat-leisure',    '여가',        'hsl(275 55% 62%)', 4, 0, '1970-01-01T00:00:00.000Z'),
  ('cat-shopping',   '쇼핑',        'hsl(32 78% 54%)',  5, 0, '1970-01-01T00:00:00.000Z'),
  ('cat-etc',        '기타',        'hsl(220 10% 55%)', 6, 0, '1970-01-01T00:00:00.000Z');
