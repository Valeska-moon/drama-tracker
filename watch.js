// Слежка за новыми сериями на MyAsianTV. Запускается на GitHub раз в 15 минут.
// Сверяет серии с главной страницы сайта со списком из shows.json и пишет в Telegram.
const fs = require('fs');
const path = require('path');

const SITE = process.env.WATCH_URL || 'https://ww19.myasiantv.es/';
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'state.json');
const SHOWS_FILE = process.env.SHOWS_FILE || path.join(__dirname, 'shows.json');
const TOKEN = process.env.TELEGRAM_TOKEN, CHAT = process.env.TELEGRAM_CHAT_ID;

// «Ao to Midori (2026)» -> «ao-to-midori»
const slug = (s) => String(s || '').toLowerCase().replace(/\(\d{4}\)/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function tg(text) {
  console.log('Telegram:', text.replace(/\n/g, ' | '));
  if (!TOKEN || !CHAT) return;
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text }),
  });
  if (!r.ok) console.log('Telegram error', r.status, await r.text());
}

// Достаёт со страницы все ссылки на серии вида /ep/название-год-episode-5-english-subbed/
function parseEpisodes(html) {
  const out = new Map();
  for (const m of html.matchAll(/href="([^"]*\/ep\/([^"\/?#]+)\/?)[^"]*"/g)) {
    const mm = m[2].match(/^(.*?)-episode-(\d+)(?:-(.*))?$/);
    if (!mm) continue;
    const kind = /subbed/.test(mm[3] || '') ? 'SUB' : 'RAW';
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
  return base === showSlug || urlName === showSlug;
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
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); return;
  }
  if (state.down) { await tg('MyAsianTV снова доступен, слежка работает.'); state.down = false; }

  const mine = eps.filter(e => tracked.some(t => matches(e.name, t.slug)));
  const fresh = mine.filter(e => !state.seen[`${e.name}|${e.n}|${e.kind}`]);
  console.log(`Серий на странице: ${eps.length}, из вашего списка: ${mine.length}, новых: ${fresh.length}`);

  if (!state.started) { // первый запуск: запоминаем текущее состояние, чтобы не присылать старые серии
    state.started = true;
    await tg(`Слежка за MyAsianTV включена. Слежу за сериалами: ${shows.length}.`);
  } else {
    for (const e of fresh) {
      const t = tracked.find(t => matches(e.name, t.slug));
      await tg(`Вышла серия ${e.n} «${t.s.title}» (${e.kind})\n${e.url}`);
    }
  }
  const now = new Date().toISOString();
  for (const e of mine) state.seen[`${e.name}|${e.n}|${e.kind}`] = state.seen[`${e.name}|${e.n}|${e.kind}`] || now;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
