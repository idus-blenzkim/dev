/* PB 트렌드 허브 프론트엔드 */

const POST_CATEGORIES = ['문구/팬시', '리빙/홈데코', '패션잡화', '뷰티', '푸드', '디지털/테크', '키즈', '반려동물', '기타'];
const COUNTRIES = ['한국', '일본', '미국', '중국', '동남아', '유럽', '글로벌'];
const COUNTRY_FLAG = { '한국': '🇰🇷', '일본': '🇯🇵', '미국': '🇺🇸', '중국': '🇨🇳', '동남아': '🌴', '유럽': '🇪🇺', '글로벌': '🌏' };
const flag = (c) => COUNTRY_FLAG[c] || '🌏';
const SITE_CATEGORIES = ['펀딩/트렌드', '문구/팬시', '리빙/홈데코', '패션잡화', '뷰티', '푸드', '영감/레퍼런스', '핸드메이드', '해외', '기타'];
const CATEGORY_EMOJI = {
  '문구/팬시': '✏️', '리빙/홈데코': '🏠', '패션잡화': '👜', '뷰티': '💄', '푸드': '🍑',
  '디지털/테크': '📱', '키즈': '🧸', '반려동물': '🐶', '기타': '✨',
};

const state = {
  user: null,
  tab: 'dashboard',     // dashboard | feed | brag | sites | mine
  category: '전체',
  country: '전체',
  sort: 'latest',
  q: '',
  siteScope: 'all',
  openComments: new Set(),
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------- API ----------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data;
}

// ---------- 유틸 ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function timeAgo(iso) {
  const then = new Date(iso.replace(' ', 'T') + 'Z');
  const diff = (Date.now() - then.getTime()) / 1000;
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}일 전`;
  return then.toLocaleDateString('ko-KR');
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
}

function safeHttpUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

// ---------- 인증 ----------

async function checkLogin() {
  const { user } = await api('/api/me');
  state.user = user;
  if (user) {
    $('#login-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#me-nickname').textContent = `${user.nickname} 님`;
    render();
  } else {
    $('#app').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
    $('#login-nickname').focus();
  }
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nickname = $('#login-nickname').value.trim();
  if (!nickname) return;
  try {
    await api('/api/login', { method: 'POST', body: { nickname } });
    await checkLogin();
    toast(`환영합니다, ${nickname} 님! 👋`);
  } catch (err) {
    toast(err.message);
  }
});

$('#btn-logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  state.user = null;
  checkLogin();
});

// ---------- 탭 ----------

$$('.tab').forEach((btn) => btn.addEventListener('click', () => {
  state.tab = btn.dataset.tab;
  $$('.tab').forEach((b) => b.classList.toggle('active', b === btn));
  render();
}));

function render() {
  const isSites = state.tab === 'sites';
  const isDash = state.tab === 'dashboard';
  $('#view-dashboard').classList.toggle('hidden', !isDash);
  $('#view-feed').classList.toggle('hidden', isDash || isSites);
  $('#view-sites').classList.toggle('hidden', !isSites);
  if (isDash) loadDashboard();
  else if (isSites) loadSites();
  else loadPosts();
}

// ---------- 대시보드 ----------

async function loadDashboard() {
  const { kpis, dailySites, hotTags, topPosts, byIp, byCountry } = await api('/api/dashboard');

  $('#kpi-row').innerHTML = [
    { label: '이번 주 새 트렌드', value: kpis.posts_week, emoji: '🆕' },
    { label: '누적 관심있어요', value: kpis.interests_total, emoji: '❤️' },
    { label: '참여 팀원', value: kpis.members, emoji: '👥' },
    { label: '등록된 사이트', value: kpis.sites, emoji: '🌐' },
  ].map((k) => `
    <div class="kpi">
      <div class="kpi-emoji">${k.emoji}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-label">${k.label}</div>
    </div>`).join('');

  // 데일리 체크
  const done = dailySites.filter((s) => s.checked).length;
  $('#daily-progress').textContent = dailySites.length ? `${done}/${dailySites.length} 완료` : '';
  $('#daily-list').innerHTML = dailySites.length ? dailySites.map((s) => {
    const link = safeHttpUrl(s.url);
    return `
    <div class="daily-item ${s.checked ? 'done' : ''}" data-id="${s.id}">
      <button class="daily-check" data-act="daily-toggle">${s.checked ? '✅' : '⬜'}</button>
      <div class="daily-info">
        <span class="daily-name">${flag(s.country)} ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a>` : esc(s.name)}</span>
        ${s.description ? `<span class="daily-desc">${esc(s.description)}</span>` : ''}
      </div>
    </div>`;
  }).join('') : '<p class="dash-empty">사이트 등록 시 "매일 봐야 하는 사이트"로 체크하면 여기에 표시돼요.</p>';

  $$('#daily-list [data-act="daily-toggle"]').forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.closest('.daily-item').dataset.id;
    try {
      await api(`/api/sites/${id}/check`, { method: 'POST' });
      loadDashboard();
    } catch (err) { toast(err.message); }
  }));

  // 인기 태그
  $('#hot-tags').innerHTML = hotTags.length
    ? hotTags.map((t) => `<button class="hot-tag" data-tag="${esc(t.tag)}">#${esc(t.tag)} <b>${t.count}</b></button>`).join('')
    : '<p class="dash-empty">최근 2주간 태그가 없어요.</p>';
  $$('#hot-tags .hot-tag').forEach((btn) => btn.addEventListener('click', () => {
    state.q = btn.dataset.tag;
    switchTab('feed');
    $('#search-input').value = state.q;
  }));

  // 관심 급상승
  $('#top-posts').innerHTML = topPosts.filter((p) => p.interest_count > 0).map((p, i) => `
    <div class="top-post">
      <span class="top-rank">${i + 1}</span>
      <span class="top-title">${flag(p.country)} ${esc(p.title)}${p.ip_name ? ` <span class="tag">${esc(p.ip_name)}</span>` : ''}</span>
      <span class="top-count">❤️ ${p.interest_count}</span>
    </div>`).join('') || '<p class="dash-empty">아직 관심 표시가 없어요.</p>';

  // IP별 인기 상품
  $('#ip-board').innerHTML = byIp.length ? byIp.map((ip) => `
    <div class="ip-card">
      <div class="ip-head">
        <span class="ip-name">${esc(ip.ip_name)}</span>
        <span class="ip-stat">포스트 ${ip.post_count} · ❤️ ${ip.interest_sum}</span>
      </div>
      ${ip.top_posts.map((p) => `
        <div class="ip-post">
          <span>${flag(p.country)} ${esc(p.title)}</span>
          <span class="ip-post-meta">${p.price ? esc(p.price) + ' · ' : ''}❤️ ${p.interest_count}</span>
        </div>`).join('')}
    </div>`).join('')
    : '<p class="dash-empty">아직 IP가 입력된 포스트가 없어요. 공유할 때 IP(캐릭터/브랜드)를 입력해 보세요.</p>';

  // 국가별 트렌드
  $('#country-board').innerHTML = byCountry.map((c) => `
    <div class="country-col">
      <div class="country-head">${flag(c.country)} ${esc(c.country)} <span class="dash-sub">${c.post_count}건</span></div>
      ${c.recent_posts.map((p) => `
        <div class="country-post">
          <span>${esc(p.title)}${p.ip_name ? ` <span class="tag">${esc(p.ip_name)}</span>` : ''}</span>
          <span class="ip-post-meta">❤️ ${p.interest_count}</span>
        </div>`).join('')}
    </div>`).join('');
}

function switchTab(tab) {
  state.tab = tab;
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  render();
}

// ---------- 카테고리 칩 ----------

function renderChips() {
  const chips = ['전체', ...POST_CATEGORIES];
  $('#category-chips').innerHTML = chips.map((c) =>
    `<button class="chip ${state.category === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`
  ).join('');
  $$('#category-chips .chip').forEach((btn) => btn.addEventListener('click', () => {
    state.category = btn.dataset.cat;
    renderChips();
    loadPosts();
  }));
}

// ---------- 포스트 ----------

async function loadPosts() {
  const params = new URLSearchParams();
  if (state.sort) params.set('sort', state.sort);
  if (state.category !== '전체') params.set('category', state.category);
  if (state.country !== '전체') params.set('country', state.country);
  if (state.q) params.set('q', state.q);
  if (state.tab === 'brag') params.set('type', 'brag');
  if (state.tab === 'mine') params.set('author', 'me');

  const { posts } = await api('/api/posts?' + params.toString());
  const grid = $('#post-grid');
  grid.innerHTML = posts.map(postCard).join('');
  $('#feed-empty').classList.toggle('hidden', posts.length > 0);

  posts.forEach((p) => {
    if (state.openComments.has(p.id)) toggleComments(p.id, true);
  });
  bindPostEvents();
}

function postCard(p) {
  const emoji = CATEGORY_EMOJI[p.category] || '✨';
  const imgUrl = p.image_url ? safeHttpUrl(p.image_url) : null;
  const thumb = imgUrl
    ? `<div class="post-thumb" style="background-image:url('${esc(imgUrl)}')"></div>`
    : `<div class="post-thumb placeholder">${emoji}</div>`;
  const typeBadge = p.post_type === 'brag' ? '🏆 자랑' : '🔥 트렌드';
  const link = p.url ? safeHttpUrl(p.url) : null;
  const titleHtml = link
    ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(p.title)} ↗</a>`
    : esc(p.title);
  const names = p.interested_users.length
    ? `${p.interested_users.slice(0, 3).map(esc).join(', ')}${p.interested_users.length > 3 ? ` 외 ${p.interested_users.length - 3}명` : ''} 님이 관심`
    : '';
  const mine = state.user && p.user_id === state.user.id;

  return `
  <article class="post-card ${p.post_type}" data-id="${p.id}">
    <div style="position:relative">${thumb}<span class="badge-type" style="position:absolute;top:10px;left:10px">${typeBadge}</span></div>
    <div class="post-body">
      <div class="post-meta-top">
        <span class="post-cat">${flag(p.country)} ${esc(p.category)}</span>
        <span>${esc(p.author)} · ${timeAgo(p.created_at)}</span>
      </div>
      <h3 class="post-title">${titleHtml}</h3>
      ${p.ip_name ? `<div><span class="tag ip-tag">🎨 ${esc(p.ip_name)}</span></div>` : ''}
      ${p.price ? `<div class="post-price">${esc(p.price)}</div>` : ''}
      ${p.memo ? `<p class="post-memo">${esc(p.memo)}</p>` : ''}
      ${p.tags.length ? `<div class="post-tags">${p.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
      ${p.source_site ? `<div class="post-source">발견한 곳: <b>${esc(p.source_site)}</b></div>` : ''}
    </div>
    <div class="post-foot">
      <button class="btn-interest ${p.my_interest ? 'on' : ''}" data-act="interest" title="${esc(p.interested_users.join(', '))}">
        ${p.my_interest ? '❤️' : '🤍'} 관심있어요 <b>${p.interest_count}</b>
      </button>
      <span class="interest-names">${names}</span>
      <button class="btn-comments" data-act="comments">💬 ${p.comment_count}</button>
      ${mine ? '<button class="btn-delete" data-act="delete">삭제</button>' : ''}
    </div>
    <div class="comments-box hidden" data-comments></div>
  </article>`;
}

function bindPostEvents() {
  $$('.post-card [data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.post-card');
      const id = Number(card.dataset.id);
      const act = btn.dataset.act;
      try {
        if (act === 'interest') {
          const { post } = await api(`/api/posts/${id}/interest`, { method: 'POST' });
          card.outerHTML = postCard(post);
          if (state.openComments.has(id)) toggleComments(id, true);
          bindPostEvents();
        } else if (act === 'comments') {
          if (state.openComments.has(id)) {
            state.openComments.delete(id);
            card.querySelector('[data-comments]').classList.add('hidden');
          } else {
            state.openComments.add(id);
            await toggleComments(id, true);
          }
        } else if (act === 'delete') {
          if (!confirm('이 포스트를 삭제할까요?')) return;
          await api(`/api/posts/${id}`, { method: 'DELETE' });
          toast('삭제했습니다.');
          loadPosts();
        }
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

async function toggleComments(postId, open) {
  const card = document.querySelector(`.post-card[data-id="${postId}"]`);
  if (!card) return;
  const box = card.querySelector('[data-comments]');
  if (!open) { box.classList.add('hidden'); return; }

  const { comments } = await api(`/api/posts/${postId}/comments`);
  box.innerHTML = `
    ${comments.map((c) => `
      <div class="comment"><b>${esc(c.author)}</b>${esc(c.body)}<span class="comment-time">${timeAgo(c.created_at)}</span></div>
    `).join('') || '<div class="comment" style="color:var(--ink-faint)">첫 댓글을 남겨 보세요!</div>'}
    <form class="comment-form">
      <input type="text" maxlength="300" placeholder="댓글 달기…" />
      <button type="submit" class="btn btn-primary">등록</button>
    </form>`;
  box.classList.remove('hidden');

  box.querySelector('.comment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = box.querySelector('input');
    const body = input.value.trim();
    if (!body) return;
    try {
      await api(`/api/posts/${postId}/comments`, { method: 'POST', body: { body } });
      await toggleComments(postId, true);
      const countBtn = card.querySelector('[data-act="comments"]');
      countBtn.textContent = `💬 ${comments.length + 1}`;
    } catch (err) {
      toast(err.message);
    }
  });
}

// 검색 / 정렬 / 국가
$('#country-filter').addEventListener('change', (e) => {
  state.country = e.target.value;
  loadPosts();
});
let searchTimer;
$('#search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value.trim();
    loadPosts();
  }, 300);
});
$('#sort-select').addEventListener('change', (e) => {
  state.sort = e.target.value;
  loadPosts();
});

// ---------- 사이트 디렉토리 ----------

$$('.scope-btn').forEach((btn) => btn.addEventListener('click', () => {
  state.siteScope = btn.dataset.scope;
  $$('.scope-btn').forEach((b) => b.classList.toggle('active', b === btn));
  loadSites();
}));

async function loadSites() {
  const { sites } = await api(`/api/sites?scope=${state.siteScope}`);
  const grid = $('#site-grid');
  grid.innerHTML = sites.map((s) => {
    const link = safeHttpUrl(s.url);
    return `
    <div class="site-card" data-id="${s.id}">
      <div class="site-top">
        <span class="site-name">${flag(s.country)} ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a>` : esc(s.name)}</span>
        <span class="site-cat">${esc(s.category)}</span>
      </div>
      ${s.daily_check ? '<div class="site-daily">📌 매일 체크</div>' : ''}
      <div class="site-url">${esc(s.url)}</div>
      ${s.description ? `<div class="site-desc">${esc(s.description)}</div>` : ''}
      <div class="site-foot">
        <span>등록: ${esc(s.owner)}</span>
        ${s.mine ? '<button class="btn-delete" data-act="site-delete">삭제</button>' : ''}
      </div>
    </div>`;
  }).join('');
  $('#sites-empty').classList.toggle('hidden', sites.length > 0);

  $$('#site-grid [data-act="site-delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.site-card').dataset.id;
      if (!confirm('이 사이트를 삭제할까요?')) return;
      try {
        await api(`/api/sites/${id}`, { method: 'DELETE' });
        toast('삭제했습니다.');
        loadSites();
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

// ---------- 모달 ----------

function fillCategorySelects() {
  $('#post-form select[name="category"]').innerHTML =
    POST_CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('');
  $('#site-form select[name="category"]').innerHTML =
    SITE_CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('');
  const countryOpts = COUNTRIES.map((c) => `<option>${flag(c)} ${esc(c)}</option>`).join('');
  $('#post-form select[name="country"]').innerHTML = countryOpts;
  $('#site-form select[name="country"]').innerHTML = countryOpts;
  $('#country-filter').innerHTML =
    `<option value="전체">🌐 국가 전체</option>` +
    COUNTRIES.map((c) => `<option value="${esc(c)}">${flag(c)} ${esc(c)}</option>`).join('');
}

// select에 넣은 "🇰🇷 한국" 형태에서 국가명만 추출
function parseCountry(v) {
  const parts = String(v || '').trim().split(' ');
  return parts[parts.length - 1] || '한국';
}

$('#btn-new-post').addEventListener('click', () => $('#post-modal').classList.remove('hidden'));
$('#btn-new-site').addEventListener('click', () => $('#site-modal').classList.remove('hidden'));
$$('.modal-close').forEach((btn) => btn.addEventListener('click', () => {
  $('#' + btn.dataset.close).classList.add('hidden');
}));
$$('.modal-backdrop').forEach((bd) => bd.addEventListener('click', (e) => {
  if (e.target === bd) bd.classList.add('hidden');
}));

$('#post-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  body.country = parseCountry(body.country);
  try {
    await api('/api/posts', { method: 'POST', body });
    $('#post-modal').classList.add('hidden');
    e.target.reset();
    toast('공유했습니다! 🎉');
    switchTab(body.post_type === 'brag' ? 'brag' : 'feed');
  } catch (err) {
    toast(err.message);
  }
});

$('#site-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  body.country = parseCountry(body.country);
  body.daily_check = fd.get('daily_check') ? 1 : 0;
  try {
    await api('/api/sites', { method: 'POST', body });
    $('#site-modal').classList.add('hidden');
    e.target.reset();
    toast('사이트를 등록했습니다! 🌐');
    state.siteScope = 'mine';
    $$('.scope-btn').forEach((b) => b.classList.toggle('active', b.dataset.scope === 'mine'));
    loadSites();
  } catch (err) {
    toast(err.message);
  }
});

// ---------- 시작 ----------

renderChips();
fillCategorySelects();
checkLogin();
