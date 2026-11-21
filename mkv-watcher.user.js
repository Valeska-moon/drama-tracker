// ==UserScript==
// @name         Сторож серии (MKVDrama)
// @namespace    bl-tracker
// @version      1.7
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
  const MIN_S = 35, MAX_S = 70; // пауза между обновлениями, секунд (случайная)

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
    if (!found.size) els.forEach(el => { if (!el.closest('#bl-watch')) scan(el.textContent || ''); });
    return found;
  }
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
      box.innerHTML = `<div style="margin-bottom:6px">Сейчас на странице: <b>${cur ? 'серия ' + cur : 'серии не найдены'}</b></div>
        <div style="margin-bottom:8px;opacity:.8">Ждать серию №
          <input id="bl-n" type="number" min="1" value="${cur ? cur + 1 : ''}" style="width:52px;border-radius:8px;border:1px solid #555;background:#0a0809;color:#fff;padding:3px 6px"></div>
        ${btn('bl-go', 'Следить', true)} ${btn('bl-set', '⚙')}
        <div id="bl-cfg" style="display:none;margin-top:8px">
          <input id="bl-tok" placeholder="токен бота" style="width:100%;box-sizing:border-box;margin-bottom:4px;border-radius:8px;border:1px solid #555;background:#0a0809;color:#fff;padding:4px 6px">
          <input id="bl-chat" placeholder="chat id" style="width:100%;box-sizing:border-box;margin-bottom:4px;border-radius:8px;border:1px solid #555;background:#0a0809;color:#fff;padding:4px 6px">
          ${btn('bl-save', 'Сохранить', true)}
        </div>`;
      box.querySelector('#bl-set').onclick = () => { const c = box.querySelector('#bl-cfg'); c.style.display = c.style.display === 'none' ? 'block' : 'none'; box.querySelector('#bl-tok').value = GM_getValue('tgToken', ''); box.querySelector('#bl-chat').value = GM_getValue('tgChat', ''); };
      box.querySelector('#bl-save').onclick = () => { GM_setValue('tgToken', box.querySelector('#bl-tok').value.trim()); GM_setValue('tgChat', box.querySelector('#bl-chat').value.trim()); box.querySelector('#bl-cfg').style.display = 'none'; };
      box.querySelector('#bl-go').onclick = () => {
        const n = +box.querySelector('#bl-n').value || (cur ? cur + 1 : 0);
        GM_setValue(KEY, { target: n, base: cur, links: document.querySelectorAll('a').length, since: Date.now() });
        location.reload();
      };
      return;
    }
    // режим слежения
    const hit = (cur && st.target && cur >= st.target) || (cur && st.base && cur > st.base) || (!cur && !st.base && document.querySelectorAll('a').length > st.links + 2);
    if (hit) {
      GM_deleteValue(KEY);
      box.innerHTML = `<div style="font-size:15px;margin-bottom:8px">🔔 <b>${cur ? 'Серия ' + cur + ' вышла' : 'Что-то новое'}!</b></div><div id="bl-tg" style="font-size:12px;margin-bottom:8px"></div>${btn('bl-ok', 'Готово', true)}`;
      box.style.borderColor = '#7dffb0';
      box.querySelector('#bl-ok').onclick = () => { render(); };
      alertUser(cur);
      return;
    }
    const deadline = Date.now() + (MIN_S + Math.random() * (MAX_S - MIN_S)) * 1000;
    let left = 0;
    const mins = Math.floor((Date.now() - st.since) / 60000);
    const draw = () => {
      box.innerHTML = `<div style="margin-bottom:6px">👀 Слежу за серией <b>${st.target || '?'}</b><br>
        <span style="opacity:.75">на странице: ${cur ? 'серия ' + cur : '—'} · следим ${mins} мин<br>обновление через ${Math.ceil(left)} с</span></div>${btn('bl-stop', 'Остановить')}`;
      box.querySelector('#bl-stop').onclick = () => { GM_deleteValue(KEY); location.reload(); };
    };
    draw();
    const timer = setInterval(() => {
      left = (deadline - Date.now()) / 1000; if (left <= 0) { clearInterval(timer); location.reload(); } else draw();
    }, 1000);
  }
  render();
})();
