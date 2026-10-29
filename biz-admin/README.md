# biz-admin — ✨ PB 트렌드 허브 (프로토타입)

PB팀 트렌드 큐레이션(트렌드 허브) 프로토타입입니다. 유행하는 상품을 모아 보고, 영감을 받고, 소재를 발굴하는 우리 팀의 공간이에요.

> **이 폴더는 실제 biz-admin이 아닙니다.** 실제 biz-admin은 Bitbucket [`backpackr/business-operation-admin`](https://bitbucket.org/backpackr/business-operation-admin/src/master/) 저장소의 Next.js 앱이며, 사내 서버 `/DATA/docker/biz-admin/`에 배포됩니다. 이 폴더는 그 안의 **트렌드 HUB** 메뉴에 넣기 전, 기능과 화면을 먼저 확인하기 위한 독립 실행형 프로토타입입니다.

## 실제 biz-admin과의 관계

| 구분 | 실제 biz-admin | 이 프로토타입 |
|---|---|---|
| 저장소 | Bitbucket `business-operation-admin` | GitHub `idus-blenzkim/dev`의 `biz-admin/` |
| 스택 | Next.js 16 / React 19 / TypeScript / Tailwind CSS 4 | Express + SQLite + Vanilla JS |
| 개발 서버 | https://biz-admin.develop.10x10aws.net | 로컬 http://localhost:3000 |
| 배포 | 사내 서버에서 `pull → plan → up → status` | Docker Compose 또는 로컬 실행 |

실제 biz-admin에는 이미 **트렌드 HUB** 메뉴가 있고, 정희정님이 만든 **트렌드 → 브랜드 모니터링 → 브랜드 트렌드**(`/brand-trend`)가 들어가 있습니다. 해당 화면의 현재 상태와 UI/UX 개선 방향은 [`docs/BRAND-TREND-UIUX-HANDOFF-2026-10-28.md`](docs/BRAND-TREND-UIUX-HANDOFF-2026-10-28.md)에 정리돼 있습니다.

이 프로토타입의 기능을 실제 biz-admin으로 옮길 때는 같은 트렌드 HUB 아래 메뉴로 붙이고, 인수인계 문서 4~5절의 기준(범위 명확화, 미확인과 0건 구분, 텐텐 스타일 유지)을 따릅니다.

## 주요 기능

- **🔥 트렌드 피드** — 팀원들이 발견한 유행 상품/소재를 카드 형태로 모아 봅니다. 카테고리·태그·검색 필터와 최신순/관심 많은 순 정렬을 지원합니다.
- **🏆 자랑 게시판** — 좋은 소재나 공급처를 발굴했을 때 팀에 자랑하는 공간입니다.
- **🤍 관심있어요** — 마음에 드는 상품에 관심을 표현하고, 누가 관심을 눌렀는지 확인할 수 있습니다.
- **💬 댓글** — 각 포스트에 의견을 나눌 수 있습니다.
- **🌐 사이트 디렉토리** — 유저별로 즐겨 보는 트렌드 사이트를 등록하고, 팀 전체가 공유하는 디렉토리로 모아 봅니다.
- **👤 간편 로그인** — 닉네임만 입력하면 바로 시작할 수 있습니다 (사내용 간편 인증).

## 실행 방법

Node.js 22.5 이상이 필요합니다 (내장 SQLite 사용).

```bash
cd biz-admin
npm install
npm start
```

브라우저에서 http://localhost:3000 접속 → 닉네임 입력 → 시작!

개발 중에는 자동 재시작 모드를 사용할 수 있습니다:

```bash
npm run dev
```

### Docker로 실행 (팀 공유 서버 배포용)

```bash
cd biz-admin
docker compose up -d --build
```

http://서버주소:3000 으로 접속합니다. SQLite 데이터는 `biz-admin-data` 볼륨에 보존되어 컨테이너를 재시작해도 유지됩니다.

## 데모 미리보기

`demo/index.html`은 서버 없이 브라우저에서 바로 열어볼 수 있는 체험용 데모입니다 (데이터는 브라우저 localStorage에만 저장). 실제 기능 확인은 위의 서버 실행 방식을 사용하세요.

## 기술 구성

| 구분 | 스택 |
|---|---|
| 서버 | Node.js + Express |
| DB | SQLite (`node:sqlite` 내장 모듈, 별도 설치 불필요) |
| 프론트엔드 | Vanilla JS SPA (빌드 과정 없음) |

데이터는 `data/trend-hub.db` 파일에 저장됩니다 (git에서 제외됨). 최초 실행 시 샘플 트렌드 포스트와 추천 사이트가 자동으로 채워집니다.

## API 요약

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/login` | 닉네임 로그인 (없으면 자동 생성) |
| GET | `/api/posts` | 피드 조회 (`sort`, `category`, `q`, `type`, `author=me`) |
| POST | `/api/posts` | 트렌드/자랑 포스트 작성 |
| POST | `/api/posts/:id/interest` | 관심있어요 토글 |
| GET/POST | `/api/posts/:id/comments` | 댓글 조회/작성 |
| GET | `/api/sites` | 사이트 디렉토리 (`scope=all\|mine`) |
| POST | `/api/sites` | 사이트 등록 |
