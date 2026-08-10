const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- 인증 ----------

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.nickname FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?
  `).get(token) || null;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  req.user = user;
  next();
}

app.post('/api/login', (req, res) => {
  const nickname = String(req.body.nickname || '').trim();
  if (!nickname || nickname.length > 20) {
    return res.status(400).json({ error: '닉네임은 1~20자로 입력해 주세요.' });
  }
  let user = db.prepare('SELECT id, nickname FROM users WHERE nickname = ?').get(nickname);
  if (!user) {
    const id = db.prepare('INSERT INTO users (nickname) VALUES (?)').run(nickname).lastInsertRowid;
    user = { id, nickname };
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
  res.setHeader('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}`);
  res.json({ user });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req).session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ user: currentUser(req) });
});

// ---------- 포스트 (트렌드 발견 / 자랑) ----------

function postWithMeta(row, userId) {
  const interested = db.prepare(`
    SELECT u.nickname FROM interests i JOIN users u ON u.id = i.user_id
    WHERE i.post_id = ? ORDER BY i.created_at
  `).all(row.id).map((r) => r.nickname);
  const commentCount = db.prepare('SELECT COUNT(*) AS n FROM comments WHERE post_id = ?').get(row.id).n;
  return {
    ...row,
    tags: row.tags ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    interest_count: interested.length,
    interested_users: interested,
    my_interest: userId ? interested.length > 0 && !!db.prepare(
      'SELECT 1 FROM interests WHERE post_id = ? AND user_id = ?'
    ).get(row.id, userId) : false,
    comment_count: commentCount,
  };
}

app.get('/api/posts', (req, res) => {
  const user = currentUser(req);
  const { sort = 'latest', category, q, type, author, country, ip } = req.query;

  const where = [];
  const params = [];
  if (category && category !== '전체') { where.push('p.category = ?'); params.push(category); }
  if (country && country !== '전체') { where.push('p.country = ?'); params.push(country); }
  if (ip) { where.push('p.ip_name = ?'); params.push(ip); }
  if (type) { where.push('p.post_type = ?'); params.push(type); }
  if (author === 'me' && user) { where.push('p.user_id = ?'); params.push(user.id); }
  if (q) {
    where.push('(p.title LIKE ? OR p.tags LIKE ? OR p.memo LIKE ? OR p.source_site LIKE ? OR p.ip_name LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }

  const orderBy = sort === 'popular'
    ? '(SELECT COUNT(*) FROM interests i WHERE i.post_id = p.id) DESC, p.created_at DESC'
    : 'p.created_at DESC';

  const rows = db.prepare(`
    SELECT p.*, u.nickname AS author
    FROM posts p JOIN users u ON u.id = p.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${orderBy}
    LIMIT 200
  `).all(...params);

  res.json({ posts: rows.map((r) => postWithMeta(r, user?.id)) });
});

app.post('/api/posts', requireAuth, (req, res) => {
  const { title, url, image_url, price, source_site, category, country, ip_name, tags, memo, post_type } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: '상품/소재 이름을 입력해 주세요.' });
  const type = post_type === 'brag' ? 'brag' : 'trend';
  const tagStr = Array.isArray(tags) ? tags.join(',') : String(tags || '');
  const id = db.prepare(`
    INSERT INTO posts (user_id, post_type, title, url, image_url, price, source_site, category, country, ip_name, tags, memo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id, type, String(title).trim(), String(url || ''), String(image_url || ''),
    String(price || ''), String(source_site || ''), String(category || '기타'),
    String(country || '한국'), String(ip_name || '').trim(), tagStr, String(memo || '')
  ).lastInsertRowid;
  const row = db.prepare('SELECT p.*, u.nickname AS author FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?').get(id);
  res.status(201).json({ post: postWithMeta(row, req.user.id) });
});

app.delete('/api/posts/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '포스트를 찾을 수 없습니다.' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: '본인 포스트만 삭제할 수 있습니다.' });
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 관심있어요 토글
app.post('/api/posts/:id/interest', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '포스트를 찾을 수 없습니다.' });
  const existing = db.prepare('SELECT 1 FROM interests WHERE post_id = ? AND user_id = ?').get(post.id, req.user.id);
  if (existing) {
    db.prepare('DELETE FROM interests WHERE post_id = ? AND user_id = ?').run(post.id, req.user.id);
  } else {
    db.prepare('INSERT INTO interests (post_id, user_id) VALUES (?, ?)').run(post.id, req.user.id);
  }
  const row = db.prepare('SELECT p.*, u.nickname AS author FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?').get(post.id);
  res.json({ post: postWithMeta(row, req.user.id) });
});

// ---------- 댓글 ----------

app.get('/api/posts/:id/comments', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.body, c.created_at, u.nickname AS author, c.user_id
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.post_id = ? ORDER BY c.created_at
  `).all(req.params.id);
  res.json({ comments: rows });
});

app.post('/api/posts/:id/comments', requireAuth, (req, res) => {
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: '댓글 내용을 입력해 주세요.' });
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '포스트를 찾을 수 없습니다.' });
  const id = db.prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)').run(post.id, req.user.id, body).lastInsertRowid;
  const row = db.prepare(`
    SELECT c.id, c.body, c.created_at, u.nickname AS author, c.user_id
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?
  `).get(id);
  res.status(201).json({ comment: row });
});

// ---------- 사이트 디렉토리 ----------

app.get('/api/sites', (req, res) => {
  const user = currentUser(req);
  const { scope = 'all' } = req.query;
  let rows;
  if (scope === 'mine') {
    if (!user) return res.json({ sites: [] });
    rows = db.prepare(`
      SELECT s.*, u.nickname AS owner FROM sites s JOIN users u ON u.id = s.user_id
      WHERE s.user_id = ? ORDER BY s.created_at DESC
    `).all(user.id);
  } else {
    rows = db.prepare(`
      SELECT s.*, u.nickname AS owner FROM sites s JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC
    `).all();
  }
  res.json({ sites: rows.map((s) => ({ ...s, mine: user ? s.user_id === user.id : false })) });
});

app.post('/api/sites', requireAuth, (req, res) => {
  const { name, url, description, category, country, daily_check } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: '사이트 이름을 입력해 주세요.' });
  let siteUrl = String(url || '').trim();
  if (!siteUrl) return res.status(400).json({ error: '사이트 주소(URL)를 입력해 주세요.' });
  if (!/^https?:\/\//i.test(siteUrl)) siteUrl = 'https://' + siteUrl;
  const id = db.prepare(
    'INSERT INTO sites (user_id, name, url, description, category, country, daily_check) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    req.user.id, String(name).trim(), siteUrl, String(description || ''),
    String(category || '기타'), String(country || '한국'), daily_check ? 1 : 0
  ).lastInsertRowid;
  const row = db.prepare('SELECT s.*, u.nickname AS owner FROM sites s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(id);
  res.status(201).json({ site: { ...row, mine: true } });
});

app.delete('/api/sites/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT user_id FROM sites WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '사이트를 찾을 수 없습니다.' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: '본인이 등록한 사이트만 삭제할 수 있습니다.' });
  db.prepare('DELETE FROM sites WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 데일리 체크 ----------

// 매일 봐야 하는 사이트를 오늘 확인했는지 토글 (유저별/일별)
app.post('/api/sites/:id/check', requireAuth, (req, res) => {
  const site = db.prepare('SELECT id FROM sites WHERE id = ?').get(req.params.id);
  if (!site) return res.status(404).json({ error: '사이트를 찾을 수 없습니다.' });
  const today = new Date().toISOString().slice(0, 10);
  const existing = db.prepare(
    'SELECT 1 FROM site_checks WHERE site_id = ? AND user_id = ? AND check_date = ?'
  ).get(site.id, req.user.id, today);
  if (existing) {
    db.prepare('DELETE FROM site_checks WHERE site_id = ? AND user_id = ? AND check_date = ?')
      .run(site.id, req.user.id, today);
  } else {
    db.prepare('INSERT INTO site_checks (site_id, user_id, check_date) VALUES (?, ?, ?)')
      .run(site.id, req.user.id, today);
  }
  res.json({ checked: !existing });
});

// ---------- 대시보드 ----------

app.get('/api/dashboard', (req, res) => {
  const user = currentUser(req);
  const today = new Date().toISOString().slice(0, 10);

  // KPI
  const kpis = {
    posts_week: db.prepare("SELECT COUNT(*) AS n FROM posts WHERE created_at >= datetime('now', '-7 days')").get().n,
    interests_total: db.prepare('SELECT COUNT(*) AS n FROM interests').get().n,
    members: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    sites: db.prepare('SELECT COUNT(*) AS n FROM sites').get().n,
  };

  // 오늘의 데일리 체크 (daily_check 사이트 + 내 오늘 체크 상태)
  const dailySites = db.prepare(`
    SELECT s.id, s.name, s.url, s.description, s.country,
           CASE WHEN c.site_id IS NOT NULL THEN 1 ELSE 0 END AS checked
    FROM sites s
    LEFT JOIN site_checks c
      ON c.site_id = s.id AND c.user_id = ? AND c.check_date = ?
    WHERE s.daily_check = 1
    ORDER BY checked, s.country, s.name
  `).all(user ? user.id : -1, today);

  // 최근 2주 인기 태그
  const recent = db.prepare(
    "SELECT tags FROM posts WHERE created_at >= datetime('now', '-14 days') AND tags != ''"
  ).all();
  const tagCount = {};
  for (const r of recent) {
    for (const t of r.tags.split(',').map((x) => x.trim()).filter(Boolean)) {
      tagCount[t] = (tagCount[t] || 0) + 1;
    }
  }
  const hotTags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1]).slice(0, 14)
    .map(([tag, count]) => ({ tag, count }));

  // 관심 급상승 TOP 5
  const topPosts = db.prepare(`
    SELECT p.id, p.title, p.category, p.country, p.ip_name, p.price, p.url, p.post_type,
           u.nickname AS author,
           (SELECT COUNT(*) FROM interests i WHERE i.post_id = p.id) AS interest_count
    FROM posts p JOIN users u ON u.id = p.user_id
    ORDER BY interest_count DESC, p.created_at DESC
    LIMIT 5
  `).all();

  // IP별 인기 상품 (관심 수 기준 상위 IP + 각 IP 대표 상품)
  const ipRows = db.prepare(`
    SELECT p.ip_name,
           COUNT(*) AS post_count,
           SUM((SELECT COUNT(*) FROM interests i WHERE i.post_id = p.id)) AS interest_sum
    FROM posts p
    WHERE p.ip_name != ''
    GROUP BY p.ip_name
    ORDER BY interest_sum DESC, post_count DESC
    LIMIT 8
  `).all();
  const byIp = ipRows.map((row) => ({
    ...row,
    top_posts: db.prepare(`
      SELECT p.id, p.title, p.price, p.country, p.url,
             (SELECT COUNT(*) FROM interests i WHERE i.post_id = p.id) AS interest_count
      FROM posts p WHERE p.ip_name = ?
      ORDER BY interest_count DESC, p.created_at DESC
      LIMIT 3
    `).all(row.ip_name),
  }));

  // 국가별 최근 트렌드
  const countryRows = db.prepare(`
    SELECT country, COUNT(*) AS post_count FROM posts GROUP BY country ORDER BY post_count DESC
  `).all();
  const byCountry = countryRows.map((row) => ({
    ...row,
    recent_posts: db.prepare(`
      SELECT p.id, p.title, p.category, p.ip_name, p.price,
             (SELECT COUNT(*) FROM interests i WHERE i.post_id = p.id) AS interest_count
      FROM posts p WHERE p.country = ?
      ORDER BY p.created_at DESC
      LIMIT 5
    `).all(row.country),
  }));

  res.json({ kpis, dailySites, hotTags, topPosts, byIp, byCountry });
});

app.listen(PORT, () => {
  console.log(`PB 트렌드 허브가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
