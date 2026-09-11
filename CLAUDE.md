# 주간 타임블록 TODO 위젯

서브모니터에 상주하는 Electron 데스크톱 위젯. 요일 컬럼 × 시간축 그리드에 일정과 TODO를 함께 표시하고, Google Calendar와 연동한다.

전체 기획은 [weekly-timeblock-widget-spec.md](weekly-timeblock-widget-spec.md), 단계별 로드맵은 [docs/PLAN.md](docs/PLAN.md).

## 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 셸 | Electron | 프레임리스 + 투명 + always-on-top |
| 빌드 | `electron-vite` | main / preload / renderer 3-타깃 빌드 |
| UI | React + TypeScript | SSR 불필요, 순수 클라이언트 |
| 아이콘 | `lucide-react` (화면) / `lucide-static` + `@resvg/resvg-js` (트레이·앱 아이콘) | 이모지는 컬러로 렌더돼 톤이 깨진다. 아이콘 PNG는 `node resources/gen-icon.mjs`로 굽는다 |
| DB | `better-sqlite3` | **메인 프로세스 전용**. 네이티브 모듈이라 `@electron/rebuild` 필요 |
| 구글 연동 | `@googleapis/calendar` + `google-auth-library` | 전체 `googleapis`는 50MB+라 캘린더만 쓴다. `singleEvents=true`로 반복 전개 |
| 토큰 저장 | `electron-store`(v8, CJS) + `safeStorage` | 평문 저장 금지. **`settings` 테이블에 두지 않는다** — 그건 통째로 렌더러에 내려간다 |
| 자연어 명령 | Anthropic Messages API를 `fetch`로 직접 | 엔드포인트가 하나뿐이라 SDK를 물지 않는다. 키는 `llm-auth.json`에 암호화 저장, 메인 전용 |
| 테스트 | `vitest` | 스케줄 계산 엔진 위주 |

DB 파일: `app.getPath('userData')/app.db`

## 디렉터리 구조

```
src/
  main/              # Electron 메인 프로세스
    index.ts
    window.ts        # 창 생성, 이동/고정 모드, 크기 모드 전환
    db/
      client.ts      # better-sqlite3 연결 + PRAGMA
      migrations/    # 001_init.sql, 002_*.sql ... 순번 고정, 수정 금지
      repositories/  # 테이블별 CRUD
      mutations.ts   # ★ 쓰기의 유일한 입구 (IPC와 채팅 도구가 함께 쓴다)
      schedule-view.ts # ★ 읽기의 유일한 입구
    google/          # OAuth, sync worker
    llm/             # 자연어 명령 — 키 저장, 도구 정의/실행, 도구 루프
    command-window.ts # 위젯 위에 뜨는 명령 입력 창
    jobs/            # 이월 스케줄러, 구글 폴링
    ipc/handlers.ts
  preload/
    index.ts         # contextBridge 노출
    index.d.ts       # window.api 타입 선언
  renderer/
    index.html       # electron-vite의 renderer root
    src/
      main.tsx
      App.tsx
      components/
        WeekGrid/    # 시간 그리드 (메인 영역)
        BacklogList/ # 미배치 TODO 리스트
        WidgetChrome/# 투명 배경, 모드 토글, 리사이즈 핸들
      hooks/ store/ styles/
  shared/
    scheduler/       # ★ 순수 계산 엔진 (main/renderer 공용)
    types.ts         # DB 행 타입
    ipc-contract.ts  # 채널 이름 + 요청/응답 타입
    constants.ts     # 매직 넘버 모음
```

경로 별칭: `@main/*` `@renderer/*` `@shared/*` (`tsconfig.*.json` + `electron.vite.config.ts` + `vitest.config.ts` 세 곳에 모두 등록해야 한다).

## 명령어

| 명령 | 용도 |
|---|---|
| `npm run dev` | 개발 실행 (HMR) |
| `npm run build` | main/preload/renderer 번들 빌드 |
| `npm run preview` | 빌드 결과로 실행 |
| `npm test` | vitest (`src/shared/**/*.test.ts`) |
| `npm run typecheck` | node/web 두 tsconfig 모두 검사 |
| `npm run rebuild` | 네이티브 모듈을 Electron ABI로 재빌드 |
| `npm run dist` | Windows 설치본 빌드 (`dist/weektodo-widget-*-setup.exe`) |

## 알려진 함정

- **`ELECTRON_RUN_AS_NODE`**: VS Code 확장 호스트가 이 변수를 자식 프로세스에 상속시킨다. 남아 있으면 Electron이 평범한 Node로 실행되어 `require('electron')`이 API 객체 대신 **실행 파일 경로 문자열**을 돌려주고, `app.requestSingleInstanceLock()`에서 `Cannot read properties of undefined`로 죽는다. 앱 코드 문제로 오해하기 쉽다. `.vscode/settings.json`에서 제거해두었지만, 외부 터미널에서 같은 증상이 나면 이걸 먼저 의심할 것.
- **네이티브 모듈**: `better-sqlite3`는 Node ABI가 아니라 **Electron ABI**로 빌드돼야 한다. `postinstall`의 `electron-builder install-app-deps`가 처리한다. Electron 버전을 올리면 `npm run rebuild`를 다시 돌릴 것.
- **유리 배경은 `transparent: true` + CSS로 만들 수 없다**: `backdrop-filter`가 흐리는 대상은 "페이지 안에서 그 요소 뒤에 그려진 것"이지 **창 뒤의 바탕화면이 아니다**. 그래서 선명한 벽지 위에 어두운 막만 씌워지고, 위젯이 비어 있는 부분(타이틀바 등)에서 벽지가 그대로 비친다. Windows 11의 `backgroundMaterial: 'acrylic'`을 쓴다 — 컴포지터가 창 뒤를 실제로 흐려준다. 단 `transparent: true`와 함께 쓸 수 없으므로 끄고 `backgroundColor: '#00000000'`을 준다.
- **비활성 창에 타이틀바가 생기는 건 Electron 버그였다**: 프레임리스+투명 창이 포커스를 잃으면 Windows 타이틀바가 나타난다. 우리 CSS·창 옵션 문제가 아니며 `titleBarStyle`·`thickFrame`·제목 비우기로도 안 잡힌다. **Electron 43으로 올려서 해결**했다 ([#46882](https://github.com/electron/electron/issues/46882), PR #47386). 비슷한 증상이 나오면 **CSS를 뜯기 전에 증상 그대로 웹 검색부터 할 것** — 이 건은 원인 추측으로 오래 헤맸고 검색 한 번이면 끝났다.
- **유리(acrylic)는 비활성 창에서 흐림이 꺼진다**: Windows 11의 의도된 동작이라 Electron 옵션으로 못 바꾼다. 항상 유지하려면 `SetWindowCompositionAttribute`(구형 비공개 API)를 쓰는 `electron-acrylic-window`류가 필요한데, 창을 끌 때 렉이 생기는 알려진 부작용이 있다.
- **투명 창은 이전 프레임을 지우지 않는다**: 컴포지터가 새 프레임을 이전 버퍼 **위에** 그리는데 위젯 배경이 반투명이라, 내용이 움직이면 옛 픽셀이 그대로 비쳐 남는다. 창을 옮기거나 배율을 바꾼 뒤 "같은 글자가 크기만 다르게 두 번" 보이고 그 자리가 밝은 띠처럼 뜬 게 이 현상이다. 세 가지를 함께 해야 없어진다.
  1. **`webPreferences.backgroundThrottling: false`** ← 가장 중요. 기본값이면 창이 비활성일 때 Chromium이 렌더링을 늦추거나 멈춰서, 그동안 남아 있던 옛 픽셀이 그대로 드러난다. **포커스가 있을 땐 계속 다시 그려 안 보이므로 "비활성일 때만 생기는" 것처럼 보인다.** 항상 위에 떠 있는 위젯은 대부분 비활성이라 사실상 필수.
  2. `webPreferences.zoomFactor`로 **첫 프레임부터** 올바른 배율로 그린다. 나중에 `setZoomFactor`로 바꾸면 100% 시절 프레임이 남는다. 그래서 배율이 바뀌면 창을 다시 만든다.
  3. 창 제목을 비운다 (`title: ''` + `page-title-updated` 가로채기). 남아 있으면 비활성 캡션에 시스템 글꼴 제목이 그려진다. 화면의 "주간 타임블록"은 HTML이 그리므로 창 제목은 필요 없다.
- **`thickFrame: false`는 OS 리사이즈를 없앤다**: 가장자리 드래그로 크기를 못 바꾸게 되므로, 이동 모드에서 렌더러가 직접 핸들(`ResizeHandles`)을 그려 `window:resizeBy`로 넘긴다.
- **투명 창 문제는 `PrintWindow` 캡처에 안 잡힌다**: 화면에서만 보인다. 유리/투명을 디버깅할 때는 화면 영역을 그대로 뜨는 캡처(`CopyFromScreen`)를 쓸 것. 그리고 **"비활성일 때만 생기는" 증상은 캡처 시점에 창이 정말 비활성인지 반드시 확인할 것** — 포커스가 넘어갔다고 가정하고 찍으면 계속 "고쳐졌다"는 잘못된 결론이 나온다.
- **`setBackgroundMaterial('none')`은 투명이 아니다**: 재질만 빼면 창 배경이 불투명하게 칠해져 검은 판이 된다 (측정: 재질 있을 때 평균 RGB 66,66,93 → 없을 때 30,26,38). 진짜 투명은 `transparent: true`가 필요한데 **생성 시에만** 정할 수 있으므로, 배경 모드를 바꾸려면 창을 다시 만들어야 한다.
- **창에 반영되는 설정은 저장한 쪽에서 적용한다**: 렌더러가 낙관적으로 상태를 바꾼 뒤 `applyWindowMode`를 부르면, 저장이 끝나기 전에 호출이 도착해 메인이 옛 값을 읽는다. `settings:set` 핸들러 안에서 바로 적용할 것.
- **투명/반투명 창의 글자 색 번짐**: 서브픽셀 안티앨리어싱(ClearType)이 배경을 모르는 채로 그려서 획에 파랑·주황 테두리가 낀다. `-webkit-font-smoothing: antialiased`로 회색조를 강제한다.
- **`body` 배경**: 불투명하면 OS 재질과 둥근 모서리가 죽는다. 배경색은 항상 `.widget` 쪽에만 준다.
- **`ready-to-show`가 안 올 수 있다**: `show: false`로 만든 창을 이 이벤트에서만 띄우면, 이벤트가 유실될 때 위젯이 조용히 영영 안 뜬다(트레이 말고는 되살릴 길이 없다). `did-finish-load`에서도 한 번 더 `show()`를 부르는 안전장치를 둔다.
- **`ul`/`ol` 기본 패딩**: `list-style: none`만 주면 글머리 기호는 사라져도 `padding-inline-start: 40px`이 남아 목록 전체가 오른쪽으로 밀린다. 전역에서 `padding: 0`으로 지운다.
- **Windows에는 "항상 맨 아래"가 없다**: Electron에 `alwaysOnBottom`이 없고 Windows에도 그런 창 레벨이 없다. 진짜 최하단은 창을 바탕화면(`WorkerW`)의 자식으로 붙여야 하는데(`electron-as-wallpaper` 류), 그러면 클릭·키보드가 통째로 막혀 체크박스 하나 못 누르는 위젯이 된다. **항상 위(`WS_EX_TOPMOST`)를 끄는 것만으로 목적은 달성된다** — 지금 쓰는 창이 곧 맨 위이므로 다른 앱이 위젯에 가려지지 않는다. 배경화면 앱(Wallpaper Engine)은 `WorkerW`에 그리므로 보통 창인 위젯은 언제나 그 위다.
- **`setIgnoreMouseEvents`는 창 전체에 걸린다**: 영역별 제외가 없으므로, 되돌릴 수단(설정 버튼·설정창)까지 통과시키면 위젯을 영영 못 만지게 된다. `forward: true`로 이동 이벤트만 받아 포인터가 그 영역 위에 있는 동안만 무시를 해제한다 (`useClickThroughEscape`).
- **flex 컨테이너 안의 `position: sticky`**: `align-items`가 기본값(stretch)이면 날짜 열이 스크롤 뷰 높이로 늘어나고, sticky 헤더는 부모 박스를 벗어나지 못해 하루치를 다 스크롤하기 전에 밀려 올라간다. 열이 내용 높이를 갖게 해야 한다.
- **ESM 전용 패키지**: 메인/프리로드는 CJS로 번들되므로 ESM 전용 패키지를 `require`하면 `X is not a constructor`로 죽는다 (`electron-store` v11에서 겪음). CJS 버전을 쓰거나 동적 import 할 것.
- **`google-auth-library` 버전 충돌**: `@googleapis/calendar`가 자체 사본을 물고 있으면 `OAuth2Client` 타입이 서로 안 맞는다(private 필드 때문). 최상위 버전을 `googleapis-common`이 요구하는 것과 맞춰 사본을 하나로 만들 것.
- **시작프로그램 등록은 개발/설치본의 경로가 다르다**: 개발 중에는 `process.execPath`가 `node_modules/electron/dist/electron.exe`라, 앱 경로를 인자로 함께 넘기지 않으면 부팅 때 **빈 Electron 창**이 뜬다. 조회(`getLoginItemSettings`)도 등록할 때와 **같은 path/args**를 줘야 우리 항목을 찾는다.
  - `launchItems[].args`는 **`--`로 시작하는 플래그를 빼고** 돌려준다. `args.includes('--autostart')`로 우리 항목을 찾을 수 없다.
  - `launchItems`는 **지금 실행 파일과 경로가 같은 항목만** 돌려준다. 설치본에서 개발 항목은 아예 안 보이므로 지울 수가 없다.
  - 그래서 만든 항목의 레지스트리 값 이름을 `settings.launchAtLoginItems`에 **기억**해두고 다른 빌드가 그걸 보고 지운다. 자동 실행 여부도 레지스트리가 아니라 `launchAtLoginEnabled`에 저장한다 — 실행 파일이 바뀌면 레지스트리는 "꺼짐"으로 보이는데 사용자가 끈 것으로 오해하면 안 된다.
- **`userData`는 이름에서 파생시키지 않는다**: 기본값이 `app.getName()`에서 나오는데 개발(package.json `name`)과 설치본(`productName`)에서 달라진다. 그대로 두면 패키징하는 순간 DB·구글 토큰·API 키가 다른 폴더를 보게 되어 **데이터가 통째로 사라진 것처럼 보인다.** `app.setPath('userData', …)`로 못 박되 반드시 `whenReady` 전에 한다.
- **네이티브 모듈은 asar 밖으로**: `asarUnpack: ["**/*.node"]`가 없으면 설치본에서 `better-sqlite3`를 못 연다.
- **`dependencies`에 있는 것은 `files`와 무관하게 설치본으로 들어간다**: `files: ["out/**/*"]`은 우리 소스에만 걸리고, electron-builder는 프로덕션 `dependencies`의 `node_modules`를 **따로** 통째로 복사한다. 그래서 렌더러 전용 패키지(`lucide-react`·`radix-ui`·`tailwind-merge` 등)를 `dependencies`에 두면, Vite가 이미 `out/renderer` 번들에 넣었는데 **원본 트리가 한 벌 더** 실린다. 한때 이것만 24MB(4,900 파일)였다. **렌더러가 쓰는 것은 전부 `devDependencies`에 둔다** — `react`/`react-dom`이 원래 그쪽에 있는 것과 같은 이유다. 메인/프리로드는 `externalizeDepsPlugin`으로 번들에서 빠지므로 그쪽이 `import`하는 것만 `dependencies`에 남긴다 (현재 `@googleapis/calendar`·`better-sqlite3`·`electron-store`·`google-auth-library` 넷).
- **`node_modules` 다이어트는 `files`의 `!` 패턴으로만 된다**: `getNodeModuleFileMatcher`가 `files`에서 **`!`로 시작하는 것만 골라** 쓰고 앞에 `**/*`를 붙인다. 그래서 긍정 패턴으로 되살리는 게 불가능하다 — `!.../prebuilds/**` 뒤에 `.../prebuilds/win32-x64.node`를 적어도 안 들어온다. 남길 것 말고 **버릴 것을 하나씩 적어야 한다**. `better-sqlite3`가 특히 크다: `deps/sqlite3.c`(9.5MB) + 쓰지도 않는 7개 플랫폼 prebuild(15MB)가 딸려온다. 런타임이 `lib/binding.js`를 통해 `prebuilds/win32-x64.node` 하나만 찾으므로 나머지는 전부 버려도 된다.
- **`electronLanguages`는 Windows에서도 듣는다**: 기본값이면 `locales/*.pak` 55개가 47MB를 먹는다. `['ko', 'en-US']`로 줄인다. 매칭이 `wanted === lang || wanted.startsWith(lang + '-')`라 파일명과 **정확히** 같게 적어야 한다(`en`이 아니라 `en-US`). 지워진 게 없으면 경고만 찍고 넘어가므로, 빌드 후 `locales/`를 눈으로 확인할 것.
- **`compression: 'maximum'`은 이 앱에서 무의미하다**: 재봤더니 92,915,917 → 92,915,913바이트(4바이트). 설치본 용량은 이미 압축된 Electron 바이너리가 대부분이라 NSIS 설정으로는 안 줄어든다. 줄일 것은 **들어가는 파일 수**뿐이다.
- **파생값을 담은 객체를 화면 상태로 쥐고 있으면 안 된다**: 블록의 시각·제목은 매번 `layoutDay`가 새로 만드는 파생값이다. 선택 바가 클릭 순간의 `PlacedBlock`을 그대로 들고 있으면, 바에서 시각을 바꿔 저장해도 **그리드만 바뀌고 바는 옛 값을 계속 보여준다**. 상세 패널처럼 **id만 들고 매번 최신에서 찾을 것** (`WeekGrid`가 선택된 블록을 새로 계산된 것으로 갈아끼운다).
- **`<input type="time">`으로는 분 단위를 제한할 수 없다**: `step`은 스피너만 제한하고, **Chromium의 네이티브 피커는 step을 무시하고 분을 00·01·02…로 나열한다** (화면으로 확인). 직접 친 값도 격자 밖이면 그대로 통과한다. 그래서 시각 입력은 전부 `TimeField`(시/분 `<select>` 두 개)로 그린다 — 고를 수 있는 값 자체가 격자로 제한된다. 격자 밖 값(구글에서 온 14:07 등)은 목록에 그 값을 끼워 넣어 그대로 보여준다.
- **커스텀 속성은 선언한 요소에서 치환된다**: `:root`에 `--a: calc(var(--b) + var(--c))`를 두고 하위 요소에서 `--c`만 덮으면, `--a`는 이미 `:root`의 값으로 굳어 있어 아무 일도 안 일어난다. 계산식은 **값을 덮는 요소와 같은 곳**에 둘 것. (종일 띠 높이가 0이 되어 칩이 통째로 잘려 보이지 않던 원인이었다)
- **날짜 열의 머리 높이는 고정이어야 한다**: `min-height`로 두면 내용이 있는 날만 머리가 커져서 그 열의 본문이 아래로 밀리고 **오늘과 내일의 시간선이 어긋난다**. 그래서 머리 안에는 **길이가 변하는 것을 두지 않는다**.
  - **종일 일정은 날짜 열 밖, 그리드 위의 한 줄(`AllDayBar`)로 뺐다.** 처음에는 머리 안에 두고 "가장 많은 날의 개수 × 한 줄"로 모든 열에 같은 높이를 줬는데, 그러면 종일 일정이 하나만 있어도 **없는 날의 머리까지 함께 늘어난다**. 밖으로 빼면 있을 때만 한 줄이 생기고 없으면 0이다. 대신 어느 열인지가 위치로 안 보이므로 칩에 요일을 적는다.
  - 머리 안에 잠깐 뜨는 입력(빠른 추가)은 자리를 차지하지 않게 absolute로 겹쳐 띄운다.
- **구글 이벤트는 자정을 넘을 수 있다**: `end_time <= start_time`이면 오류가 아니라 **다음 날**이다 (23:00~00:00). 이걸 막으면 밤늦게 시작하는 일정을 영영 못 고친다. 게다가 `dayStartHour` 때문에 논리적 날짜와 달력 날짜가 다르므로(새벽 2시 일정은 논리적으로 "어제"), 구글로 보낼 때는 반드시 달력 날짜로 되돌릴 것.
- **프로젝트가 OneDrive 안에 있다**: `node_modules`가 동기화 대상에 들어가면 빌드 중 파일 잠금이 생길 수 있다. OneDrive 설정에서 이 폴더를 동기화 제외하는 편이 좋다.

## 설계 원칙 (반드시 지킬 것)

### 1. 파생 시각은 저장하지 않는다
`local_events`는 `duration_minutes` + `order_index`만 저장한다. 시작/종료 시각은 **렌더링 시점에** `앵커 + 앞 항목들의 누적 소요시간`으로 계산한다. 절대 시각 컬럼을 추가하고 싶어지면 설계가 틀어진 것이니 먼저 논의할 것.

예외: `todo_time_slots`, `google_event_cache`는 원래부터 절대 시각 기반이다(큐가 아니라 고정 좌표).

### 1-1. 앵커는 모든 날에 반드시 존재한다
"앵커 없는 날"은 없다. 앵커 시각은 항상 다음 순서로 해석된다.

1. `anchors` 테이블에 그 날짜의 행이 있으면 그 값
2. 없으면 `settings.weekdayAnchorTimes[요일]` 에서 **파생** (월 19:00, 화 20:00 … 요일별 설정)

`anchors` 행은 요일 기본값에 대한 **override 기록**이며, 두 경로로 생긴다.

| `source` | 생성 시점 | 덮어쓰기 규칙 |
|---|---|---|
| `autostart` | PC 부팅 → 시작앱으로 자동 실행된 그 순간, 실행 시각을 **30분 단위 올림**해서 기록 (06:40 → 07:00) | 그 날짜에 행이 **하나도 없을 때만** 생성. 이미 있으면 손대지 않음 |
| `manual` | "지금부터" 버튼, 또는 사용자가 앵커를 직접 조정 | 항상 우선. 기존 `autostart` 행이 있으면 갱신하며 `source`를 `manual`로 승격 |

부팅 시각은 **관측된 사실**이지 파생값이 아니므로 저장한다 (원칙 1에 어긋나지 않음). 저장해야 하는 이유: 저장하지 않으면 어제·그제 컬럼의 큐 시각이 요일 기본값으로 다시 계산되어 **과거 기록이 실제와 달라진다**.

구현 주의:
- Windows에는 `wasOpenedAtLogin`이 없다. 로그인 항목 등록 시 `app.setLoginItemSettings({ openAtLogin: true, args: ['--autostart'] })`로 인자를 심고 `process.argv`로 판별한다. 사용자가 손으로 켠 실행은 앵커를 건드리지 않는다.
- 하루에 여러 번 재부팅해도 그날 **첫 실행만** 반영된다 (위 덮어쓰기 규칙에 따라 자동으로 보장).
- 새벽 2시 재부팅은 `dayStartHour` 기준 아직 어제이므로 어제 앵커를 건드리지 않는다 — 반드시 `getLogicalDate`를 거칠 것.

따라서 `local_events`는 `anchor_id`가 아니라 `date`에 매단다 — 날짜당 앵커는 유일하므로 `anchor_id`는 중복 정보다.

### 2. 스케줄 계산은 순수 함수로 격리한다
`src/shared/scheduler/`는 DB·IPC·React를 import하지 않는다. 입력(앵커 + 로컬 큐 + 구글 이벤트 + 설정) → 출력(배치된 블록 배열)인 순수 함수만 둔다. 이 레이어는 UI보다 먼저 테스트로 고정한다.

### 3. 구글 이벤트는 고정 장애물
밀림의 방향은 항상 한쪽이다.
- 구글 이벤트는 **자동으로 밀리지 않는다**. 로컬 큐만 비켜간다.
- 구글끼리의 겹침은 **개입하지 않는다** (Google Calendar와 동일하게 나란히 렌더).
- TODO 슬롯은 밀림 로직에서 **완전히 제외**한다. 겹침 허용.

사용자가 **직접** 하는 것은 예외다 — 홀드 후 드래그, 상세 편집, 빈 칸 우클릭의 "구글에 일정 만들기",
그리고 두 번 확인하는 삭제. 자동 판단(밀림·이월·자연어 명령)은 절대 구글을 건드리지 않는다.

새 일정의 알림은 **캘린더 기본값을 따르지 않고**(`reminders.useDefault: false`) 설정값만 넣는다
(기본 팝업 10분 전). **이메일 알림은 절대 넣지 않는다** — 위젯에서 툭툭 만드는 일정이 전부
메일로 오면 메일함이 잠긴다.

**구글 삭제는 이 앱의 유일한 되돌릴 수 없는 조작이다.** 우클릭 메뉴에서 두 번 눌러야 나가고,
자동 판단은 이 길로 오지 않는다.

### 3-1. 구글 쓰기는 캐시를 손대지 않는다
PATCH가 성공하면 **동기화를 다시 돌려** 구글이 실제로 저장한 값을 받아온다. 로컬에서 추측해
캐시에 써넣으면 시간대 보정·반복 인스턴스 처리 때문에 다음 동기화에 조용히 뒤집힌다.
실패하면 캐시가 그대로이므로 화면이 다시 읽는 순간 원래 자리로 돌아간다 — **되돌리기 코드가 따로 없다.**

### 4. TODO는 자동 완료되지 않는다
시간이 지나도 `completed`를 건드리지 않는다. 지난 항목은 시각적으로만 흐리게/"지남" 뱃지. 완료는 사용자의 명시적 체크로만.

### 5. 날짜는 항상 논리적 날짜
`new Date().getDate()` 직접 사용 금지. 모든 날짜 판단은 `getLogicalDate(now, dayStartHour)`를 거친다. 기본 `dayStartHour = 6`이므로 새벽 3시는 "어제"다.

### 6. 데이터는 삭제하지 않는다
`include_in_history`는 표시 필터일 뿐 저장 여부가 아니다. 완료된 TODO도 보존한다.

## 기획서 대비 확정 변경점

기획서(`weekly-timeblock-widget-spec.md`)는 초기 설계 문서라, 아래 항목은 이후 논의로 확정된 내용이 우선한다.

| 항목 | 기획서 | 확정 |
|---|---|---|
| 앵커 존재 | 없는 날이 있을 수 있음 | **항상 존재**. 요일별 기본값에서 파생, `anchors` 행은 override |
| 앵커 기본값 | `settings.fixedAnchorTime` 단일값 | `settings.weekdayAnchorTimes` — 요일별 7개 (`{"mon":"19:00", …}`) |
| 앵커 자동 설정 | 없음 | 시작앱 자동 실행 시각을 30분 올림해 `source='autostart'` 행 생성 |
| 앵커 입력 단위 | 명시 없음 | 손으로 지정할 때는 **30분 단위**(00/30)로 스냅 |
| 시각 입력 단위 | 명시 없음 | TODO 슬롯·구글 일정·마감은 **10분 단위**. 화면에 1분 단위 입력은 없다 |
| 드래그 이동 단위 | 15/30/60분 | **10~50분** 중 선택 (기본 30) |
| 위젯 위치 저장 | `{x,y,width,height}` 하나 | **위치는 하나, 크기는 모드별로.** 크기 모드를 바꿔도 좌상단은 고정 |
| 배경 | `widgetOpacity` + `widgetBlurRadius` | `backgroundEffect`(유리/그대로 비침) + `widgetOpacity`(틴트). 흐림은 OS가 그리므로 `widgetBlurRadius`는 폐기 |
| 창 층 | 항상 위 고정 | `windowLayer` — 기본은 **`desktop`**(바탕화면 위·앱 아래). `top`도 설정에서 고를 수 있다 |
| `anchors.source` | `'manual' \| 'fixed'` | `'manual' \| 'autostart'` (`fixed`는 행 없이 파생되므로 저장 안 함) |
| `local_events` 소속 | `anchor_id NOT NULL` | `anchor_id` 제거, `date TEXT NOT NULL` |
| TODO 이월 위치 | "다음 날 큐의 맨 앞" | **다음 날 앵커 시각에 붙임** (duration 유지, 여러 개면 앵커부터 순차) |
| 로컬 이벤트 완료 | 없음 | `categories.completable = 1`인 카테고리만 체크박스 노출 (기본: 과제만) |
| 작은 위젯 범위 | 모호 | **오늘 + 내일 고정**. `weekStartMode`는 큰 위젯에만 적용 |
| 구글 캐시 upsert | 명시 없음 | `ON CONFLICT DO UPDATE`로 구글 필드만 갱신, `is_held`·`created_at_original`은 보존 |

## 코드 컨벤션

- 시각은 문자열 `'HH:MM'`, 날짜는 `'YYYY-MM-DD'`, 타임스탬프는 ISO 문자열로 통일한다. Date 객체를 DB에 넣지 않는다.
- **시각 구간 편집은 막지 않고 밀어준다** (`adjustRangeStart` / `adjustRangeEnd`). 길이가 0 이하로 뒤집힐 때만 반대쪽을 길이만큼 민다 — 15:00~16:00에서 시작을 16:00으로 올리면 16:00~17:00. 뒤집히지 않는 변경(시작을 당기거나 종료를 늘리는 것)은 반대쪽을 건드리지 않는다. 이미 자정을 넘는 구간은 같은 날 앞뒤 비교가 통하지 않으므로 길이가 정확히 0이 될 때만 민다.
- **구글 상세만 저장 버튼을 쓴다.** 로컬 편집은 즉시 저장이지만, 구글은 한 번이 네트워크 왕복 + 재동기화라 칸마다 보내면 느리고 중간 상태(날짜만 먼저 바뀐 일정)가 그대로 찍힌다.
- **ISO 타임스탬프를 잘라서 화면에 쓰지 않는다.** `toISOString()`은 UTC라 `slice(11,16)`으로 뽑으면 한국에서 9시간 어긋난다. 반드시 `new Date(iso)`를 거쳐 로컬 시각으로 변환한다.
- 색상은 HSL 문자열로 저장하고, lightness 교차(인접 동일 카테고리 ±8%p)와 왼쪽 띠 색(`accentColor`)은 **렌더링 시점 파생**으로만 적용한다. 파생 색을 DB에 저장하지 않는다.
- **모든 블록은 왼쪽에 색 띠를 갖는다.** 구글에만 있으면 나란히 놓았을 때 로컬·TODO가 허전해 보인다. 배경은 검은 글자를 받치느라 밝은 쪽으로 몰려 카테고리끼리 비슷해 보이는데, 띠는 어둡고 진해서 hue 차이가 바로 드러난다. **달력 아이콘은 구글에만** 붙인다 — 출처가 다르다는 표시는 하나면 된다.
- 렌더러에서 `fs`/`better-sqlite3`/`googleapis`를 직접 부르지 않는다. 전부 preload가 노출한 IPC를 통한다.
- 마이그레이션 파일은 한 번 커밋되면 수정하지 않고 새 번호를 추가한다.
- 매직 넘버(색상 임계 시간, 백오프 간격, 배칭 상한 등)는 `shared/constants.ts`에 모은다.

## 자연어 명령 (LLM)

미배치 TODO 머리의 ✨ 버튼(손으로 넣는 `+` 바로 왼쪽) → **위젯 위에 뜨는 작은 입력 창**에 한 줄을 친다. 기획서에서는 스코프 밖이었으나 앞당겨 구현했다.

- **대화가 아니다** (기획서의 "input-only, 되묻기 없음"). 답변 말풍선도 결과 로그도 없고, 피드백은 위젯이 실제로 바뀌는 것으로 준다. 시스템 프롬프트도 "애매하면 되묻기"가 아니라 **"애매해도 가장 그럴듯한 해석으로 즉시 실행"** 으로 지시한다.
  - 예외는 **아무 일도 일어나지 않았을 때뿐**이다. 그때만 이유를 한 줄 띄운다 — 안 그러면 사용자는 먹통으로 오해한다.
- **대화 기록을 남기지 않는다.** 매 호출이 독립이고, 맥락은 그때그때 새로 만든 일정 스냅샷이 전부다. 보이지 않는 기록을 들고 있으면 화면에 없는 맥락 때문에 결과가 달라지는 이유를 알 수 없다.
- 입력은 **별도 창**(`?view=command`)이다. 위젯 안 드롭다운으로 그리면 백로그가 맨 아래 스크롤 영역이라 잘리거나 목록을 가린다. 렌더러는 번들 하나를 공유하고 `main.tsx`가 쿼리로 어느 쪽을 그릴지 고른다. 창은 카드 전체가 드래그 영역(`-webkit-app-region: drag`, 입력칸만 `no-drag`)이고 위치는 `settings.commandPosition`에 남는다.
- 키는 `설정 > 명령 입력`에서 넣는다. **입력창에 붙여넣지 않는다.** `safeStorage`로 암호화해 `llm-auth.json`에 저장하고 렌더러에는 "있는지"와 꼬리 4자만 내려간다.
- 시스템 프롬프트에는 매 호출마다 **현재 일정 스냅샷**을 새로 넣는다. 스냅샷의 시각은 화면과 같은 `layoutDay`로 계산하고 저장하지 않는다 (원칙 1).
- **구글 캘린더는 명령으로도 읽기만 한다.** 원칙 3의 연장 — 구글 이벤트는 고정 장애물이지 우리가 쓰는 대상이 아니다. 바꾸는 것은 로컬 큐와 TODO뿐이다.
- **삭제 도구는 일부러 없다** (원칙 6). 되돌릴 수 있는 것만 준다 — 완료 체크, 배치 해제, 시간 이동. 삭제 도구를 넣게 되면 반드시 실행 전 확인 UI를 함께 붙일 것.
- 도구를 추가할 때는 `src/main/llm/tools.ts`의 `TOOLS`(스키마)와 `runTool`(실행) 두 곳을 함께 고친다. 모델이 만든 인자는 사용자 입력과 같은 급으로 검증한다 — 형식이 어긋나면 던지고, 그 메시지가 도구 결과로 돌아가 모델이 스스로 고친다.
- **기본 모델은 Haiku 4.5**(`claude-haiku-4-5-20251001`). 하는 일이 "한 줄 → 도구 호출"이라 추론이 거의 없고, 치고 바로 닫는 흐름이라 지연이 곧 손해다. 모델 id의 날짜는 **출시 스냅샷**이지 만료일이 아니다.
- **명령으로 만든 항목의 카테고리는 모델이 고른다.** 스냅샷에 카테고리 목록이 들어가고, 프롬프트가 "새로 만드는 것에는 반드시 골라 넣으라"고 지시한다. 기획서의 `ai_classification_queue`(손으로 만든 TODO를 백그라운드에서 분류)와는 다른 것이며 그쪽은 여전히 스코프 밖이다.
- **"오늘/내일"을 모델에게 계산시키지 않는다.** 스냅샷의 날짜마다 `relative`(어제·오늘·내일…)를 붙여 보낸다(`relativeDayLabel`). 벽시계로 더하게 두면 새벽에 하루씩 밀린다 — 8월 6일 02시는 논리적으로 아직 8월 5일이라 그때의 "내일"은 8월 7일이 아니라 **8월 6일**이다.
- **`create_event`는 시작 시각을 저장할 수 없다.** "8시에"를 듣고 이걸 부르면 엉뚱한 시간에 놓인다. 프롬프트 맨 앞에 "무엇으로 만들지 고르는 법" 표를 둔 이유다 — 시각을 말했으면 `create_todo` + startTime/endTime, 시각 없이 그날 할 일이면 `create_event`, 언제 할지 안 정했으면 시간 없는 `create_todo`.
- 명령이 DB를 바꿨으면 `settings:changed`를 **위젯 창으로** 보낸다. `e.sender`로 보내면 명령 창 자신이 받고 위젯은 낡은 채로 남는다.

## 스코프 밖 (이번 버전 제외)

알림 · 모바일/클라우드 동기화 · **카테고리 백그라운드 자동 분류**(`ai_classification_queue`).

손으로(`+` 버튼, 우클릭 메뉴) 만든 TODO는 카테고리를 직접 고른다(기본 "기타"). 만들자마자 큐에 넣고 배칭·백오프로 나중에 채워 넣는 워커는 구현하지 않았다.
단, **명령 입력으로 만든 것은 그 자리에서 모델이 카테고리를 고른다** — 이미 모델을 부르는 김에 정하므로 큐가 필요 없다.
