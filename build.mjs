#!/usr/bin/env node
// Собирает дашборд поездки из хаба в Obsidian: build/index.html (не шифрованный, в git не идёт).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { marked } from 'marked';

const HUB = process.argv[2] ?? '/home/ae/Documents/vault/Поездки/Азия 2026/Азия 2026.md';

// Часовые пояса городов маршрута; `on` — день в городе, на который считаем сдвиг.
const CITIES = [
  { name: 'Лиссабон', tz: 'Europe/Lisbon', on: '2026-11-23' },
  { name: 'Ташкент', tz: 'Asia/Tashkent', on: '2026-11-23' },
  { name: 'Гуанчжоу', tz: 'Asia/Shanghai', on: '2026-11-26' },
  { name: 'Гонконг', tz: 'Asia/Hong_Kong', on: '2026-11-29' },
  { name: 'Сеул', tz: 'Asia/Seoul', on: '2026-12-02' },
];

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// Провенанс-callout'ы — для хаба, не для дашборда.
function stripCallouts(md) {
  const out = [];
  let inside = false;
  for (const line of md.split('\n')) {
    if (/^>\s*\[!/.test(line)) { inside = true; continue; }
    if (inside && line.startsWith('>')) continue;
    inside = false;
    out.push(line);
  }
  return out.join('\n');
}

// Вики-ссылки → текст, госсайты и телефоны → кликабельные (Мира открывает с телефона).
const linkify = (s) => s
  .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b ?? a)
  .replace(/(?<![\w./@-])((?:[a-z0-9-]+\.)+(?:go\.kr|gov\.cn)(?:\/[\w./?=&%-]*)?)/gi, (m) => `[${m}](https://${m})`)
  .replace(/\+\d{1,3}(?: \d{2,3}){3,4}/g, (m) => `[${m}](tel:${m.replace(/ /g, '')})`);

const inline = (s) => marked.parseInline(s ?? '');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const md = linkify(stripCallouts(readFileSync(HUB, 'utf8')));

const [tripName, routeTitle = ''] = md.match(/^# (.+)$/m)[1].split(/:\s*/);
const [intro, ...chunks] = md.split(/^## /m);
const sections = Object.fromEntries(chunks.map((c) => {
  const nl = c.indexOf('\n');
  return [c.slice(0, nl).trim(), c.slice(nl + 1).trim()];
}));

const dm = intro.match(/(\d{2})\.(\d{2})\s*[–-]\s*(\d{2})\.(\d{2})\.(\d{4})/);
const YEAR = +dm[5];
const START_MONTH = +dm[2];
const iso = (dd, mm) => {
  const year = +mm < 7 && START_MONTH >= 7 ? YEAR + 1 : YEAR;
  return `${year}-${mm}-${dd}`;
};
const start = iso(dm[1], dm[2]);
const end = `${YEAR}-${dm[4]}-${dm[3]}`;

function parseTable(block) {
  const rows = block.split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  return { head: rows[0], rows: rows.slice(2) };
}

function parseRange(s) {
  let m = s.match(/(\d{2})(?:\.(\d{2}))?\s*[–→-]\s*(\d{2})\.(\d{2})/);
  if (m) return { from: iso(m[1], m[2] ?? m[4]), to: iso(m[3], m[4]) };
  m = s.match(/(\d{2})\.(\d{2})/);
  return m ? { from: iso(m[1], m[2]), to: iso(m[1], m[2]) } : {};
}

const ICONS = { '✅': 'ok', '🔎': 'wip', '⬜': 'todo' };
function status(cell, what, emptyTodo) {
  if (!cell || cell === '—') return '';
  const icon = Object.keys(ICONS).find((i) => cell.startsWith(i));
  const kind = icon ? ICONS[icon] : 'info';
  const label = (icon ? cell.slice(icon.length).trim() : cell) || emptyTodo;
  return `<span class="st ${kind}">${what}: ${inline(label)}</span>`;
}

// Маршрут
const routeRows = parseTable(sections['Маршрут']).rows.map(([dates, place, transport, ticket, stay]) => {
  const transfer = place.includes('→');
  const icon = /поезд/.test(transport) && /рейс/.test(transport) ? '✈️ / 🚄' : /поезд/.test(transport) ? '🚄' : /рейс/.test(transport) ? '✈️' : '';
  return { dates, place, transport, ticket, stay, transfer, icon, ...parseRange(dates) };
});
const transfers = routeRows.filter((r) => r.transfer);
const chain = [
  transfers[0].place.split('→')[0].trim(),
  ...routeTitle.split('→').map((s) => s.trim()),
  transfers.at(-1).place.split('→')[1].split(/\s+через\s+/)[0].trim(),
];
const routeHtml = routeRows.map((r) => `
      <li class="leg ${r.transfer ? 'transfer' : 'stay'}" data-from="${r.from}" data-to="${r.to}">
        <div class="when">${esc(r.dates)}</div>
        <div class="what">
          <div class="place">${r.transfer ? `<span class="ic">${r.icon}</span> ` : ''}${inline(r.place)}</div>
          ${r.transfer && r.transport !== '—' ? `<div class="sub">${inline(r.transport)}</div>` : ''}
          <div class="chips">${status(r.ticket, 'Билет', 'не куплен')}${status(r.stay, 'Жильё', 'не забронировано')}</div>
        </div>
      </li>`).join('');

// Визы
const visaSec = sections['Визы и документы'];
const visaTable = parseTable(visaSec);
const people = visaTable.head.slice(1).map((h) => h.replace(/\s*\(.*\)/, ''));
const visaHtml = visaTable.rows.map(([country, ...cells]) => `
      <div class="card visa">
        <div class="vc">${inline(country)}</div>
        <dl>${cells.map((c, i) => `<dt>${esc(people[i])}</dt><dd${/\*\*нужна/i.test(c) ? ' class="warn"' : ''}>${inline(c)}</dd>`).join('')}</dl>
      </div>`).join('');
const visaParas = visaSec.split('\n').filter((l) => !l.trim().startsWith('|')).join('\n').trim().split(/\n{2,}/);
const riskIdx = visaParas.findIndex((p) => p.startsWith('**⚠️'));
const riskHtml = riskIdx >= 0 ? marked.parse(visaParas[riskIdx]) : '';
const visaDetailsHtml = marked.parse(visaParas.filter((_, i) => i !== riskIdx).join('\n\n'));

// Дела: дедлайн — дата в хвосте после последнего « — »
const tasks = [];
for (const line of sections['Очередь дел'].split('\n')) {
  const m = line.match(/^- \[( |x)\] (.+)$/);
  if (!m) continue;
  // Явный исполнитель «(делает Даня)» важнее догадки по имени в тексте.
  const owner = m[2].match(/\s*\(делает (Даня|Мира|оба)\)/);
  const text = owner ? m[2].replace(owner[0], '') : m[2];
  const cut = text.lastIndexOf(' — ');
  let body = text;
  let tail = '';
  let dates = [];
  if (cut > 0) {
    tail = text.slice(cut + 3);
    dates = [...tail.matchAll(/(\d{2})\.(\d{2})/g)].map((d) => iso(d[1], d[2]));
    if (dates.length) body = text.slice(0, cut);
    else tail = '';
  }
  let due = null;
  let from = null;
  if (/^с\s*~?\d/.test(tail)) from = dates[0];
  else if (dates.length > 1 && /\d\s*[–-]\s*\d/.test(tail)) { from = dates[0]; due = dates.at(-1); }
  else if (dates.length) due = dates.at(-1);
  const d = /Дан[яиеюу](?![а-яё])/i.test(text);
  const mi = /Миросла/.test(text);
  const who = owner ? owner[1] : /обоих/.test(text) || (d && mi) ? 'оба' : mi ? 'Мира' : d ? 'Даня' : '';
  tasks.push({ done: m[1] === 'x', html: inline(body), tail: esc(tail), due, from, who });
}

const fmtLong = (isoDate) => `${+isoDate.slice(8, 10)} ${MONTHS[+isoDate.slice(5, 7) - 1]}`;
const built = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date());

const data = {
  start, end, tasks, cities: CITIES,
  stays: routeRows.filter((r) => !r.transfer).map((r) => ({ name: r.place, from: r.from, to: r.to })),
  firstLeg: transfers[0].place,
};

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(tripName)}</title>
<style>
  :root {
    --bg: #f6f3ee; --card: #ffffff; --ink: #1d1b18; --muted: #6b665e; --line: #e6e0d6;
    --accent: #c2410c; --accent-soft: #fde9dc;
    --ok: #15803d; --ok-soft: #dcfce7; --wip: #92400e; --wip-soft: #fef3c7;
    --todo: #b91c1c; --todo-soft: #fee2e2; --info-soft: #eef0f3;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #151413; --card: #1f1d1b; --ink: #f2efe9; --muted: #a39e95; --line: #34312d;
      --accent: #fb923c; --accent-soft: #3b2416;
      --ok: #4ade80; --ok-soft: #15301f; --wip: #fcd34d; --wip-soft: #362c10;
      --todo: #f87171; --todo-soft: #3a1a1a; --info-soft: #292724;
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: var(--bg); color: var(--ink); overflow-wrap: anywhere;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  a { color: var(--accent); text-underline-offset: 2px; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 0 16px 56px; }

  .hero { padding: 28px 0 4px; }
  .eyebrow { color: var(--muted); font-size: 14px; }
  h1 { font-size: 34px; line-height: 1.1; margin: 4px 0 14px; letter-spacing: -0.02em; }
  .chain { display: flex; flex-wrap: wrap; gap: 6px 4px; align-items: center; font-size: 14px; }
  .chain .c { background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; }
  .chain .arr { color: var(--muted); }
  .countdown { margin-top: 20px; display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 10px; }
  .countdown .n { font-size: 56px; font-weight: 700; line-height: 1; color: var(--accent); letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
  .countdown .l { font-size: 18px; font-weight: 600; }
  .countdown .s { width: 100%; color: var(--muted); font-size: 14px; margin-top: 4px; }

  nav { position: sticky; top: 0; z-index: 5; margin: 18px -16px 0; padding: 10px 16px;
    display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none;
    background: color-mix(in srgb, var(--bg) 90%, transparent); backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--line); }
  nav::-webkit-scrollbar { display: none; }
  nav a { flex: none; font-size: 14px; color: var(--ink); text-decoration: none; padding: 4px 12px;
    border-radius: 999px; background: var(--card); border: 1px solid var(--line); }

  section { margin-top: 30px; scroll-margin-top: 64px; }
  h2 { font-size: 20px; margin: 0 0 12px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  h2 small { font-size: 14px; color: var(--muted); font-weight: 400; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 4px 16px; }

  .gt { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 16px 0 6px; font-weight: 600; }
  .gt.over { color: var(--todo); }
  ul.tasks { list-style: none; margin: 0; padding: 0; }
  .task { display: flex; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
  .task:first-child { border-top: 0; }
  .box { flex: none; width: 18px; height: 18px; margin-top: 3px; border: 2px solid var(--muted); border-radius: 5px; opacity: 0.6; }
  .task.done .box { background: var(--ok); border-color: var(--ok); opacity: 1; position: relative; }
  .task.done .box::after { content: ""; position: absolute; left: 4px; top: 0; width: 5px; height: 10px;
    border: solid var(--card); border-width: 0 2px 2px 0; transform: rotate(45deg); }
  .task.done .tt { color: var(--muted); }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .chip { font-size: 13px; padding: 1px 9px; border-radius: 999px; background: var(--info-soft); }
  .chip.over { background: var(--todo-soft); color: var(--todo); }
  .chip.soon { background: var(--wip-soft); color: var(--wip); }
  .chip.who { background: var(--accent-soft); color: var(--accent); }

  ol.route { list-style: none; margin: 0; padding: 8px 0; }
  .leg { display: grid; grid-template-columns: 72px 1fr; column-gap: 14px; }
  .leg .when { font-size: 13px; color: var(--muted); text-align: right; padding-top: 12px; font-variant-numeric: tabular-nums; }
  .leg .what { position: relative; padding: 9px 0 9px 20px; border-left: 2px solid var(--line); }
  .leg .what::before { content: ""; position: absolute; left: -7px; top: 16px; width: 12px; height: 12px;
    border-radius: 50%; background: var(--card); border: 2px solid var(--muted); }
  .leg.stay .what::before { background: var(--accent); border-color: var(--accent); }
  .leg.stay .place { font-size: 18px; font-weight: 650; }
  .leg.transfer .place { font-size: 14.5px; }
  .leg .sub { color: var(--muted); font-size: 14px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .chips:empty { display: none; }
  .st { font-size: 13px; padding: 1px 9px; border-radius: 999px; background: var(--info-soft); }
  .st.ok { background: var(--ok-soft); color: var(--ok); }
  .st.wip { background: var(--wip-soft); color: var(--wip); }
  .st.todo { background: var(--todo-soft); color: var(--todo); }
  .leg.past { opacity: 0.45; }
  .leg.now .what::before { box-shadow: 0 0 0 5px var(--accent-soft); }
  .leg.now .place::after { content: "сейчас"; margin-left: 8px; font-size: 12px; font-weight: 600; color: var(--accent);
    background: var(--accent-soft); padding: 1px 8px; border-radius: 999px; vertical-align: 2px; }

  .risk { background: var(--todo-soft); border-radius: 14px; padding: 2px 16px; margin-bottom: 12px; }
  .risk p { margin: 12px 0; }
  .visas { display: grid; gap: 10px; }
  .visa { padding: 12px 16px; }
  .visa .vc { font-weight: 650; margin-bottom: 8px; }
  .visa dl { margin: 0; display: grid; grid-template-columns: 88px 1fr; gap: 8px 12px; font-size: 15px; }
  .visa dt { color: var(--muted); }
  .visa dd { margin: 0; }
  .visa dd.warn { color: var(--todo); }

  details { margin-top: 12px; }
  details > summary { cursor: pointer; font-weight: 600; padding: 10px 0; color: var(--accent); }
  .prose { font-size: 15px; }
  .prose h3 { font-size: 16px; margin: 16px 0 4px; }
  .prose ul { padding-left: 20px; margin: 6px 0 12px; }
  .prose li { margin: 4px 0; }
  .prose p { margin: 10px 0; }
  .card.prose { padding: 4px 16px; }

  table.tz { width: 100%; border-collapse: collapse; font-size: 15px; }
  table.tz th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 600; padding: 10px 0 6px; }
  table.tz td { padding: 9px 0; border-top: 1px solid var(--line); font-variant-numeric: tabular-nums; }
  table.tz td:not(:first-child), table.tz th:not(:first-child) { text-align: right; }
  .note { color: var(--muted); font-size: 13px; margin: 8px 0 0; }

  footer { margin-top: 40px; color: var(--muted); font-size: 13px; }
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div class="eyebrow">${fmtLong(start)} — ${fmtLong(end)} ${YEAR} · Даня и Мира</div>
    <h1>${esc(tripName)}</h1>
    <div class="chain">${chain.map((c) => `<span class="c">${esc(c)}</span>`).join('<span class="arr">→</span>')}</div>
    <div class="countdown" id="countdown"></div>
  </header>

  <nav>
    <a href="#todo">Дела</a><a href="#route">Маршрут</a><a href="#visas">Визы</a><a href="#bookings">Брони</a><a href="#time">Время</a><a href="#questions">Вопросы</a>
  </nav>

  <section id="todo">
    <h2>Дела <small id="todo-count"></small></h2>
    <div id="tasks"></div>
  </section>

  <section id="route">
    <h2>Маршрут</h2>
    <div class="card"><ol class="route">${routeHtml}
    </ol></div>
  </section>

  <section id="visas">
    <h2>Визы и документы</h2>
    ${riskHtml ? `<div class="risk">${riskHtml}</div>` : ''}
    <div class="visas">${visaHtml}
    </div>
    <details><summary>Подробно: виза в Корею, транзит, Шенген</summary><div class="card prose">${visaDetailsHtml}</div></details>
  </section>

  <section id="bookings">
    <h2>Брони</h2>
    <div class="card prose">${marked.parse(sections['Брони'] ?? '')}</div>
  </section>

  <section id="time">
    <h2>Время</h2>
    <div class="card">
      <table class="tz"><thead><tr><th>Город</th><th>Сейчас</th><th>09–14 Лиссабона</th></tr></thead><tbody id="tz"></tbody></table>
    </div>
    <p class="note">Правая колонка — рабочий блок Дани 09–14 по Лиссабону в местном времени на дни поездки.</p>
  </section>

  <section id="questions">
    <h2>Открытые вопросы</h2>
    <div class="card prose">${marked.parse(sections['Открытые вопросы'] ?? '')}</div>
    <details><summary>Договорённости: жильё, темп, еда</summary><div class="card prose">${marked.parse(sections['Предпочтения'] ?? '')}</div></details>
  </section>

  <footer>Собрано из хаба поездки ${built} (Лиссабон). Изменения — через Даню.</footer>
</div>
<script>
const DATA = ${JSON.stringify(data).replace(/</g, '\\u003c')};
const DAY = 86400000;
const now = new Date();
const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
const t = (iso) => Date.parse(iso + 'T00:00:00Z');
const diff = (iso) => Math.round((t(iso) - today) / DAY);
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
const days = (n) => n + ' ' + plural(n, 'день', 'дня', 'дней');
const fmt = (iso) => iso.slice(8, 10) + '.' + iso.slice(5, 7);
const rel = (n) => n === 0 ? 'сегодня' : n === 1 ? 'завтра' : n === -1 ? 'вчера' : n > 0 ? 'через ' + days(n) : days(-n) + ' назад';

// Обратный отсчёт
(() => {
  const s = diff(DATA.start), e = diff(DATA.end), el = document.getElementById('countdown');
  const total = (t(DATA.end) - t(DATA.start)) / DAY + 1;
  if (s > 0) {
    el.innerHTML = '<span class="n">' + s + '</span><span class="l">' + plural(s, 'день', 'дня', 'дней') + ' до вылета</span><span class="s">' + fmt(DATA.start) + ' · ' + DATA.firstLeg + '</span>';
  } else if (e >= 0) {
    const stay = DATA.stays.find((x) => t(x.from) <= today && today <= t(x.to));
    el.innerHTML = '<span class="n">' + (1 - s) + '</span><span class="l">день из ' + total + '</span>' + (stay ? '<span class="s">Сейчас: ' + stay.name + '</span>' : '');
  } else {
    el.innerHTML = '<span class="l">Поездка позади</span>';
  }
})();

// Дела
(() => {
  const open = DATA.tasks.filter((x) => !x.done), done = DATA.tasks.filter((x) => x.done);
  const key = (x) => x.due ?? x.from;
  const groups = [
    ['over', 'Просрочено', open.filter((x) => x.due && diff(x.due) < 0)],
    ['soon', 'Ближайшие 7 дней', open.filter((x) => key(x) && diff(key(x)) >= 0 && diff(key(x)) <= 7 || (!x.due && x.from && diff(x.from) < 0))],
    ['', 'Позже', open.filter((x) => key(x) && diff(key(x)) > 7)],
    ['', 'Без срока', open.filter((x) => !key(x))],
  ];
  const item = (x, cls) => {
    let chip = '';
    if (x.tail) {
      const n = diff(key(x));
      const when = x.done ? '' : (!x.due && n <= 0) ? ' · можно делать' : ' · ' + rel(n);
      chip = '<span class="chip ' + cls + '">' + x.tail + when + '</span>';
    }
    const who = x.who ? '<span class="chip who">' + x.who + '</span>' : '';
    return '<li class="task' + (x.done ? ' done' : '') + '"><span class="box"></span><div><div class="tt">' + x.html + '</div>' +
      (chip || who ? '<div class="meta">' + chip + who + '</div>' : '') + '</div></li>';
  };
  let html = '';
  for (const [cls, title, list] of groups) {
    if (!list.length) continue;
    list.sort((a, b) => (key(a) ?? '').localeCompare(key(b) ?? ''));
    html += '<div class="gt ' + cls + '">' + title + ' · ' + list.length + '</div><div class="card"><ul class="tasks">' + list.map((x) => item(x, cls)).join('') + '</ul></div>';
  }
  if (done.length) html += '<details><summary>Сделано · ' + done.length + '</summary><div class="card"><ul class="tasks">' + done.map((x) => item(x, '')).join('') + '</ul></div></details>';
  document.getElementById('tasks').innerHTML = html;
  document.getElementById('todo-count').textContent = 'осталось ' + open.length + ' из ' + DATA.tasks.length;
})();

// Маршрут: прошедшее и текущее
document.querySelectorAll('.leg').forEach((li) => {
  const { from, to } = li.dataset;
  if (!from) return;
  if (t(to) < today) li.classList.add('past');
  else if (t(from) <= today && today <= t(to) && li.classList.contains('stay')) li.classList.add('now');
});

// Время
const offset = (tz, date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(date / 60000) * 60000;
};
const hm = (tz, date) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(date);
const workIn = (c) => {
  const day = t(c.on), lis = offset('Europe/Lisbon', new Date(day + 12 * 3600000));
  const from = new Date(day + 9 * 3600000 - lis), to = new Date(day + 14 * 3600000 - lis);
  return hm(c.tz, from) + '–' + hm(c.tz, to);
};
const drawTz = () => {
  const d = new Date();
  document.getElementById('tz').innerHTML = DATA.cities.map((c) =>
    '<tr><td>' + c.name + '</td><td>' + hm(c.tz, d) + '</td><td>' + workIn(c) + '</td></tr>').join('');
};
drawTz();
setInterval(drawTz, 30000);
</script>
</body>
</html>
`;

mkdirSync(new URL('./build/', import.meta.url), { recursive: true });
writeFileSync(new URL('./build/index.html', import.meta.url), html);
console.log(`build/index.html: ${tasks.filter((x) => !x.done).length} открытых дел, ${routeRows.length} строк маршрута, ${visaTable.rows.length} стран`);
