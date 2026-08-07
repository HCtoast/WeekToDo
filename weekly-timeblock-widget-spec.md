# 주간 타임블록 TODO 위젯 — 프로젝트 스펙

## 개요

서브모니터에 항상 띄워두는 데스크톱 위젯. 요일별 컬럼 + 시간축 형태의 주간 타임블록 뷰에 일정과 TODO를 함께 표시한다. Google Calendar와 연동하되, 이벤트마다 "구글 캘린더에 저장" 또는 "로컬에만 저장"을 선택할 수 있다.

평소 일정 작성 스타일 예시:
```
7~8시 밥
8~10 과제
10~11 게임1
11~12 게임2
12~1 웹서핑
```

## 기술 스택

- **Electron + React + Vite** (Next.js 등 SSR 불필요, 순수 클라이언트 앱)
- **로컬 DB: SQLite** (`better-sqlite3`) — 별도 서버/Docker 불필요, 파일 하나로 완결되는 임베디드 DB. `app.getPath('userData')` 경로에 `app.db`로 저장
- **Google Calendar 연동**: `googleapis` 패키지, OAuth2 인증. 토큰은 `electron-store` + Electron `safeStorage`로 암호화 저장
- **로컬 알림/타이머 등 폴링 로직**: 메인 프로세스에서 1분 간격 정도로 충분 (알림 기능 자체는 이번 스코프에서 제외됨, 아래 참고)

## 데이터 모델 (SQLite 스키마)

### `anchors` — 하루의 기준점(트리거)

```sql
CREATE TABLE anchors (
  id            TEXT PRIMARY KEY,       -- uuid
  date          TEXT NOT NULL,          -- 'YYYY-MM-DD', dayStartHour 기준 논리적 날짜
  anchor_time   TEXT NOT NULL,          -- 'HH:MM', 그날 큐가 시작되는 기준 시각
  source        TEXT NOT NULL,          -- 'manual' | 'fixed'
  created_at    TEXT NOT NULL
);
```

- **정확한 시각을 미리 정하기보다, "퇴근 후/하교 후" 같은 트리거 이후의 순서를 대략적으로 정하는 용도**로 쓰기 위한 기준점.
- **manual**: "지금부터" 버튼으로 현재 시각을 그날의 앵커로 설정.
- **fixed**: `settings.fixedAnchorTime`으로 매일 같은 시각 자동 설정 (예: 거의 매일 19시에 퇴근하는 경우).
- 그날 앵커가 아직 없으면 큐(순서)만 보여주고 시각 표시는 비워둠 — 앵커를 찍는 순간 전체 큐의 표시 시각이 계산됨.

### `local_events` — 로컬 전용 항목 (앵커 기준 상대 순서 큐)

```sql
CREATE TABLE local_events (
  id                TEXT PRIMARY KEY,       -- uuid
  anchor_id         TEXT NOT NULL REFERENCES anchors(id),
  title             TEXT NOT NULL,
  duration_minutes  INTEGER NOT NULL,       -- 절대 시각 대신 소요시간
  order_index       INTEGER NOT NULL,       -- 앵커로부터 이어지는 순서
  category_id       TEXT NULL REFERENCES categories(id),
  is_held           INTEGER NOT NULL DEFAULT 0,  -- 홀드 상태(순서/소요시간 변경 가능 모드)
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
```

- **절대 `start_time`/`end_time`을 저장하지 않는다.** 대신 `duration_minutes` + `order_index`만 저장하고, 표시 시각은 항상 `앵커 시각 + 그 앞 항목들의 누적 소요시간`으로 렌더링 시점에 계산한다. (예: 앵커 19:00, 밥 60분 → 19:00~20:00 / 과제 120분 → 20:00~22:00 ...)
- 순서를 드래그로 바꾸면 `order_index`만 갱신 — 절대 시각 재계산이 필요 없어 로직이 단순해짐.
- 소요시간을 늘리거나 줄이면 뒤 항목들의 **표시 시각만** 자동으로 밀리거나 당겨짐 (DB 갱신은 그 항목 하나의 `duration_minutes`뿐, 나머지는 파생 계산).
- `is_held`가 1인 동안만 드래그로 순서/소요시간 변경 가능. 평소엔 고정(실수 방지).
- 구글 캘린더 이벤트(절대 시각 고정)와 겹치는 경우: 큐를 앵커부터 순서대로 누적 계산하다가 구글 이벤트 시작 시각과 만나면, 그 구글 이벤트가 끝나는 시각까지 큐 전체가 밀리고 그 이후로 이어서 계산됨(여전히 "구글 이벤트는 고정 장애물" 원칙 유지, 계산 방식만 상대 오프셋 기반).

### `todos` — TODO 항목

### `categories` — TODO/이벤트 카테고리

```sql
CREATE TABLE categories (
  id            TEXT PRIMARY KEY,       -- uuid
  name          TEXT NOT NULL,          -- '과제', '일상', '개발', '여가', '기타'
  base_color    TEXT NOT NULL,          -- HSL 형태로 저장 권장, 예: 'hsl(210, 70%, 55%)'
  priority      INTEGER NOT NULL,       -- 기본 정렬 힌트로만 사용 (낮을수록 먼저), 강제 규칙 아님
  created_at    TEXT NOT NULL
);
```

- 기본 시드값: 과제(priority 1) / 일상(priority 2) / 개발·자기계발(priority 3) / 여가(priority 4) / 쇼핑(priority 5) / 기타(priority 6).
- **`priority`는 강제 정렬 규칙이 아니라 "기본값을 뭘로 미리 채워둘지"에 대한 힌트로만 쓴다.** 실제 순서는 언제나 유저가 직접 바꿀 수 있고, 한 번 유저가 손으로 순서를 조정하면(`backlog_order` 등에 값이 들어가면) 그 이후로는 카테고리 우선순위보다 유저가 정한 순서가 항상 우선한다.
  - 사용처: 미배치 TODO를 새로 여러 개 만들었거나, "완료된 TODO 정리" 같은 액션으로 리스트를 재배열할 때, 초기 정렬값으로 카테고리 우선순위를 사용해 자동 배치해두고, 이후 유저가 드래그로 자유롭게 재조정.
- 색상을 HSL로 저장하는 이유: hue(카테고리 고유색)는 고정하고 lightness만 상황별로 조절해서 "인접 구분" 렌더링을 쉽게 하기 위함 (아래 UI 섹션 참고).
- `todos.category_color`, `local_events.color`는 문자열 대신 이 테이블의 `id`를 참조하는 `category_id`로 변경 (아래 두 테이블 정의에 반영).

### `todos` — TODO 항목 (카테고리 FK 반영)

```sql
CREATE TABLE todos (
  id                    TEXT PRIMARY KEY,     -- uuid
  title                 TEXT NOT NULL,
  description           TEXT NULL,            -- 세부 설명, 자유 텍스트
  url                   TEXT NULL,            -- 첨부 URL (하이퍼링크로 렌더링, 쇼핑 카테고리면 상품 링크로 사용)
  deadline_type         TEXT NULL,            -- 'absolute' | 'relative' | null(마감 없음)
  deadline_absolute     TEXT NULL,            -- ISO datetime, deadline_type='absolute'일 때 사용
  deadline_relative_days INTEGER NULL,        -- deadline_type='relative'일 때 사용, "생성 후 N일"
  deadline_computed     TEXT NULL,            -- 실제 계산된 절대 마감 시각 (카운트다운은 이 값으로 계산)
  completed             INTEGER NOT NULL DEFAULT 0,
  completed_at          TEXT NULL,            -- 완료 처리된 시각, 히스토리 조회에 사용
  include_in_history    INTEGER NOT NULL DEFAULT 1,  -- 히스토리 뷰에 노출할지 여부
  category_id           TEXT NULL REFERENCES categories(id),
  backlog_order         INTEGER NULL,         -- 미배치 TODO 리스트/완료 목록 정리 시 수동 정렬 순서. null이면 categories.priority로 기본 정렬, 유저가 한 번 드래그하면 값이 채워지며 그 뒤로는 이 값이 항상 우선
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
```

- 마감일 입력은 "특정 날짜/시각 직접 지정(absolute)"과 "생성 후 N일 이내(relative)" 두 방식 모두 지원.
- `deadline_relative_days`로 만든 TODO는 `created_at + N일`을 `deadline_computed`에 정규화해 저장 — 카운트다운 렌더링은 항상 `deadline_computed` 하나만 보면 되도록 함. `deadline_type`/`deadline_relative_days`는 원본 의도 기록용으로 남겨서, 나중에 relative로 만든 항목을 수정할 때 "생성일 기준 N일"이라는 원래 의미를 유지할 수 있게 함.

- 마감 카운트다운(D:H:M)은 저장하지 않고 `deadline`에서 렌더링 시점마다 계산.
- 색상 단계 예시 (설정으로 추후 조정 가능하게 상수 분리 권장):
  - 24시간 이상 남음 → 기본색
  - 6~24시간 → 주황
  - 6시간 미만 → 빨강 + 강조
  - 지남(overdue) → 진한 빨강 + "지남" 표시

### `todo_time_slots` — TODO의 시간대 배치 (별도 테이블로 분리 확정)

```sql
CREATE TABLE todo_time_slots (
  id            TEXT PRIMARY KEY,       -- uuid
  todo_id       TEXT NOT NULL REFERENCES todos(id),
  date          TEXT NOT NULL,
  start_time    TEXT NOT NULL,
  end_time      TEXT NOT NULL
);
```

- **TODO는 같은 시간대에 여러 개 겹치는 것을 허용한다.** 예: 밥/게임을 같은 시간대에 걸어두고, 먼저 끝나는 걸 하고 나머지는 유저가 직접 뒤 시간대로 조정하는 방식.
- 겹침 허용이므로 밀림/충돌 감지 로직 대상에서 TODO는 완전히 제외.
- `todos`와 분리한 이유: TODO 완료 처리(`todos.completed`)와 시간대 배치(`todo_time_slots`)를 독립적으로 관리하기 위함. 추후 "하나의 TODO를 여러 후보 시간대에 걸치기" 같은 확장에도 유리.

### `google_event_cache` — 구글 캘린더 이벤트 로컬 캐시 (읽기 전용 미러)

```sql
CREATE TABLE google_event_cache (
  google_event_id     TEXT PRIMARY KEY,
  calendar_id          TEXT NOT NULL,
  title                TEXT NOT NULL,
  description          TEXT NULL,
  location             TEXT NULL,
  date                 TEXT NOT NULL,
  start_time           TEXT NOT NULL,
  end_time             TEXT NOT NULL,
  is_recurring         INTEGER NOT NULL DEFAULT 0,
  recurrence_rule      TEXT NULL,       -- RRULE 원본, 표시용
  is_held              INTEGER NOT NULL DEFAULT 0,  -- 구글 이벤트도 홀드 이동 가능
  created_at_original  TEXT NULL,       -- 원본 시작시각 백업 (밀림/이동 시 undo 대비)
  last_synced_at       TEXT NOT NULL
);
```

- 구글 캘린더 앱과 동일한 UX로 펼쳐서 조회/수정 가능해야 하므로 `description`, `location` 등 구글 캘린더 표준 필드를 최소한으로 포함.

- 주기적으로(예: 5분마다, 또는 앱 포커스 시) Google Calendar API에서 fetch해서 덮어쓰는 캐시. 로컬에서 직접 수정하지 않음.
- 반복 이벤트는 Google API의 `singleEvents=true` 옵션으로 이미 전개된 인스턴스를 받아오는 방식 권장 (클라이언트에서 RRULE 직접 전개할 필요 없음).
- "구글 캘린더에 저장" 옵션으로 만든 이벤트는 API로 생성 요청 → 응답의 event_id를 이 테이블에 캐싱.
- 구글 이벤트를 홀드해서 옮기면: 로컬 캐시의 시간 먼저 변경 → Google Calendar API `PATCH` 요청 → 성공 시 확정, 실패 시 롤백.

### `settings` — 앱 전역 설정 (key-value)

```sql
CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL          -- JSON 문자열
);
```

주요 키:
| key | 설명 | 기본값 |
|---|---|---|
| `dayStartHour` | 하루의 기준 시각 (0~23) | `6` |
| `weekStartMode` | 주 시작 기준: `"saturday" \| "sunday" \| "monday" \| "today" \| "yesterday"` | `"yesterday"` |
| `moveUnitMinutes` | 일정 이동 단위, 15/30/60 중 선택 | `30` |
| `widgetOpacity` | 위젯 전체 불투명도 (0~100) | `85` |
| `widgetBlurRadius` | 뒷배경 블러 강도 | `12` |
| `widgetPosition` | `{x, y, width, height}` | - |
| `widgetMode` | `"fixed" \| "move"` | `"fixed"` |
| `googleAuthTokens` | OAuth 토큰 (암호화 저장, safeStorage 권장) | - |

## 핵심 동작 로직

### 1. 하루의 기준 시각 (Day Boundary)

- 올빼미형 사용 패턴 고려 — 자정이 아니라 `dayStartHour`(기본 새벽 6시) 기준으로 "오늘"을 판단.
- 모든 날짜 계산은 `getLogicalDate(now, dayStartHour)` 형태의 헬퍼 함수로 통일. 예: 새벽 2시에 작업해도 여전히 "어제"로 표시됨.

### 1-1. 주 시작 기준 (Week Start)

`weekStartMode` 설정으로 두 가지 모드를 지원:
- **요일 고정 모드**: `"saturday" | "sunday" | "monday"` — 매주 해당 요일부터 7일 컬럼 고정.
- **롤링 모드**: `"today" | "yesterday"` (기본값 `"yesterday"`) — 오늘/어제부터 7일을 표시하며, 날짜가 바뀌면 창이 매일 한 칸씩 밀림.
- TODO 중심 위젯이라는 특성상 기본값은 `"yesterday"` — 로그를 놓치지 않고 하루 정도의 버퍼를 두고 보여줌.
- 구현 노트: 롤링 모드는 요일 고정 모드와 달리 "이번 주"라는 고정된 개념이 없고 매일 렌더링 범위 자체가 바뀌므로, 주간 뷰 컴포넌트가 두 모드를 분기 처리해야 함.

### 2. 충돌/밀림 로직

1. `local_events`는 앵커부터 누적 소요시간으로 순서대로 배치되는데, 이 누적 계산 도중 `google_event_cache`의 절대 시각 구간과 겹치면 → 그 지점부터 구글 이벤트 종료 시각까지 **뒤따르는 로컬 큐 전체가 밀려서 이어진다** (구글 이벤트는 절대 밀리지 않는 고정 장애물).
2. 특정 `local_events` 항목의 `duration_minutes`이 늘어나거나 줄어들면 → `order_index` 기준 뒤에 있는 항목들의 **표시 시각만** 자동으로 밀리거나 당겨짐 (DB상 변경은 그 항목 하나뿐, 나머지는 파생 계산이므로 사실상 "도미노"라기보다 순차 누적 재계산에 가까움).
3. 누적 계산 결과가 하루 경계(`dayStartHour` 기준 24시간 슬롯)를 넘어가면 → 그 지점 이후 항목들은 **다음 날 큐로 자동 이월** (앵커는 유지한 채, 넘어가는 항목들만 다음 날짜로 재배정).
4. `is_held = 1`인 로컬/구글 이벤트는 사용자가 드래그로 이동 가능 — `moveUnitMinutes` 단위로 스냅. 이동 후 발생하는 새 충돌은 1~3번 로직 재실행.
5. TODO(`todo_time_slots`)는 이 충돌/밀림 로직에서 완전히 제외 — 겹침 허용.
6. **구글 캘린더 이벤트가 수정(시간 변경)되면** → 캐시(`google_event_cache`) 갱신을 트리거로 삼아 1~3번 로직을 그대로 재실행 — 새로 바뀐 구글 이벤트 시간과 겹치는 로컬 이벤트/TODO 슬롯이 있으면 밀려남. 별도의 새 로직이 아니라 기존 밀림 로직을 "구글 이벤트 변경"이라는 트리거로도 호출하는 것.

### 2-1. 구글 캘린더 이벤트끼리의 충돌 — 겹침 허용

- Google Calendar 이벤트끼리는 자동 밀림 없이 겹침을 그대로 허용한다. Google Calendar 원래 UX와 동일하게, 겹치는 이벤트는 시각적으로 나란히(반쪽씩) 표시.
- 이 앱이 구글-구글 관계에 개입하지 않으므로 우선순위 규칙이나 연쇄 API 호출 문제가 애초에 발생하지 않음 — 구현 단순화.
- 로컬-구글, 로컬-로컬 밀림 로직(위 1~4번)만 자동화 대상으로 유지.

### 3. 마감 카운트다운

- `todos.deadline_computed`가 null이 아니면 위젯에 `00D : 00H : 00M` 형식으로 실시간(분 단위) 표시.
- null이면 카운트다운 자체를 숨김.
- 임박 정도에 따라 색상 변화 (위 색상 단계 참고).

### 4. 반복 일정

- 로컬 반복 일정은 지원하지 않음. 반복이 필요하면 Google Calendar 쪽에 등록 → `google_event_cache`가 자동으로 반영.

### 5. 미완료 TODO 이월

- **TODO는 시간이 지나도 자동으로 완료 처리되지 않는다.** 완료는 항상 사용자의 명시적인 체크로만 이루어진다.
  - 이유: 계획을 세워두고 바로 잠들어 "뭐 하려 했는지" 잊어버리는 경우가 있는데, 자동완료를 쓰면 실제로 안 한 일도 "완료"로 찍혀 다음날 완료 목록을 훑어봐도 착각을 못 걸러낼 위험이 있음. 수동 완료를 기본으로 하면, 안 한 일은 절대 조용히 "완료"로 둔갑하지 않고 계속 TODO로 남아 있음.
  - 대신 예정 시각이 지난 TODO는 완료 처리와 무관하게 **시각적으로만** 흐리게 표시하거나 "지남" 뱃지를 붙여서 알아채기 쉽게 함 (완료 상태를 건드리지 않음).
- 하루 경계(`dayStartHour`)를 넘는 시점에, 그날 `todo_time_slots`에 배치되어 있었지만 `todos.completed = 0`인 항목은 자동으로 다음 날 큐로 이월된다.
- 이월 방식: 해당 `todo_time_slots` 레코드의 `date`를 다음 날로 갱신하고, 새 날짜 큐의 **맨 앞(order 최상단)** 에 배치 — 못 끝낸 일이 눈에 먼저 띄도록 기본값을 그렇게 잡는다. (뒤로 보내고 싶으면 사용자가 드래그로 재배치)
- 이 이월 로직이 사실상 "기억을 대신 들고 있어주는" 역할을 함 — 사용자가 다시 기억해내지 않아도, 앱을 켜면 못 끝낸 일이 자동으로 눈앞에 다시 나타남.
- 시간 미배치 TODO(그리드에 없던 것)는 애초에 날짜 개념이 없으므로 이월 로직 대상이 아님 — 완료 전까지 계속 "미배치 TODO 리스트"에 남아있음.

### 6. 완료 기록 (히스토리)

- `todos.completed_at`을 기준으로 "지난번에 뭐 했는지" 조회하는 히스토리 뷰 제공 (날짜별/기간별 필터).
- **모든 TODO를 히스토리에 남기면 번잡해질 수 있다는 우려를 반영** — `todos.include_in_history` 플래그로 항목별 노출 여부를 조정 가능. 기본값은 `1`(노출)이되, 다음과 같은 방식으로 번잡함을 줄인다:
  - 카테고리별로 기본 제외 여부를 `settings`에 저장 (`historyExcludedCategoryIds`: 예를 들어 "여가" 카테고리를 기본 제외로 설정 가능) — 새 TODO 생성 시 해당 카테고리면 `include_in_history`를 자동으로 `0`으로 초기화.
  - 개별 TODO 단위로도 언제든 토글 가능 (사소해 보여도 기록하고 싶은 특정 항목은 개별적으로 켤 수 있음).
  - 히스토리 뷰 자체도 기본은 접힌 요약(날짜별 완료 개수 등)으로 보여주고, 펼쳐야 상세 목록이 나오는 식으로 정보 밀도 조절.
- 데이터는 삭제하지 않고 전부 보존 — `include_in_history`는 어디까지나 "화면에 보여줄지"를 결정하는 필터일 뿐, 저장 자체는 항상 함(나중에 필요해지면 언제든 다시 노출 가능).

## UI/UX

### 위젯 크기 모드

- **작은 위젯(기본)**: 오늘 + 내일, 2일치만 표시. 서브모니터 구석에 항상 떠있는 미니멀한 상태.
- **큰 위젯(확장)**: 클릭/버튼으로 확장하면 `weekStartMode` 설정에 따라 정해진 일수(기본 7일) 표시.
- 확장/축소는 애니메이션 트랜지션으로 처리하고, 마지막 상태(작은/큰)도 `settings`에 저장해 재시작 시 복원.

### 화면 구성: 캘린더 그리드 vs 상태별 리스트 — 하이브리드 제안

두 방식을 저울질하고 계셨는데, 둘 다 장단점이 뚜렷해서 **하이브리드**를 추천한다.

- **순수 캘린더 그리드만 쓰면**: "밥/과제/게임1..." 식으로 실제 시간에 배치된 항목(로컬 이벤트, 구글 이벤트, 시간대가 지정된 TODO)은 잘 표현되지만, 아직 시간을 안 정한 TODO(백로그성 작업)를 억지로 그리드에 욱여넣어야 해서 지저분해짐.
- **순수 상태별 리스트(todo/in-progress/completed)만 쓰면**: 지금 설계의 핵심인 "시간대별로 무엇을 할지" 감각이 사라짐 — 애초에 Sticky Note 방식이 불편했던 이유(구조 없이 텍스트로만 나열)로 되돌아가는 것과 비슷해짐. "7~8시 밥" 같은 시간 그리드형 사고방식과 안 맞음.
- **하이브리드**:
  - **상단/메인 영역 = 시간 그리드(캘린더 형태)**: `local_events` + `google_event_cache` + **시간대가 지정된 TODO**(`todo_time_slots`에 슬롯이 있는 것)를 블록으로 배치. TODO끼리 같은 시간대에 겹치는 건 허용하므로, Google Calendar가 겹치는 이벤트를 나란히 반쪽씩 보여주는 것과 같은 방식으로 렌더링(밥/게임 동시 배치 시나리오에 맞음).
  - **하단/사이드 영역 = 미배치 TODO 리스트**: `todo_time_slots`에 아무 슬롯도 없는 TODO만 여기 모아서, `completed / in progress / todo` 상태별로 나열. 시간을 아직 안 정한 "일단 적어만 둔" 항목들이 여기 위치.
  - TODO를 미배치 리스트에서 그리드로 드래그하면 `todo_time_slots`에 슬롯이 생기며 그리드로 승격 — 자연스러운 워크플로우.
- 작은 위젯(2일 뷰)에서는 이 두 영역을 세로로 압축해서 보여주고, 큰 위젯(7일 뷰)에서는 그리드 비중을 넓게, 미배치 리스트는 사이드 패널 정도로 배치하는 걸 권장.

### 카테고리 색상 & 인접 구분 렌더링

- `categories.base_color`는 `hsl(hue, saturation%, lightness%)` 형태로 저장 — hue는 카테고리 고유색으로 고정, lightness만 상황에 따라 조절해 세부 구분에 활용.
- **같은 카테고리 블록이 연속으로 인접할 때**: 큐/그리드 상에서 순서상 짝수/홀수 번째마다 `lightness`를 예를 들어 ±8%p 교차시켜 렌더링 (예: "게임1, 게임2"가 연속이면 게임1은 조금 더 진하고 게임2는 조금 더 밝게). 저장값(`base_color`)은 그대로 두고 렌더링 시점에만 파생 적용 — DB에 여러 색을 저장할 필요 없음.
- 모든 블록 사이에는 얇은 구분선(1px, 배경 대비 톤)을 항상 넣어서 색이 비슷해도 경계가 분명히 보이게 함.
- 위 두 규칙(명도 교차 + 구분선)은 함께 적용하는 것을 권장.

- **반투명 배경**: "Me Calendar" 스타일 참고. `widgetOpacity` + `widgetBlurRadius`로 조절 가능한 유리 느낌의 배경. 텍스트는 배경 대비 확보를 위해 약간의 그림자/외곽선 적용 고려.
- **이동모드 / 고정모드 토글**: 우측 상단 등에 작은 토글 버튼(자물쇠 아이콘 등).
  - **이동 모드**: 창 드래그 가능, 리사이즈 핸들 노출.
  - **고정 모드**: 드래그/리사이즈 비활성화. 필요 시 `setIgnoreMouseEvents`로 클릭스루까지 적용해 완전히 배경처럼 동작시킬 수 있음.
  - 마지막 위치/크기/설정은 `settings.widgetPosition` 등에 저장해 재시작 시 복원.
- **일정 홀드**: 로컬/구글 이벤트 모두 홀드 시 드래그로 이동 가능. 이동 단위는 설정에서 15/30/60분 중 선택.
- **구글 캘린더 이벤트 상세 뷰**: 클릭하면 Google Calendar 앱과 동일한 UX로 펼쳐지며(제목/설명/장소 등), 그 안에서 바로 수정 가능. 수정 시 Google Calendar API로 반영 → 캐시 갱신 → 위 밀림 로직 트리거.
- **TODO 상세 툴팁**: TODO 클릭 시 확장된 툴팁으로 세부정보 표시. `description`(자유 텍스트 설명)과 `url`(하이퍼링크로 렌더링되는 첨부 링크)을 이 안에서 보고 편집 가능.
- **앵커 설정 버튼**: "지금부터" 버튼 하나로 그날의 앵커를 현재 시각으로 즉시 설정 (퇴근/하교 후 컴퓨터 켜자마자 누르는 용도). 앵커가 없는 날은 큐만 보이고 시각 표시가 비어있다가, 버튼을 누르는 순간 전체 큐에 시각이 채워짐.

## 카테고리 자동 분류 (AI 보조, 백그라운드)

TODO 생성 시 카테고리를 명시적으로 지정하지 않으면, `title`/`description`을 보고 AI가 자동으로 `category_id`를 채워주는 보조 기능. 위 자연어 인터페이스와 같은 AI 레이어를 재사용하되, 역할이 다르므로 별도로 분리해서 설계한다.

- **비동기 처리**: TODO 생성은 즉시 반영되고(임시로 "기타" 또는 미분류 상태로 표시), 분류 요청은 백그라운드에서 별도로 처리되어 결과가 오면 `category_id`만 조용히 갱신된다. 생성 흐름을 AI 응답 대기로 막지 않는다 — 연속으로 TODO를 빠르게 입력하는 흐름을 방해하지 않기 위함.
- **fallback**: AI가 애매하다고 판단하거나 호출이 실패하면 기본값(`기타`)으로 남긴다.
- **유저 override 항상 가능**: AI가 채운 값은 어디까지나 초기값일 뿐, 카테고리 뱃지를 클릭하면 언제든 수동으로 바꿀 수 있다. 명시적으로 카테고리를 지정하고 생성한 TODO는 애초에 이 자동 분류 대상이 아니다.

### 분류 큐 테이블 (배칭 + 재시도)

저가형/무료 티어 모델은 분당 요청 수 제한(예: 분당 3회)이 걸려있는 경우가 많아, 개별 TODO마다 즉시 API를 호출하지 않고 큐에 쌓았다가 주기적으로 처리한다.

```sql
CREATE TABLE ai_classification_queue (
  id              TEXT PRIMARY KEY,     -- uuid
  todo_id         TEXT NOT NULL REFERENCES todos(id),
  status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'processing' | 'done' | 'failed'
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,        -- 재시도 가능 시각 (백오프 반영)
  created_at      TEXT NOT NULL
);
```

**동작 방식**

1. 카테고리 미지정 TODO가 생성되면 `ai_classification_queue`에 `status='pending'` 레코드를 즉시 추가 (todo 자체는 이미 "기타"로 생성 완료된 상태).
2. 백그라운드 워커가 일정 주기(예: 5~10초)마다 `pending` 상태이면서 `next_attempt_at <= now`인 항목들을 모아 **하나의 요청으로 배칭**해서 보낸다 — 여러 TODO의 제목/설명을 한 번에 넣고, 각각의 카테고리를 배열로 응답받는 프롬프트 구조. 이렇게 하면 TODO 개수와 무관하게 API 호출 자체는 1건으로 처리되어 분당 요청 제한에 유리하다.
3. 요청 성공 시 → 각 `todo_id`의 `category_id` 갱신, 큐 레코드는 `status='done'`으로 마킹(또는 삭제).
4. 요청 실패(레이트리밋, 네트워크 오류 등) 시 → `attempts` 증가, 지수 백오프로 `next_attempt_at` 갱신(예: 1회 실패=10초 뒤, 2회=30초, 3회=60초, 이후 상한 유지). 일정 횟수(예: 5회) 이상 실패하면 `status='failed'`로 마킹하고 해당 TODO는 "기타"로 확정, 더 이상 재시도하지 않음.
5. 워커는 배칭 시 한 번에 처리할 최대 개수(예: 20개)를 상한으로 두어, 큐가 갑자기 많이 쌓여도 요청 하나가 지나치게 커지지 않게 함.

MVP 이후 고도화 후보. 위젯에 작은 채팅 입력창을 추가해, 자연어로 일정/TODO를 조작할 수 있게 하는 기능.

예시 명령:
- "게임1 일정 8시로 옮겨줘"
- "TODO 생성해줘, 대략 저녁 시간대에"
- "이 TODO를 3시로 옮겨줘"
- "7~8시 밥 8~10 과제 10~11 게임1 11~12 게임2 12~1 웹서핑 으로 만들어줘" (한 번에 여러 일정 일괄 생성, 오전/오후는 맥락으로 판단)

### 역할 분리 원칙 (핵심)

**AI는 사용자가 명시한 액션만 수행하고, 그로 인해 파생되는 모든 스케줄링 계산(충돌 감지, 도미노 밀림, 하루 경계 이월 등)은 기존 로직이 그대로 처리한다.** AI가 스케줄링 계산 자체를 하지 않도록 역할을 명확히 나눈다.

- AI의 역할: 자연어 → 구조화된 함수 호출(tool use)로 변환하는 것까지만.
  - `reorder_event(event_id, new_order_index)` — 로컬 큐 순서 변경
  - `resize_event(event_id, new_duration_minutes)` — 로컬 이벤트 소요시간 변경
  - `create_todo(title, deadline?, category_id?)`
  - `create_time_slot(todo_id, date, order_index, duration_minutes)`
  - `create_events_batch([{title, duration_minutes}, ...])` — 일괄 생성용, 순서는 배열 순서 그대로 반영
  - `move_todo_slot(slot_id, new_date, new_order_index)`
  - `resize_todo(todo_id, new_duration_minutes)`
  - `set_anchor(date, anchor_time)` — "지금부터", "저녁 7시부터" 같은 앵커 지정
- 기존 로직의 역할: 위 함수가 호출된 뒤의 충돌 감지 / 도미노 밀림 / 하루 경계 이월 등 실제 스케줄링 계산 전부. (이미 정의된 "충돌/밀림 로직" 섹션과 동일한 코드 경로를 그대로 재사용)

### 예시 시나리오

일정: 게임1(8~10) / 게임2(10~12) / 게임3(12~2)

명령: **"게임1을 1시간 줄이고, 그 뒤에 게임4 1시간 넣어줘"**

이 명령은 두 개의 독립적인 액션으로 분해되어 순차 실행된다:

1. `resize_event(게임1, new_end_time=09:00)` 호출 → 게임1이 8~9로 줄어듦 → 기존 "TODO 시간 줄이면 뒷 일정 당기기" 로직이 동작해 게임2(9~11), 게임3(11~1)로 당겨짐.
2. `create_events_batch([{게임4, 09:00, 10:00}])` 호출 → 9~10 자리에 게임4 생성 시도 → 이미 그 자리엔 당겨진 게임2가 있으므로, 기존 "충돌 시 뒤로 밀기" 도미노 로직이 동작해 게임2(10~12), 게임3(12~2)으로 다시 밀림.

즉 AI는 "무엇을 줄이고 무엇을 새로 넣을지"만 판단하고, 그 결과로 발생하는 당김/밀림 계산은 각 액션이 기존 로직을 그대로 통과하며 자연스럽게 처리된다. AI가 최종 배치 결과를 직접 계산하지 않는다.

### TODO 시간 변경 시 뒷 일정 당기기 로직

**AI가 아니라 일반 로직으로 구현하는 것을 권장.** 이유:
- 결정론적 동작이 사용자 기대와 일치함 (모델 컨디션에 따라 결과가 달라지면 안 되는 영역).
- 이미 만드는 "충돌 시 뒤로 밀기" 도미노 로직의 대칭 버전(줄어들면 당기기)이라 코드 재사용성이 높음.
- AI는 "이 TODO를 N분으로 줄여줘"라는 의도를 `resize_todo(todo_id, new_duration)` 호출로 변환하는 트리거 역할만 담당.

### 채팅 UX: input-only, 되묻기 없음 (fire-and-forget)

**채팅창은 명령 입력만 받고, AI의 응답/확인 질문은 받지 않는다.** 빠르게 명령하고 끝내려는 목적이므로, 애매한 부분이 있어도 AI가 되묻지 않고 스스로 가장 그럴듯한 해석으로 즉시 실행한다.

- 결과가 마음에 안 들면 사용자가 **다시 명령을 치거나, 직접 드래그해서 조정**하는 것으로 해결 — 대화형으로 확인/수정하는 흐름은 만들지 않음.
- 따라서 시스템 프롬프트 설계 시 "애매하면 되묻기"가 아니라 "애매해도 가장 합리적인 기본값으로 바로 실행"하도록 지시해야 함 (예: 오전/오후 불명확 시 `dayStartHour`와 올빼미형 활동 패턴 컨텍스트를 기반으로 스스로 판단).
- UI적으로도 채팅 입력창에 응답 말풍선이나 결과 로그를 띄우지 않음 — 명령을 넣으면 위젯에 실제 반영된 결과(일정이 옮겨지고 밀리는 애니메이션 등)로만 피드백을 준다.

### 모델 선택 관련 메모

- 완전 로컬/무료를 우선하면 Ollama + 소형 모델(Qwen2.5, Llama 3.1 8B 등)도 이 정도의 구조화 추출 작업엔 가능.
- 다만 한국어의 미묘한 시간 표현(예: "낮 12시", "자정 넘어서") 처리 정확도는 저렴한 클라우드 API 티어(Claude Haiku, GPT-4o-mini 등)가 더 안정적일 수 있음. 완전 무료·로컬 우선 vs 정확도 우선은 추후 판단.
- 시스템 프롬프트에 `dayStartHour` 설정값과 "사용자는 올빼미형이라 새벽 활동이 흔함"이라는 컨텍스트를 미리 포함시키면 오전/오후 판단 정확도가 올라감. (위 원칙에 따라 확인 질문 없이 바로 이 컨텍스트로 판단해서 실행)

## 이번 스코프에서 제외 (추후 고도화)

- **알림 기능**: TODO/일정 임박 알림은 이번 버전에서 구현하지 않음.
- **모바일 연동**: 웹으로 접속 가능한 클라우드 동기화는 고도화 단계로 보류. 이번 버전은 완전히 로컬 데스크톱 전용.
- **자연어(AI) 인터페이스**: 위 섹션 전체가 고도화 단계 후보. MVP(핵심 데이터 모델 + 충돌/밀림 로직 + UI)를 먼저 완성한 뒤, 그 위에 얇은 레이어로 얹는 순서를 권장.
- **카테고리 자동 분류**: 자연어 인터페이스와 같은 AI 레이어에 의존하므로 같은 고도화 단계에 묶어서 진행. MVP 단계에서는 카테고리를 수동 지정(기본값 "기타")으로 시작.

## 개발 방식

- 기존 오픈소스(WeekToDo 등)를 fork하지 않고 **새로 구현**하기로 결정.
  - 이유: 데이터 모델(밀림/도미노/하루 기준 재정의/TODO 겹침 허용)이 이미 상당히 커스텀되어 있어 기존 앱 구조 위에 얹기보다 새로 짜는 게 더 빠름. Google Calendar 양방향 연동, 반투명+이동/고정 모드 UI도 대부분의 기존 오픈소스 위클리 플래너에는 없는 요소.
  - WeekToDo의 주간 그리드 드래그 UI 컴포넌트는 참고용으로 코드만 읽어볼 가치 있음.
  - Google Calendar 연동은 오픈소스보다 `googleapis` 공식 quickstart 문서를 기준으로 구현.
