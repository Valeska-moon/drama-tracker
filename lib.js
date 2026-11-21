// Общая логика: расписание серий и генерация календаря (.ics).
// Используется и страницей (index.html), и сборкой на GitHub (build.js).
(function (root) {
  const TZ_OFFSET_H = 3; // Europe/Minsk = UTC+3, без перехода на летнее время
  const REMIND_MINUTES = 60; // напоминание за 1 час

  const pad = (n) => String(n).padStart(2, '0');
  const parseDate = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const fmtDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const addDays = (d, n) => new Date(d.getTime() + n * 864e5);

  // Возвращает [{n, date:'YYYY-MM-DD'}] для одного сериала.
  function generateEpisodes(show) {
    const total = parseInt(show.totalEpisodes, 10) || 0;
    const eps = [];
    if (!show.startDate || total < 1) return eps;

    const skip = new Set(show.skipDates || []);
    const batch = Math.max(1, parseInt(show.premiereBatch, 10) || 1); // сколько серий в день премьеры
    const perDay = Math.max(1, parseInt(show.perDay, 10) || 1); // сколько серий в обычный день выхода
    let weekdays = (show.weekdays || []).map(Number);
    let day = parseDate(show.startDate);
    if (!weekdays.length) weekdays = [day.getUTCDay()];

    let n = 1;
    for (let i = 0; i < batch && n <= total; i++) eps.push({ n: n++, date: fmtDate(day) });

    let guard = 0;
    while (n <= total && guard++ < 3000) {
      day = addDays(day, 1);
      if (!weekdays.includes(day.getUTCDay())) continue;
      if (skip.has(fmtDate(day))) continue; // неделя без серии: всё сдвигается
      for (let i = 0; i < perDay && n <= total; i++) eps.push({ n: n++, date: fmtDate(day) });
    }

    // Ручные исправления отдельных серий: { "5": "2026-12-04" } или { "5": "2026-12-04 21:30" }
    const ov = show.overrides || {};
    for (const e of eps) {
      const v = ov[String(e.n)];
      if (!v) continue;
      const [d, t] = String(v).trim().split(/\s+/);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) e.date = d;
      if (t && /^\d{1,2}:\d{2}$/.test(t)) e.time = t;
    }
    return eps;
  }

  // --- .ics ---
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

  function utcStamp(dateStr, timeStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = (timeStr || '20:00').split(':').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d, hh - TZ_OFFSET_H, mm));
    return (
      t.getUTCFullYear() + pad(t.getUTCMonth() + 1) + pad(t.getUTCDate()) +
      'T' + pad(t.getUTCHours()) + pad(t.getUTCMinutes()) + '00Z'
    );
  }

  // Складывание длинных строк (по байтам, как требует стандарт)
  function fold(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 74) return line;
    let out = '', cur = '', bytes = 0, limit = 74;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > limit) { out += cur + '\r\n '; cur = ''; bytes = 0; limit = 73; }
      cur += ch; bytes += b;
    }
    return out + cur;
  }

  function buildICS(shows, nowStamp) {
    const stamp = nowStamp || utcStamp(fmtDate(new Date()), '12:00');
    const L = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//drama-tracker//RU',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:BL Tracker',
      'X-WR-TIMEZONE:Europe/Minsk',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'X-PUBLISHED-TTL:PT1H',
    ];
    for (const show of shows) {
      for (const e of generateEpisodes(show)) {
        const time = e.time || show.time || '20:00';
        const start = utcStamp(e.date, time);
        const [y, m, d] = e.date.split('-').map(Number);
        const [hh, mm] = time.split(':').map(Number);
        const endDate = new Date(Date.UTC(y, m - 1, d, hh - TZ_OFFSET_H + 1, mm));
        const end =
          endDate.getUTCFullYear() + pad(endDate.getUTCMonth() + 1) + pad(endDate.getUTCDate()) +
          'T' + pad(endDate.getUTCHours()) + pad(endDate.getUTCMinutes()) + '00Z';
        const desc = [show.mdlUrl && 'MyDramaList: ' + show.mdlUrl, show.asiantvUrl && 'MyAsianTV: ' + show.asiantvUrl]
          .filter(Boolean).join('\n');
        L.push(
          'BEGIN:VEVENT',
          // Постоянный UID: при обновлении серия заменяется, а не дублируется
          `UID:${show.id}-ep${e.n}@drama-tracker`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${start}`,
          `DTEND:${end}`,
          `SUMMARY:${esc(`${show.ruMain && show.ruTitle ? show.ruTitle : show.title} — серия ${e.n}/${show.totalEpisodes}`)}`,
          ...(desc ? [`DESCRIPTION:${esc(desc)}`] : []),
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          `DESCRIPTION:${esc(`Через час: ${show.ruMain && show.ruTitle ? show.ruTitle : show.title}, серия ${e.n}`)}`,
          `TRIGGER:-PT${REMIND_MINUTES}M`,
          'END:VALARM',
          'END:VEVENT'
        );
      }
    }
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  const api = { generateEpisodes, buildICS, fmtDate, parseDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DramaLib = api;
})(typeof self !== 'undefined' ? self : this);
