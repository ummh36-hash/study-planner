'use strict';

/* =========================================================
   Storage
   ========================================================= */
const STORE_KEY = 'studyPlanner.v1';
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Senin..Minggu
const TYPE_LABEL = { tugas: 'Tugas', proyek: 'Proyek', ujian: 'Ujian' };
const PRIO_LABEL = { tinggi: 'Tinggi', sedang: 'Sedang', rendah: 'Rendah' };
const PRIO_WEIGHT = { tinggi: 0, sedang: 1, rendah: 2 };
const DEFAULT_SETTINGS = { notify: false, focus: 25, short: 5, long: 15 };

/** Fill in defaults so older saves and imported files keep working. */
function normalize(data) {
  const d = data && typeof data === 'object' ? data : {};
  const settings = { ...DEFAULT_SETTINGS, ...(d.settings && typeof d.settings === 'object' ? d.settings : {}) };
  const focusLog = d.focusLog && typeof d.focusLog === 'object' && !Array.isArray(d.focusLog) ? d.focusLog : {};
  const tasks = (Array.isArray(d.tasks) ? d.tasks : [])
    .filter((t) => t && t.id && t.title && t.deadline)
    .map((t) => ({
      type: 'tugas', priority: 'sedang', subject: '', notes: '', done: false, focusMin: 0, ...t,
      notified: Array.isArray(t.notified) ? t.notified : [],
    }));
  const schedules = (Array.isArray(d.schedules) ? d.schedules : [])
    .filter((s) => s && s.id && s.subject && s.start && s.end);
  return { tasks, schedules, focusLog, settings };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (_) { /* ignore corrupt/blocked storage */ }
  return normalize(null);
}

let state = load();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (_) {
    toast('⚠️ Gagal menyimpan data ke Local Storage.');
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* =========================================================
   Helpers
   ========================================================= */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const isUrl = (str) => /^https?:\/\/\S+$/i.test(str || '');

const fmtDateTime = new Intl.DateTimeFormat('id-ID', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const fmtToday = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtMonth = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' });
const fmtDayLong = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });

function splitDuration(ms) {
  const s = Math.floor(Math.abs(ms) / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** e.g. "3 hari 4 jam lagi" / "Terlambat 2 jam". */
function remainingText(ms) {
  const { d, h, m } = splitDuration(ms);
  let txt;
  if (d > 0) txt = `${d} hari${h ? ` ${h} jam` : ''}`;
  else if (h > 0) txt = `${h} jam${m ? ` ${m} menit` : ''}`;
  else txt = `${Math.max(m, ms >= 0 ? 0 : 1)} menit`;
  return ms >= 0 ? `${txt} lagi` : `Terlambat ${txt}`;
}

function urgencyClass(ms) {
  if (ms < 0) return 'overdue';
  if (ms < 864e5) return 'urgent';
  return 'ok';
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const deadlineTs = (t) => new Date(t.deadline).getTime();

function sortTasks(a, b) {
  return (a.done - b.done)
    || (deadlineTs(a) - deadlineTs(b))
    || ((PRIO_WEIGHT[a.priority] ?? 1) - (PRIO_WEIGHT[b.priority] ?? 1));
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function focusToday() {
  return state.focusLog[dateKey(new Date())] || { min: 0, sessions: 0 };
}

function todaysClasses() {
  const today = new Date().getDay();
  return state.schedules.filter((s) => Number(s.day) === today).sort((a, b) => a.start.localeCompare(b.start));
}

/* =========================================================
   Task cards (shared by Beranda, Tugas, Kalender)
   ========================================================= */
function taskCardHTML(t, now) {
  const diff = deadlineTs(t) - now;
  const remaining = t.done
    ? '<span class="remaining ok">Selesai ✿</span>'
    : `<span class="remaining ${urgencyClass(diff)}">${remainingText(diff)}</span>`;
  return `
    <li class="card prio-${esc(t.priority)} ${t.done ? 'done' : ''}" data-id="${esc(t.id)}">
      <input type="checkbox" ${t.done ? 'checked' : ''} aria-label="Tandai selesai: ${esc(t.title)}" data-action="toggle" />
      <div class="body">
        <div class="title">${esc(t.title)}</div>
        <div class="meta">
          <span class="tag ${esc(t.type)}">${TYPE_LABEL[t.type] || 'Tugas'}</span>
          <span>Prioritas ${PRIO_LABEL[t.priority] || 'Sedang'}</span>
          ${t.subject ? `<span>📚 ${esc(t.subject)}</span>` : ''}
          <span>🗓 ${fmtDateTime.format(new Date(t.deadline))}</span>
          ${remaining}
          ${t.focusMin ? `<span class="focus-min">⏰ ${t.focusMin} mnt fokus</span>` : ''}
        </div>
        ${t.notes ? `<div class="notes">${esc(t.notes)}</div>` : ''}
      </div>
      <div class="tools">
        <button class="icon-btn" data-action="edit">Edit</button>
        <button class="icon-btn del" data-action="delete">Hapus</button>
      </div>
    </li>`;
}

function handleTaskAction(e) {
  const action = e.target.dataset.action;
  const card = e.target.closest('.card');
  if (!action || !card) return;
  const task = state.tasks.find((t) => t.id === card.dataset.id);
  if (!task) return;

  if (action === 'toggle') {
    task.done = e.target.checked;
    if (task.done) toast(`Yeay! "${task.title}" selesai ✿`);
  } else if (action === 'edit') {
    openTaskDialog(task);
    return;
  } else if (action === 'delete') {
    if (!confirm(`Hapus "${task.title}"?`)) return;
    state.tasks = state.tasks.filter((t) => t !== task);
  }
  save();
  renderAll();
}

['#task-list', '#home-tasks', '#cal-day-list'].forEach((sel) => $(sel).addEventListener('click', handleTaskAction));

/* =========================================================
   Tugas
   ========================================================= */
let taskFilter = 'pending';
let taskSearch = '';
let taskPriority = 'all';

function renderTasks() {
  const now = Date.now();
  const q = taskSearch.toLowerCase();
  const items = state.tasks
    .filter((t) => taskFilter === 'all' || (taskFilter === 'done' ? t.done : !t.done))
    .filter((t) => taskPriority === 'all' || t.priority === taskPriority)
    .filter((t) => !q || `${t.title} ${t.subject} ${t.notes}`.toLowerCase().includes(q))
    .sort(sortTasks);

  $('#pending-count').textContent = state.tasks.filter((t) => !t.done).length;

  if (!items.length) {
    const msg = q || taskPriority !== 'all'
      ? 'Tidak ada tugas yang cocok dengan pencarian.'
      : { pending: 'Tidak ada tugas yang tertunda. Waktunya santai ✿',
          done: 'Belum ada tugas yang diselesaikan.',
          all: 'Belum ada tugas. Klik “+ Tambah Tugas”.' }[taskFilter];
    $('#task-list').innerHTML = `<li class="empty">${msg}</li>`;
    return;
  }
  $('#task-list').innerHTML = items.map((t) => taskCardHTML(t, now)).join('');
}

function openTaskDialog(task, preset = {}) {
  const form = $('#task-form');
  form.reset();
  $('#task-dialog-title').textContent = task ? 'Edit Tugas' : 'Tambah Tugas';
  const src = task || { id: '', priority: 'sedang', type: 'tugas', ...preset };
  for (const key of ['id', 'title', 'type', 'priority', 'subject', 'deadline', 'notes']) {
    if (src[key] !== undefined) form.elements[key].value = src[key];
  }
  refreshSubjectOptions();
  $('#task-dialog').showModal();
}

$('#task-form').addEventListener('submit', (e) => {
  const f = e.target.elements;
  const data = {
    title: f.title.value.trim(),
    type: f.type.value,
    priority: f.priority.value,
    subject: f.subject.value.trim(),
    deadline: f.deadline.value,
    notes: f.notes.value.trim(),
  };
  if (!data.title || !data.deadline) { e.preventDefault(); return; }

  const existing = state.tasks.find((t) => t.id === f.id.value);
  if (existing) {
    if (existing.deadline !== data.deadline) existing.notified = [];
    Object.assign(existing, data);
  } else {
    state.tasks.push({ id: uid(), done: false, focusMin: 0, notified: [], ...data });
  }
  save();
  renderAll();
});

$('#task-filters').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  taskFilter = btn.dataset.filter;
  $$('#task-filters .chip').forEach((c) => c.classList.toggle('active', c === btn));
  renderTasks();
});
$('#task-search').addEventListener('input', (e) => { taskSearch = e.target.value.trim(); renderTasks(); });
$('#task-priority').addEventListener('change', (e) => { taskPriority = e.target.value; renderTasks(); });
$('#add-task').addEventListener('click', () => openTaskDialog(null));

/* =========================================================
   Jadwal
   ========================================================= */
function roomHTML(s) {
  if (!s.room) return '';
  return isUrl(s.room)
    ? `<a href="${esc(s.room)}" target="_blank" rel="noopener noreferrer">Link kelas online ↗</a>`
    : `<span>📍 ${esc(s.room)}</span>`;
}

function classStatus(s, isToday, nowMin) {
  if (!isToday) return '';
  if (nowMin >= toMinutes(s.start) && nowMin < toMinutes(s.end)) return '<span class="live">● Sedang berlangsung</span>';
  if (nowMin >= toMinutes(s.end)) return '<span class="past">sudah selesai</span>';
  return '';
}

function renderSchedule() {
  const wrap = $('#schedule-list');
  if (!state.schedules.length) {
    wrap.innerHTML = '<p class="empty">Belum ada jadwal. Klik “+ Tambah Jadwal”.</p>';
    return;
  }
  const now = new Date();
  const today = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  wrap.innerHTML = DAY_ORDER.map((day) => {
    const items = state.schedules.filter((s) => Number(s.day) === day).sort((a, b) => a.start.localeCompare(b.start));
    if (!items.length) return '';
    const isToday = day === today;
    return `
      <div class="day ${isToday ? 'today' : ''}">
        <h3>${DAYS[day]}${isToday ? ' <span class="badge">hari ini</span>' : ''}</h3>
        <ul class="list">
          ${items.map((s) => `
            <li class="card" data-id="${esc(s.id)}">
              <div class="time">${esc(s.start)}–${esc(s.end)}</div>
              <div class="body">
                <div class="title">${esc(s.subject)} ${classStatus(s, isToday, nowMin)}</div>
                <div class="meta">${roomHTML(s)}${s.lecturer ? `<span>👤 ${esc(s.lecturer)}</span>` : ''}</div>
              </div>
              <div class="tools">
                <button class="icon-btn" data-action="edit">Edit</button>
                <button class="icon-btn del" data-action="delete">Hapus</button>
              </div>
            </li>`).join('')}
        </ul>
      </div>`;
  }).join('');
}

function openScheduleDialog(item) {
  const form = $('#schedule-form');
  form.reset();
  $('#schedule-error').hidden = true;
  $('#schedule-dialog-title').textContent = item ? 'Edit Jadwal' : 'Tambah Jadwal';
  if (item) {
    for (const key of ['id', 'subject', 'day', 'start', 'end', 'room', 'lecturer']) form.elements[key].value = item[key] ?? '';
  } else {
    form.elements.id.value = '';
    form.elements.day.value = String(new Date().getDay());
  }
  $('#schedule-dialog').showModal();
}

$('#schedule-form').addEventListener('submit', (e) => {
  const f = e.target.elements;
  const data = {
    subject: f.subject.value.trim(),
    day: Number(f.day.value),
    start: f.start.value,
    end: f.end.value,
    room: f.room.value.trim(),
    lecturer: f.lecturer.value.trim(),
  };
  if (toMinutes(data.end) <= toMinutes(data.start)) {
    e.preventDefault();
    const err = $('#schedule-error');
    err.textContent = 'Jam selesai harus setelah jam mulai.';
    err.hidden = false;
    return;
  }
  const existing = state.schedules.find((s) => s.id === f.id.value);
  if (existing) Object.assign(existing, data);
  else state.schedules.push({ id: uid(), ...data });
  save();
  renderAll();
});

$('#schedule-list').addEventListener('click', (e) => {
  const action = e.target.dataset.action;
  const card = e.target.closest('.card');
  if (!action || !card) return;
  const item = state.schedules.find((s) => s.id === card.dataset.id);
  if (!item) return;
  if (action === 'edit') {
    openScheduleDialog(item);
  } else if (action === 'delete' && confirm(`Hapus jadwal "${item.subject}" (${DAYS[item.day]})?`)) {
    state.schedules = state.schedules.filter((s) => s !== item);
    save();
    renderAll();
  }
});

$('#add-schedule').addEventListener('click', () => openScheduleDialog(null));

function refreshSubjectOptions() {
  const subjects = new Set([...state.schedules.map((s) => s.subject), ...state.tasks.map((t) => t.subject).filter(Boolean)]);
  $('#subject-options').innerHTML = [...subjects].map((s) => `<option value="${esc(s)}"></option>`).join('');
}

/* =========================================================
   Beranda
   ========================================================= */
function renderHome() {
  const now = Date.now();
  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.done).length;
  const overdue = state.tasks.filter((t) => !t.done && deadlineTs(t) < now).length;
  const classes = todaysClasses();

  $('#st-done').textContent = `${done}/${total}`;
  $('#st-bar').style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  $('#st-focus').textContent = `${focusToday().min} mnt`;
  $('#st-classes').textContent = classes.length;
  $('#st-overdue').textContent = overdue;

  const nowD = new Date();
  const nowMin = nowD.getHours() * 60 + nowD.getMinutes();
  $('#home-classes').innerHTML = classes.length
    ? classes.map((s) => `
        <li class="card">
          <span class="mini-time">${esc(s.start)}–${esc(s.end)}</span>
          <div class="body">
            <div class="title">${esc(s.subject)} ${classStatus(s, true, nowMin)}</div>
            <div class="meta">${roomHTML(s)}${s.lecturer ? `<span>👤 ${esc(s.lecturer)}</span>` : ''}</div>
          </div>
        </li>`).join('')
    : '<li class="empty">Tidak ada kelas hari ini. Waktunya belajar mandiri ✿</li>';

  const soon = state.tasks
    .filter((t) => !t.done && deadlineTs(t) - now < 3 * 864e5)
    .sort(sortTasks)
    .slice(0, 6);
  $('#home-tasks').innerHTML = soon.length
    ? soon.map((t) => taskCardHTML(t, now)).join('')
    : '<li class="empty">Tidak ada tenggat dalam 3 hari ke depan 🌸</li>';
}

/* =========================================================
   Kalender
   ========================================================= */
const calMonth = new Date();
calMonth.setDate(1);
let calSelected = dateKey(new Date());

function renderCalendar() {
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  const todayKey = dateKey(new Date());
  const offset = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const byDay = {};
  for (const t of state.tasks) (byDay[t.deadline.slice(0, 10)] ||= []).push(t);

  $('#cal-title').textContent = fmtMonth.format(calMonth);

  let html = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < offset; i++) html += '<div class="cal-cell blank"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${pad(m + 1)}-${pad(d)}`;
    const items = (byDay[key] || []).sort(sortTasks);
    const dow = new Date(y, m, d).getDay();
    const cls = [
      'cal-cell',
      key === todayKey && 'today',
      key === calSelected && 'selected',
      (dow === 0 || dow === 6) && 'weekend',
    ].filter(Boolean).join(' ');
    const dots = items.slice(0, 4).map((t) => `<i class="dot ${esc(t.type)} ${t.done ? 'done' : ''}"></i>`).join('');
    const more = items.length > 4 ? `<span class="more">+${items.length - 4}</span>` : '';
    const label = `${d} ${fmtMonth.format(calMonth)}${items.length ? `, ${items.length} tugas` : ''}`;
    html += `<button class="${cls}" data-date="${key}" aria-label="${esc(label)}"><span class="num">${d}</span><span class="dots">${dots}${more}</span></button>`;
  }
  $('#cal-grid').innerHTML = html;

  // Selected day details
  const [sy, sm, sd] = calSelected.split('-').map(Number);
  const selDate = new Date(sy, sm - 1, sd);
  $('#cal-day-title').textContent = fmtDayLong.format(selDate);
  const classes = state.schedules
    .filter((s) => Number(s.day) === selDate.getDay())
    .sort((a, b) => a.start.localeCompare(b.start));
  $('#cal-day-classes').textContent = classes.length
    ? `🎒 Kelas: ${classes.map((s) => `${s.subject} (${s.start})`).join(', ')}`
    : '🎒 Tidak ada kelas di hari ini.';
  const items = (byDay[calSelected] || []).sort(sortTasks);
  $('#cal-day-list').innerHTML = items.length
    ? items.map((t) => taskCardHTML(t, Date.now())).join('')
    : '<li class="empty">Tidak ada tugas di tanggal ini.</li>';
}

$('#cal-grid').addEventListener('click', (e) => {
  const cell = e.target.closest('[data-date]');
  if (!cell) return;
  calSelected = cell.dataset.date;
  renderCalendar();
});
$('#cal-prev').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); });
$('#cal-next').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); });
$('#cal-today').addEventListener('click', () => {
  const now = new Date();
  calMonth.setFullYear(now.getFullYear(), now.getMonth(), 1);
  calSelected = dateKey(now);
  renderCalendar();
});
$('#cal-add').addEventListener('click', () => openTaskDialog(null, { deadline: `${calSelected}T23:59` }));

/* =========================================================
   Countdown
   ========================================================= */
function nextTarget() {
  const now = Date.now();
  const pending = state.tasks.filter((t) => !t.done).map((t) => ({ ...t, ts: deadlineTs(t) })).sort((a, b) => a.ts - b.ts);
  // Prefer the nearest upcoming item; fall back to the most recently overdue one.
  return pending.find((t) => t.ts >= now) || pending[pending.length - 1] || null;
}

function updateCountdown() {
  const t = nextTarget();
  const box = $('#countdown');
  const grid = $('#cd-grid');
  if (!t) {
    box.classList.remove('overdue');
    $('#cd-label').textContent = 'Tenggat terdekat';
    $('#cd-title').textContent = 'Belum ada tugas atau ujian';
    $('#cd-meta').textContent = 'Tambahkan tugas/ujian untuk memulai hitung mundur.';
    grid.hidden = true;
    return;
  }
  const diff = t.ts - Date.now();
  const overdue = diff < 0;
  const { d, h, m, s } = splitDuration(diff);
  box.classList.toggle('overdue', overdue);
  $('#cd-label').textContent = overdue ? 'Ups, sudah lewat tenggat!' : (t.type === 'ujian' ? 'Ujian terdekat' : 'Tenggat terdekat');
  $('#cd-title').textContent = t.title;
  $('#cd-meta').textContent = [TYPE_LABEL[t.type], t.subject, fmtDateTime.format(new Date(t.ts))].filter(Boolean).join(' · ');
  grid.hidden = false;
  $('#cd-d').textContent = d;
  $('#cd-h').textContent = pad(h);
  $('#cd-m').textContent = pad(m);
  $('#cd-s').textContent = pad(s);
}

/* =========================================================
   Pengingat (notifications)
   ========================================================= */
function notify(title, body) {
  toast(`🔔 ${title}: ${body}`);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body }); } catch (_) { /* some browsers need a service worker */ }
  }
}

function checkReminders() {
  if (!state.settings.notify) return;
  const now = Date.now();
  let changed = false;
  for (const t of state.tasks) {
    if (t.done) continue;
    const diff = deadlineTs(t) - now;
    if (diff <= 0) continue;
    const level = diff <= 36e5 ? '1h' : diff <= 864e5 ? '24h' : null;
    if (!level || t.notified.includes(level)) continue;
    notify(`${TYPE_LABEL[t.type] || 'Tugas'}: ${t.title}`, remainingText(diff));
    t.notified.push(level);
    if (level === '1h' && !t.notified.includes('24h')) t.notified.push('24h');
    changed = true;
  }
  if (changed) save();
}

/* =========================================================
   Pomodoro
   ========================================================= */
const RING_C = 2 * Math.PI * 54;
const MODE_LABEL = { focus: 'waktunya fokus ✿', short: 'istirahat sebentar ☕', long: 'istirahat panjang 🌙' };
const pomo = { mode: 'focus', running: false, endAt: 0, remaining: state.settings.focus * 60000, cycle: 0 };

const modeMs = (mode) => state.settings[mode] * 60000;

function setPomoMode(mode) {
  pomo.mode = mode;
  pomo.running = false;
  pomo.remaining = modeMs(mode);
  renderPomo();
}

function pomoRemaining() {
  return pomo.running ? Math.max(0, pomo.endAt - Date.now()) : pomo.remaining;
}

function renderPomo() {
  const rem = pomoRemaining();
  const total = modeMs(pomo.mode);
  const secs = Math.ceil(rem / 1000);
  const time = `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;

  $('#pomo-time').textContent = time;
  $('#pomo-label').textContent = MODE_LABEL[pomo.mode];
  const ring = $('#pomo-ring');
  ring.style.strokeDasharray = RING_C;
  ring.style.strokeDashoffset = RING_C * (1 - rem / total);
  $('#pomo').className = `pomo sticker mode-${pomo.mode}`;
  $('#pomo-start').textContent = pomo.running ? 'Jeda' : (rem < total ? 'Lanjut' : 'Mulai');
  $$('#pomo-modes .chip').forEach((c) => c.classList.toggle('active', c.dataset.mode === pomo.mode));
  document.title = pomo.running ? `${time} · ${pomo.mode === 'focus' ? 'Fokus' : 'Istirahat'}` : 'Study Planner';

  $('#pomo-count').textContent = focusToday().sessions;
  let week = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    week += state.focusLog[dateKey(d)]?.min || 0;
  }
  $('#pomo-week').textContent = `${week} mnt`;
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.28, 0.56].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      const at = ctx.currentTime + t;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      o.start(at);
      o.stop(at + 0.24);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch (_) { /* audio not available */ }
}

function completePomo() {
  pomo.running = false;
  beep();
  let next;
  if (pomo.mode === 'focus') {
    const min = state.settings.focus;
    const key = dateKey(new Date());
    const log = state.focusLog[key] || { min: 0, sessions: 0 };
    state.focusLog[key] = { min: log.min + min, sessions: log.sessions + 1 };
    const task = state.tasks.find((t) => t.id === $('#pomo-task').value);
    if (task) task.focusMin = (task.focusMin || 0) + min;
    save();
    pomo.cycle++;
    next = pomo.cycle % 4 === 0 ? 'long' : 'short';
    notify('Sesi fokus selesai', next === 'long' ? 'Hebat! Ambil istirahat panjang 🌙' : 'Istirahat sebentar dulu ☕');
  } else {
    next = 'focus';
    notify('Istirahat selesai', 'Yuk, lanjut fokus lagi ✿');
  }
  setPomoMode(next);
  renderHome();
  renderTasks();
}

$('#pomo-start').addEventListener('click', () => {
  if (pomo.running) {
    pomo.remaining = pomoRemaining();
    pomo.running = false;
  } else {
    pomo.endAt = Date.now() + pomo.remaining;
    pomo.running = true;
  }
  renderPomo();
});
$('#pomo-reset').addEventListener('click', () => setPomoMode(pomo.mode));
$('#pomo-skip').addEventListener('click', () => {
  if (pomo.mode === 'focus') setPomoMode('short');
  else setPomoMode('focus');
});
$('#pomo-modes').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mode]');
  if (!btn) return;
  if (pomo.running && !confirm('Timer sedang berjalan. Ganti mode?')) return;
  setPomoMode(btn.dataset.mode);
});

function refreshPomoTasks() {
  const sel = $('#pomo-task');
  const current = sel.value;
  const pending = state.tasks.filter((t) => !t.done).sort(sortTasks);
  sel.innerHTML = '<option value="">Pilih tugas (opsional)</option>'
    + pending.map((t) => `<option value="${esc(t.id)}">${esc(t.title)}${t.subject ? ` · ${esc(t.subject)}` : ''}</option>`).join('');
  if (pending.some((t) => t.id === current)) sel.value = current;
}

/* =========================================================
   Pengaturan & data
   ========================================================= */
$('#open-settings').addEventListener('click', () => {
  const f = $('#settings-form').elements;
  f.notify.checked = state.settings.notify;
  f.focus.value = state.settings.focus;
  f.short.value = state.settings.short;
  f.long.value = state.settings.long;
  $('#settings-dialog').showModal();
});

$('#settings-form').addEventListener('submit', async (e) => {
  const f = e.target.elements;
  const clamp = (v, max) => Math.min(max, Math.max(1, Math.round(Number(v) || 1)));
  const old = { ...state.settings };
  state.settings = {
    notify: f.notify.checked,
    focus: clamp(f.focus.value, 180),
    short: clamp(f.short.value, 60),
    long: clamp(f.long.value, 90),
  };
  save();
  if (!pomo.running && state.settings[pomo.mode] !== old[pomo.mode]) setPomoMode(pomo.mode);

  if (state.settings.notify && 'Notification' in window && Notification.permission === 'default') {
    const res = await Notification.requestPermission();
    if (res !== 'granted') toast('Izin notifikasi ditolak. Pengingat tetap muncul di halaman.');
  }
  toast('Pengaturan disimpan ✿');
  checkReminders();
});

$('#export-data').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `study-planner-backup-${dateKey(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Cadangan diunduh 💾');
});

$('#import-data').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || (!Array.isArray(parsed.tasks) && !Array.isArray(parsed.schedules))) throw new Error('format');
    if (!confirm('Ganti semua data saat ini dengan isi file cadangan?')) return;
    state = normalize(parsed);
    save();
    setPomoMode('focus');
    renderAll();
    $('#settings-dialog').close();
    toast('Data berhasil diimpor ✿');
  } catch (_) {
    toast('⚠️ File cadangan tidak valid.');
  }
});

$('#reset-data').addEventListener('click', () => {
  if (!confirm('Hapus SEMUA jadwal, tugas, dan riwayat fokus? Tindakan ini tidak bisa dibatalkan.')) return;
  state = normalize(null);
  save();
  setPomoMode('focus');
  renderAll();
  $('#settings-dialog').close();
  toast('Semua data dihapus.');
});

/* =========================================================
   Tabs, clock, dialogs, boot
   ========================================================= */
function showTab(name) {
  $$('.tab').forEach((b) => {
    const active = b.dataset.tab === name;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active);
  });
  $$('.panel').forEach((p) => { p.hidden = p.id !== `panel-${name}`; });
  updateFab(name);
  try { localStorage.setItem('studyPlanner.tab', name); } catch (_) { /* ignore */ }
}

$('.tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (!tab) return;
  showTab(tab.dataset.tab);
  // On phones the nav sits at the bottom: jump back to the top of the new panel.
  const panel = $(`#panel-${tab.dataset.tab}`);
  const top = panel.getBoundingClientRect().top + window.scrollY - 16;
  if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
});

/* Floating "+" button (phone layout): adds whatever fits the current tab. */
let currentTab = 'home';
function updateFab(name) {
  currentTab = name;
  const fab = $('#fab');
  fab.hidden = name === 'focus';
  fab.setAttribute('aria-label', name === 'schedule' ? 'Tambah jadwal' : 'Tambah tugas');
}
$('#fab').addEventListener('click', () => {
  if (currentTab === 'schedule') openScheduleDialog(null);
  else if (currentTab === 'calendar') openTaskDialog(null, { deadline: `${calSelected}T23:59` });
  else openTaskDialog(null);
});

$$('[data-close]').forEach((btn) => btn.addEventListener('click', () => btn.closest('dialog').close()));

// Tap outside a dialog (on the backdrop) closes it.
$$('dialog').forEach((dlg) => dlg.addEventListener('click', (e) => {
  if (e.target === dlg) dlg.close();
}));

function tickClock() {
  const now = new Date();
  const h = now.getHours();
  $('#clock').textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('#today').textContent = fmtToday.format(now);
  $('#greeting').textContent = h < 11 ? 'Selamat pagi! ☀️' : h < 15 ? 'Selamat siang! 🌤' : h < 18 ? 'Selamat sore! 🌇' : 'Selamat malam! 🌙';
}

function renderAll() {
  renderTasks();
  renderSchedule();
  renderHome();
  renderCalendar();
  refreshPomoTasks();
  updateCountdown();
  renderPomo();
}

// Sync across browser tabs.
window.addEventListener('storage', (e) => {
  if (e.key === STORE_KEY) { state = load(); renderAll(); }
});

try {
  const saved = localStorage.getItem('studyPlanner.tab');
  if (saved && $(`#panel-${saved}`)) showTab(saved);
} catch (_) { /* ignore */ }

renderAll();
tickClock();
checkReminders();

// Installable/offline app — only works when served over http(s), not file://.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* ignore */ });
}

let lastMinute = new Date().getMinutes();
setInterval(() => {
  tickClock();
  updateCountdown();
  if (pomo.running) {
    if (pomoRemaining() <= 0) completePomo();
    else renderPomo();
  }
  const minute = new Date().getMinutes();
  if (minute !== lastMinute) {
    lastMinute = minute;
    renderTasks();
    renderSchedule();
    renderHome();
    checkReminders();
  }
}, 1000);
