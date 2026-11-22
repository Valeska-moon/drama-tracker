/* Пароль на вход: один раз на устройство. Это защита от случайного посетителя, не от взлома:
   файлы данных лежат в публичном репозитории. Хэш пароля — в auth.json. */
(function () {
  var KEY = 'lsAuth', done = false;
  var hide = document.createElement('style'); hide.id = 'gateHide'; hide.textContent = 'html{visibility:hidden!important}';
  document.head.appendChild(hide);
  function open() { done = true; var s = document.getElementById('gateHide'); if (s) s.remove(); var o = document.getElementById('gate'); if (o) o.remove(); document.documentElement.style.overflow = ''; }
  function sha(t) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)).then(function (b) { return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join(''); }); }
  function ask(a) {
    function build() {
      var o = document.createElement('div'); o.id = 'gate';
      o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;visibility:visible;background:#0a0809 radial-gradient(60% 50% at 80% 0%,rgba(255,138,196,.18),transparent);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Montserrat,system-ui,sans-serif;color:#f4eef2';
      o.innerHTML = '<form style="width:min(340px,100%);display:flex;flex-direction:column;gap:14px;text-align:center">' +
        '<div style="font-size:34px;color:#ff8ac4">✦</div><div style="font-weight:800;letter-spacing:.08em;font-size:15px">LUMERA SUBS</div>' +
        '<input type="password" id="gpw" placeholder="Пароль" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" style="height:48px;border-radius:24px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;padding:0 20px;font-size:16px;text-align:center;outline:none">' +
        '<label style="font-size:13px;color:#a99ba5;display:flex;gap:8px;justify-content:center;align-items:center;cursor:pointer"><input type="checkbox" id="gshow"> Показать пароль</label>' +
        '<button type="submit" style="height:48px;border-radius:24px;border:0;background:#ff8ac4;color:#14090f;font-weight:700;font-size:15px;cursor:pointer">Войти</button>' +
        '<div id="gerr" style="min-height:18px;font-size:13px;color:#ff8a8a"></div></form>';
      document.body.appendChild(o); document.documentElement.style.overflow = 'hidden';
      var f = o.querySelector('form'), i = o.querySelector('#gpw'); setTimeout(function () { i.focus(); }, 50);
      o.querySelector('#gshow').onchange = function () { i.type = this.checked ? 'text' : 'password'; };
      f.onsubmit = function (e) { e.preventDefault(); sha(a.salt + ':' + i.value).then(function (h) {
        if (h === a.hash) { try { localStorage.setItem(KEY, h); } catch (x) {} open(); }
        else { o.querySelector('#gerr').textContent = 'Неверный пароль'; i.value = ''; i.focus(); } }); };
    }
    if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
  }
  fetch('auth.json?' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (a) {
    if (!a || !a.hash) return open();
    var t = null; try { t = localStorage.getItem(KEY); } catch (x) {}
    if (t === a.hash) return open();
    ask(a);
  }).catch(function () { var t = null; try { t = localStorage.getItem(KEY); } catch (x) {} if (t) open(); else ask({ salt: '', hash: 'x' }); });
})();
