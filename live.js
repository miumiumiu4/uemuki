// 本番用：config.js に Supabase の住所と鍵が入っているときだけ動きます。
(() => {
  const C = window.UEMUKI_CONFIG || {};
  if (!C.supabaseUrl || !C.supabaseAnonKey) return;
  const D = window.UEMUKI_DATA;
  const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'uemuki.auth' }
  });

  const $ = (s, el = document) => el.querySelector(s);
  const view = $('#view');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('ja-JP');
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const dayOf = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const ago = iso => {
    const m = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'たった今';
    if (m < 60) return `${m}分前`;
    if (m < 1440) return `${Math.floor(m / 60)}時間前`;
    return `${Math.floor(m / 1440)}日前`;
  };
  const q = async p => { const { data, error } = await p; if (error) throw error; return data; };

  // ストア版（iPhone・Android）のときだけ、スマホの歩数を自動で読む
  const NATIVE = !!window.Capacitor?.isNativePlatform?.();
  const Health = NATIVE && window.Capacitor.registerPlugin ? window.Capacitor.registerPlugin('HealthPlugin') : null;

  const S = { tab: 'home', homeSeg: 'feed', user: null, profile: null, settings: null, blocks: new Set(), stats: { today: 0, total: 0 } };

  let timers = [];
  const clearTimers = () => { timers.forEach(t => { clearInterval(t); clearTimeout(t); }); timers = []; };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function fail(e) {
    console.error(e);
    toast(navigator.onLine ? 'うまくいきませんでした。もう一度どうぞ' : '電波がないようです');
  }
  // 困ったときに原因が分かるよう、画面の下に小さく理由を出す
  const why = e => `<div class="muted" style="font-size:11px;margin-top:12px;word-break:break-all">理由：${esc([e?.code, e?.message, e?.details, e?.hint].filter(Boolean).join(' / ') || String(e))}</div>`;
  const setTitle = t => { $('#title').textContent = t; };
  const tabbar = on => { $('.tabbar').hidden = !on; };

  // 開いた画面は「戻る」ボタンでも、スマホの戻る操作でも閉じられる
  function openSheet(html, onMount) {
    if ($('#sheet').hidden) { try { history.pushState({ sheet: 1 }, ''); } catch {} }
    $('#sheetContent').innerHTML = html;
    $('#sheet').hidden = false;
    $('.sheet-body').scrollTop = 0;
    if (onMount) onMount($('#sheetContent'));
  }
  const cleanups = [];
  function hideSheet() { clearTimers(); cleanups.splice(0).forEach(f => { try { f(); } catch {} }); $('#sheet').hidden = true; $('#sheetContent').innerHTML = ''; }
  function closeSheet() {
    if ($('#sheet').hidden) return;
    hideSheet();
    if (history.state?.sheet) history.back();
  }
  window.addEventListener('popstate', () => { if (!$('#sheet').hidden) hideSheet(); });
  document.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });

  function routeSvg(d, big) {
    const m = d.match(/M(\d+) (\d+)/) || [0, 20, 70];
    return `<svg viewBox="0 0 260 140" preserveAspectRatio="none" aria-hidden="true">
      ${big ? `<circle cx="${m[1]}" cy="${m[2]}" r="22" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="4 4"/>` : ''}
      <path d="${esc(d)}" fill="none" stroke="var(--sky)" stroke-width="${big ? 4 : 5}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // ---- 自分の情報 ----
  async function loadMe() {
    const uid = S.user.id;
    const [profile, settings, blocks] = await Promise.all([
      q(sb.from('profiles').select('*').eq('id', uid).maybeSingle()),
      q(sb.from('settings').select('*').eq('user_id', uid).maybeSingle()),
      q(sb.from('blocks').select('blocked_id'))
    ]);
    S.profile = profile; S.settings = settings;
    S.blocks = new Set(blocks.map(b => b.blocked_id));
  }

  // 歩数：ショートカットで届いた歩数と、アプリで歩いた記録の多い方をその日の歩数にする
  async function loadStats() {
    const uid = S.user.id;
    const [daily, posts] = await Promise.all([
      q(sb.from('daily_steps').select('day,steps').eq('user_id', uid)),
      q(sb.from('posts').select('kind,steps,created_at').eq('user_id', uid))
    ]);
    const byDay = {}, active = new Set();
    posts.forEach(w => {
      const d = dayOf(w.created_at); active.add(d);
      if (w.kind === 'walk') byDay[d] = (byDay[d] || 0) + (w.steps || 0);
    });
    daily.forEach(r => { byDay[r.day] = Math.max(byDay[r.day] || 0, r.steps); if (r.steps > 0) active.add(r.day); });
    // 連続記録：今日（まだなら昨日）からさかのぼって、歩数か投稿がある日が何日続いているか
    let streak = 0;
    const d = new Date(today() + 'T12:00:00+09:00');
    if (!active.has(today())) d.setDate(d.getDate() - 1);
    while (active.has(d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }))) { streak++; d.setDate(d.getDate() - 1); }
    S.stats = { today: byDay[today()] || 0, total: Object.values(byDay).reduce((a, b) => a + b, 0), streak, doneToday: active.has(today()) };
  }

  // スマホの歩数（ヘルスケア／Health Connect）を、直近7日分まとめて送る
  let lastSync = 0, healthOk = false;
  async function syncHealth(force) {
    if (!Health || !S.user) return false;
    if (!force && Date.now() - lastSync < 5 * 60000) return healthOk;
    lastSync = Date.now();
    try {
      const { available } = await Health.isHealthAvailable();
      if (!available) return (healthOk = false);
      await Health.requestHealthPermissions({ permissions: ['READ_STEPS'] });
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      const { aggregatedData } = await Health.queryAggregated({ startDate: from.toISOString(), endDate: now.toISOString(), dataType: 'steps', bucket: 'day' });
      const rows = (aggregatedData || []).filter(r => r.value > 0).map(r => ({
        user_id: S.user.id, day: dayOf(r.startDate), steps: Math.min(200000, Math.round(r.value)), updated_at: new Date().toISOString()
      }));
      if (rows.length) await q(sb.from('daily_steps').upsert(rows));
      return (healthOk = true);
    } catch (e) { console.error(e); return (healthOk = false); }
  }

  // ---- ログイン ----
  function renderLogin(mode = 'new') {
    tabbar(false); setTitle('うえむき');
    view.innerHTML = `
      <div class="card" style="text-align:center;background:var(--sky-soft);border-color:var(--sky)">
        <img src="icon.svg" alt="" width="64" height="64" style="border-radius:16px">
        <div style="font-weight:800;font-size:20px;margin-top:6px">うえむき</div>
        <div class="muted">みんなの一歩を、応援し合う場所</div>
      </div>
      <div class="seg" style="margin-top:16px">
        <button data-mode="new" class="${mode === 'new' ? 'on' : ''}">はじめての方</button>
        <button data-mode="login" class="${mode === 'login' ? 'on' : ''}">2回目から</button>
      </div>
      <form id="auth" class="card">
        ${mode === 'new' ? `<label class="muted">表示する名前（ニックネームでOK）</label>
        <input class="input" name="name" required maxlength="20" placeholder="例：さとし">` : ''}
        <label class="muted">メールアドレス</label>
        <input class="input" name="email" type="email" required autocomplete="email">
        <label class="muted">パスワード（8文字以上）</label>
        <input class="input" name="pw" type="password" required minlength="8" autocomplete="${mode === 'new' ? 'new-password' : 'current-password'}">
        <button class="btn">${mode === 'new' ? 'はじめる' : 'ログイン'}</button>
        <p class="muted" style="margin-bottom:0">体重などの体の数字は、最初は自分だけに見えます。見せたい項目だけ、あとで選べます。</p>
      </form>
      ${mode === 'login' ? '<p style="text-align:center"><button class="link" id="forgot">パスワードを忘れたとき</button></p>' : ''}
      <p class="foot">ずっと無料です・<a href="privacy.html" style="color:inherit">プライバシーと利用のきまり</a></p>`;
    view.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => renderLogin(b.dataset.mode));
    if ($('#forgot')) $('#forgot').onclick = openForgot;
    $('#auth').onsubmit = async e => {
      e.preventDefault();
      const f = e.target, btn = $('button.btn', f);
      btn.disabled = true;
      try {
        const email = f.email.value.trim(), password = f.pw.value;
        if (mode === 'new') {
          const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name: f.name.value.trim() } } });
          if (error) throw error;
          if (!data.session) { toast('確認メールを送りました。メールのリンクを押してから「2回目から」でログインしてください'); renderLogin('login'); return; }
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
        }
      } catch (err) {
        const m = String(err.message || '');
        toast(/registered/.test(m) ? 'このメールは登録済みです。「2回目から」へどうぞ'
          : /Invalid login/.test(m) ? 'メールかパスワードが違います'
          : /Password/.test(m) ? 'パスワードは8文字以上にしてください' : 'うまくいきませんでした');
        btn.disabled = false;
      }
    };
  }

  // パスワードを忘れたとき：登録したメールに「作り直し」のリンクを送る
  function openForgot() {
    openSheet(`
      <h2 style="margin:0 0 4px;font-size:18px">パスワードを作り直す</h2>
      <div class="muted" style="margin-bottom:12px">登録したメールアドレスに、作り直し用のリンクを送ります。メールのリンクを押すと、新しいパスワードを決める画面が開きます。</div>
      <form id="fform">
        <label class="muted">登録したメールアドレス</label>
        <input class="input" name="email" type="email" required autocomplete="email" value="${esc($('#auth')?.email?.value || '')}">
        <button class="btn">リンクを送る</button>
      </form>`, el => {
      $('#fform', el).onsubmit = async e => {
        e.preventDefault();
        const btn = $('button.btn', e.target); btn.disabled = true;
        const { error } = await sb.auth.resetPasswordForEmail(e.target.email.value.trim(), { redirectTo: location.origin + location.pathname });
        if (error) { btn.disabled = false; toast(/rate|limit/i.test(error.message) ? '送りすぎのため、少し時間をおいてください' : 'うまくいきませんでした'); return; }
        closeSheet(); toast('メールを送りました。届いたリンクを押してください');
      };
    });
  }

  function openNewPassword() {
    openSheet(`
      <h2 style="margin:0 0 12px;font-size:18px">新しいパスワード</h2>
      <form id="npform">
        <label class="muted">新しいパスワード（8文字以上）</label>
        <input class="input" name="pw" type="password" required minlength="8" autocomplete="new-password">
        <button class="btn">決める</button>
      </form>`, el => {
      $('#npform', el).onsubmit = async e => {
        e.preventDefault();
        const { error } = await sb.auth.updateUser({ password: e.target.pw.value });
        if (error) { toast(/different|same/i.test(error.message) ? '前と違うパスワードにしてください' : 'うまくいきませんでした'); return; }
        closeSheet(); toast('新しいパスワードにしました');
      };
    });
  }

  // ---- ホーム ----
  async function renderHome() {
    setTitle('みんなの一歩');
    view.innerHTML = '<div class="muted">読み込み中…</div>';
    try {
      await syncHealth();
      const [, groupSteps] = await Promise.all([loadStats(), q(sb.rpc('group_total_steps'))]);
      const goal = { name: '日本縦断', km: 3000 };
      const doneKm = Math.round(groupSteps * 0.0007);
      const pct = Math.min(100, Math.round(doneKm / goal.km * 100));
      view.innerHTML = `
        <div class="card today">
          <div><div class="muted">今日のあなた</div><div class="big">${num(S.stats.today)}<small>歩</small></div>
            ${S.stats.streak ? `<span class="pill sun">${S.stats.streak}日つづいています</span>` : '<span class="muted" style="font-size:11px">今日の一歩を記録しよう</span>'}
            ${S.stats.streak && !S.stats.doneToday ? '<div class="muted" style="font-size:11px">今日の記録でつながります</div>' : ''}</div>
          <div><div class="muted">みんなで目標</div><div style="font-weight:800">${goal.name} ${pct}%</div>
            <div class="goalbar"><i style="width:${pct}%"></i></div>
            <div class="muted" style="font-size:11px">みんなで${num(doneKm)}km・あと${num(Math.max(0, goal.km - doneKm))}km</div></div>
        </div>
        <div class="seg" style="margin-top:16px">
          <button data-seg="feed" class="${S.homeSeg === 'feed' ? 'on' : ''}">仲間の一歩</button>
          <button data-seg="board" class="${S.homeSeg === 'board' ? 'on' : ''}">掲示板</button>
        </div>
        <div id="homeBody"><div class="muted">読み込み中…</div></div>`;
      view.querySelectorAll('[data-seg]').forEach(b => b.onclick = () => { S.homeSeg = b.dataset.seg; renderHome(); });
      if (S.homeSeg === 'feed') await renderFeed($('#homeBody')); else await renderBoard($('#homeBody'));
    } catch (e) { fail(e); view.innerHTML = '<div class="muted">読み込めませんでした。タブを押し直してください。</div>' + why(e); }
  }

  let feedCache = [];
  async function loadFeed() {
    const rows = await q(sb.from('posts')
      .select('id,user_id,kind,steps,km,minutes,label,detail,route_path,created_at,profiles!posts_user_id_fkey(display_name,area),cheers(stamp,user_id),comments(id,body,user_id,created_at,profiles(display_name))')
      .order('created_at', { ascending: false })
      .order('created_at', { referencedTable: 'comments', ascending: true })
      .limit(60));
    feedCache = rows.filter(p => !S.blocks.has(p.user_id));
    return feedCache;
  }
  const who = p => p.user_id === S.user.id ? 'あなた' : (p.profiles?.display_name || '仲間');
  function postLabel(p) {
    if (p.kind === 'walk') return `${num(p.steps)}歩`;
    if (p.kind === 'mind') return p.label || `瞑想 ${p.minutes}分`;
    return p.label || '筋トレ';
  }
  function thumb(p) {
    if (p.kind === 'walk') return p.route_path ? routeSvg(p.route_path) : '<span class="glyph">👣</span>';
    return `<span class="glyph">${p.kind === 'mind' ? '◯' : '◎'}</span>`;
  }

  async function renderFeed(body) {
    const posts = await loadFeed();
    if (!posts.length) { body.innerHTML = '<div class="card muted">まだ投稿がありません。「歩く」から最初の一歩をどうぞ。</div>'; return; }
    body.innerHTML = `<div class="grid">${posts.map(p => `
      <button class="tile" data-post="${p.id}">
        <div class="thumb">${thumb(p)}</div>
        <div class="who">${esc(who(p))}${p.profiles?.area ? `（${esc(p.profiles.area)}）` : ''}・${ago(p.created_at)}</div>
        <div class="what">${esc(postLabel(p))}</div>
        <div class="cheer">応援 ${p.cheers.length}${p.comments.length ? `・コメント ${p.comments.length}` : ''}</div>
      </button>`).join('')}</div>`;
    body.querySelectorAll('[data-post]').forEach(b => b.onclick = () => openPost(b.dataset.post));
  }

  async function openPost(id) {
    const draw = async el => {
      const p = feedCache.find(x => x.id === id);
      if (!p) { closeSheet(); return; }
      const mine = p.cheers.filter(c => c.user_id === S.user.id).map(c => c.stamp);
      const counts = {}; p.cheers.forEach(c => { counts[c.stamp] = (counts[c.stamp] || 0) + 1; });
      const isMe = p.user_id === S.user.id;
      el.innerHTML = `
        <h2 style="margin:0 0 4px;font-size:18px">${esc(who(p))}の一歩</h2>
        <div class="muted">${ago(p.created_at)}</div>
        ${p.kind === 'walk' ? `
          ${p.route_path ? `<div class="map">${routeSvg(p.route_path, true)}<span class="note">歩き始めと終わりの近くは表示しません</span></div>` : ''}
          <div style="font-weight:800;margin-top:10px">${num(p.steps)}歩${p.km ? `・${p.km}km` : ''}${p.minutes ? `・${p.minutes}分` : ''}</div>` : `
          <div class="card" style="background:var(--bg)"><div style="font-weight:800">${esc(postLabel(p))}</div><div class="muted">${esc(p.detail || '')}</div></div>`}
        <div id="shared"></div>
        <div class="section-title">スタンプで応援</div>
        <div class="stamps">${D.stamps.map(s => `
          <button class="stamp ${s.length > 8 ? 'wide' : ''} ${mine.includes(s) ? 'sent' : ''}" data-stamp="${esc(s)}"><span>${esc(s)}</span><b>${counts[s] || ''}</b></button>`).join('')}</div>
        <div class="section-title">コメント</div>
        ${p.comments.length ? p.comments.map(c => `<div class="comment"><b>${esc(c.user_id === S.user.id ? 'あなた' : c.profiles?.display_name || '仲間')}</b>${esc(c.body)}</div>`).join('') : '<div class="muted">まだありません</div>'}
        <form id="cform" style="display:flex;gap:8px;margin-top:12px">
          <input name="t" maxlength="200" placeholder="ひとこと応援" class="input" style="flex:1;margin:0;border-radius:99px">
          <button class="btn" style="width:auto;padding:10px 16px">送る</button>
        </form>
        <div style="display:flex;gap:16px;justify-content:flex-end;margin-top:16px">
          ${isMe ? '<button class="link" id="del">この投稿を消す</button>' : `${S.profile.is_admin ? '<button class="link" id="del">見守り役として消す</button>' : ''}<button class="link" id="hide">この人を表示しない</button><button class="link" id="rep">通報する</button>`}
        </div>`;
      el.querySelectorAll('[data-stamp]').forEach(b => b.onclick = async () => {
        const s = b.dataset.stamp;
        try {
          if (mine.includes(s)) {
            await q(sb.from('cheers').delete().match({ post_id: p.id, user_id: S.user.id, stamp: s }));
            p.cheers = p.cheers.filter(c => !(c.user_id === S.user.id && c.stamp === s));
          } else {
            await q(sb.from('cheers').insert({ post_id: p.id, stamp: s }));
            p.cheers.push({ stamp: s, user_id: S.user.id });
            toast(`「${s}」を送りました`);
          }
          draw(el);
        } catch (e) { fail(e); }
      });
      $('#cform', el).onsubmit = async e => {
        e.preventDefault();
        const t = e.target.t.value.trim();
        if (!t) return;
        try {
          const c = await q(sb.from('comments').insert({ post_id: p.id, body: t }).select('id,body,user_id,created_at').single());
          p.comments.push(c); draw(el);
        } catch (err) { fail(err); }
      };
      const delBtn = $('#del', el);
      if (delBtn) delBtn.onclick = async () => {
        if (!confirm('この投稿を消しますか？')) return;
        try { await q(sb.from('posts').delete().eq('id', p.id)); closeSheet(); renderTab(); toast('消しました'); } catch (e) { fail(e); }
      };
      if (!isMe) {
        $('#hide', el).onclick = async () => {
          if (!confirm(`${who(p)}さんの投稿を表示しないようにしますか？（相手には伝わりません）`)) return;
          try { await q(sb.from('blocks').insert({ blocked_id: p.user_id })); S.blocks.add(p.user_id); closeSheet(); renderTab(); } catch (e) { fail(e); }
        };
        $('#rep', el).onclick = async () => {
          const reason = prompt('通報の理由を教えてください（見守り役だけが読みます）');
          if (reason === null) return;
          try { await q(sb.from('reports').insert({ target_type: 'post', target_id: p.id, reason: reason.slice(0, 200) })); toast('見守り役に届けました'); } catch (e) { fail(e); }
        };
        sharedBody(p.user_id, $('#shared', el));
      }
    };
    openSheet('', draw);
  }

  // ほかの人が公開を選んだ体の数字（最新と最初の差）
  async function sharedBody(uid, box) {
    try {
      const rows = await q(sb.rpc('shared_body', { p_user: uid }));
      if (!rows.length) return;
      const items = [['weight', '体重', 'kg'], ['muscle', '骨格筋量', 'kg'], ['fat', '体脂肪率', '%']].map(([k, label, u]) => {
        const v = rows.filter(r => r[k] != null);
        if (!v.length) return '';
        const d = +(v.at(-1)[k] - v[0][k]).toFixed(1);
        return `<div><div class="muted">${label}</div><b>${v.at(-1)[k]}${u}</b>${v.length > 1 ? `<div class="muted" style="font-size:11px">はじめから ${d > 0 ? '+' : ''}${d}${u}</div>` : ''}</div>`;
      }).join('');
      const bp = rows.filter(r => r.bp_sys != null).at(-1);
      box.innerHTML = `<div class="section-title">公開している記録</div><div class="card walk-stats" style="margin:0">${items}${bp ? `<div><div class="muted">血圧</div><b>${bp.bp_sys}/${bp.bp_dia}</b></div>` : ''}</div>`;
    } catch (e) { console.error(e); }
  }

  // ---- 掲示板 ----
  async function renderBoard(body) {
    const rows = await q(sb.from('board_threads').select('id,user_id,title,body,created_at,profiles(display_name),board_replies(count)').order('created_at', { ascending: false }).limit(50));
    const list = rows.filter(t => !S.blocks.has(t.user_id));
    body.innerHTML = `<button class="btn ghost" id="newThread" style="margin-bottom:12px">話題をつくる</button>` + (list.length ? list.map(t => `
      <button class="card tile" data-thread="${t.id}" style="width:100%;margin-bottom:10px;padding:16px">
        <div style="font-weight:700">${esc(t.title)}</div>
        <div style="margin:4px 0;white-space:pre-wrap">${esc(t.body.length > 80 ? t.body.slice(0, 80) + '…' : t.body)}</div>
        <div class="muted">${esc(t.user_id === S.user.id ? 'あなた' : t.profiles?.display_name || '仲間')}・${ago(t.created_at)}・返信 ${t.board_replies[0]?.count || 0}</div>
      </button>`).join('') : '<div class="card muted">まだ話題がありません</div>');
    $('#newThread').onclick = () => openSheet(`
      <h2 style="margin:0 0 12px;font-size:18px">話題をつくる</h2>
      <form id="tform">
        <label class="muted">タイトル</label><input class="input" name="title" required maxlength="60">
        <label class="muted">本文</label><textarea class="input" name="body" required maxlength="1000" rows="5"></textarea>
        <button class="btn">投稿する</button>
      </form>`, el => {
      $('#tform', el).onsubmit = async e => {
        e.preventDefault();
        try {
          await q(sb.from('board_threads').insert({ title: e.target.title.value.trim(), body: e.target.body.value.trim() }));
          closeSheet(); renderTab();
        } catch (err) { fail(err); }
      };
    });
    body.querySelectorAll('[data-thread]').forEach(b => b.onclick = () => openThread(list.find(t => t.id === b.dataset.thread)));
  }

  function openThread(t) {
    const draw = async el => {
      const replies = (await q(sb.from('board_replies').select('id,user_id,body,created_at,profiles(display_name)').eq('thread_id', t.id).order('created_at'))).filter(r => !S.blocks.has(r.user_id));
      el.innerHTML = `
        <h2 style="margin:0;font-size:18px">${esc(t.title)}</h2>
        <div class="muted">${esc(t.user_id === S.user.id ? 'あなた' : t.profiles?.display_name || '仲間')}・${ago(t.created_at)}</div>
        <p style="white-space:pre-wrap">${esc(t.body)}</p>
        <div class="section-title">返信</div>
        ${replies.length ? replies.map(r => `<div class="comment"><b>${esc(r.user_id === S.user.id ? 'あなた' : r.profiles?.display_name || '仲間')}</b>${esc(r.body)}</div>`).join('') : '<div class="muted">まだありません</div>'}
        <form id="rform" style="display:flex;gap:8px;margin-top:12px">
          <input name="t" maxlength="500" placeholder="返信する" class="input" style="flex:1;margin:0;border-radius:99px">
          <button class="btn" style="width:auto;padding:10px 16px">送る</button>
        </form>
        <div style="display:flex;gap:16px;justify-content:flex-end;margin-top:16px">
          ${t.user_id === S.user.id ? '<button class="link" id="del">この話題を消す</button>' : `${S.profile.is_admin ? '<button class="link" id="del">見守り役として消す</button>' : ''}<button class="link" id="rep">通報する</button>`}
        </div>`;
      $('#rform', el).onsubmit = async e => {
        e.preventDefault();
        const v = e.target.t.value.trim();
        if (!v) return;
        try { await q(sb.from('board_replies').insert({ thread_id: t.id, body: v })); draw(el); } catch (err) { fail(err); }
      };
      const del = $('#del', el), rep = $('#rep', el);
      if (del) del.onclick = async () => {
        if (!confirm('この話題を消しますか？')) return;
        try { await q(sb.from('board_threads').delete().eq('id', t.id)); closeSheet(); renderTab(); } catch (e) { fail(e); }
      };
      if (rep) rep.onclick = async () => {
        const reason = prompt('通報の理由を教えてください（見守り役だけが読みます）');
        if (reason === null) return;
        try { await q(sb.from('reports').insert({ target_type: 'thread', target_id: t.id, reason: reason.slice(0, 200) })); toast('見守り役に届けました'); } catch (e) { fail(e); }
      };
    };
    openSheet('<div class="muted">読み込み中…</div>', el => draw(el).catch(fail));
  }

  // ---- からだ ----
  async function renderBody() {
    setTitle('からだ');
    let menu = [], mindMin = 0;
    try {
      const [m, mind] = await Promise.all([
        q(sb.from('menu_items').select('*, profiles(display_name)').order('created_at')),
        q(sb.from('posts').select('minutes').eq('user_id', S.user.id).eq('kind', 'mind'))
      ]);
      menu = m; mindMin = mind.reduce((a, r) => a + (r.minutes || 0), 0);
    } catch (e) { fail(e); }
    const by = m => m.created_by ? (m.created_by === S.user.id ? 'あなたが追加' : `${m.profiles?.display_name || '仲間'}が追加`) : '本部が追加';
    view.innerHTML = `
      <div class="section-title" style="margin-top:0">筋トレメニュー表</div>
      <div class="muted" style="margin-bottom:6px">誰かが報告すると、その種目がここに増えていきます。</div>
      <div class="card" style="padding:0 16px">${menu.map((m, i) => `
        <button class="row" data-menu="${i}">
          <span><span class="r-main">${esc(m.name)}</span><br><span class="r-sub">${esc(m.part || 'みんなの種目')}・${esc(by(m))}</span></span>
          <span class="pill ${m.video_url ? '' : 'sun'}">${m.video_url ? '動画あり' : '説明'}</span>
        </button>`).join('')}</div>
      <button class="btn ghost" id="report" style="margin-top:10px">筋トレを報告する</button>

      <div class="section-title">瞑想の時間</div>
      <div class="card">
        <div class="muted">これまで ${mindMin}分</div>
        <div class="muted" style="margin-top:4px">時間を選ぶと、そのままタイマーが始まります。</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px">
          ${[3, 5, 10, 15, 20, 30, 45, 60].map(m => `<button class="btn ghost" data-mind="${m}" style="padding:12px 0">${m}分</button>`).join('')}
        </div>
      </div>

      <div class="section-title">呼吸法</div>
      <div class="card" style="padding:0 16px">${D.breathing.map((b, i) => `
        <button class="row" data-breath="${i}">
          <span><span class="r-main">${esc(b.name)}</span><br><span class="r-sub">${esc(b.when)}・${b.steps.map(s => s[0] + s[1]).join(' ')}</span></span>
          <span class="pill">はじめる</span>
        </button>`).join('')}</div>`;
    view.querySelectorAll('[data-menu]').forEach(b => b.onclick = () => openMenu(menu[+b.dataset.menu], by(menu[+b.dataset.menu])));
    view.querySelectorAll('[data-breath]').forEach(b => b.onclick = () => openBreath(D.breathing[+b.dataset.breath]));
    view.querySelectorAll('[data-mind]').forEach(b => b.onclick = () => openMind(+b.dataset.mind));
    $('#report').onclick = () => openReport(menu);
  }

  function videoHtml(url) {
    if (!url) return '<div class="video">動画はまだありません<br>説明を読んで試してみてください</div>';
    const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/);
    if (yt) return `<div class="video" style="padding:0"><iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}?playsinline=1&rel=0" title="動画" style="width:100%;height:100%;border:0;border-radius:var(--radius)" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
    return `<video class="video" style="padding:0;width:100%" src="${esc(url)}" controls playsinline preload="metadata"></video>`;
  }

  function openMenu(m, by) {
    openSheet(`
      <h2 style="margin:0;font-size:18px">${esc(m.name)}</h2>
      <div class="muted">${esc(m.part || 'みんなの種目')}・${esc(by)}</div>
      ${videoHtml(m.video_url)}
      <div class="section-title">やり方</div><div>${esc(m.how || 'まだ説明がありません。')}</div>
      ${m.tip ? `<div class="section-title">ヒント</div><div>${esc(m.tip)}</div>` : ''}`);
  }

  function openReport(menu) {
    openSheet(`
      <h2 style="margin:0 0 12px;font-size:18px">筋トレを報告</h2>
      <form id="rform">
        <label class="muted">種目</label>
        <input class="input" name="name" required maxlength="30" list="menuNames" placeholder="例：ランジ">
        <datalist id="menuNames">${menu.map(m => `<option value="${esc(m.name)}">`).join('')}</datalist>
        <label class="muted">回数や時間</label>
        <input class="input" name="amount" maxlength="100" placeholder="例：左右10回×2">
        <button class="btn">報告する</button>
      </form>`, el => {
      $('#rform', el).onsubmit = async e => {
        e.preventDefault();
        const name = e.target.name.value.trim(), amount = e.target.amount.value.trim();
        if (!name) return;
        const known = menu.some(m => m.name === name);
        try {
          if (!known) await q(sb.from('menu_items').insert({ name, part: 'みんなの種目', how: amount ? `報告された内容：${amount}` : null }));
          await q(sb.from('posts').insert({ kind: 'training', label: name, detail: amount || null }));
          closeSheet(); renderTab();
          toast(known ? '報告しました。お楽しみ様' : `「${name}」がメニュー表に増えました`);
        } catch (err) { fail(err); }
      };
    });
  }

  function openBreath(b) {
    openSheet(`
      <h2 style="margin:0;font-size:18px">${esc(b.name)}</h2>
      <div class="muted">${esc(b.note)}</div>
      <div class="breath"><div class="circle" id="circle">はじめます</div></div>
      <div class="muted" style="text-align:center" id="bcount">円に合わせて呼吸してください</div>`, el => {
      const c = $('#circle', el);
      let i = 0, rounds = 0;
      const step = () => {
        const [label, sec] = b.steps[i];
        c.textContent = `${label} ${sec}`;
        c.style.transitionDuration = sec + 's';
        if (label === '吸う') c.style.transform = 'scale(1.7)';
        if (label === '吐く') c.style.transform = 'scale(1)';
        i = (i + 1) % b.steps.length;
        if (i === 0) { rounds++; $('#bcount', el).textContent = `${rounds}回目`; }
        timers.push(setTimeout(step, sec * 1000));
      };
      timers.push(setTimeout(step, 600));
    });
  }

  // 終わりの合図（やさしい鐘の音と振動）
  function chime(ctx) {
    try {
      [0, 1.6].forEach(at => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = 528;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
        g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + at + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 3);
        o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 3.1);
      });
    } catch {}
    try { navigator.vibrate?.([300, 200, 300]); } catch {}
  }

  function openMind(min) {
    let ctx = null;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); } catch {}
    openSheet(`
      <h2 style="margin:0;font-size:18px">瞑想 ${min}分</h2>
      <div class="muted">目を閉じて、呼吸だけに気持ちを向けます。終わると鐘が鳴り、記録されます。画面は消えないようにしてあります。</div>
      <div class="breath"><div class="circle" id="mclock" style="width:170px;height:170px;font-size:30px">${min}:00</div></div>
      <button class="btn ghost" id="mstop">ここで終える</button>`, async el => {
      const start = Date.now();
      let done = false, lock = null;
      try { lock = await navigator.wakeLock?.request('screen'); } catch {}
      cleanups.push(() => { lock?.release(); ctx?.close(); });
      const finish = async () => {
        if (done) return; done = true;
        clearTimers();
        try { await lock?.release(); } catch {}
        const used = Math.min(min, Math.round((Date.now() - start) / 60000));
        $('#mstop', el)?.remove();
        if (used < 1) { $('#mclock', el).textContent = 'また今度'; return; }
        if (used >= min && ctx) chime(ctx);
        $('#mclock', el).textContent = 'お楽しみ様';
        try { await q(sb.from('posts').insert({ kind: 'mind', minutes: used, label: `瞑想 ${used}分` })); renderTab(); } catch (e) { fail(e); }
      };
      const tick = () => {
        const left = Math.max(0, min * 60 - Math.floor((Date.now() - start) / 1000));
        const c = $('#mclock', el); if (!c) return;
        c.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        if (left <= 0) finish();
      };
      timers.push(setInterval(tick, 1000));
      $('#mstop', el).onclick = () => { if (confirm('ここで終えて、ここまでの時間を記録しますか？')) finish(); };
    });
  }

  // ---- 歩く（GPS） ----
  const R = 6371000;
  const rad = d => d * Math.PI / 180;
  const dist = (a, b) => {
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  // 緯度経度を「形」だけの線に変える。家の場所が分からないよう、始めと終わりの200mは消す
  function trimEnds(pts, m = 200) {
    if (pts.length < 2) return [];
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    const total = cum.at(-1);
    return pts.filter((_, i) => cum[i] >= m && cum[i] <= total - m);
  }
  function toPath(pts) {
    if (pts.length < 2) return '';
    const step = Math.ceil(pts.length / 200);
    const ps = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    const k = Math.cos(rad(ps[0].lat));
    const xs = ps.map(p => p.lng * k), ys = ps.map(p => -p.lat);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const w = Math.max(...xs) - minX || 1e-9, h = Math.max(...ys) - minY || 1e-9;
    const s = Math.min(220 / w, 110 / h);
    const ox = (260 - w * s) / 2, oy = (140 - h * s) / 2;
    return ps.map((_, i) => `${i ? 'L' : 'M'}${Math.round(ox + (xs[i] - minX) * s)} ${Math.round(oy + (ys[i] - minY) * s)}`).join(' ');
  }

  let W = null;
  async function renderWalk() {
    setTitle('歩く');
    if (!W) {
      try { await syncHealth(); await loadStats(); } catch (e) { fail(e); }
      view.innerHTML = `
        <div class="card" style="text-align:center">
          <div class="muted">今日のあなた</div>
          <div class="big">${num(S.stats.today)}<small>歩</small></div>
          ${healthOk ? '<div class="muted" style="margin-top:8px">スマホの歩数が自動で入ります</div>' : ''}
          <button class="${healthOk ? 'link' : 'btn ghost'}" id="enterSteps" style="margin-top:10px">${healthOk ? '手で直す' : '今日の歩数を入れる'}</button>
        </div>
        <div style="margin-top:20px"><button class="btn sun" id="start">歩き始める</button></div>
        <p class="muted" style="margin-top:12px">歩いている間はこの画面を開いたままにしてください。歩き始めと終わりの200mは地図から消し、公開は歩き終わってからです。</p>`;
      $('#start').onclick = startWalk;
      $('#enterSteps').onclick = openSteps;
      return;
    }
    view.innerHTML = `
      <div class="map" style="height:220px">${routeSvg(toPath(W.pts) || 'M130 70', false)}<span class="note" id="gpsNote">位置を探しています…</span></div>
      <div class="walk-stats">
        <div class="card"><div class="muted">歩数</div><b id="wSteps">0</b></div>
        <div class="card"><div class="muted">距離</div><b id="wKm">0.00km</b></div>
        <div class="card"><div class="muted">時間</div><b id="wTime">0分</b></div>
      </div>
      <button class="btn" id="stop">歩き終える</button>
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px" class="muted"><input type="checkbox" id="showMap" checked> 道の形もみんなに見せる</label>
      <p class="muted">歩数は距離からのめやすです。正確な歩数は毎晩ショートカットで届きます。</p>
      <button class="link" id="cancel">記録せずにやめる</button>`;
    const paint = () => {
      const mins = Math.floor((Date.now() - W.start) / 60000);
      $('#wSteps').textContent = num(Math.round(W.dist / 0.7));
      $('#wKm').textContent = (W.dist / 1000).toFixed(2) + 'km';
      $('#wTime').textContent = mins + '分';
      if (W.pts.length > 1) $('.map svg path', view).setAttribute('d', toPath(W.pts));
      $('#gpsNote').textContent = W.err || (W.pts.length ? '記録中（この画面はあなただけに見えます）' : '位置を探しています…');
    };
    paint();
    W.paint = paint;
    $('#stop').onclick = () => stopWalk(true);
    $('#cancel').onclick = () => { if (confirm('この歩きは記録しません。よろしいですか？')) stopWalk(false); };
  }

  // 今日の歩数を手で入れる（iPhoneもAndroidも同じ）
  function openSteps() {
    openSheet(`
      <h2 style="margin:0 0 4px;font-size:18px">今日の歩数</h2>
      <div class="muted" style="margin-bottom:12px">iPhoneは「ヘルスケア」、Androidは「Google Fit」や「Samsung Health」（Galaxyの人）に出ている今日の歩数を入れてください。何度入れ直しても大丈夫です。</div>
      <form id="sform">
        <input class="input" name="steps" type="number" inputmode="numeric" min="0" max="200000" required placeholder="例：6500" style="font-size:24px;text-align:center">
        <button class="btn">送る</button>
      </form>`, el => {
      $('#sform', el).onsubmit = async e => {
        e.preventDefault();
        const steps = Math.round(+e.target.steps.value);
        if (!(steps >= 0 && steps <= 200000)) { toast('歩数を確かめてください'); return; }
        const before = S.stats.total;
        try {
          await q(sb.from('daily_steps').upsert({ user_id: S.user.id, day: today(), steps, updated_at: new Date().toISOString() }));
          await loadStats();
          const opened = D.hints.filter(h => h.at > before && h.at <= S.stats.total);
          closeSheet(); renderTab();
          toast(opened.length ? '新しいヒントカードが開きました' : `お楽しみ様。${num(steps)}歩を記録しました`);
        } catch (err) { fail(err); }
      };
      setTimeout(() => $('input', el)?.focus(), 100);
    });
  }

  async function startWalk() {
    if (!('geolocation' in navigator)) { toast('このスマホでは位置が使えません'); return; }
    W = { pts: [], dist: 0, start: Date.now(), err: '' };
    W.watch = navigator.geolocation.watchPosition(pos => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      if (accuracy > 40) return;
      const p = { lat, lng, t: pos.timestamp };
      const last = W.pts.at(-1);
      if (last) {
        const d = dist(last, p), sec = Math.max(1, (p.t - last.t) / 1000);
        if (d < 5) return;               // その場の揺れは数えない
        if (d / sec > 4) return;         // 歩きでは出ない速さ（乗り物など）は数えない
        W.dist += d;
      }
      W.pts.push(p); W.err = '';
    }, err => {
      W.err = err.code === 1 ? '位置の使用が許可されていません（設定 → プライバシー → 位置情報）' : '位置がとれません。空の見える所へどうぞ';
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    try { W.lock = await navigator.wakeLock?.request('screen'); } catch {}
    W.tick = setInterval(() => W?.paint?.(), 1000);
    renderWalk();
  }

  async function stopWalk(save) {
    const w = W; W = null;
    navigator.geolocation.clearWatch(w.watch);
    clearInterval(w.tick);
    try { await w.lock?.release(); } catch {}
    if (!save) { renderTab(); return; }
    const steps = Math.round(w.dist / 0.7);
    if (steps < 50) { toast('ほとんど動いていないので、今回は記録しませんでした'); renderTab(); return; }
    const showMap = $('#showMap')?.checked;
    const before = S.stats.total;
    try {
      await q(sb.from('posts').insert({
        kind: 'walk', steps, km: +(w.dist / 1000).toFixed(2),
        minutes: Math.max(1, Math.round((Date.now() - w.start) / 60000)),
        route_path: showMap ? (toPath(trimEnds(w.pts)) || null) : null
      }));
      await loadStats();
      const opened = D.hints.filter(h => h.at > before && h.at <= S.stats.total);
      toast(opened.length ? '新しいヒントカードが開きました' : 'お楽しみ様。みんなに届けました');
      S.tab = 'home'; S.homeSeg = 'feed';
    } catch (e) { fail(e); }
    renderTab();
  }

  // ---- ヒント ----
  async function renderHints() {
    setTitle('ヒント');
    try { await loadStats(); } catch (e) { fail(e); }
    const total = S.stats.total;
    const next = D.hints.find(h => h.at > total);
    view.innerHTML = `
      <div class="card" style="background:var(--sun-soft);border-color:var(--sun)">
        <div class="muted">これまでの合計</div>
        <div class="big">${num(total)}<small>歩</small></div>
        <div class="muted">${next ? `あと${num(next.at - total)}歩で次のカードが開きます` : 'すべてのカードが開きました'}</div>
      </div>
      <div class="section-title">歩くほど届くヒント</div>
      ${D.hints.map(h => {
        const open = total >= h.at;
        return `<div class="card hint ${open ? '' : 'locked'}">
          <div class="from">${open ? esc(h.from) : `${num(h.at)}歩で開きます`}</div>
          <div>${open ? esc(h.text) : '・・・'}</div>
        </div>`;
      }).join('')}
      <p class="muted">治療のことは、必ず主治医と相談してください。「先生のお話」は、代表の母の主治医の説明をそのまま紹介しています。</p>`;
  }

  // ---- マイページ ----
  function chart(rows, key, unit, color) {
    const w = 320, h = 150, pl = 36, pr = 16, pt = 16, pb = 26;
    const vals = rows.map(r => +r[key]);
    const lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
    const X = i => pl + i * (w - pl - pr) / Math.max(1, rows.length - 1);
    const Y = v => pt + (hi - v) / (hi - lo) * (h - pt - pb);
    const d = rows.map((r, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(+r[key]).toFixed(1)}`).join(' ');
    const every = Math.ceil(rows.length / 6);
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${key}の推移">
      <line x1="${pl}" x2="${w - pr}" y1="${h - pb}" y2="${h - pb}" stroke="var(--line)"/>
      <text x="4" y="${Y(hi) + 4}" font-size="10" fill="var(--ink-2)">${hi}</text>
      <text x="4" y="${Y(lo) + 4}" font-size="10" fill="var(--ink-2)">${lo}</text>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2.5"/>
      ${rows.map((r, i) => `<circle cx="${X(i)}" cy="${Y(+r[key])}" r="4" fill="${color}"/>
        ${i % every === 0 || i === rows.length - 1 ? `<text x="${X(i)}" y="${h - 8}" font-size="10" text-anchor="middle" fill="var(--ink-2)">${+r.day.slice(5, 7)}/${+r.day.slice(8)}</text>` : ''}
        ${i === rows.length - 1 ? `<text x="${X(i) - 4}" y="${Y(+r[key]) - 9}" font-size="11" text-anchor="end" font-weight="700" fill="var(--ink)">${r[key]}${unit}</text>` : ''}`).join('')}
    </svg>`;
  }

  let meChart = 'muscle';
  async function renderMe() {
    setTitle('マイページ');
    let records = [];
    try { records = await q(sb.from('body_records').select('*').eq('user_id', S.user.id).order('day').order('created_at')); } catch (e) { fail(e); }
    const keys = { muscle: ['骨格筋量', 'kg', 'var(--leaf)'], fat: ['体脂肪率', '%', 'var(--sun)'], weight: ['体重', 'kg', 'var(--sky)'] };
    const rows = records.filter(r => r[meChart] != null);
    const diff = rows.length > 1 ? +(rows.at(-1)[meChart] - rows[0][meChart]).toFixed(1) : 0;
    const pub = [['share_steps', '毎日の歩数'], ['share_weight', '体重'], ['share_muscle', '骨格筋量'], ['share_fat', '体脂肪率'], ['share_bp', '血圧']];
    view.innerHTML = `
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-weight:800;font-size:18px">${esc(S.profile.display_name)}</div><div class="muted">${esc(S.profile.area || '地域は未設定')}</div></div>
        <button class="btn ghost" id="editName" style="width:auto;padding:8px 14px">変更</button>
      </div>

      <div class="section-title">体の記録・InBodyの推移</div>
      <div class="card chart">
        <div class="seg" style="grid-template-columns:repeat(3,1fr)">
          ${Object.entries(keys).map(([k, v]) => `<button data-ck="${k}" class="${meChart === k ? 'on' : ''}">${v[0]}</button>`).join('')}
        </div>
        ${rows.length > 1 ? chart(rows, meChart, keys[meChart][1], keys[meChart][2]) + `<div class="muted">${rows.length}回の記録で ${diff > 0 ? '+' : ''}${diff}${keys[meChart][1]}</div>`
          : `<div class="muted" style="padding:16px 0">${rows.length ? `いまは ${rows[0][meChart]}${keys[meChart][1]}。2回目から線で見られます。` : 'まだ記録がありません。'}</div>`}
        <button class="btn" id="addRec" style="margin-top:12px">今日の体の記録をつける</button>
      </div>

      <div class="section-title">みんなに見せるもの</div>
      <div class="card" style="padding:0 16px">
        <div class="row"><span>歩いた・筋トレ・瞑想の投稿<br><span class="r-sub">投稿したものはみんなに見えます</span></span><span class="muted">公開</span></div>
        ${pub.map(([k, label]) => `<div class="row"><span>${label}</span><button class="toggle ${S.settings[k] ? 'on' : ''}" data-pub="${k}" aria-label="${label}を公開"></button></div>`).join('')}
        <div class="row"><span>脈・服薬・体調メモ<br><span class="r-sub">いつも自分だけ</span></span><span class="muted">非公開</span></div>
      </div>

      ${NATIVE ? '' : `<div class="section-title">歩数を自動で送る（詳しい人向け・iPhone）</div>
      <div class="card">
        <div class="muted">ふだんは「歩く」の「今日の歩数を入れる」で大丈夫です。iPhoneの「ショートカット」に詳しい人は、毎晩自動で送る設定もできます。</div>
        <button class="btn ghost" id="shortcut" style="margin-top:10px">設定のしかたを見る</button>
      </div>`}

      <div class="section-title">うえむきが生まれたきっかけ</div>
      <div class="card">
        <p style="margin-top:0">代表は心筋梗塞を経験し、母はステージ4のがんと向き合っています。</p>
        <p>健康を祈るだけでなく、毎日の一歩を見せ合い、応援し合える場所をつくりたい。そんな思いから、うえむきは生まれました。</p>
        <p style="margin-bottom:0">上を向いて、一緒に歩いていきましょう。</p>
      </div>
      ${S.profile.is_admin ? '<div class="section-title">見守り役</div><button class="btn ghost" id="reports">届いた通報を見る</button>' : ''}
      <button class="btn sun" id="invite" style="margin-top:20px">仲間を招待する</button>
      <button class="btn ghost" id="logout" style="margin-top:12px">ログアウト</button>
      <p style="text-align:center;margin-top:16px"><a class="link" href="privacy.html">プライバシーと利用のきまり</a>　<button class="link" id="leave">退会する</button></p>
      <p class="foot">${esc(S.user.email)}</p>`;
    view.querySelectorAll('[data-ck]').forEach(b => b.onclick = () => { meChart = b.dataset.ck; renderMe(); });
    view.querySelectorAll('[data-pub]').forEach(b => b.onclick = async () => {
      const k = b.dataset.pub, v = !S.settings[k];
      try { await q(sb.from('settings').update({ [k]: v }).eq('user_id', S.user.id)); S.settings[k] = v; b.classList.toggle('on', v); toast(v ? 'みんなに見せます' : '自分だけにしました'); } catch (e) { fail(e); }
    });
    $('#editName').onclick = openProfile;
    $('#addRec').onclick = openRecord;
    if ($('#shortcut')) $('#shortcut').onclick = openShortcut;
    $('#logout').onclick = async () => { await sb.auth.signOut(); };
    if ($('#reports')) $('#reports').onclick = openReports;
    $('#invite').onclick = invite;
    $('#leave').onclick = leave;
  }

  // 仲間を招待：スマホの「共有」で、LINEやメールにそのまま送れる
  async function invite() {
    const url = location.origin + location.pathname;
    const text = `${S.profile.display_name}さんから、うえむきへのお誘いです。みんなの一歩をスタンプで応援し合う、ずっと無料のアプリです。一緒に歩きませんか。`;
    try {
      if (navigator.share) { await navigator.share({ title: 'うえむき', text, url }); return; }
      await navigator.clipboard.writeText(`${text}\n${url}`); toast('お誘いの文をコピーしました。LINEなどに貼ってください');
    } catch (e) { if (e?.name !== 'AbortError') toast('うまくいきませんでした'); }
  }

  // 退会：その人の記録をすべて消す（ストアの決まりで必要）
  async function leave() {
    if (!confirm('退会すると、投稿・スタンプ・コメント・体の記録がすべて消え、元に戻せません。よろしいですか？')) return;
    const word = prompt('確認のため「退会」と入力してください');
    if (word === null) return;
    if (word.trim() !== '退会') { toast('「退会」と入力されなかったので、やめました'); return; }
    const { error } = await sb.rpc('delete_my_account');
    if (error) { toast(error.code === 'PGRST202' ? '退会の仕組みは準備中です。見守り役に連絡してください' : 'うまくいきませんでした'); return; }
    try { await sb.auth.signOut({ scope: 'local' }); } catch {}
    toast('退会しました。これまでありがとうございました');
  }

  async function openReports() {
    openSheet('<div class="muted">読み込み中…</div>', async el => {
      try {
        const rows = await q(sb.from('reports').select('id,target_type,target_id,reason,created_at,profiles(display_name)').order('created_at', { ascending: false }).limit(50));
        const kind = { post: '投稿', thread: '掲示板の話題', comment: 'コメント', reply: '返信', user: '人' };
        el.innerHTML = `<h2 style="margin:0 0 12px;font-size:18px">届いた通報</h2>` + (rows.length ? rows.map(r => `
          <div class="comment"><b>${esc(kind[r.target_type] || r.target_type)}</b>${esc(r.reason || '理由なし')}
          <div class="muted">${esc(r.profiles?.display_name || '仲間')}から・${ago(r.created_at)}${r.target_type === 'post' ? ` ・<button class="link" data-open="${r.target_id}">投稿を見る</button>` : ''}</div></div>`).join('') : '<div class="muted">通報はまだありません</div>');
        el.querySelectorAll('[data-open]').forEach(b => b.onclick = async () => {
          if (!feedCache.some(x => x.id === b.dataset.open)) await loadFeed();
          if (!feedCache.some(x => x.id === b.dataset.open)) { toast('この投稿はもう消えています'); return; }
          hideSheet(); openPost(b.dataset.open);
        });
      } catch (e) { fail(e); }
    });
  }

  function openProfile(first) {
    openSheet(`
      <h2 style="margin:0 0 12px;font-size:18px">${first === true ? 'ようこそ。名前を教えてください' : '名前と地域'}</h2>
      <form id="pform">
        <label class="muted">表示する名前</label><input class="input" name="name" required maxlength="20" value="${first === true ? '' : esc(S.profile.display_name)}">
        <label class="muted">地域（例：横浜。なくてもOK）</label><input class="input" name="area" maxlength="20" value="${esc(S.profile.area || '')}">
        <button class="btn">保存</button>
      </form>`, el => {
      $('#pform', el).onsubmit = async e => {
        e.preventDefault();
        const patch = { display_name: e.target.name.value.trim(), area: e.target.area.value.trim() || null };
        try { await q(sb.from('profiles').update(patch).eq('id', S.user.id)); Object.assign(S.profile, patch); closeSheet(); renderTab(); } catch (err) { fail(err); }
      };
    });
  }

  function openRecord() {
    const f = (name, label, step, ph) => `<label class="muted">${label}</label><input class="input" name="${name}" type="number" inputmode="decimal" step="${step}" placeholder="${ph}">`;
    openSheet(`
      <h2 style="margin:0 0 4px;font-size:18px">体の記録</h2>
      <div class="muted" style="margin-bottom:12px">わかる項目だけで大丈夫です。InBodyの日はその数字を。</div>
      <form id="bform">
        <label class="muted">日付</label><input class="input" name="day" type="date" value="${today()}" max="${today()}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 10px">
          <div>${f('weight', '体重 kg', '0.1', '70.0')}</div><div>${f('muscle', '骨格筋量 kg', '0.1', '30.0')}</div>
          <div>${f('fat', '体脂肪率 %', '0.1', '20.0')}</div><div>${f('pulse', '脈 回/分（自分だけ）', '1', '65')}</div>
          <div>${f('bp_sys', '血圧 上', '1', '120')}</div><div>${f('bp_dia', '血圧 下', '1', '80')}</div>
        </div>
        <label class="muted">服薬・体調メモ（いつも自分だけ）</label><textarea class="input" name="note" maxlength="500" rows="3"></textarea>
        <button class="btn">記録する</button>
      </form>`, el => {
      $('#bform', el).onsubmit = async e => {
        e.preventDefault();
        const fd = new FormData(e.target), row = { day: fd.get('day') || today() };
        ['weight', 'muscle', 'fat', 'pulse', 'bp_sys', 'bp_dia'].forEach(k => { const v = fd.get(k); if (v !== '') row[k] = +v; });
        const note = fd.get('note').trim(); if (note) row.note = note;
        if (Object.keys(row).length < 2) { toast('どれか1つ入れてください'); return; }
        try { await q(sb.from('body_records').insert(row)); closeSheet(); renderTab(); toast('記録しました。お楽しみ様'); }
        catch (err) { toast(/check/.test(err.message) ? '数字の範囲を確かめてください' : 'うまくいきませんでした'); }
      };
    });
  }

  function openShortcut() {
    const url = `${C.supabaseUrl}/rest/v1/rpc/submit_steps`;
    const copyRow = (label, value, id) => `<div class="muted" style="margin-top:10px">${label}</div>
      <div style="display:flex;gap:8px;align-items:center"><code class="code" id="${id}">${esc(value)}</code><button class="btn ghost" data-copy="${id}" style="width:auto;padding:6px 12px;font-size:13px">コピー</button></div>`;
    openSheet(`
      <h2 style="margin:0 0 4px;font-size:18px">歩数を自動で送る</h2>
      <div class="muted">「合言葉」はあなた専用です。人に見せないでください。</div>
      ${copyRow('送り先（URL）', url, 'scUrl')}
      ${copyRow('鍵（apikey）', C.supabaseAnonKey, 'scKey')}
      ${copyRow('あなたの合言葉', S.settings.steps_token, 'scToken')}
      <div class="section-title">ショートカットの作り方</div>
      <ol style="padding-left:20px;margin:0">
        <li>「ショートカット」アプリで ＋ を押し、新しいショートカットを作る</li>
        <li>「ヘルスケアサンプルを検索」を追加し、種類を「歩数」、開始日を「今日」にする</li>
        <li>「統計を計算」を追加し、「合計」にする</li>
        <li>「URLの内容を取得」を追加し、URLに上の送り先を入れる。方法は「POST」</li>
        <li>ヘッダに「apikey」＝上の鍵、「Content-Type」＝application/json を追加</li>
        <li>本文を「JSON」にして、「p_token」（テキスト）＝あなたの合言葉、「p_steps」（数値）＝「統計」を入れる</li>
        <li>「オートメーション」タブで「時刻」→ 毎日 22:00、「すぐに実行」にしてこのショートカットを選ぶ</li>
      </ol>
      <p class="muted">一度手で実行して「お楽しみ様。○歩を受け取りました」と出れば完成です。</p>
      <button class="link" id="resetToken">合言葉を作り直す（漏れたとき）</button>`, el => {
      el.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
        try { await navigator.clipboard.writeText($('#' + b.dataset.copy, el).textContent); toast('コピーしました'); } catch { toast('長押しでコピーしてください'); }
      });
      $('#resetToken', el).onclick = async () => {
        if (!confirm('合言葉を作り直すと、今のショートカットは使えなくなります。よろしいですか？')) return;
        try { S.settings.steps_token = await q(sb.rpc('reset_steps_token')); openShortcut(); toast('新しい合言葉にしました'); } catch (e) { fail(e); }
      };
    });
  }

  // ---- タブ ----
  const renderers = { home: renderHome, body: renderBody, walk: renderWalk, hints: renderHints, me: renderMe };
  function renderTab() {
    if (!S.user) return;
    if ($('#sheet').hidden) clearTimers();
    tabbar(true);
    document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
    renderers[S.tab]();
  }
  document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => {
    if (S.tab === 'walk' && W && b.dataset.tab !== 'walk') { toast('「歩き終える」で記録できます'); return; }
    S.tab = b.dataset.tab; window.scrollTo(0, 0); renderTab();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.user && (S.tab === 'home' || S.tab === 'walk') && !W && $('#sheet').hidden) renderTab();
  });

  async function start(session) {
    const uid = session?.user?.id || null;
    if (uid && uid === S.user?.id) return;
    S.user = session?.user || null;
    if (!S.user) { closeSheet(); renderLogin(); return; }
    try {
      await loadMe();
      if (!S.profile || !S.settings) throw new Error('profile missing');
    } catch (e) { fail(e); view.innerHTML = '<div class="card muted">準備中です。少し待ってから開き直してください。</div>'; return; }
    S.tab = 'home';
    renderTab();
    if (S.profile.display_name === 'なまえ未設定') openProfile(true);
  }
  sb.auth.onAuthStateChange((ev, session) => {
    setTimeout(async () => {
      await start(session);
      if (ev === 'PASSWORD_RECOVERY') { try { history.replaceState(null, '', location.pathname); } catch {} openNewPassword(); }
    }, 0);
  });

  if ('serviceWorker' in navigator && !NATIVE) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
