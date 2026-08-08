const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'trend-hub.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname   TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_type   TEXT NOT NULL DEFAULT 'trend' CHECK (post_type IN ('trend', 'brag')),
    title       TEXT NOT NULL,
    url         TEXT,
    image_url   TEXT,
    price       TEXT,
    source_site TEXT,
    category    TEXT NOT NULL DEFAULT '기타',
    tags        TEXT NOT NULL DEFAULT '',
    memo        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS interests (
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (post_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    url         TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT '기타',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_interests_post ON interests(post_id);
  CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
  CREATE INDEX IF NOT EXISTS idx_sites_user ON sites(user_id);
`);

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
  if (count > 0) return;

  const insertUser = db.prepare('INSERT INTO users (nickname) VALUES (?)');
  const botId = insertUser.run('트렌드봇').lastInsertRowid;

  const insertPost = db.prepare(`
    INSERT INTO posts (user_id, post_type, title, url, image_url, price, source_site, category, tags, memo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const samples = [
    ['trend', '젤리 그립톡 스마트톡', 'https://www.10x10.co.kr', '', '8,900원', '텐바이텐',
      '디지털/테크', '그립톡,젤리,투명', 'SNS에서 투명 젤리 소재 그립톡이 계속 올라옴. 컬러 베리에이션으로 PB 전개 가능해 보여요.'],
    ['trend', '납작 복숭아 모양 인센스 홀더', 'https://ohou.se', '', '15,000원', '오늘의집',
      '리빙/홈데코', '인센스,홈프레그런스,오브제', '홈프레그런스 카테고리가 꾸준히 성장 중. 과일 모티브 오브제형 홀더가 인기.'],
    ['trend', '모루 인형 키링 DIY 키트', 'https://www.idus.com', '', '12,000원', '아이디어스',
      '문구/팬시', '모루인형,키링,DIY', '모루 인형 열풍이 키트 상품으로 확장되는 중. 초보자용 키트 구성 참고.'],
    ['brag', '빈티지 체크 패턴 데스크 매트 소재 발굴!', 'https://www.wadiz.kr', '', '', '와디즈',
      '문구/팬시', '데스크테리어,체크,빈티지', '펀딩 오픈 3일 만에 1,000% 달성한 데스크 매트. 이 체크 패턴 원단 공급처 찾았습니다 👍'],
  ];
  for (const s of samples) insertPost.run(botId, ...s);

  const insertSite = db.prepare(
    'INSERT INTO sites (user_id, name, url, description, category) VALUES (?, ?, ?, ?, ?)'
  );
  const sites = [
    ['와디즈', 'https://www.wadiz.kr', '펀딩 랭킹으로 뜨는 아이템 미리 보기', '펀딩/트렌드'],
    ['텐바이텐', 'https://www.10x10.co.kr', '문구/팬시 베스트 셀러 모니터링', '문구/팬시'],
    ['오늘의집', 'https://ohou.se', '리빙 카테고리 인기 상품, 유저 취향 파악', '리빙/홈데코'],
    ['핀터레스트', 'https://www.pinterest.com', '무드보드, 디자인 레퍼런스 수집', '영감/레퍼런스'],
    ['아이디어스', 'https://www.idus.com', '핸드메이드 트렌드, 실시간 인기 작품', '핸드메이드'],
  ];
  for (const s of sites) insertSite.run(botId, ...s);
}

seed();

module.exports = db;
