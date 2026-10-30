/* CTRL + ALT + QUEST — single-player review game.
   Questions come from bank.js (built from the teacher's JSON files by build.py).
   Everything stays in this browser: no accounts, no network calls, no student data sent anywhere. */
(() => {
  'use strict';

  // ---------- data ----------
  const KEY = 'ctrl+alt+quest';
  const BANK = (() => {
    const bin = atob(window.QUEST_BANK);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length);
    return JSON.parse(new TextDecoder().decode(bytes));
  })();

  const QMAP = {};
  BANK.worlds.forEach((w, wi) => {
    w.index = wi;
    w.categories.forEach(c => c.questions.forEach((q, qi) =>
      (QMAP[q.id] = { q, wid: w.id, cat: c.name, catId: c.id, row: qi, kind: 'board' })));
    w.lightning.forEach(q => (QMAP[q.id] = { q, wid: w.id, cat: 'Lightning Round', kind: 'lightning' }));
  });
  BANK.speed.forEach(q => (QMAP[q.id] = { q, wid: 'boss', cat: 'Sudden Byte', kind: 'speed' }));
  BANK.finals.forEach(q => (QMAP[q.id] = { q, wid: 'boss', cat: 'Final Byte: ' + q.category, kind: 'final' }));

  const WORLD = Object.fromEntries(BANK.worlds.map(w => [w.id, w]));
  const BOARD_COUNT = BANK.worlds.reduce((n, w) => n + w.categories.reduce((m, c) => m + c.questions.length, 0), 0);
  const TOTAL_Q = BOARD_COUNT + BANK.worlds.reduce((n, w) => n + w.lightning.length, 0) + BANK.speed.length + 1;

  const TIME = { mc: 30, tf: 20, order: 45, lightning: 12, speed: 15, final: 60 };
  const STORE = 'caq-save-v1';
  const PREFS = 'caq-prefs-v1';
  const SALT = 'caq|7th|steam';
  const LIFE = {
    fifty: { label: '50/50', icon: '½', tip: 'Removes two wrong answers' },
    freeze: { label: 'Freeze', icon: '❄', tip: 'Stops the timer for this question' },
    shield: { label: 'Shield', icon: '⛨', tip: 'If you miss, your streak is safe' },
  };
  const BADGES = {
    streak5: ['🔥', 'Hot Streak', '5 correct in a row'],
    streak10: ['☄️', 'Unstoppable', '10 correct in a row'],
    speedy: ['⚡', 'Lightning Fingers', '10 correct answers in under 5 seconds'],
    perfectCat: ['🎯', 'Category Clear', 'Every question right in one category'],
    threeStar: ['⭐', 'Triple Star', '3 stars on a world'],
    allStars: ['🌌', 'Galaxy Brain', '3 stars on every world'],
    finalByte: ['👑', 'Final Byte', 'Won the Final Byte'],
    questDone: ['🏁', 'Quest Complete', 'Finished the whole quest'],
  };
  const RANKS = [
    [90, 'Kernel Legend'], [80, 'Network Ninja'], [70, 'Data Defender'],
    [60, 'Byte Builder'], [45, 'Packet Pathfinder'], [0, 'Pixel Rookie'],
  ];

  // ---------- utils ----------
  const $ = (s, r = document) => r.querySelector(s);
  const app = $('#app');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const mins = ms => {
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    return m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
  };
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const range = n => Array.from({ length: n }, (_, i) => i);
  const todayISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // ---------- storage ----------
  let S = null;
  let prefs = { sound: true };
  try { prefs = Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS) || '{}')); } catch (e) { /* private mode */ }
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s && s.v === 1) S = s;
  } catch (e) { /* ignore */ }
  const save = () => { try { if (S) localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* storage full or blocked */ } };
  const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) { /* ignore */ } };

  function newGame(name, period) {
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const rand = rng(seed);
    const world = {};
    BANK.worlds.forEach((w, wi) => {
      const pool = [];
      w.categories.forEach(c => c.questions.forEach((q, qi) => { if (qi >= 1) pool.push(q.id); }));
      world[w.id] = {
        done: {}, li: 0, complete: false,
        life: { fifty: 1, freeze: 1, shield: 1 },
        doubles: shuffle(pool, rand).slice(0, wi >= 2 ? 2 : 1),
      };
    });
    S = {
      v: 1, name, period, seed,
      startedAt: Date.now(), finishedAt: null, playMs: 0,
      score: 0, streak: 0, bestStreak: 0, fast: 0,
      world,
      boss: { stage: 'intro', i: 0, finalId: BANK.finals[Math.floor(rand() * BANK.finals.length)].id, wager: 0 },
      log: [], cur: null, badges: {}, finished: false,
    };
    save();
  }

  // active play clock (only while the tab is visible)
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = Math.min(now - lastTick, 5000);
    lastTick = now;
    if (S && !S.finished && !document.hidden) {
      S.playMs += dt;
      if (Math.floor(S.playMs / 1000) % 5 === 0) save();
    }
  }, 1000);

  // ---------- sound ----------
  let actx = null;
  function tone(freq, dur = 0.12, type = 'sine', vol = 0.08, when = 0) {
    if (!prefs.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime + when;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* audio blocked */ }
  }
  const sfx = {
    open: () => { tone(520, 0.08, 'triangle'); tone(780, 0.1, 'triangle', 0.07, 0.07); },
    good: () => { tone(660, 0.1, 'triangle'); tone(880, 0.12, 'triangle', 0.08, 0.09); tone(1320, 0.18, 'triangle', 0.06, 0.18); },
    bad: () => { tone(220, 0.22, 'sawtooth', 0.05); tone(160, 0.28, 'sawtooth', 0.05, 0.12); },
    tick: () => tone(1000, 0.04, 'square', 0.03),
    power: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, 'triangle', 0.07, i * 0.07)); },
    win: () => { [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(f, 0.16, 'triangle', 0.07, i * 0.11)); },
  };

  // ---------- toast + confetti ----------
  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function confetti(ms = 2400) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = $('#confetti'), ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const colors = ['#5EEAD4', '#E8B048', '#FF7A6B', '#A78BFA', '#4ADE80'];
    const parts = range(140).map(() => ({
      x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.5,
      vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
      r: 4 + Math.random() * 5, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const end = performance.now() + ms;
    (function frame(now) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.a += p.va; p.vy += 0.04;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        ctx.restore();
      });
      if (now < end) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })(performance.now());
  }

  // two-tap confirm for destructive buttons (no confirm() dialogs)
  function armConfirm(btn, label, onConfirm) {
    btn.addEventListener('click', () => {
      if (btn.dataset.armed) { onConfirm(); return; }
      const orig = btn.textContent;
      btn.dataset.armed = '1';
      btn.textContent = label;
      setTimeout(() => { delete btn.dataset.armed; btn.textContent = orig; }, 4000);
    });
  }

  // ---------- stats ----------
  function worldStats(wid) {
    const L = S.log.filter(e => e.w === wid);
    const correct = L.filter(e => e.c).length;
    const total = WORLD[wid].categories.reduce((n, c) => n + c.questions.length, 0) + WORLD[wid].lightning.length;
    const pts = L.reduce((n, e) => n + e.p, 0);
    const acc = pct(correct, L.length);
    const stars = S.world[wid].complete ? (acc >= 90 ? 3 : acc >= 75 ? 2 : acc >= 50 ? 1 : 0) : 0;
    return { answered: L.length, correct, total, pts, acc, stars };
  }
  function overall() {
    const fin = S.log.find(e => e.k === 'final');
    const answered = S.log.length;
    const correct = S.log.filter(e => e.c).length;
    const acc = pct(correct, answered);
    const rank = RANKS.find(r => acc >= r[0])[1];
    return { answered, correct, acc, rank, fin };
  }
  function catStats() {
    const out = [];
    BANK.worlds.forEach(w => w.categories.forEach(c => {
      const L = S.log.filter(e => e.catId === c.id);
      out.push({ world: w.name, name: c.name, correct: L.filter(e => e.c).length, answered: L.length, total: c.questions.length });
    }));
    return out;
  }
  function award(id) {
    if (S.badges[id]) return;
    S.badges[id] = Date.now();
    const b = BADGES[id];
    setTimeout(() => { toast(`${b[0]} Badge unlocked: ${b[1]}`); sfx.power(); }, 700);
  }

  // ---------- HUD ----------
  const ICON = {
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/></svg>',
  };
  function hud({ back = false } = {}) {
    return `<header class="hud">
      <div class="hud-brand">${back ? `<button class="hud-icon" data-act="map" aria-label="Back to the quest map">${ICON.map}</button>` : ''}
        <span>CTRL<span style="color:var(--gold)">+</span>ALT<span style="color:var(--gold)">+</span><span style="color:var(--teal)">QUEST</span></span>
        <small>${esc(S.name)}</small></div>
      <div class="hud-stat"><b id="hud-score">${fmt(S.score)}</b><span>Score</span></div>
      <div class="hud-stat streak"><b>${S.streak}${S.streak >= 3 ? '🔥' : ''}</b><span>Streak</span></div>
      <div class="hud-stat"><b>${S.log.length}/${TOTAL_Q}</b><span>Done</span></div>
      <button class="hud-icon" data-act="help" aria-label="How to play">${ICON.help}</button>
      <button class="hud-icon" data-act="sound" aria-label="${prefs.sound ? 'Mute sound' : 'Turn sound on'}">${prefs.sound ? ICON.sound : ICON.mute}</button>
    </header>`;
  }
  function wireHud() {
    app.querySelectorAll('[data-act="map"]').forEach(b => b.onclick = () => { stopTimer(); renderMap(); });
    app.querySelectorAll('[data-act="help"]').forEach(b => b.onclick = showHelp);
    app.querySelectorAll('[data-act="sound"]').forEach(b => b.onclick = () => {
      prefs.sound = !prefs.sound; savePrefs();
      b.innerHTML = prefs.sound ? ICON.sound : ICON.mute;
      b.setAttribute('aria-label', prefs.sound ? 'Mute sound' : 'Turn sound on');
      if (prefs.sound) sfx.open();
    });
  }

  const HOWTO = `
    <ul class="howto-list">
      <li class="c-teal"><span class="ico">1</span><span><b>Clear 4 worlds.</b> Two are from Units 1 &amp; 2, two are pop culture. Each world is a board of 30 questions. Pick any tile you want.</span></li>
      <li class="c-gold"><span class="ico">$</span><span><b>Score points.</b> Harder tiles are worth more. Answer fast for a <b>speed bonus</b>. Get 3+ in a row for a <b>streak bonus</b>. Wrong answers cost nothing.</span></li>
      <li class="c-coral"><span class="ico">2×</span><span><b>Hidden Double Bytes</b> are on every board. Find one and that question is worth double.</span></li>
      <li class="c-violet"><span class="ico">⚡</span><span><b>Lightning Round</b> after each board: 6 quick questions, 12 seconds each.</span></li>
      <li class="c-teal"><span class="ico">✚</span><span><b>Power-ups</b> (one each per world): <b>50/50</b> removes two wrong answers, <b>Freeze</b> stops the clock, <b>Shield</b> saves your streak if you miss.</span></li>
      <li class="c-gold"><span class="ico">👑</span><span><b>Boss Stage:</b> the Sudden Byte speed round, then the <b>Final Byte</b>, where you bet points on one last question.</span></li>
      <li class="c-coral"><span class="ico">⬇</span><span>At the end, <b>download your score report PDF</b> and turn it in. Your progress saves on this device, so you can keep going next class.</span></li>
    </ul>`;
  function showHelp() {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal card" role="dialog" aria-modal="true" aria-labelledby="help-h">
      <h2 id="help-h">How to play</h2>${HOWTO}
      <div class="row" style="justify-content:flex-end"><button class="btn" id="help-close">Got it</button></div></div>`;
    document.body.appendChild(back);
    // the question clock keeps running behind this dialog, so it can't be used to pause
    const close = () => back.remove();
    $('#help-close', back).onclick = close;
    back.addEventListener('click', e => { if (e.target === back) close(); });
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });
    $('#help-close', back).focus();
  }

  // ---------- title ----------
  function renderTitle() {
    stopTimer();
    const has = S && S.name;
    app.innerHTML = `<section class="title-screen">
      <div class="hero" style="background-image:url(assets/hero.jpg)" role="img" aria-label="Four floating game worlds connected by glowing bridges">
        <div class="hero-text">
          <div class="logo">CTRL <span class="plus">+</span> ALT <span class="plus">+</span> <span class="q">QUEST</span></div>
          <p class="tagline">A solo review adventure: Units 1 &amp; 2 plus pop culture. ${TOTAL_Q} questions, 4 worlds, 1 boss.</p>
        </div>
      </div>
      <div class="title-grid">
        <div class="card start-card">
          ${has ? `<div class="resume-box">
              <div>Welcome back, <b>${esc(S.name)}</b>! ${S.finished ? 'You finished the quest.' : `You have <b>${fmt(S.score)}</b> points and ${S.log.length} of ${TOTAL_Q} questions done.`}</div>
              <div class="row"><button class="btn big" id="resume">${S.finished ? 'See my results' : 'Continue my quest'}</button>
              <button class="link-btn" id="newplayer">Not ${esc(S.name)}? Start a new quest</button></div>
            </div>` : ''}
          <form id="start-form" class="start-card" style="padding:0" ${has ? 'hidden' : ''}>
            <h2>Start your quest</h2>
            <div class="field"><label for="nm">Your name</label>
              <input id="nm" name="nm" maxlength="30" autocomplete="off" required placeholder="First name and last initial">
              <small>This only goes on your score report. It never leaves this computer.</small></div>
            <div class="field"><label for="pd">Class period <span class="muted">(optional)</span></label>
              <input id="pd" name="pd" maxlength="14" autocomplete="off" placeholder="e.g. Period 3"></div>
            <div class="row"><button class="btn big" type="submit">Start the quest</button></div>
          </form>
        </div>
        <div class="card howto-card"><h3>How it works</h3>${HOWTO}
          <p class="privacy" style="margin-top:14px">No logins and no data collection. Your progress is saved only in this browser.</p></div>
      </div>
    </section>`;
    const form = $('#start-form');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = $('#nm').value.trim().replace(/\s+/g, ' ');
      if (!name) { $('#nm').focus(); return; }
      newGame(name, $('#pd').value.trim());
      sfx.power();
      renderMap();
    });
    if (has) {
      $('#resume').onclick = () => resume();
      armConfirm($('#newplayer'), 'Tap again: this erases the saved quest on this device', () => {
        try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
        S = null;
        renderTitle();
        $('#nm').focus();
      });
    }
  }

  function resume() {
    if (S.finished) return renderResults();
    if (S.cur) return renderQuestion();
    renderMap();
  }

  // ---------- map ----------
  function unlocked(wi) { return wi === 0 || S.world[BANK.worlds[wi - 1].id].complete; }
  function renderMap() {
    stopTimer();
    if (S.finished) return renderResults();
    const bossOpen = BANK.worlds.every(w => S.world[w.id].complete);
    app.innerHTML = `${hud()}
      <div class="map-head">
        <div><p class="muted">Quest map</p><h1>${S.log.length ? `Keep going, ${esc(S.name.split(' ')[0])}!` : `Welcome, ${esc(S.name.split(' ')[0])}. Start with World 1!`}</h1></div>
        <div class="overall"><div class="row" style="justify-content:space-between"><span class="muted">Quest progress</span><b class="mono">${pct(S.log.length, TOTAL_Q)}%</b></div>
          <div class="bar"><i style="width:${pct(S.log.length, TOTAL_Q)}%"></i></div></div>
      </div>
      <div class="worlds">
        ${BANK.worlds.map((w, wi) => {
          const st = worldStats(w.id), ws = S.world[w.id], open = unlocked(wi);
          const status = !open ? `<span class="lock-note">🔒 Clear World ${wi} to unlock</span>`
            : ws.complete ? `<span class="go-pill">Review board</span>`
            : st.answered ? `<span class="go-pill">Continue</span>` : `<span class="go-pill">Play</span>`;
          return `<button class="world-card c-${w.color} ${open ? '' : 'locked'}" data-w="${w.id}" ${open ? '' : 'disabled'}>
            <div class="world-art" style="background-image:url(${w.art})"><span class="world-num">WORLD ${wi + 1}</span></div>
            <div class="world-body"><h2>${esc(w.name)}</h2><p>${esc(w.sub)}</p>
              <div class="bar"><i style="width:${pct(st.answered, st.total)}%"></i></div>
              <div class="world-foot"><span class="muted mono">${st.answered}/${st.total} · ${fmt(st.pts)} pts</span>
                <span class="stars" aria-label="${st.stars} of 3 stars">${starHTML(st.stars)}</span>${status}</div>
            </div></button>`;
        }).join('')}
        <button class="world-card boss-card c-gold ${bossOpen ? '' : 'locked'}" id="boss" ${bossOpen ? '' : 'disabled'}>
          <div class="world-art" style="background-image:url(assets/hero.jpg);background-position:center 40%"><span class="world-num">BOSS STAGE</span></div>
          <div class="world-body"><h2>SUDDEN BYTE + FINAL BYTE</h2>
            <p>10 rapid-fire questions, then bet your points on the Final Byte.</p>
            <div class="world-foot"><span class="muted">${S.boss.stage === 'intro' ? '11 questions' : `${S.boss.i}/${BANK.speed.length} speed questions done`}</span>
            ${bossOpen ? '<span class="go-pill">Enter boss stage</span>' : '<span class="lock-note">🔒 Clear all 4 worlds</span>'}</div></div>
        </button>
      </div>
      <div class="map-tools">
        <button class="btn ghost small" id="progress-pdf">⬇ Download progress report (PDF)</button>
        <button class="btn ghost small" id="to-title">Switch player</button>
      </div>`;
    wireHud();
    app.querySelectorAll('[data-w]').forEach(b => b.onclick = () => openWorld(b.dataset.w));
    $('#boss').onclick = openBoss;
    $('#progress-pdf').onclick = () => downloadPDF(false);
    $('#to-title').onclick = renderTitle;
    window.scrollTo(0, 0);
  }
  const starHTML = n => range(3).map(i => `<span class="${i < n ? 'on' : ''}">★</span>`).join('');

  // ---------- world board ----------
  function boardRemaining(wid) {
    const ws = S.world[wid];
    return WORLD[wid].categories.reduce((n, c) => n + c.questions.filter(q => !ws.done[q.id]).length, 0);
  }
  function openWorld(wid) {
    const ws = S.world[wid];
    if (!ws.complete && boardRemaining(wid) === 0) return renderLightningIntro(wid);
    renderBoard(wid);
  }
  function renderBoard(wid) {
    stopTimer();
    const w = WORLD[wid], ws = S.world[wid];
    const left = boardRemaining(wid);
    app.innerHTML = `${hud({ back: true })}
      <div class="c-${w.color}">
        <div class="board-head">
          <div><p class="muted">World ${w.index + 1}</p><h1>${esc(w.name)}</h1><p>${esc(w.sub)}</p></div>
          <div class="lifebar" aria-label="Power-ups left in this world">
            ${Object.entries(LIFE).map(([k, l]) => `<span class="life ${ws.life[k] ? '' : 'used'}" title="${l.tip}">${l.icon} ${l.label}</span>`).join('')}
          </div>
        </div>
        <div class="board">
          ${w.categories.map(c => `<div class="col">
            <div class="cat"><b>${esc(c.name)}</b><small>${esc(c.blurb)}</small></div>
            ${c.questions.map(q => {
              const d = ws.done[q.id];
              if (d) return `<button class="tile done ${d.c ? 'ok' : 'bad'}" disabled aria-label="${esc(c.name)} ${q.value}, ${d.c ? 'correct' : 'missed'}">
                <span class="t-mark">${d.c ? '✓' : '✗'}</span><span>${d.c ? '+' + fmt(d.p) : q.value}</span></button>`;
              return `<button class="tile" data-q="${q.id}" aria-label="${esc(c.name)} for ${q.value}">${q.value}</button>`;
            }).join('')}
          </div>`).join('')}
        </div>
        <div class="board-foot">
          <span>${ws.complete ? 'World cleared! Head back to the map for the next one.' : `${left} tile${left === 1 ? '' : 's'} left, then the Lightning Round.`}</span>
          <button class="btn ghost small" data-act="map">Back to map</button>
        </div>
      </div>`;
    wireHud();
    app.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { sfx.open(); startQ('board', b.dataset.q, wid); });
    window.scrollTo(0, 0);
  }

  function renderLightningIntro(wid) {
    stopTimer();
    const w = WORLD[wid];
    app.innerHTML = `${hud({ back: true })}
      <section class="stage c-${w.color}"><div class="card">
        <div class="bolt">⚡</div>
        <h1>Lightning Round</h1>
        <p>You cleared the ${esc(w.name)} board! Now answer ${w.lightning.length} quick questions. You only get <b>${TIME.lightning} seconds</b> each, so trust your gut.</p>
        <button class="btn big" id="go">Start the Lightning Round</button>
      </div></section>`;
    wireHud();
    $('#go').onclick = () => startQ('lightning', w.lightning[S.world[wid].li].id, wid);
    $('#go').focus();
  }

  function renderWorldDone(wid) {
    stopTimer();
    const w = WORLD[wid], st = worldStats(wid);
    const cats = catStats().filter(c => c.world === w.name);
    const nextW = BANK.worlds[w.index + 1];
    app.innerHTML = `${hud({ back: true })}
      <section class="stage c-${w.color}"><div class="card">
        <p class="mono muted">WORLD ${w.index + 1} CLEARED</p>
        <h1>${esc(w.name)}</h1>
        <div class="stars" style="font-size:2.6rem">${starHTML(st.stars)}</div>
        <div class="stat-grid">
          <div class="stat"><b>${fmt(st.pts)}</b><span>World points</span></div>
          <div class="stat"><b>${st.correct}/${st.answered}</b><span>Correct</span></div>
          <div class="stat"><b>${st.acc}%</b><span>Accuracy</span></div>
        </div>
        <div class="cat-list">${cats.map(c => `<div class="cat-row"><span>${esc(c.name)}</span><b>${c.correct}/${c.total}</b></div>`).join('')}</div>
        <button class="btn big" id="go">${nextW ? `On to World ${w.index + 2}: ${esc(nextW.name)}` : 'On to the Boss Stage'}</button>
      </div></section>`;
    wireHud();
    $('#go').onclick = () => (nextW ? renderBoard(nextW.id) : openBoss());
    confetti(); sfx.win();
  }

  // ---------- boss ----------
  function openBoss() {
    const b = S.boss;
    if (b.stage === 'intro') return renderBossIntro();
    if (b.stage === 'speed') return startQ('speed', BANK.speed[b.i].id, 'boss');
    if (b.stage === 'wager') return renderWager();
    if (b.stage === 'final') return startQ('final', b.finalId, 'boss');
    renderResults();
  }
  function renderBossIntro() {
    stopTimer();
    app.innerHTML = `${hud({ back: true })}
      <section class="stage c-gold"><div class="card">
        <p class="mono muted">BOSS STAGE</p>
        <h1>Sudden Byte</h1>
        <p>All four worlds cleared. Now prove it: <b>${BANK.speed.length} rapid-fire questions</b>, ${TIME.speed} seconds each, worth 250 points plus speed bonus. No power-ups in the boss stage.</p>
        <p>After that comes the <b>Final Byte</b>. You bet some of your points on one last question.</p>
        <button class="btn big" id="go">Start the Boss Stage</button>
      </div></section>`;
    wireHud();
    $('#go').onclick = () => { S.boss.stage = 'speed'; S.boss.i = 0; save(); startQ('speed', BANK.speed[0].id, 'boss'); };
    $('#go').focus();
  }
  function renderWager() {
    stopTimer();
    const fq = QMAP[S.boss.finalId].q;
    const max = Math.max(S.score, 500);
    const start = Math.min(max, Math.round(max / 4 / 50) * 50);
    app.innerHTML = `${hud()}
      <section class="stage c-gold"><div class="card">
        <p class="mono muted">FINAL BYTE</p>
        <h1>${esc(fq.category)}</h1>
        <p>Here is the category. How many points will you bet? Get it right and you <b>win</b> your bet. Miss it and you <b>lose</b> it.</p>
        <div class="wager-val mono" id="wv">${fmt(start)}</div>
        <input type="range" id="wr" min="0" max="${max}" step="50" value="${start}" aria-label="Your bet">
        <div class="wager-quick">
          <button class="btn ghost small" data-w="0">Play it safe (0)</button>
          <button class="btn ghost small" data-w="${Math.round(max / 2 / 50) * 50}">Half</button>
          <button class="btn ghost small" data-w="${max}">All in (${fmt(max)})</button>
        </div>
        <button class="btn big" id="lock">Lock in my bet</button>
      </div></section>`;
    wireHud();
    const r = $('#wr'), v = $('#wv');
    r.oninput = () => (v.textContent = fmt(r.value));
    app.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { r.value = b.dataset.w; r.oninput(); });
    $('#lock').onclick = () => {
      S.boss.wager = Math.max(0, Math.min(max, parseInt(r.value, 10) || 0));
      S.boss.stage = 'final';
      save();
      startQ('final', S.boss.finalId, 'boss');
    };
  }

  // ---------- question engine ----------
  let timerId = null;
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  function startQ(kind, qid, wid) {
    const q = QMAP[qid].q;
    const rand = rng(S.seed ^ hash(qid));
    let order;
    if (q.type === 'mc') order = /above|both|none of/i.test(q.choices.join('|')) ? range(q.choices.length) : shuffle(range(q.choices.length), rand);
    else if (q.type === 'tf') order = [0, 1];
    else {
      order = shuffle(range(q.items.length), rand);
      if (order.every((v, i) => v === i)) order.reverse();
    }
    const time = kind === 'board' ? TIME[q.type] : kind === 'final' ? TIME.final : Math.max(TIME[kind], q.type === 'order' ? 30 : 0);
    S.cur = {
      kind, qid, wid, order, time, left: time,
      removed: [], frozen: false, shield: false, picked: [],
      double: kind === 'board' && S.world[wid].doubles.includes(qid),
      result: null,
    };
    save();
    renderQuestion();
    if (S.cur.double) { sfx.power(); }
  }

  function renderQuestion() {
    stopTimer();
    const c = S.cur, meta = QMAP[c.qid], q = meta.q;
    const w = WORLD[c.wid];
    const color = w ? w.color : 'gold';
    const r = c.result;
    const kindLabel = { board: w ? `World ${w.index + 1}: ${w.name}` : '', lightning: '⚡ Lightning Round', speed: '👑 Sudden Byte', final: '👑 Final Byte' }[c.kind];
    let progress = '';
    if (c.kind === 'lightning') progress = `${S.world[c.wid].li + 1} of ${w.lightning.length}`;
    if (c.kind === 'speed') progress = `${S.boss.i + 1} of ${BANK.speed.length}`;
    const valueLabel = c.kind === 'final' ? `Bet: ${fmt(S.boss.wager)}` : `${fmt(q.value * (c.double ? 2 : 1))} pts`;
    const canLife = (c.kind === 'board' || c.kind === 'lightning') && !r;
    const ws = w && S.world[c.wid];

    let body;
    if (q.type === 'order') {
      const placed = c.picked;
      const pool = c.order.filter(i => !placed.includes(i));
      body = `<div class="order-zone">
        <div><div class="order-label">Your order (tap an item to remove it)</div>
          <div class="order-picked">${range(q.items.length).map(slot => {
            const it = placed[slot];
            if (it === undefined) return `<div class="order-slot">${slot + 1}.</div>`;
            const cls = r ? (it === slot ? 'right' : 'wrong') : '';
            return `<button class="order-item ${cls}" data-unpick="${slot}" ${r ? 'disabled' : ''}><span class="n">${slot + 1}</span><span>${esc(q.items[it])}</span></button>`;
          }).join('')}</div></div>
        ${r ? '' : `<div><div class="order-label">Tap these in order</div>
          <div class="order-pool">${pool.map(i => `<button class="order-item" data-pick="${i}"><span class="n">+</span><span>${esc(q.items[i])}</span></button>`).join('') || '<p class="muted">All placed. Lock it in!</p>'}</div></div>`}
        ${r ? '' : `<div class="q-actions"><button class="btn" id="lock" ${placed.length === q.items.length ? '' : 'disabled'}>Lock in my order <kbd>Enter</kbd></button>
          <button class="btn ghost small" id="reset" ${placed.length ? '' : 'disabled'}>Reset</button></div>`}
      </div>`;
    } else {
      body = `<div class="choices ${q.type === 'tf' ? 'tf' : ''}">${c.order.map((oi, di) => {
        let cls = '';
        if (r) { if (oi === q.answerIndex) cls = 'right'; else if (oi === r.choice) cls = 'wrong'; }
        else if (c.removed.includes(oi)) cls = 'removed';
        const key = q.type === 'tf' ? (oi === 0 ? 'T' : 'F') : 'ABCD'[di];
        return `<button class="choice ${cls}" data-pick="${oi}" ${r || c.removed.includes(oi) ? 'disabled' : ''}><span class="key">${key}</span><span>${esc(q.choices[oi])}</span></button>`;
      }).join('')}</div>`;
    }

    const lifeBtns = canLife ? `<div class="lifelines">${Object.entries(LIFE).map(([k, l]) => {
      const active = (k === 'freeze' && c.frozen) || (k === 'shield' && c.shield) || (k === 'fifty' && c.removed.length);
      const usable = ws.life[k] > 0 && !active && !(k === 'fifty' && (q.type !== 'mc' || q.choices.length < 4));
      return `<button class="life-btn ${active ? 'active' : ''}" data-life="${k}" ${usable ? '' : 'disabled'} title="${l.tip}">${l.icon} ${l.label}${active ? ' on' : ''}</button>`;
    }).join('')}</div>` : '';

    let fb = '';
    if (r) {
      const head = r.correct ? pick(['Correct!', 'Nailed it!', 'Yes!', 'Big brain!', 'Boom!']) : r.timeout ? "Time's up!" : 'Not quite';
      const ptsTxt = c.kind === 'final' ? (r.pts >= 0 ? '+' : '−') + fmt(Math.abs(r.pts)) : r.pts ? '+' + fmt(r.pts) : '+0';
      fb = `<section class="feedback ${r.correct ? 'good' : 'bad'}" aria-live="assertive">
        <div class="fb-head"><span class="fb-title">${head}</span><span class="fb-points">${ptsTxt}</span></div>
        ${r.parts.length ? `<div class="fb-parts">${r.parts.map(p => `<span class="chip">${esc(p[0])}${p[1] ? ' +' + fmt(p[1]) : ''}</span>`).join('')}</div>` : ''}
        ${r.correct ? '' : `<p class="fb-answer">Answer: ${esc(q.answer)}</p>`}
        ${q.explanation ? `<p class="fb-why">${esc(q.explanation)}</p>` : ''}
        <div class="row"><button class="btn big" id="next">${nextLabel()} <kbd>Enter</kbd></button></div>
      </section>`;
    }

    app.innerHTML = `${hud()}
      <div class="q-wrap c-${color}">
        <article class="card q-card">
          <div class="q-meta"><span class="chip accent">${esc(kindLabel)}</span><span class="chip">${esc(meta.cat)}</span>
            ${progress ? `<span class="chip mono">${progress}</span>` : ''}<span class="spacer"></span><span class="chip value-chip">${valueLabel}</span></div>
          ${c.double ? '<div class="double-banner">DOUBLE BYTE! This question is worth 2×</div>' : ''}
          ${r ? '' : `<div class="timer ${c.frozen ? 'frozen' : ''}" id="timer"><div class="bar"><i id="tbar" style="width:${(c.left / c.time) * 100}%"></i></div><span class="timer-num" id="tnum">${c.frozen ? '❄' : Math.ceil(c.left)}</span></div>`}
          <h2 class="q-prompt">${esc(q.prompt)}</h2>
          ${body}
          ${lifeBtns}
        </article>
        ${fb}
      </div>`;
    wireHud();

    if (r) {
      const n = $('#next');
      n.onclick = next;
      setTimeout(() => n.focus({ preventScroll: true }), 50);
      $('.feedback').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (q.type === 'order') {
      app.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { c.picked.push(+b.dataset.pick); sfx.tick(); save(); renderQuestion(); });
      app.querySelectorAll('[data-unpick]').forEach(b => b.onclick = () => { c.picked.splice(+b.dataset.unpick, 1); save(); renderQuestion(); });
      const lk = $('#lock'); if (lk) lk.onclick = () => answer();
      const rs = $('#reset'); if (rs) rs.onclick = () => { c.picked = []; save(); renderQuestion(); };
    } else {
      app.querySelectorAll('.choice[data-pick]').forEach(b => b.onclick = () => answer(+b.dataset.pick));
    }
    app.querySelectorAll('[data-life]').forEach(b => b.onclick = () => useLife(b.dataset.life));
    runTimer();
  }
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  function nextLabel() {
    const c = S.cur;
    if (c.kind === 'board') return boardRemaining(c.wid) === 0 ? 'Go to the Lightning Round' : 'Back to the board';
    if (c.kind === 'lightning') return S.world[c.wid].li + 1 >= WORLD[c.wid].lightning.length ? 'Finish the world' : 'Next question';
    if (c.kind === 'speed') return S.boss.i + 1 >= BANK.speed.length ? 'On to the Final Byte' : 'Next question';
    return 'See my results';
  }

  function runTimer() {
    const c = S.cur;
    let lastSave = Date.now(), lastSec = Math.ceil(c.left);
    timerId = setInterval(() => {
      if (!S.cur || S.cur.result || c.frozen) return;
      c.left = Math.max(0, c.left - 0.1);
      const bar = $('#tbar'), num = $('#tnum'), tm = $('#timer');
      if (bar) bar.style.width = `${(c.left / c.time) * 100}%`;
      const sec = Math.ceil(c.left);
      if (num) num.textContent = sec;
      if (tm) tm.classList.toggle('low', c.left <= 5);
      if (sec !== lastSec && sec <= 5 && sec > 0) sfx.tick();
      lastSec = sec;
      if (Date.now() - lastSave > 1000) { save(); lastSave = Date.now(); }
      if (c.left <= 0) { stopTimer(); answer(null, true); }
    }, 100);
  }

  function useLife(k) {
    const c = S.cur, q = QMAP[c.qid].q, ws = S.world[c.wid];
    if (!ws || ws.life[k] <= 0 || c.result) return;
    ws.life[k]--;
    if (k === 'fifty') {
      const wrong = shuffle(range(q.choices.length).filter(i => i !== q.answerIndex), Math.random);
      c.removed = wrong.slice(0, 2);
    }
    if (k === 'freeze') c.frozen = true;
    if (k === 'shield') c.shield = true;
    sfx.power();
    save();
    renderQuestion();
  }

  function answer(choice = null, timeout = false) {
    const c = S.cur;
    if (!c || c.result) return;
    stopTimer();
    const meta = QMAP[c.qid], q = meta.q;
    let correct;
    if (q.type === 'order') correct = c.picked.length === q.items.length && c.picked.every((v, i) => v === i);
    else correct = choice !== null && choice === q.answerIndex;
    const used = c.time - c.left;
    const frac = c.frozen ? 0.5 : Math.max(0, c.left / c.time);
    let pts = 0;
    const parts = [];
    if (c.kind === 'final') {
      pts = correct ? S.boss.wager : -Math.min(S.boss.wager, S.score);
      if (correct) { S.streak++; award('finalByte'); } else S.streak = 0;
    } else if (correct) {
      S.streak++;
      const base = q.value * (c.double ? 2 : 1);
      parts.push([c.double ? 'Double Byte' : 'Correct', base]);
      const speed = Math.round((base * 0.5 * frac) / 10) * 10;
      if (speed) parts.push(['Speed bonus', speed]);
      const streak = S.streak >= 3 ? Math.round((base * 0.1 * Math.min(S.streak - 2, 5)) / 10) * 10 : 0;
      if (streak) parts.push([`${S.streak} in a row`, streak]);
      pts = base + speed + streak;
      if (used < 5 && !c.frozen) S.fast++;
    } else if (c.shield) {
      parts.push(['🛡 Shield saved your streak', 0]);
    } else {
      S.streak = 0;
    }
    S.bestStreak = Math.max(S.bestStreak, S.streak);
    S.score = Math.max(0, S.score + pts);
    S.log.push({ id: c.qid, k: c.kind, w: c.wid, catId: meta.catId || null, c: correct, p: pts, s: Math.round(used * 10) / 10 });
    if (c.kind === 'board') S.world[c.wid].done[c.qid] = { c: correct, p: pts };
    c.result = { correct, pts, parts, choice, timeout };

    if (S.streak >= 5) award('streak5');
    if (S.streak >= 10) award('streak10');
    if (S.fast >= 10) award('speedy');
    if (c.kind === 'board') {
      const cat = WORLD[c.wid].categories.find(x => x.id === meta.catId);
      if (cat.questions.every(x => S.world[c.wid].done[x.id] && S.world[c.wid].done[x.id].c)) award('perfectCat');
    }
    save();
    (correct ? sfx.good : sfx.bad)();
    renderQuestion();
    const hs = $('#hud-score');
    if (hs && pts > 0) hs.classList.add('score-pop');
  }

  function next() {
    const c = S.cur;
    if (!c || !c.result) return;
    S.cur = null;
    if (c.kind === 'board') {
      save();
      return boardRemaining(c.wid) === 0 ? renderLightningIntro(c.wid) : renderBoard(c.wid);
    }
    if (c.kind === 'lightning') {
      const ws = S.world[c.wid];
      ws.li++;
      if (ws.li >= WORLD[c.wid].lightning.length) {
        ws.complete = true;
        const st = worldStats(c.wid);
        if (st.stars === 3) award('threeStar');
        if (BANK.worlds.every(w => S.world[w.id].complete && worldStats(w.id).stars === 3)) award('allStars');
        save();
        return renderWorldDone(c.wid);
      }
      save();
      return startQ('lightning', WORLD[c.wid].lightning[ws.li].id, c.wid);
    }
    if (c.kind === 'speed') {
      S.boss.i++;
      if (S.boss.i >= BANK.speed.length) { S.boss.stage = 'wager'; save(); return renderWager(); }
      save();
      return startQ('speed', BANK.speed[S.boss.i].id, 'boss');
    }
    S.boss.stage = 'done';
    S.finished = true;
    S.finishedAt = Date.now();
    award('questDone');
    save();
    renderResults(true);
  }

  // keyboard: A-D / 1-4 / T-F to answer, Enter to continue or lock in
  document.addEventListener('keydown', e => {
    if (!S || !S.cur || e.altKey || e.ctrlKey || e.metaKey) return;
    if (document.querySelector('.modal-back')) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const c = S.cur, q = QMAP[c.qid].q;
    if (c.result) {
      if (e.key === 'Enter' && e.target.id !== 'next') { e.preventDefault(); next(); }
      return;
    }
    if (q.type === 'order') {
      if (e.key === 'Enter' && c.picked.length === q.items.length) { e.preventDefault(); answer(); }
      return;
    }
    const k = e.key.toLowerCase();
    let di = -1;
    if (q.type === 'tf') { if (k === 't') di = c.order.indexOf(0); if (k === 'f') di = c.order.indexOf(1); }
    if ('abcd'.includes(k) && k.length === 1) di = 'abcd'.indexOf(k);
    if ('1234'.includes(k) && k.length === 1) di = +k - 1;
    if (di >= 0 && di < c.order.length) {
      const oi = c.order[di];
      if (!c.removed.includes(oi)) { e.preventDefault(); answer(oi); }
    }
  });

  // ---------- results ----------
  function renderResults(fresh = false) {
    stopTimer();
    const o = overall();
    const fin = o.fin;
    const missed = S.log.filter(e => !e.c);
    app.innerHTML = `${hud()}
      <section class="results">
        <div class="card result-hero c-gold">
          <p class="kicker">QUEST COMPLETE</p>
          <div class="big-score" id="big">${fresh ? 0 : fmt(S.score)}</div>
          <p class="muted">final score</p>
          <p class="rank">Rank: <span style="color:var(--teal)">${o.rank}</span></p>
          <div class="stat-grid" style="max-width:760px;margin-top:8px">
            <div class="stat"><b>${o.correct}/${o.answered}</b><span>Correct</span></div>
            <div class="stat"><b>${o.acc}%</b><span>Accuracy</span></div>
            <div class="stat"><b>${S.bestStreak}</b><span>Best streak</span></div>
            <div class="stat"><b>${Math.round(S.playMs / 60000)} min</b><span>Time played</span></div>
          </div>
        </div>
        <div class="card download-zone">
          <h3 class="display" style="font-size:1.4rem">Turn in your score</h3>
          <p class="muted">Download your score report and submit it the way your teacher asked.</p>
          <button class="btn big" id="pdf">⬇ Download my score report (PDF)</button>
        </div>
        <div class="result-cols">
          <div class="card panel">
            <h3>Worlds</h3>
            ${BANK.worlds.map(w => {
              const st = worldStats(w.id);
              return `<div class="world-row c-${w.color}"><span class="name">${esc(w.name)}</span><span class="mono">${st.correct}/${st.total} · ${fmt(st.pts)}</span><span class="stars">${starHTML(st.stars)}</span></div>`;
            }).join('')}
            <div class="world-row c-gold"><span class="name">SUDDEN BYTE</span><span class="mono">${S.log.filter(e => e.k === 'speed' && e.c).length}/${BANK.speed.length} · ${fmt(S.log.filter(e => e.k === 'speed').reduce((n, e) => n + e.p, 0))}</span><span></span></div>
            <div class="world-row c-gold"><span class="name">FINAL BYTE</span><span class="mono">${fin ? (fin.c ? 'Won +' : 'Lost −') + fmt(Math.abs(fin.p)) : '—'}</span><span></span></div>
            <h3 style="margin-top:8px">Badges</h3>
            <div class="badges">${Object.entries(BADGES).map(([k, b]) => `<span class="badge ${S.badges[k] ? '' : 'off'}" title="${esc(b[2])}">${b[0]} ${esc(b[1])}</span>`).join('')}</div>
          </div>
          <div class="card panel">
            <h3>Study list: questions you missed (${missed.length})</h3>
            ${missed.length ? `<div class="missed">${missed.map(e => {
              const m = QMAP[e.id];
              return `<div class="missed-item"><span class="c">${esc(m.cat)}</span><span>${esc(m.q.prompt)}</span><span class="a">${esc(m.q.answer)}</span></div>`;
            }).join('')}</div>` : '<p class="muted">You did not miss a single question. Legendary.</p>'}
          </div>
        </div>
        <div class="map-tools"><button class="btn ghost small" id="again">Play again from the start</button></div>
      </section>`;
    wireHud();
    $('#pdf').onclick = () => downloadPDF(true);
    armConfirm($('#again'), 'Tap again: download your PDF first!', () => {
      const name = S.name, period = S.period;
      newGame(name, period);
      renderMap();
    });
    if (fresh) {
      confetti(3500); sfx.win();
      const el = $('#big'), target = S.score, t0 = performance.now();
      (function step(now) {
        const k = Math.min(1, (now - t0) / 1600);
        el.textContent = fmt(target * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    }
    window.scrollTo(0, 0);
  }

  // ---------- PDF report ----------
  function checkCode(name, score, correct, answered, date) {
    const h = hash([name.trim().toLowerCase(), score, correct, answered, date, SALT].join('|'));
    const s = h.toString(36).toUpperCase().padStart(7, '0').slice(-6);
    return s.slice(0, 3) + '-' + s.slice(3);
  }

  const pdfSafe = s => String(s)
    .replace(/→/g, '->').replace(/←/g, '<-').replace(/×/g, 'x').replace(/÷/g, '/')
    .replace(/[—–]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');

  function fit(doc, s, max) {
    if (doc.getTextWidth(s) <= max) return s;
    while (s.length > 1 && doc.getTextWidth(s + '...') > max) s = s.slice(0, -1);
    return s.trimEnd() + '...';
  }

  function downloadPDF(final) {
    if (!window.jspdf || !window.jspdf.jsPDF) { toast('The PDF maker is still loading. Try again in a second.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const W = 612, H = 792, M = 48;
    const o = overall();
    const now = new Date(S.finishedAt || Date.now());
    const date = todayISO(now);
    const code = checkCode(S.name, S.score, o.correct, o.answered, date);
    const NAVY = [6, 15, 31], TEAL = [20, 150, 135], GOLD = [196, 140, 30], GRAY = [90, 105, 130], INK = [20, 28, 40];
    let y = 0;

    // header band
    doc.setFillColor(...NAVY); doc.rect(0, 0, W, 96, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(24);
    doc.text('CTRL + ALT + QUEST', M, 46);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(180, 200, 225);
    doc.text('Score Report  |  7th Grade STEAM Review: Units 1 & 2 + Pop Culture', M, 68);
    doc.setTextColor(232, 176, 72); doc.setFont('helvetica', 'bold');
    doc.text(final && S.finished ? 'QUEST COMPLETE' : 'PROGRESS REPORT (not finished)', W - M, 46, { align: 'right' });
    y = 128;

    // student info
    const info = [
      ['Student', S.name], ['Class period', S.period || '-'],
      ['Date', now.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })],
      ['Time played', mins(S.playMs)],
    ];
    doc.setFontSize(10);
    info.forEach(([k, v], i) => {
      const x = M + (i % 2) * 270, yy = y + Math.floor(i / 2) * 20;
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRAY); doc.text(k.toUpperCase(), x, yy);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK); doc.text(pdfSafe(v), x + 90, yy);
    });
    y += 46;

    // score box
    doc.setDrawColor(220, 226, 236); doc.setFillColor(246, 248, 252);
    doc.roundedRect(M, y, W - 2 * M, 104, 10, 10, 'FD');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GRAY);
    doc.text(final && S.finished ? 'FINAL SCORE' : 'SCORE SO FAR', M + 20, y + 26);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(40); doc.setTextColor(...GOLD);
    doc.text(fmt(S.score), M + 20, y + 72);
    doc.setFontSize(12); doc.setTextColor(...TEAL); doc.text('Rank: ' + o.rank, M + 20, y + 92);
    const boxes = [['Correct', `${o.correct} / ${o.answered}`], ['Accuracy', `${o.acc}%`], ['Best streak', String(S.bestStreak)], ['Progress', `${S.log.length} / ${TOTAL_Q}`]];
    boxes.forEach(([k, v], i) => {
      const x = M + 250 + (i % 2) * 130, yy = y + 34 + Math.floor(i / 2) * 40;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRAY); doc.text(k.toUpperCase(), x, yy);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...INK); doc.text(v, x, yy + 18);
    });
    y += 128;

    // worlds table
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK);
    doc.text('Results by world', M, y); y += 10;
    const cols = [M, M + 230, M + 320, M + 400, M + 470];
    const head = ['World', 'Correct', 'Accuracy', 'Points', 'Stars'];
    doc.setFillColor(...NAVY); doc.rect(M, y, W - 2 * M, 22, 'F');
    doc.setFontSize(9); doc.setTextColor(255, 255, 255);
    head.forEach((h, i) => doc.text(h.toUpperCase(), cols[i] + 8, y + 15));
    y += 22;
    const rows = BANK.worlds.map(w => {
      const st = worldStats(w.id);
      return [`${w.index + 1}. ${w.name}: ${w.sub.replace('Pop Culture: ', 'Pop: ').replace(/^Unit \d: /, '')}`, `${st.correct} / ${st.total}`, st.answered ? `${st.acc}%` : '-', fmt(st.pts), S.world[w.id].complete ? `${st.stars} of 3` : 'not cleared'];
    });
    const sp = S.log.filter(e => e.k === 'speed');
    rows.push(['Boss: Sudden Byte speed round', `${sp.filter(e => e.c).length} / ${BANK.speed.length}`, sp.length ? `${pct(sp.filter(e => e.c).length, sp.length)}%` : '-', fmt(sp.reduce((n, e) => n + e.p, 0)), '']);
    rows.push(['Boss: Final Byte wager', o.fin ? (o.fin.c ? 'Correct' : 'Missed') : 'not played', '', o.fin ? (o.fin.p >= 0 ? '+' : '-') + fmt(Math.abs(o.fin.p)) : '-', '']);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    rows.forEach((r, ri) => {
      if (ri % 2) { doc.setFillColor(244, 246, 250); doc.rect(M, y, W - 2 * M, 19, 'F'); }
      doc.setTextColor(...INK);
      r.forEach((cell, i) => doc.text(fit(doc, pdfSafe(cell), (cols[i + 1] || W - M) - cols[i] - 12), cols[i] + 8, y + 14));
      y += 19;
    });
    y += 20;

    // categories (two columns)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('Category check (board questions)', M, y); y += 8;
    const cats = catStats();
    const half = Math.ceil(cats.length / 2), colW = (W - 2 * M - 16) / 2;
    doc.setFontSize(9);
    cats.forEach((c, i) => {
      const x = M + (i >= half ? colW + 16 : 0), yy = y + 14 + (i % half) * 14.5;
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRAY);
      doc.text(pdfSafe(`${c.world}: ${c.name}`), x, yy);
      doc.setFont('helvetica', 'bold');
      const good = c.answered && c.correct / c.total >= 0.8;
      doc.setTextColor(...(c.answered ? (good ? TEAL : INK) : GRAY));
      doc.text(c.answered ? `${c.correct}/${c.total}` : '-', x + colW, yy, { align: 'right' });
    });
    y += 14 + half * 14.5 + 10;

    // badges
    const earned = Object.keys(BADGES).filter(k => S.badges[k]).map(k => BADGES[k][1]);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK);
    doc.text('Badges earned', M, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GRAY);
    const bl = doc.splitTextToSize(earned.length ? earned.join('  |  ') : 'None yet', W - 2 * M - 120);
    doc.text(bl, M + 120, y);
    y += 12 + bl.length * 12;

    // check code
    doc.setDrawColor(...TEAL); doc.setLineDashPattern([3, 3], 0);
    doc.roundedRect(M, y, W - 2 * M, 40, 8, 8, 'S'); doc.setLineDashPattern([], 0);
    doc.setFontSize(9); doc.setTextColor(...GRAY); doc.setFont('helvetica', 'normal');
    doc.text('TEACHER CHECK CODE', M + 14, y + 17);
    doc.text(`Matches: name, score ${fmt(S.score)}, ${o.correct}/${o.answered} correct, date ${date}`, M + 14, y + 31);
    doc.setFont('courier', 'bold'); doc.setFontSize(18); doc.setTextColor(...INK);
    doc.text(code, W - M - 14, y + 27, { align: 'right' });

    // page 2+: study list
    const missed = S.log.filter(e => !e.c);
    doc.addPage(); y = M;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...INK);
    doc.text('Study list: questions to review', M, y); y += 18;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GRAY);
    doc.text(missed.length ? `${missed.length} missed question${missed.length === 1 ? '' : 's'}, with the correct answers.` : 'No missed questions. Amazing work!', M, y);
    y += 22;
    missed.forEach((e, i) => {
      const m = QMAP[e.id];
      const ql = doc.splitTextToSize(pdfSafe(`${i + 1}. ${m.q.prompt}`), W - 2 * M);
      const al = doc.splitTextToSize(pdfSafe('Answer: ' + m.q.answer), W - 2 * M - 14);
      const need = 12 + ql.length * 13 + al.length * 13 + 12;
      if (y + need > H - 50) { doc.addPage(); y = M; }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRAY);
      doc.text(pdfSafe(m.cat.toUpperCase()), M, y); y += 12;
      doc.setFontSize(10); doc.setTextColor(...INK); doc.text(ql, M, y); y += ql.length * 13;
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...TEAL); doc.text(al, M + 14, y); y += al.length * 13 + 12;
    });

    // footers
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRAY);
      doc.text(pdfSafe(`${S.name}  |  CTRL + ALT + QUEST  |  ${date}`), M, H - 20);
      doc.text(`Page ${p} of ${pages}`, W - M, H - 20, { align: 'right' });
    }

    const safeName = S.name.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'student';
    doc.save(`CTRL-ALT-QUEST_${safeName}_${date}${final && S.finished ? '' : '_progress'}.pdf`);
    toast('Score report downloaded!');
  }

  // ---------- boot ----------
  if (S && S.name) {
    if (S.cur) renderQuestion();
    else renderTitle();
  } else renderTitle();
})();
