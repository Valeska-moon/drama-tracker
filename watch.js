// Слежка за новыми сериями на MyAsianTV. Запускается на GitHub раз в 15 минут.
// Сверяет серии с главной страницы сайта со списком из shows.json и пишет в Telegram.
const fs = require('fs');
const path = require('path');

const SITE = process.env.WATCH_URL || 'https://ww19.myasiantv.es/';
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'state.json');
const SHOWS_FILE = process.env.SHOWS_FILE || path.join(__dirname, 'shows.json');
const TOKEN = process.env.TELEGRAM_TOKEN, CHAT = process.env.TELEGRAM_CHAT_ID;

// «Ao to Midori (2026)» -> «ao-to-midori»
const slug = (s) => String(s || '').toLowerCase().replace(/[’‘`'"]/g, '').replace(/\(\d{4}\)/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const h = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// raw=true: текст уже размечен (<b>, <a>), динамические части экранированы через h()
async function tg(text, raw = false) {
  const body = raw ? text : h(text);
  console.log('Telegram:', body.replace(/\n/g, ' | '));
  if (!TOKEN || !CHAT) return;
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: body, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!r.ok) console.log('Telegram error', r.status, await r.text());
}

// Достаёт со страницы все ссылки на серии вида /ep/название-год-episode-5-english-subbed/
function parseEpisodes(html) {
  const out = new Map();
  for (const m of html.matchAll(/href="([^"]*\/ep\/([^"\/?#]+)\/?)[^"]*"/g)) {
    const mm = m[2].match(/^(.*?)-episode-(\d+)(?:-(.*))?$/);
    if (!mm) continue;
    // нужны только английские и тайские субтитры; версии без субтитров (RAW) и с другими языками пропускаем
    const suf = (mm[3] || '').toLowerCase();
    const kind = /thai/.test(suf) ? 'тайские субтитры' : /english|^subbed/.test(suf) ? 'английские субтитры' : null;
    if (!kind) continue;
    const key = `${mm[1]}|${mm[2]}|${kind}`;
    const url = m[1].startsWith('http') ? m[1] : new URL(m[1], SITE).href;
    if (!out.has(key)) out.set(key, { name: mm[1], n: +mm[2], kind, url });
  }
  return [...out.values()];
}

// Совпадает ли имя из ссылки (ao-to-midori-2026, возможно с суффиксом -aa) с названием сериала
function matches(urlName, showSlug) {
  if (!showSlug) return false;
  const base = urlName.replace(/-(?:19|20)\d{2}(?:-[a-z]{1,2})?$/, '');
  const flat = (x) => x.replace(/[^a-z0-9]/g, ''); // без дефисов: «its-just-business» = «it-s-just-business»
  return flat(base) === flat(showSlug) || flat(urlName) === flat(showSlug);
}

// Страница сериала /tv/название-год/: проверяем, создана ли она (год в адресе заранее неизвестен)
// hints — точные адреса из ленты свежих серий (gun-shot-2026): у сайта бывает старый одноимённый сериал, и страница без года принадлежит ему
async function findShowPage(sl, hints = []) {
  const y = new Date().getFullYear();
  const cands = [...new Set([...hints, ...(/-(?:19|20)\d{2}$/.test(sl) ? [sl] : [sl, ...[y, y + 1, y - 1].map(n => `${sl}-${n}`)])])];
  for (const c of cands) {
    try {
      const url = new URL(`/tv/${c}/`, SITE).href;
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; drama-tracker)' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const html = await r.text();
      if (/Total Episodes|Original name|Description:/i.test(html)) return { url, html }; // у несуществующих страниц сайт отдаёт заглушку без этих слов
    } catch {}
  }
  return null;
}

// ---------- второй сайт: MKVDrama ----------
// У сериала там одна страница вида /teach-me-touch-me-26kcfzlw с блоком «Episode 01 - 06»: когда выходит серия, цифры меняются.
const MKV = process.env.MKV_URL || 'https://mkvdrama.net/';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; drama-tracker)', 'accept-language': 'en' };
async function mkvGet(u) {
  const r = await fetch(new URL(u, MKV).href, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('код ' + r.status);
  return r.text();
}
async function mkvFind(sl, title) {
  const q = String(title).toLowerCase().replace(/[’‘`'"]/g, '').replace(/\(\d{4}\)/g, ' ').replace(/[^a-z0-9]+/g, '+').replace(/^\++|\++$/g, '');
  const html = await mkvGet('/search?q=' + q);
  for (const m of html.matchAll(/href="(?:https?:\/\/[^"\/]*)?\/([a-z0-9][a-z0-9-]*)\/?"/gi)) {
    const base = m[1].replace(/-[a-z0-9]{5,12}$/i, '');
    if (matches(base.toLowerCase(), sl)) return new URL('/' + m[1], MKV).href;
  }
  return null;
}
// «Episode 01 - 06» -> 6;  «Episode 7» -> 7
async function mkvEpisodes(url) {
  const text = (await mkvGet(url)).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  const m = text.match(/Episodes?\s*0*(\d+)(?:\s*(?:[-–—]|to)\s*0*(\d+))?/i); // первое упоминание на странице
  return m ? Math.max(+m[1], +(m[2] || 0)) : null;
}
async function checkMkv(tracked, state) {
  state.mkv = state.mkv || {};
  const list = tracked.filter(t => t.slug);
  let problem = '';
  const msgs = [], foundNow = [], missingNow = [], created = [];
  for (const t of list) {
    const rec = state.mkv[t.s.id];
    try {
      let url = rec && rec.url;
      if (!url) {
        url = await mkvFind(t.slug, t.s.siteName || t.s.title);
        if (!url) { if (!rec) { state.mkv[t.s.id] = { url: null, max: null }; created.push(t.s.id); missingNow.push(t); } continue; }
      }
      const max = await mkvEpisodes(url);
      if (!rec) { state.mkv[t.s.id] = { url, max }; created.push(t.s.id); foundNow.push({ t, url, max }); continue; }
      if (!rec.url) { // раньше страницы не было, теперь появилась
        state.mkv[t.s.id] = { url, max }; msgs.push(`Сериал «${t.s.title}» появился на MKVDrama${max ? ` (серии до ${max})` : ''}\n${url}`); continue;
      }
      if (max && rec.max && max > rec.max) msgs.push(`На MKVDrama ${max - rec.max > 1 ? `вышли серии ${rec.max + 1}–${max}` : `вышла серия ${max}`} «${t.s.title}»\nСкачать видео: ${url}${t.s.matvUrl ? `\nСубтитры: ${t.s.matvUrl}` : ''}`);
      if (max && max !== rec.max) rec.max = max;
      else if (max && !rec.max) rec.max = max;
    } catch (e) { problem = e.message; break; }
  }
  if (problem) {
    console.log('MKVDrama:', problem);
    created.forEach(id => delete state.mkv[id]); // не запоминаем половину списка: сообщение отправим целиком, когда сайт заработает
    if (!state.mkvDown) { await tg(`MKVDrama сейчас недоступен для слежки: ${problem}. Напишу, когда заработает.`); state.mkvDown = true; }
    return;
  }
  if (state.mkvDown) { await tg('MKVDrama снова доступен.'); state.mkvDown = false; }
  if (foundNow.length || missingNow.length) {
    let m = 'MKVDrama, слежка включена.';
    if (foundNow.length) m += `\n\nНашла страницы:\n${foundNow.map(x => `• ${x.t.s.title}${x.max ? ` (сейчас серии до ${x.max})` : ' (номер серии не распознала)'}`).join('\n')}`;
    if (missingNow.length) m += `\n\nПока нет на MKVDrama (напишу, когда появятся):\n${missingNow.map(t => '• ' + t.s.title).join('\n')}`;
    await tg(m);
  }
  for (const m of msgs) await tg(m);
}

const COUNTRY = { thai: 'Таиланд', korean: 'Корея', chinese: 'Китай', japanese: 'Япония', taiwanese: 'Тайвань', 'hong kong': 'Гонконг' };
const CCODE = { 'Таиланд': 'TH', 'Корея': 'KR', 'Китай': 'CN', 'Япония': 'JP', 'Тайвань': 'TW', 'Гонконг': 'HK' };
// Страница сериала: серии с плашкой SUB уже вышли с английскими субтитрами, с плашкой NEXT только анонсированы (видео ещё нет).
function parseShowPage(html, sl) {
  const sub = {}, next = {}, nextUrl = {};
  for (const m of html.matchAll(/<a\b[^>]*?href=(?:"([^"]*\/ep\/([^"\/?#]+)[^"]*)"|'([^']*\/ep\/([^'\/?#]+)[^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    m[1] = m[1] || m[3]; m[2] = m[2] || m[4]; m[3] = m[5]; // сайт пишет и "..." и '...'
    const nm = m[2].match(/^(.*?)-episode-\d+/);
    if (!nm || !matches(nm[1], sl)) continue; // ссылки на серии других сериалов (боковая колонка) пропускаем
    const text = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const n = text.match(/Episode\s+(\d+)/i); if (!n) continue;
    const date = (text.match(/[A-Z][a-z]{2}\.? \d{1,2}, \d{4}/) || [''])[0];
    if (/^NEXT\b/i.test(text)) { next[n[1]] = date; nextUrl[n[1]] = new URL(m[1], SITE).href; }
    else if (/^SUB\b/i.test(text)) sub[n[1]] = { url: new URL(m[1], SITE).href, date };
  }
  const c = (html.match(/<title>[^<]*?\b(Thai|Korean|Chinese|Japanese|Taiwanese|Hong Kong)\s+Drama/i) || [])[1];
  return { sub, next, nextUrl, country: c ? COUNTRY[c.toLowerCase()] : '' };
}

async function main() {
  const shows = (JSON.parse(fs.readFileSync(SHOWS_FILE, 'utf8')).shows || []);
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  state.seen = state.seen || {};

  const tracked = shows.map(s => ({ s, slug: slug(s.siteName || s.title) }));
  const noLatin = tracked.filter(t => !t.slug).map(t => t.s.title);
  if (noLatin.length) console.log('Нет английского названия, слежка пропущена для:', noLatin.join(', '));

  let html = '', problem = '';
  try {
    const r = await fetch(SITE, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; drama-tracker)', 'accept-language': 'en' } });
    if (!r.ok) problem = `сайт ответил кодом ${r.status}`; else html = await r.text();
  } catch (e) { problem = 'сайт не открылся (' + e.message + ')'; }
  const eps = html ? parseEpisodes(html) : [];
  if (!problem && !eps.length) problem = 'на странице не нашлось ссылок на серии (возможно, сайт изменился или включил защиту)';

  if (problem) {
    console.log('Проблема:', problem);
    if (!state.down) { await tg(`Слежка за MyAsianTV не работает: ${problem}. Напишу, когда заработает.`); state.down = true; }
    await checkMkv(tracked, state).catch(e => console.log('MKVDrama, ошибка:', e.message));
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); return;
  }
  if (state.down) { await tg('MyAsianTV снова доступен, слежка работает.'); state.down = false; }

  const mine = eps.filter(e => tracked.some(t => matches(e.name, t.slug)));
  const fresh = mine.filter(e => !state.seen[`${e.name}|${e.n}|${e.kind}`]);
  console.log(`Серий на странице: ${eps.length}, из вашего списка: ${mine.length}, новых: ${fresh.length}`);

  // Источник правды: страница сериала на сайте. Там у каждой серии плашка SUB (вышла с англ. субтитрами) или NEXT (только анонс).
  state.shows = state.shows || {}; state.eps = state.eps || {};
  const info = {};
  for (const t of tracked.filter(t => t.slug)) {
    const f = await findShowPage(t.slug, [...new Set(mine.filter(e => matches(e.name, t.slug)).map(e => e.name))]);
    info[t.s.id] = f ? { on: true, url: f.url, ...parseShowPage(f.html, t.slug) } : { on: false };
  }
  state.countries = state.countries || {}; state.links = state.links || {};
  for (const t of tracked) { const i = info[t.s.id]; if (i && i.on && i.url) state.links[t.s.id] = i.url; }
  for (const t of tracked) { const i = info[t.s.id]; if (i && i.country && CCODE[i.country]) state.countries[t.s.id] = CCODE[i.country]; }
  const nums = (o) => Object.keys(o).map(Number).sort((a, b) => a - b);
  const MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'], MONRU = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const dateRu = (d) => { const m = String(d).match(/^([A-Za-z]{3})\.? (\d{1,2}), (\d{4})$/), i = m ? MON.indexOf(m[1].toLowerCase()) : -1; return i >= 0 ? `${+m[2]} ${MONRU[i]} ${m[3]}` : (d || 'дата не указана'); };
  const baseline = tracked.filter(t => t.slug && ((info[t.s.id].on && !state.eps[t.s.id]) || !(t.s.id in state.shows)));
  const range = (a) => { const out = []; for (let i = 0; i < a.length; i++) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(j > i ? `${a[i]}–${a[j]}` : `${a[i]}`); i = j; } return out.join(', '); };
  if (baseline.length) {
    const blocks = baseline.map(t => {
      const i = info[t.s.id], head = `<b>${h(t.s.title)}</b>${i.country ? ` · ${h(i.country)}` : ''}`;
      if (!i.on) return `${head}\n⏳ страницы на сайте пока нет, напишу, когда появится`;
      const sn = nums(i.sub), nx = nums(i.next), was = state.shows[t.s.id] === false ? '🆕 появился на сайте\n' : '';
      return `${head}\n${was}${sn.length ? `✅ серии ${range(sn)}, английские субтитры` : '— серий с английскими субтитрами пока нет'}${nx.length ? `\n🗓 анонс: серия ${nx[0]}, ${dateRu(i.next[nx[0]])}` : ''}`;
    });
    await tg(`${state.started ? '<b>Слежка по страницам сериалов</b>' : '<b>Слежка за MyAsianTV включена</b>'}\n\n${blocks.join('\n\n')}`, true);
    state.started = true;
  }
  if (noLatin.length && !state.warnedNoLatin) { await tg(`Не могу следить за: ${noLatin.join(', ')}. Впишите английское название, как на MyAsianTV, в поле «Название на MyAsianTV».`); state.warnedNoLatin = true; }

  for (const t of tracked) {
    if (!t.slug) continue;
    const i = info[t.s.id], base = baseline.includes(t);
    if (!base && state.shows[t.s.id] === false && i.on) await tg(`🆕 <b>${h(t.s.title)}</b>${i.country ? ` · ${h(i.country)}` : ''}\nпоявился на сайте\n<a href="${h(i.url)}">Открыть страницу</a>`, true);
    if (i.on) {
      const prev = state.eps[t.s.id];
      if (prev && !base) {
        for (const n of nums(i.sub)) if (!prev.sub.includes(n)) await tg(`✅ <b>Серия ${n}</b> · ${h(t.s.title)}${i.country ? ` · ${h(i.country)}` : ''}\nАнглийские субтитры\n<a href="${h(i.sub[n].url)}">Субтитры</a>${t.s.mkvUrl ? ` · <a href="${h(t.s.mkvUrl)}">Скачать видео</a>` : ''}`, true);
        for (const n of nums(i.next)) {
          if (prev.sub.includes(n)) continue;
          if (!(n in prev.next)) await tg(`🗓 <b>Анонс · серия ${n}</b> · ${h(t.s.title)}\n${h(dateRu(i.next[n]))}, видео пока нет\n<a href="${h(i.url)}">Страница сериала</a>`, true);
          else if (prev.next[n] !== i.next[n]) await tg(`🗓 <b>Дата изменилась · серия ${n}</b> · ${h(t.s.title)}\nбыло: ${h(dateRu(prev.next[n]))}\nстало: ${h(dateRu(i.next[n]))}`, true);
        }
      }
      state.eps[t.s.id] = { sub: nums(i.sub), next: i.next };
    }
    state.shows[t.s.id] = i.on;
  }
  if (process.env.CHECK_MKV) await checkMkv(tracked, state).catch(e => console.log('MKVDrama, ошибка:', e.message));
  const now = new Date().toISOString();
  for (const e of mine) state.seen[`${e.name}|${e.n}|${e.kind}`] = state.seen[`${e.name}|${e.n}|${e.kind}`] || now;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
