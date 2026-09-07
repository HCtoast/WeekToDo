-- ── 카테고리 색을 HCToast 카테고리 팔레트로 통일 ────────────────────────────
--
-- 왜:
-- 1) 채도가 너무 높았다. 이 위젯은 유리 배경 위에 얹히는 "배경형 도구"인데
--    블록 색이 s 52~78%로 진해서 화면 앞으로 튀어나왔다. 정작 읽어야 할
--    제목·시간보다 색이 먼저 보인다. 구분은 hue가 하고 채도는 낮춘다.
-- 2) 001의 시드 색 6개 중 5개가 BLOCK_MIN_LIGHTNESS(58%)보다 어두웠다.
--    그래서 저장된 색과 실제로 그려지는 색이 달랐다 —
--    ensureReadableBackground()가 렌더링 때마다 조용히 밝혀주고 있었다.
--    밝기를 66%로 통일해 "저장된 값 = 보이는 값"으로 맞춘다.
-- 3) 색 정의가 이 SQL에만 있어서 다른 프로젝트와 공유되지 않았다.
--    이제 shared/category-palette.ts(HCToast 레지스트리 `category-palette`)가
--    기준이고, 이 마이그레이션은 그 값을 DB에 반영하는 역할만 한다.
--
-- hue 계열은 유지했다 (빨강→로즈, 초록→청록, 파랑→파랑, …).
-- 노랑·주황(쇼핑)만 채도를 몇 %p 높게 뒀다 — 같은 채도값에서 더 흐리게 보여서.
--
-- 사용자가 이미 색을 바꾼 카테고리는 건드리지 않는다 —
-- base_color가 001의 시드 값 그대로일 때만 갱신한다.

UPDATE categories SET base_color = 'hsl(352 38% 66%)'
  WHERE id = 'cat-assignment' AND base_color = 'hsl(356 68% 56%)';

UPDATE categories SET base_color = 'hsl(168 34% 66%)'
  WHERE id = 'cat-daily'      AND base_color = 'hsl(145 52% 46%)';

UPDATE categories SET base_color = 'hsl(212 40% 66%)'
  WHERE id = 'cat-dev'        AND base_color = 'hsl(212 70% 55%)';

UPDATE categories SET base_color = 'hsl(268 34% 66%)'
  WHERE id = 'cat-leisure'    AND base_color = 'hsl(275 55% 62%)';

UPDATE categories SET base_color = 'hsl(36 44% 66%)'
  WHERE id = 'cat-shopping'   AND base_color = 'hsl(32 78% 54%)';

UPDATE categories SET base_color = 'hsl(220 8% 66%)'
  WHERE id = 'cat-etc'        AND base_color = 'hsl(220 10% 55%)';
