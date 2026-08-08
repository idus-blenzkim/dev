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
  const { sort = 'latest', category, q, type, author } = req.query;

  const where = [];
  const params = [];
  if (category && category !== '전체') { where.push('p.category = ?'); params.push(category); }
  if (type) { where.push('p.post_type = ?'); params.push(type); }
  if (author === 'me' && user) { where.push('p.user_id = ?'); params.push(user.id); }
  if (q) {
    where.push('(p.title LIKE ? OR p.tags LIKE ? OR p.memo LIKE ? OR p.source_site LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
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
  const { title, url, image_url, price, source_site, category, tags, memo, post_type } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: '상품/소재 이름을 입력해 주세요.' });
  const type = post_type === 'brag' ? 'brag' : 'trend';
  const tagStr = Array.isArray(tags) ? tags.join(',') : String(tags || '');
  const id = db.prepare(`
    INSERT INTO posts (user_id, post_type, title, url, image_url, price, source_site, category, tags, memo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id, type, String(title).trim(), String(url || ''), String(image_url || ''),
    String(price || ''), String(source_site || ''), String(category || '기타'), tagStr, String(memo || '')
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
  const { name, url, description, category } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: '사이트 이름을 입력해 주세요.' });
  let siteUrl = String(url || '').trim();
  if (!siteUrl) return res.status(400).json({ error: '사이트 주소(URL)를 입력해 주세요.' });
  if (!/^https?:\/\//i.test(siteUrl)) siteUrl = 'https://' + siteUrl;
  const id = db.prepare(
    'INSERT INTO sites (user_id, name, url, description, category) VALUES (?, ?, ?, ?, ?)'
  ).run(req.user.id, String(name).trim(), siteUrl, String(description || ''), String(category || '기타')).lastInsertRowid;
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

app.listen(PORT, () => {
  console.log(`PB 트렌드 허브가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
