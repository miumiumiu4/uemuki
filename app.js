(() => {
  const D = window.UEMUKI_DATA;
  const $ = (s, el = document) => el.querySelector(s);
  const view = $('#view');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => n.toLocaleString('ja-JP');

  // ---- 保存（この端末の中だけ） ----
  const load = (k, d) => { try { const v = localStorage.getItem('uemuki.' + k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem('uemuki.' + k, JSON.stringify(v)); } catch {} };

  const state = {
    tab: 'home',
    homeSeg: 'feed',
    totalSteps: load('totalSteps', 42300),
    todaySteps: load('todaySteps', 6240),
    sent: load('sent', {}),              // { postId: [stamp, ...] }
    myPosts: load('myPosts', []),
    myComments: load('myComments', {}),  // { postId: [text] }
    menuAdds: load('menuAdds', []),
    publicSet: load('publicSet', { steps: true, training: true, weight: false, muscle: false, fat: false, bp: false }),
    mindMinutes: load('mindMinutes', 0)
  };
  const persist = () => {
    ['totalSteps', 'todaySteps', 'sent', 'myPosts', 'myComments', 'menuAdds', 'publicSet', 'mindMinutes'].forEach(k => save(k, state[k]));
  };

  let timers = [];
  const clearTimers = () => { timers.forEach(t => clearInterval(t)); timers.forEach(t => clearTimeout(t)); timers = []; };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2400);
  }

  function setTitle(t) { $('#title').textContent = t; }

  // ---- シート ----
  function openSheet(html, onMount) {
    $('#sheetContent').innerHTML = html;
    $('#sheet').hidden = false;
    if (onMount) onMount($('#sheetContent'));
  }
  function closeSheet() { clearTimers(); $('#sheet').hidden = true; $('#sheetContent').innerHTML = ''; }
  document.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });

  // ---- 共通部品 ----
  function routeSvg(d, big) {
    const m = d.match(/M(\d+) (\d+)/) || [0, 20, 70];
    return `<svg viewBox="0 0 260 140" preserveAspectRatio="none" aria-hidden="true">
      ${big ? `<circle cx="${m[1]}" cy="${m[2]}" r="22" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="4 4"/>` : ''}
      <path d="${d}" fill="none" stroke="var(--sky)" stroke-width="${big ? 4 : 5}" stroke-linecap="round"/></svg>`;
  }
  const allPosts = () => [...state.myPosts, ...D.feed];
  const cheerCount = p => {
    const base = Object.values(p.cheers || {}).reduce((a, b) => a + b, 0);
    return base + (state.sent[p.id] || []).length;
  };
  function postLabel(p) {
    if (p.kind === 'walk') return `${num(p.steps)}歩`;
    return p.label;
  }
  function thumb(p) {
    if (p.kind === 'walk') return routeSvg(p.route);
    return `<span class="glyph">${p.kind === 'mind' ? '◯' : '◎'}</span>`;
  }

  // ---- ホーム ----
  function renderHome() {
    setTitle('みんなの一歩');
    const g = D.groupGoal;
    const done = g.doneKm + state.myPosts.reduce((a, p) => a + (p.km || 0), 0);
    const pct = Math.min(100, Math.round(done / g.totalKm * 100));
    view.innerHTML = `
      <div class="card today">
        <div><div class="muted">今日のあなた</div><div class="big">${num(state.todaySteps)}<small>歩</small></div></div>
        <div><div class="muted">みんなで目標</div><div style="font-weight:800">${esc(g.name)} ${pct}%</div>
          <div class="goalbar"><i style="width:${pct}%"></i></div>
          <div class="muted" style="font-size:11px">あと${num(Math.max(0, Math.round(g.totalKm - done)))}km</div></div>
      </div>
      <div class="seg" style="margin-top:16px">
        <button data-seg="feed" class="${state.homeSeg === 'feed' ? 'on' : ''}">仲間の一歩</button>
        <button data-seg="board" class="${state.homeSeg === 'board' ? 'on' : ''}">掲示板</button>
      </div>
      <div id="homeBody"></div>
      <p class="foot">これは見本です。名前と数字はすべて例です。</p>`;
    view.querySelectorAll('[data-seg]').forEach(b => b.onclick = () => { state.homeSeg = b.dataset.seg; renderHome(); });
    const body = $('#homeBody');
    if (state.homeSeg === 'feed') {
      body.innerHTML = `<div class="grid">${allPosts().map(p => `
        <button class="tile" data-post="${p.id}">
          <div class="thumb">${thumb(p)}</div>
          <div class="who">${esc(p.name)}（${esc(p.area)}）</div>
          <div class="what">${esc(postLabel(p))}</div>
          <div class="cheer">応援 ${cheerCount(p)}</div>
        </button>`).join('')}</div>`;
      body.querySelectorAll('[data-post]').forEach(b => b.onclick = () => openPost(b.dataset.post));
    } else {
      body.innerHTML = D.board.map(t => `
        <div class="card" style="margin-bottom:10px">
          <div style="font-weight:700">${esc(t.title)}</div>
          <div style="margin:4px 0">${esc(t.body)}</div>
          <div class="muted">${esc(t.by)}・返信 ${t.replies}</div>
        </div>`).join('');
    }
  }

  function openPost(id) {
    const p = allPosts().find(x => x.id === id);
    if (!p) return;
    const draw = el => {
      const sent = state.sent[p.id] || [];
      const counts = Object.fromEntries(D.stamps.map(s => [s, (p.cheers?.[s] || 0) + sent.filter(x => x === s).length]));
      const comments = [...(p.comments || []), ...(state.myComments[p.id] || []).map(t => ['あなた', t])];
      el.innerHTML = `
        <h2 style="margin:0 0 4px;font-size:18px">${esc(p.name)}の一歩</h2>
        ${p.kind === 'walk' ? `
          <div class="map">${routeSvg(p.route, true)}<span class="note">自宅付近は表示しません</span></div>
          <div style="font-weight:800;margin-top:10px">${esc(p.course)} ${p.km}km・${num(p.steps)}歩</div>
          <div class="muted">${esc(p.time)}</div>` : `
          <div class="card" style="background:var(--bg)"><div style="font-weight:800">${esc(p.label)}</div><div class="muted">${esc(p.detail || '')}</div></div>`}
        <div class="section-title">スタンプで応援</div>
        <div class="stamps">${D.stamps.map(s => `
          <button class="stamp ${s.length > 8 ? 'wide' : ''} ${sent.includes(s) ? 'sent' : ''}" data-stamp="${esc(s)}"><span>${esc(s)}</span><b>${counts[s] || ''}</b></button>`).join('')}</div>
        <div class="section-title">コメント</div>
        ${comments.length ? comments.map(([w, t]) => `<div class="comment"><b>${esc(w)}</b>${esc(t)}</div>`).join('') : '<div class="muted">まだありません</div>'}
        <form id="cform" style="display:flex;gap:8px;margin-top:12px">
          <input name="t" maxlength="80" placeholder="ひとこと応援" style="flex:1;padding:10px 12px;border-radius:99px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:inherit">
          <button class="btn" style="width:auto;padding:10px 16px">送る</button>
        </form>`;
      el.querySelectorAll('[data-stamp]').forEach(b => b.onclick = () => {
        const s = b.dataset.stamp;
        state.sent[p.id] = [...(state.sent[p.id] || []), s];
        persist(); draw(el); renderTab();
        toast(`「${s}」を送りました`);
      });
      $('#cform', el).onsubmit = e => {
        e.preventDefault();
        const t = e.target.t.value.trim();
        if (!t) return;
        state.myComments[p.id] = [...(state.myComments[p.id] || []), t];
        persist(); draw(el);
      };
    };
    openSheet('', draw);
  }

  // ---- からだ（筋トレ・瞑想・呼吸法） ----
  function renderBody() {
    setTitle('からだ');
    const menu = [...D.menu, ...state.menuAdds];
    view.innerHTML = `
      <div class="section-title" style="margin-top:0">筋トレメニュー表</div>
      <div class="muted" style="margin-bottom:6px">誰かが報告すると、その種目がここに増えていきます。</div>
      <div class="card" style="padding:0 16px">${menu.map((m, i) => `
        <button class="row" data-menu="${i}">
          <span><span class="r-main">${esc(m.name)}</span><br><span class="r-sub">${esc(m.part)}・${esc(m.by)}</span></span>
          <span class="pill ${m.video ? '' : 'sun'}">${m.video ? '動画あり' : '説明'}</span>
        </button>`).join('')}</div>
      <button class="btn ghost" id="report" style="margin-top:10px">筋トレを報告する</button>

      <div class="section-title">瞑想の時間</div>
      <div class="card">
        <div class="muted">これまで ${state.mindMinutes}分</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px">
          ${[3, 5, 10].map(m => `<button class="btn ghost" data-mind="${m}">${m}分</button>`).join('')}
        </div>
      </div>

      <div class="section-title">呼吸法</div>
      <div class="card" style="padding:0 16px">${D.breathing.map((b, i) => `
        <button class="row" data-breath="${i}">
          <span><span class="r-main">${esc(b.name)}</span><br><span class="r-sub">${esc(b.when)}・${b.steps.map(s => s[0] + s[1]).join(' ')}</span></span>
          <span class="pill">はじめる</span>
        </button>`).join('')}</div>`;
    view.querySelectorAll('[data-menu]').forEach(b => b.onclick = () => openMenu(menu[+b.dataset.menu]));
    view.querySelectorAll('[data-breath]').forEach(b => b.onclick = () => openBreath(D.breathing[+b.dataset.breath]));
    view.querySelectorAll('[data-mind]').forEach(b => b.onclick = () => openMind(+b.dataset.mind));
    $('#report').onclick = openReport;
  }

  function openMenu(m) {
    openSheet(`
      <h2 style="margin:0;font-size:18px">${esc(m.name)}</h2>
      <div class="muted">${esc(m.part)}・${esc(m.by)}</div>
      <div class="video">${m.video ? '▶ ここで動画が再生されます<br>（見本なので動画はまだ入っていません）' : '動画はまだありません<br>説明を読んで試してみてください'}</div>
      <div class="section-title">やり方</div><div>${esc(m.how)}</div>
      <div class="section-title">ヒント</div><div>${esc(m.tip)}</div>`);
  }

  function openReport() {
    openSheet(`
      <h2 style="margin:0 0 12px;font-size:18px">筋トレを報告</h2>
      <form id="rform">
        <label class="muted">種目</label>
        <input name="name" required maxlength="20" placeholder="例：ランジ" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:inherit;margin:4px 0 12px">
        <label class="muted">回数や時間</label>
        <input name="amount" maxlength="30" placeholder="例：左右10回×2" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:inherit;margin:4px 0 16px">
        <button class="btn">報告する</button>
      </form>`, el => {
      $('#rform', el).onsubmit = e => {
        e.preventDefault();
        const name = e.target.name.value.trim();
        const amount = e.target.amount.value.trim();
        if (!name) return;
        const known = [...D.menu, ...state.menuAdds].some(m => m.name === name);
        if (!known) state.menuAdds.push({ name, part: 'みんなの種目', how: amount ? `報告された内容：${amount}` : '報告された種目です。', tip: '説明と動画は本部が用意します。', by: 'あなたが追加', video: false });
        state.myPosts.unshift({ id: 'me' + Date.now(), name: 'あなた', area: 'ここ', kind: 'training', label: name, detail: amount, cheers: {}, comments: [] });
        persist(); closeSheet(); renderTab();
        toast(known ? '報告しました' : `「${name}」がメニュー表に増えました`);
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

  function openMind(min) {
    openSheet(`
      <h2 style="margin:0;font-size:18px">瞑想 ${min}分</h2>
      <div class="muted">目を閉じて、呼吸だけに気持ちを向けます。</div>
      <div class="breath"><div class="circle" id="mclock" style="width:160px;height:160px;font-size:28px">${min}:00</div></div>
      <button class="btn ghost" id="mfast">見本なので早送りで終える</button>`, el => {
      let left = min * 60;
      const finish = () => {
        clearTimers();
        state.mindMinutes += min; persist();
        $('#mclock', el).textContent = 'お楽しみ様';
        $('#mfast', el).remove();
        renderTab();
      };
      timers.push(setInterval(() => {
        left--;
        $('#mclock', el).textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        if (left <= 0) finish();
      }, 1000));
      $('#mfast', el).onclick = finish;
    });
  }

  // ---- 歩く ----
  let walk = null;
  function renderWalk() {
    setTitle('歩く');
    if (!walk) {
      view.innerHTML = `
        <div class="card" style="text-align:center">
          <div class="muted">今日のあなた</div>
          <div class="big">${num(state.todaySteps)}<small>歩</small></div>
          <div class="muted" style="margin-top:8px">本番のアプリでは、スマホの歩数が自動で入ります。</div>
        </div>
        <div style="margin-top:20px"><button class="btn sun" id="start">歩き始める</button></div>
        <p class="muted" style="margin-top:12px">歩いた道は地図に線で残ります。自宅の周りは線を消し、公開は歩き終わってからです。</p>`;
      $('#start').onclick = () => { walk = { steps: 0, sec: 0, d: 'M20 110' , x: 20, y: 110 }; renderWalk(); };
      return;
    }
    view.innerHTML = `
      <div class="map" style="height:220px">${routeSvg(walk.d, true)}<span class="note">見本なので早送りで動いています</span></div>
      <div class="walk-stats">
        <div class="card"><div class="muted">歩数</div><b id="wSteps">0</b></div>
        <div class="card"><div class="muted">距離</div><b id="wKm">0.0km</b></div>
        <div class="card"><div class="muted">時間</div><b id="wTime">0分</b></div>
      </div>
      <button class="btn" id="stop">歩き終える</button>
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px" class="muted"><input type="checkbox" id="showMap" checked> 地図もみんなに見せる</label>`;
    const tick = () => {
      walk.sec += 30;
      walk.steps += 40 + Math.round(Math.random() * 20);
      walk.x = Math.min(245, walk.x + 6);
      walk.y = Math.max(20, Math.min(125, walk.y + (Math.random() * 30 - 16)));
      walk.d += ` L${walk.x.toFixed(0)} ${walk.y.toFixed(0)}`;
      $('.map svg path', view).setAttribute('d', walk.d);
      $('#wSteps').textContent = num(walk.steps);
      $('#wKm').textContent = (walk.steps * 0.00068).toFixed(1) + 'km';
      $('#wTime').textContent = Math.floor(walk.sec / 60) + '分';
      if (walk.x >= 245) walk.x = 20;
    };
    clearTimers();
    timers.push(setInterval(tick, 250));
    $('#stop').onclick = () => {
      clearTimers();
      const before = state.totalSteps;
      const km = +(walk.steps * 0.00068).toFixed(1);
      state.todaySteps += walk.steps;
      state.totalSteps += walk.steps;
      state.myPosts.unshift({
        id: 'me' + Date.now(), name: 'あなた', area: 'ここ', kind: 'walk', steps: walk.steps, km,
        course: 'さっきの道', time: `${Math.floor(walk.sec / 60)}分`,
        route: $('#showMap').checked ? walk.d : 'M20 70 L240 70', cheers: {}, comments: []
      });
      walk = null;
      persist();
      const opened = D.hints.filter(h => h.at > before && h.at <= state.totalSteps);
      toast(opened.length ? '新しいヒントカードが開きました' : 'お楽しみ様。みんなに届けました');
      state.tab = 'home'; state.homeSeg = 'feed';
      renderTab();
    };
  }

  // ---- ヒント ----
  function renderHints() {
    setTitle('ヒント');
    const next = D.hints.find(h => h.at > state.totalSteps);
    view.innerHTML = `
      <div class="card" style="background:var(--sun-soft);border-color:var(--sun)">
        <div class="muted">これまでの合計</div>
        <div class="big">${num(state.totalSteps)}<small>歩</small></div>
        <div class="muted">${next ? `あと${num(next.at - state.totalSteps)}歩で次のカードが開きます` : 'すべてのカードが開きました'}</div>
      </div>
      <div class="section-title">歩くほど届くヒント</div>
      ${D.hints.map(h => {
        const open = state.totalSteps >= h.at;
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
    const vals = rows.map(r => r[key]);
    const lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
    const X = i => pl + i * (w - pl - pr) / (rows.length - 1);
    const Y = v => pt + (hi - v) / (hi - lo) * (h - pt - pb);
    const d = rows.map((r, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(r[key]).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${key}の推移">
      <line x1="${pl}" x2="${w - pr}" y1="${h - pb}" y2="${h - pb}" stroke="var(--line)"/>
      <text x="4" y="${Y(hi) + 4}" font-size="10" fill="var(--ink-2)">${hi}</text>
      <text x="4" y="${Y(lo) + 4}" font-size="10" fill="var(--ink-2)">${lo}</text>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2.5"/>
      ${rows.map((r, i) => `<circle cx="${X(i)}" cy="${Y(r[key])}" r="4" fill="${color}"/>
        <text x="${X(i)}" y="${h - 8}" font-size="10" text-anchor="middle" fill="var(--ink-2)">${+r.date.slice(5)}月</text>
        ${i === rows.length - 1 ? `<text x="${X(i) - 4}" y="${Y(r[key]) - 9}" font-size="11" text-anchor="end" font-weight="700" fill="var(--ink)">${r[key]}${unit}</text>` : ''}`).join('')}
    </svg>`;
  }

  let meChart = 'muscle';
  function renderMe() {
    setTitle('マイページ');
    const rows = D.inbody;
    const keys = { muscle: ['骨格筋量', 'kg', 'var(--leaf)'], fat: ['体脂肪率', '%', 'var(--sun)'], weight: ['体重', 'kg', 'var(--sky)'] };
    const first = rows[0][meChart], last = rows.at(-1)[meChart];
    const diff = +(last - first).toFixed(1);
    const pub = [['steps', '歩数'], ['training', '筋トレ・瞑想'], ['weight', '体重'], ['muscle', '骨格筋量'], ['fat', '体脂肪率'], ['bp', '血圧・脈']];
    view.innerHTML = `
      <div class="section-title" style="margin-top:0">InBodyの推移</div>
      <div class="card chart">
        <div class="seg" style="grid-template-columns:repeat(3,1fr)">
          ${Object.entries(keys).map(([k, v]) => `<button data-ck="${k}" class="${meChart === k ? 'on' : ''}">${v[0]}</button>`).join('')}
        </div>
        ${chart(rows, meChart, keys[meChart][1], keys[meChart][2])}
        <div class="muted">${rows.length}回の測定で ${diff > 0 ? '+' : ''}${diff}${keys[meChart][1]}（例のデータ）</div>
      </div>

      <div class="section-title">みんなに見せるもの</div>
      <div class="card" style="padding:0 16px">
        ${pub.map(([k, label]) => `<div class="row"><span>${label}</span><button class="toggle ${state.publicSet[k] ? 'on' : ''}" data-pub="${k}" aria-label="${label}を公開"></button></div>`).join('')}
        <div class="row"><span>服薬・体調メモ<br><span class="r-sub">いつも自分だけ</span></span><span class="muted">非公開</span></div>
      </div>

      <div class="section-title">うえむきが生まれたきっかけ</div>
      <div class="card">
        <p style="margin-top:0">代表は心筋梗塞を経験し、母はステージ4のがんと向き合っています。</p>
        <p>健康を祈るだけでなく、毎日の一歩を見せ合い、応援し合える場所をつくりたい。そんな思いから、うえむきは生まれました。</p>
        <p style="margin-bottom:0">上を向いて、一緒に歩いていきましょう。</p>
      </div>
      <button class="btn ghost" id="reset" style="margin-top:20px">見本のデータを最初に戻す</button>`;
    view.querySelectorAll('[data-ck]').forEach(b => b.onclick = () => { meChart = b.dataset.ck; renderMe(); });
    view.querySelectorAll('[data-pub]').forEach(b => b.onclick = () => {
      const k = b.dataset.pub; state.publicSet[k] = !state.publicSet[k]; persist(); renderMe();
    });
    $('#reset').onclick = () => {
      try { Object.keys(localStorage).filter(k => k.startsWith('uemuki.')).forEach(k => localStorage.removeItem(k)); } catch {}
      location.reload();
    };
  }

  // ---- タブ ----
  const renderers = { home: renderHome, body: renderBody, walk: renderWalk, hints: renderHints, me: renderMe };
  function renderTab() {
    if ($('#sheet').hidden) clearTimers();
    document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
    renderers[state.tab]();
  }
  document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => {
    if (state.tab === 'walk' && walk && b.dataset.tab !== 'walk') { toast('歩き終えるボタンで記録できます'); return; }
    state.tab = b.dataset.tab; window.scrollTo(0, 0); renderTab();
  });

  renderTab();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
