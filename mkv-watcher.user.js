// ==UserScript==
// @name         Сторож серии (MKVDrama)
// @namespace    bl-tracker
// @version      1.15
// @description  По кнопке сам обновляет страницу сериала и сигналит, когда появилась новая серия. После сигнала выключается.
// @match        *://*.mkvdrama.net/*
// @match        *://*.mkvdrama.org/*
// @match        *://mkvdrama.*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      api.telegram.org
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const KEY = 'watch:' + location.origin + location.pathname;
  const ivlMin = () => +GM_getValue('ivl', 3) || 3; // минут между обновлениями (по умолчанию 3)
  const fmt = t => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  const isChallenge = () => {
    const t = (document.title || '').toLowerCase(), b = (document.body && document.body.innerText || '').slice(0, 1500).toLowerCase();
    return /just a moment|attention required|ddos|security check|access denied|too many requests/.test(t) ||
      /verify you are human|checking your browser|are you a robot|confirm you are human|too many requests|проверка безопасности/.test(b) ||
      !!document.querySelector('#challenge-form, .cf-challenge, #cf-challenge-running, iframe[src*="challenges.cloudflare"]');
  };

  // ---- поиск номеров серий на странице ----
  function episodes() {
    const found = new Set();
    // "Episode 03", "Episode 01 - 08" (любой дефис/тире), "EP 5"
    const re = /(?:episodes?|ep\.?)\s*0*(\d{1,3})(?:\s*[^\w\s]{1,4}\s*0*(\d{1,3}))?(?!\d)/gi;
    const add = (a, b) => { a = +a; b = b ? +b : a; if (b < a || b - a > 80) b = a; for (let i = a; i <= b; i++) found.add(i); };
    const scan = txt => {
      txt = txt.replace(/[\s\u00a0\u200b-\u200f]+/g, ' ').trim();
      if (!txt || txt.length > 40 || !/^(?:episodes?|ep\.?)\s*0*\d/i.test(txt)) return;
      let m; re.lastIndex = 0;
      while ((m = re.exec(txt))) add(m[1], m[2]);
    };
    const els = document.querySelectorAll('body *');
    els.forEach(el => {
      if (el.closest('#bl-watch') || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) return;
      let own = '';
      el.childNodes.forEach(n => { if (n.nodeType === 3) own += n.nodeValue; });
      scan(own);
    });
    if (!found.size) {
      // запасной путь: видимый текст страницы построчно (не зависит от разметки)
      const panel = document.getElementById('bl-watch'); if (panel) panel.style.display = 'none';
      (document.body.innerText || '').split(/\n+/).forEach(scan);
      if (panel) panel.style.display = '';
    }
    if (!found.size) els.forEach(el => { if (!el.closest('#bl-watch')) scan(el.textContent || ''); });
    return found;
  }
  const ser = n => n + ((n % 10 === 1 && n % 100 !== 11) ? ' серия' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? ' серии' : ' серий');
  const maxEp = s => (s.size ? Math.max(...s) : null);

  // ---- сигнал ----
  let beep;
  function sound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      let t = ctx.currentTime;
      for (let i = 0; i < 6; i++) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = i % 2 ? 880 : 1175; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        o.start(t); o.stop(t + 0.3); t += 0.35;
      }
    } catch (e) {}
  }
  function tgStatus(t, ok) {
    const el = document.getElementById('bl-tg');
    if (el) { el.textContent = t; el.style.color = ok ? '#7dffb0' : '#ff8a8a'; }
  }
  function tg(text) {
    const tok = GM_getValue('tgToken', ''), chat = GM_getValue('tgChat', '');
    if (!tok || !chat) { tgStatus('Telegram не настроен: нажми ⚙ и впиши токен и chat id', false); return; }
    tgStatus('Отправляю в Telegram…', true);
    try {
      GM_xmlhttpRequest({ method: 'POST', url: 'https://api.telegram.org/bot' + tok + '/sendMessage',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
        onload: r => { let j = {}; try { j = JSON.parse(r.responseText); } catch (e) {}
          j.ok ? tgStatus('✅ Отправлено в Telegram', true) : tgStatus('❌ Telegram: ' + (j.description || r.status), false); },
        onerror: () => tgStatus('❌ Нет связи с Telegram (проверь, что разрешила доступ в Tampermonkey)', false),
        ontimeout: () => tgStatus('❌ Telegram не ответил', false) });
    } catch (e) { tgStatus('❌ ' + e.message, false); }
  }
  function alertUser(ep) {
    const title = document.title;
    const msg = ep ? `Вышла серия ${ep}!` : 'На странице появилось новое!';
    try { GM_notification({ title: 'Сторож серии', text: msg + '\n' + (document.title || ''), timeout: 0, highlight: true, onclick: () => window.focus() }); } catch (e) {}
    tg('🔔 На MkvDrama вышла серия!\n' + location.href);
    sound();
    let on = true;
    setInterval(() => { document.title = on ? '🔔 ' + msg : title; on = !on; }, 800);
  }

  // ---- панель ----
  const box = document.createElement('div');
  box.id = 'bl-watch';
  box.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;background:#17101a;color:#fff;border:1px solid #ff8ac4;border-radius:14px;padding:10px 12px;font:13px/1.35 -apple-system,Helvetica,Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:250px';
  document.body.appendChild(box);
  const btn = (id, txt, pink) => `<button id="${id}" style="all:unset;cursor:pointer;padding:6px 12px;border-radius:999px;font-weight:700;${pink ? 'background:#ff8ac4;color:#1a0b14' : 'background:#2c2230;color:#fff'}">${txt}</button>`;

  function render() {
    const st = GM_getValue(KEY, null);
    const eps = episodes(), cur = maxEp(eps);
    if (!st) {
      box.innerHTML = `<div style="margin-bottom:8px"><div style="font-size:11px;opacity:.55">сейчас на странице</div><div id="bl-cur" style="font-size:18px;font-weight:700">${cur ? ser(cur) : 'ищу серии…'}</div></div>
        <div style="display:flex;align-items:center;gap:6px">${btn('bl-go', 'Следить', true)} ${btn('bl-set', '⚙')}<span style="margin-left:auto;opacity:.4;font-size:10px">v1.15</span></div>
        <div id="bl-cfg" style="display:none;margin-top:8px">
          <input id="bl-tok" placeholder="токен бота" style="width:100%;box-sizing:border-box;margin-bottom:4px;border-radius:8px;border:1px solid #555;background:#0a0809;color:#fff;padding:4px 6px">
          <input id="bl-chat" placeholder="chat id" style="width:100%;box-sizing:border-box;margin-bottom:4px;border-radius:8px;border:1px solid #555;background:#0a0809;color:#fff;padding:4px 6px">
          <div style="margin:6px 0;opacity:.85">Обновлять раз в <select id="bl-ivl" style="border-radius:8px;border:1px solid #555;background:#0a0809;color:#fff;padding:2px 4px"><option>1</option><option>2</option><option>3</option><option>5</option></select> мин</div>
          ${btn('bl-save', 'Сохранить', true)}
        </div>`;
      box.querySelector('#bl-set').onclick = () => { const c = box.querySelector('#bl-cfg'); c.style.display = c.style.display === 'none' ? 'block' : 'none'; box.querySelector('#bl-tok').value = GM_getValue('tgToken', ''); box.querySelector('#bl-chat').value = GM_getValue('tgChat', ''); box.querySelector('#bl-ivl').value = String(ivlMin()); };
      box.querySelector('#bl-save').onclick = () => { GM_setValue('tgToken', box.querySelector('#bl-tok').value.trim()); GM_setValue('tgChat', box.querySelector('#bl-chat').value.trim()); GM_setValue('ivl', +box.querySelector('#bl-ivl').value || 3); box.querySelector('#bl-cfg').style.display = 'none'; };
      box.querySelector('#bl-go').onclick = () => {
        const now = maxEp(episodes());
        GM_setValue(KEY, { target: 0, base: now, links: document.querySelectorAll('a').length, since: Date.now() });
        location.reload();
      };
      // контент сайта может подгружаться позже: перепроверяем, пока панель открыта
      const poll = setInterval(() => {
        if (!document.getElementById('bl-cur')) { clearInterval(poll); return; }
        const c = maxEp(episodes());
        const el = document.getElementById('bl-cur');
        el.textContent = c ? ser(c) : (Date.now() - T0 > 8000 ? 'серии не найдены' : 'ищу серии…');
      }, 1000);
      return;
    }
    // режим слежения
    const isHit = c => (c && st.target && c >= st.target) || (c && st.base && c > st.base) || (!c && !st.base && document.querySelectorAll('a').length > st.links + 2);
    const fire = c => {
      GM_deleteValue(KEY);
      box.innerHTML = `<div style="font-size:15px;margin-bottom:8px">🔔 <b>${c ? 'Серия ' + c + ' вышла' : 'Что-то новое'}!</b></div><div id="bl-tg" style="font-size:12px;margin-bottom:8px"></div>${btn('bl-ok', 'Готово', true)}`;
      box.style.borderColor = '#7dffb0';
      box.querySelector('#bl-ok').onclick = () => { render(); };
      alertUser(c);
    };
    const stopWith = (why) => {
      GM_deleteValue(KEY);
      box.innerHTML = `<div style="font-size:14px;margin-bottom:6px">⚠️ <b>Слежение остановлено</b></div><div style="font-size:12px;opacity:.8;margin-bottom:8px">${why}</div><div id="bl-tg" style="font-size:12px;margin-bottom:8px"></div>${btn('bl-ok', 'Понятно', true)}`;
      box.style.borderColor = '#ffb86b';
      box.querySelector('#bl-ok').onclick = () => { render(); };
      try { GM_notification({ title: 'Сторож серии', text: 'Слежение остановлено: ' + why, timeout: 0 }); } catch (e) {}
      tg('⚠️ MkvDrama: слежение остановлено — ' + why + '\n' + location.href);
      sound();
    };
    if (isChallenge()) { stopWith('сайт просит проверку «Вы человек?». Пройди её и нажми «Следить» снова.'); return; }
    if (cur && isHit(cur)) { fire(cur); return; }
    const base_s = ivlMin() * 60, deadline = Date.now() + base_s * (0.8 + Math.random() * 0.4) * 1000;
    const mins = Math.floor((Date.now() - st.since) / 60000);
    let seen = cur;
    const draw = left => {
      box.innerHTML = `<div style="margin-bottom:8px">👀 Слежу за новой серией
        <div style="font-size:11px;opacity:.55;margin-top:4px">сейчас на странице</div>
        <div style="font-size:18px;font-weight:700">${seen ? ser(seen) : '—'}</div>
        <div style="font-size:11px;opacity:.55">следим ${mins} мин · обновление через ${fmt(left)}</div></div>${btn('bl-stop', 'Остановить')}`;
      box.querySelector('#bl-stop').onclick = () => { GM_deleteValue(KEY); location.reload(); };
    };
    draw((deadline - Date.now()) / 1000);
    const timer = setInterval(() => {
      const c = maxEp(episodes()); seen = c;
      if (isChallenge()) { clearInterval(timer); stopWith('сайт просит проверку «Вы человек?». Пройди её и нажми «Следить» снова.'); return; }
      if (!c && st.base && Date.now() - T0 > 25000) { clearInterval(timer); stopWith('страница не загрузилась или серии на ней не найдены (возможно, ошибка или защита сайта).'); return; }
      if (c && isHit(c)) { clearInterval(timer); fire(c); return; }
      const left = (deadline - Date.now()) / 1000;
      if (left <= 0) { clearInterval(timer); location.reload(); } else draw(left);
    }, 1000);
  }
  const T0 = Date.now();
  render();
})();
