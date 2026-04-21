# todo_app_01 주요 기능 테스트 리포트

- **대상**: `week5/todo_app_01`
- **테스트 일시**: 2026-04-20
- **테스트 환경**: Node.js + Express + PostgreSQL(Supabase), 로컬 서버 `http://localhost:3050`
- **테스트 도구**: Playwright (Chromium)
- **테스트 계정**
  - 신규 일반 사용자: `tester01@example.com` / `Tester1234!` / 이름 `테스트유저`
  - Super Admin (시드): `rada12@naver.com` / `Skstoa77!@#$`

---

## 0. 사전 준비

```bash
PORT=3050 node server.js
```

- 서버 시작 후 `GET /` → 200 응답 확인
- `pg` Pool로 Supabase에 접속, `todo_app_01_users` / `todo_app_01_todos` 테이블 idempotent 생성
- super admin 계정 시드 확인 로그 출력

---

## 1. 로그인 / 회원가입 화면

| 단계 | 동작 | 결과 |
|---|---|---|
| 1-1 | `http://localhost:3050/` 접속 | 로그인 화면 정상 렌더 |
| 1-2 | "회원가입" 탭 전환 | 이름(선택) 필드 추가 노출 |
| 1-3 | `tester01@example.com` / `Tester1234!` / `테스트유저` 입력 후 "가입하기" | 201 응답, JWT 토큰 localStorage 저장, 메인 화면으로 자동 진입 |

**스크린샷**
- `todo_app_01_01_login_page.png` — 초기 로그인 화면
- `todo_app_01_02_signup_filled.png` — 회원가입 폼 입력 완료
- `todo_app_01_03_main_after_signup.png` — 가입 직후 메인 화면 (Signed in: 테스트유저)

---

## 2. Todo CRUD + 필터

신규 사용자(`tester01@example.com`)로 로그인된 상태에서 진행.

### 2-1. 추가
입력창에 텍스트 입력 + Enter 로 3건 추가:
1. `아침 운동하기`
2. `책 30분 읽기`
3. `장보기`

→ 하단 "남은 할 일 3개" 표시 확인.

### 2-2. 완료 토글
`아침 운동하기` 좌측 체크박스 클릭 → 텍스트에 취소선, 카운트가 "남은 할 일 2개"로 감소.

### 2-3. 필터
| 필터 | 표시되는 항목 |
|---|---|
| 전체 | 3건 모두 (완료 1 + 진행 2) |
| 진행 중 | `책 30분 읽기`, `장보기` (2건) |
| 완료 | `아침 운동하기` (1건, 취소선) |

### 2-4. 개별 삭제
`장보기` 우측 X 버튼 클릭 → 즉시 목록에서 제거. 카운트 "남은 할 일 1개".

### 2-5. 완료 항목 일괄 비우기
"완료 항목 비우기" 버튼 클릭 → 완료된 `아침 운동하기` 제거, 진행 중 항목만 남음. 버튼은 비활성화로 전환.

**스크린샷**
- `todo_app_01_04_three_todos_added.png` — 3건 추가 직후
- `todo_app_01_05_one_completed.png` — 1건 완료 토글
- `todo_app_01_06_filter_active.png` — "진행 중" 필터
- `todo_app_01_07_filter_completed.png` — "완료" 필터
- `todo_app_01_08_after_delete.png` — `장보기` 개별 삭제 후
- `todo_app_01_09_after_clear_completed.png` — 완료 항목 일괄 비우기 후

---

## 3. Super Admin 로그인 / 관리자 패널

### 3-1. 권한별 UI 분기
- 일반 사용자: 우측 상단에 "로그아웃" 버튼만 노출
- Super Admin / Admin: "관리자" 버튼이 추가로 노출 (`#/admin` 라우트)

### 3-2. 사용자 탭
`GET /api/admin/users` 결과로 6명 표시:

| ID | 이메일 | 이름 | 역할 | 할 일 수 |
|---|---|---|---|---|
| 1 | rada12@naver.com | - | 슈퍼관리자 (본인) | 1 |
| 2 | alice@example.com | 앨리스 | 일반 | 4 |
| 3 | bob@example.com | 밥 | 일반 | 3 |
| 4 | charlie@example.com | (한글 깨짐) | 일반 | 0 |
| 5 | e2e@example.com | E2E | 일반 | 0 |
| 6 | tester01@example.com | 테스트유저 | 일반 | 1 |

- 본인 행은 역할 변경/삭제 불가 (백엔드에서 400 차단)
- 다른 행은 역할 콤보박스 + "삭제" 버튼 노출

### 3-3. 할 일 탭
`GET /api/admin/todos` 결과로 9건 표시 (소유자 이메일 포함, 생성 역순). 각 행에 "삭제" 버튼.

**스크린샷**
- `todo_app_01_10_super_admin_logged_in.png` — Super Admin 로그인 직후 메인 (관리자 버튼 노출)
- `todo_app_01_11_admin_users.png` — 사용자 탭 (full page)
- `todo_app_01_12_admin_todos.png` — 할 일 탭 (full page)

---

## 4. 종합 결과

| # | 기능 | 결과 |
|---|---|---|
| 01 | 로그인 페이지 진입 | PASS |
| 02 | 회원가입 폼 입력 | PASS |
| 03 | 가입 후 자동 로그인 → 메인 진입 | PASS |
| 04 | 할 일 추가 (Enter 제출) | PASS |
| 05 | 체크박스 완료 토글 | PASS |
| 06 | "진행 중" 필터 | PASS |
| 07 | "완료" 필터 | PASS |
| 08 | 개별 항목 삭제 | PASS |
| 09 | 완료 항목 일괄 비우기 | PASS |
| 10 | Super Admin 로그인 + 권한 UI 분기 | PASS |
| 11 | 관리자 패널 - 사용자 목록 | PASS |
| 12 | 관리자 패널 - 전체 할 일 목록 | PASS |

**결론**: 인증(회원가입 / JWT 로그인 / 권한 분기), Todo CRUD, 필터, 완료 일괄 삭제, super_admin 관리자 패널까지 모든 주요 기능이 정상 동작.

### 참고 사항
- `charlie@example.com`의 이름이 관리자 패널에서 깨져 표시됨 → seed.js의 인코딩 또는 DB 컬럼 인코딩 확인 권장 (기능 결함은 아님).
- 콘솔 1건의 에러는 React Dev 빌드 + Tailwind CDN 사용에 따른 production warning 계열로 기능 영향 없음.
