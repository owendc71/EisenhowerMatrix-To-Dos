/* ============================================================
   Plotting Bed — Eisenhower matrix task board
   State lives in localStorage; every task holds a quadrant and
   a sub-grid cell index, or nothing at all (the tray).
   ============================================================ */

const STORE = 'plotting-bed.v1';
const MAX_STEPS = 6;
const MIN_STEPS = 1;

const QUADS = [
  { name: 'Urgent · Important',         verb: 'Do it now.' },
  { name: 'Not urgent · Important',     verb: 'Give it a date.' },
  { name: 'Urgent · Not important',     verb: 'Hand it to someone.' },
  { name: 'Not urgent · Not important', verb: 'Let it go.' },
];

/* ---------- helpers ---------- */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const colName = (i) => String(i + 1);
const rowName = (i) => String.fromCharCode(65 + i);
const coordOf = (q, cell) => {
  const g = state.grids[q];
  return `${rowName(Math.floor(cell / g.cols))}${colName(cell % g.cols)}`;
};

const todayISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
const daysUntil = (iso) => {
  if (!iso) return null;
  const a = new Date(todayISO() + 'T00:00:00');
  const b = new Date(iso + 'T00:00:00');
  return Math.round((b - a) / 86400000);
};
const dueLabel = (iso) => {
  const d = daysUntil(iso);
  if (d === null) return '';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return '1d late';
  if (d < 0) return `${-d}d late`;
  if (d < 7) return `${d}d`;
  return new Date(iso + 'T00:00:00')
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    .toLowerCase();
};
const dueClass = (iso, done) => {
  if (!iso || done) return '';
  const d = daysUntil(iso);
  return d < 0 ? 'over' : d <= 1 ? 'soon' : '';
};

/* ---------- state ---------- */

let state = load();
let undoStack = [];
let dragId = null;
let dropTarget = null;
let sheetView = null;   // { mode:'task'|'cell', taskId, q, cell }
let lastFocus = null;

function blankState() {
  return {
    tasks: [],
    grids: [ { cols: 2, rows: 2 }, { cols: 2, rows: 2 }, { cols: 2, rows: 2 }, { cols: 2, rows: 2 } ],
    theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    showDone: false,
  };
}

function seed() {
  const s = blankState();
  const t = (title, q, cell, extra = {}) => ({
    id: uid(), title, q, cell, notes: '', due: '', tags: [],
    done: false, subtasks: [], created: Date.now(), order: Date.now() + Math.random(), ...extra,
  });
  s.tasks = [
    t('Fix the checkout timeout', 0, 0, { tags: ['bug'], due: todayISO() }),
    t('Prep board deck', 0, 3, { due: todayISO(), subtasks: [
      { id: uid(), text: 'Pull Q3 numbers', done: true },
      { id: uid(), text: 'Draft narrative', done: false },
    ] }),
    t('Rewrite onboarding emails', 1, 0, { tags: ['growth'] }),
    t('Quarterly planning offsite', 1, 3, { notes: 'Book the room before September.' }),
    t('Vendor invoice questions', 2, 1, { tags: ['admin'] }),
    t('Reformat the old changelog', 3, 2, {}),
    t('Read the API pricing thread', null, null, { tags: ['later'] }),
    t('Cancel the unused analytics seat', null, null, {}),
  ];
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return seed();
    const parsed = JSON.parse(raw);
    const base = blankState();
    return {
      ...base,
      ...parsed,
      grids: (parsed.grids || base.grids).map((g) => ({
        cols: clamp(+g.cols || 2, MIN_STEPS, MAX_STEPS),
        rows: clamp(+g.rows || 2, MIN_STEPS, MAX_STEPS),
      })),
      tasks: (parsed.tasks || []).map((t) => ({
        subtasks: [], tags: [], notes: '', due: '', done: false, ...t,
      })),
    };
  } catch (err) {
    console.warn('Could not read saved board, starting fresh.', err);
    return seed();
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(state));
      flashSaved('Saved locally');
    } catch (err) {
      flashSaved('Could not save — storage is full or blocked');
    }
  }, 120);
}

function flashSaved(msg) {
  const el = $('#saved');
  el.textContent = msg;
}

function snapshot(label) {
  undoStack.push({ label, data: JSON.stringify({ tasks: state.tasks, grids: state.grids }) });
  if (undoStack.length > 30) undoStack.shift();
}

function undo() {
  const last = undoStack.pop();
  if (!last) { toast('Nothing to undo'); return; }
  const data = JSON.parse(last.data);
  state.tasks = data.tasks;
  state.grids = data.grids;
  closeSheet();
  render();
  save();
  toast(`Undid ${last.label}`);
}

/* ---------- task operations ---------- */

const byId = (id) => state.tasks.find((t) => t.id === id);
const inCell = (q, cell) => state.tasks
  .filter((t) => t.q === q && t.cell === cell && (state.showDone || !t.done))
  .sort((a, b) => a.order - b.order);
const inTray = () => state.tasks
  .filter((t) => t.q === null && (state.showDone || !t.done))
  .sort((a, b) => a.order - b.order);

function addTask(fields) {
  const task = {
    id: uid(), title: 'Untitled task', notes: '', due: '', tags: [],
    q: null, cell: null, done: false, subtasks: [],
    created: Date.now(), order: Date.now(), ...fields,
  };
  state.tasks.push(task);
  return task;
}

function place(id, q, cell) {
  const task = byId(id);
  if (!task) return;
  if (task.q === q && task.cell === cell) return;
  snapshot('the move');
  task.q = q;
  task.cell = q === null ? null : cell;
  task.order = Date.now();
  render();
  save();
}

function removeTask(id) {
  const task = byId(id);
  if (!task) return;
  snapshot('the delete');
  state.tasks = state.tasks.filter((t) => t.id !== id);
  render();
  save();
  toast(`Deleted “${trim(task.title, 32)}”`, 'Undo', undo);
}

const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/* Keep everything on the board when a sub-grid shrinks: clamp each
   task's row and column into the new bounds. */
function resizeGrid(q, key, delta) {
  const g = state.grids[q];
  const next = clamp(g[key] + delta, MIN_STEPS, MAX_STEPS);
  if (next === g[key]) return;
  snapshot('the resize');
  const old = { ...g };
  g[key] = next;
  state.tasks.forEach((t) => {
    if (t.q !== q || t.cell === null) return;
    const r = clamp(Math.floor(t.cell / old.cols), 0, g.rows - 1);
    const c = clamp(t.cell % old.cols, 0, g.cols - 1);
    t.cell = r * g.cols + c;
  });
  render();
  save();
}

/* ---------- quick add parsing ---------- */

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseDate(token) {
  const s = token.toLowerCase();
  if (s === 'today') return todayISO();
  if (s === 'tomorrow' || s === 'tmr') return shiftDays(1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const md = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md) {
    const now = new Date();
    const d = new Date(now.getFullYear(), +md[1] - 1, +md[2]);
    if (d < new Date(todayISO() + 'T00:00:00')) d.setFullYear(now.getFullYear() + 1);
    return isoOf(d);
  }
  const wd = WEEKDAYS.indexOf(s.slice(0, 3));
  if (wd >= 0) {
    const now = new Date(todayISO() + 'T00:00:00');
    let diff = (wd - now.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    return shiftDays(diff);
  }
  return '';
}
const isoOf = (d) => {
  const c = new Date(d);
  c.setMinutes(c.getMinutes() - c.getTimezoneOffset());
  return c.toISOString().slice(0, 10);
};
const shiftDays = (n) => {
  const d = new Date(todayISO() + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoOf(d);
};

function parseQuickAdd(raw) {
  const tags = [];
  let q = null, due = '';
  const title = raw
    .replace(/(^|\s)#([\w-]+)/g, (_, sp, tag) => { tags.push(tag); return sp; })
    .replace(/(^|\s)!([1-4])(?=\s|$)/g, (_, sp, n) => { q = +n - 1; return sp; })
    .replace(/(^|\s)>(\S+)/g, (m, sp, token) => {
      const parsed = parseDate(token);
      if (!parsed) return m;
      due = parsed;
      return sp;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { title, tags, q, due };
}

/* ---------- rendering ---------- */

function render() {
  document.documentElement.dataset.theme = state.theme;
  renderTray();
  renderQuads();
  renderReadout();
  applySearch();
  const btn = $('#toggle-done');
  btn.textContent = state.showDone ? 'Hide done' : 'Show done';
  btn.setAttribute('aria-pressed', String(state.showDone));
}

function chipHTML(task) {
  const cls = ['chip'];
  if (task.done) cls.push('done');
  const subs = task.subtasks || [];
  const doneSubs = subs.filter((s) => s.done).length;
  const meta = [];
  if (task.due) meta.push(`<span class="due ${dueClass(task.due, task.done)}">${esc(dueLabel(task.due))}</span>`);
  if (subs.length) meta.push(`<span>${doneSubs}/${subs.length}</span>`);
  (task.tags || []).slice(0, 3).forEach((t) => meta.push(`<span class="tag">${esc(t)}</span>`));
  return `<li class="${cls.join(' ')}" draggable="true" data-id="${task.id}"
      tabindex="0" role="button" aria-label="${esc(task.title)}. Open details.">
    <span class="chip-title">${esc(task.title)}</span>
    ${meta.length ? `<span class="chip-meta">${meta.join('')}</span>` : ''}
  </li>`;
}

function renderTray() {
  const list = $('#tray-list');
  const items = inTray();
  $('#tray-count').textContent = items.length;
  list.innerHTML = items.length
    ? items.map((t) => chipHTML(t)).join('')
    : `<li class="tray-empty">Nothing waiting.<br>Add a task above, or drag one back here to take it off the board.</li>`;
}

function renderQuads() {
  $('#quads').innerHTML = QUADS.map((quad, q) => labelHTML(quad, q) + quadHTML(quad, q)).join('');
}

function labelHTML(quad, q) {
  const all = state.tasks.filter((t) => t.q === q);
  const open = all.filter((t) => !t.done).length;
  return `<div class="qlabel" data-q="${q}">
    <span class="ql-name">${quad.name}</span>
    <span class="ql-tally"><b>${open}</b>/${all.length}</span>
    <span class="sizer">
      ${sizerHTML(q, quad.name, 'cols', state.grids[q].cols)}
      ${sizerHTML(q, quad.name, 'rows', state.grids[q].rows)}
    </span>
  </div>`;
}

function quadHTML(quad, q) {
  const g = state.grids[q];
  const cells = [];
  for (let i = 0; i < g.cols * g.rows; i++) {
    const items = inCell(q, i);
    cells.push(`<div class="cell ${items.length ? 'filled' : ''}" data-q="${q}" data-cell="${i}"
        tabindex="0" role="group"
        aria-label="${quad.name}, cell ${coordOf(q, i)}, ${items.length} task${items.length === 1 ? '' : 's'}">
      <span class="cell-coord">${coordOf(q, i)}${items.length > 1 ? ` · ${items.length}` : ''}</span>
      <button type="button" class="cell-add" data-add="${q}:${i}" title="Add a task in ${coordOf(q, i)}" aria-label="Add a task in cell ${coordOf(q, i)}">+</button>
      ${items.map((t) => chipHTML(t)).join('')}
    </div>`);
  }
  return `<section class="quad" data-q="${q}" aria-label="${quad.name}">
    <div class="subgrid" style="--cols:${g.cols};--rows:${g.rows}">${cells.join('')}</div>
  </section>`;
}

function sizerHTML(q, quadName, key, value) {
  const word = key === 'cols' ? 'columns' : 'rows';
  return `<span class="sizer-group">
    <span class="sizer-label">${key}</span>
    <button type="button" class="step" data-size="${q}:${key}:-1" ${value <= MIN_STEPS ? 'disabled' : ''}
      title="Fewer ${word}" aria-label="Fewer ${word} in ${quadName}">−</button>
    <span class="sizer-value">${value}</span>
    <button type="button" class="step" data-size="${q}:${key}:1" ${value >= MAX_STEPS ? 'disabled' : ''}
      title="More ${word}" aria-label="More ${word} in ${quadName}">+</button>
  </span>`;
}

function renderReadout() {
  const open = state.tasks.filter((t) => !t.done);
  const late = open.filter((t) => t.due && daysUntil(t.due) < 0).length;
  const tray = open.filter((t) => t.q === null).length;
  const done = state.tasks.length - open.length;
  $('#readout').innerHTML =
    `<span><b>${open.length}</b> open</span>` +
    `<span><b>${tray}</b> unplotted</span>` +
    `<span><b>${done}</b> done</span>` +
    (late ? `<span class="alarm"><b>${late}</b> late</span>` : '');
}

/* ---------- search ---------- */

function applySearch() {
  const q = $('#search').value.trim().toLowerCase();
  $$('.chip').forEach((chip) => {
    if (!q) { chip.classList.remove('dimmed', 'hit'); return; }
    const task = byId(chip.dataset.id);
    if (!task) return;
    const hay = [task.title, task.notes, (task.tags || []).join(' ')].join(' ').toLowerCase();
    const hit = hay.includes(q);
    chip.classList.toggle('hit', hit);
    chip.classList.toggle('dimmed', !hit);
  });
}

/* ---------- drag and drop ---------- */

function clearDrop() {
  if (dropTarget) dropTarget.classList.remove('drop-on');
  dropTarget = null;
}

document.addEventListener('dragstart', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  dragId = chip.dataset.id;
  chip.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
});

document.addEventListener('dragend', () => {
  $$('.chip.dragging').forEach((c) => c.classList.remove('dragging'));
  clearDrop();
  dragId = null;
});

document.addEventListener('dragover', (e) => {
  if (!dragId) return;
  const zone = e.target.closest('.cell, [data-drop="tray"]');
  if (!zone) { clearDrop(); return; }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (zone !== dropTarget) {
    clearDrop();
    dropTarget = zone;
    zone.classList.add('drop-on');
  }
});

document.addEventListener('drop', (e) => {
  const zone = e.target.closest('.cell, [data-drop="tray"]');
  const id = dragId || e.dataTransfer.getData('text/plain');
  clearDrop();
  if (!zone || !id) return;
  e.preventDefault();
  if (zone.dataset.drop === 'tray') place(id, null, null);
  else place(id, +zone.dataset.q, +zone.dataset.cell);
  dragId = null;
});

/* ---------- popup ---------- */

function openSheet(view) {
  sheetView = view;
  if (!$('#overlay').hasAttribute('hidden')) { paintSheet(); return; }
  lastFocus = document.activeElement;
  $('#overlay').removeAttribute('hidden');
  paintSheet();
}

function closeSheet() {
  if ($('#overlay').hasAttribute('hidden')) return;
  $('#overlay').setAttribute('hidden', '');
  $('#sheet').innerHTML = '';
  sheetView = null;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

function paintSheet(focusSelector) {
  const sheet = $('#sheet');
  if (sheetView.mode === 'cell') paintCellSheet(sheet);
  else paintTaskSheet(sheet);

  const target = focusSelector ? sheet.querySelector(focusSelector) : null;
  if (target) { target.focus({ preventScroll: true }); return; }

  const title = $('#f-title');
  if (title) {
    title.focus({ preventScroll: true });
    if (title.value === 'Untitled task') title.select();
    return;
  }
  const fallback = sheet.querySelector('.pickitem') || sheet.querySelector('button');
  if (fallback) fallback.focus({ preventScroll: true });
}

function paintCellSheet(sheet) {
  const { q, cell } = sheetView;
  const items = inCell(q, cell);
  sheet.dataset.q = q;
  sheet.innerHTML = `
    <div class="sheet-head">
      <div>
        <div class="sheet-coord">${QUADS[q].name} · cell ${coordOf(q, cell)}</div>
        <h3 id="sheet-title">${items.length} task${items.length === 1 ? '' : 's'} here</h3>
      </div>
      <button type="button" class="btn ghost" data-close>Close</button>
    </div>
    <div class="sheet-body">
      <ul class="picklist">
        ${items.map((t) => `
          <li><button type="button" class="pickitem ${t.done ? 'done' : ''}" data-open="${t.id}">
            <span class="pi-title">${esc(t.title)}</span>
            <span class="pi-meta">${t.due ? esc(dueLabel(t.due)) : ''}</span>
          </button></li>`).join('')}
      </ul>
    </div>
    <div class="sheet-foot">
      <button type="button" class="btn" data-newhere>Add a task here</button>
      <span class="spacer"></span>
      <button type="button" class="btn ghost" data-close>Done</button>
    </div>`;
}

function paintTaskSheet(sheet) {
  const task = byId(sheetView.taskId);
  if (!task) { closeSheet(); return; }
  const place_ = task.q === null ? 'Unplotted' : `${QUADS[task.q].name} · cell ${coordOf(task.q, task.cell)}`;
  const subs = task.subtasks || [];
  const doneSubs = subs.filter((s) => s.done).length;
  const grid = task.q === null ? null : state.grids[task.q];

  sheet.dataset.q = task.q === null ? '' : task.q;
  sheet.innerHTML = `
    <div class="sheet-head">
      <div>
        ${sheetView.from ? `<button type="button" class="back-link" data-back>← back to cell</button>` : ''}
        <div class="sheet-coord">${esc(place_)}</div>
        <h3 id="sheet-title">Task detail</h3>
      </div>
      <button type="button" class="btn ghost" data-close>Close</button>
    </div>
    <div class="sheet-body">
      <div class="field">
        <label for="f-title">Title</label>
        <input id="f-title" type="text" value="${esc(task.title)}" data-field="title">
      </div>

      <div class="field">
        <label for="f-notes">Notes</label>
        <textarea id="f-notes" data-field="notes" placeholder="What does finishing this look like?">${esc(task.notes || '')}</textarea>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="f-due">Due date</label>
          <input id="f-due" type="date" value="${esc(task.due || '')}" data-field="due">
        </div>
        <div class="field">
          <label for="f-tags">Tags</label>
          <input id="f-tags" type="text" value="${esc((task.tags || []).join(', '))}" data-field="tags" placeholder="comma, separated">
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="f-quad">Quadrant</label>
          <select id="f-quad" data-move="quad">
            <option value="">Unplotted</option>
            ${QUADS.map((qd, i) => `<option value="${i}" ${task.q === i ? 'selected' : ''}>${qd.name} — ${qd.verb.toLowerCase().replace('.', '')}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="f-cell">Cell</label>
          <select id="f-cell" data-move="cell" ${grid ? '' : 'disabled'}>
            ${grid
              ? Array.from({ length: grid.cols * grid.rows }, (_, i) =>
                  `<option value="${i}" ${task.cell === i ? 'selected' : ''}>${coordOf(task.q, i)}</option>`).join('')
              : '<option>—</option>'}
          </select>
        </div>
      </div>

      <div class="field">
        <label>Checklist ${subs.length ? `<span class="mono">${doneSubs}/${subs.length}</span>` : ''}</label>
        ${subs.length ? `<div class="progress"><i style="width:${Math.round((doneSubs / subs.length) * 100)}%"></i></div>` : ''}
        <ul class="subtasks">
          ${subs.map((s) => `
            <li class="subtask ${s.done ? 'checked' : ''}">
              <input type="checkbox" ${s.done ? 'checked' : ''} data-sub="${s.id}" aria-label="${esc(s.text)}">
              <span>${esc(s.text)}</span>
              <button type="button" class="x" data-subdel="${s.id}" aria-label="Remove ${esc(s.text)}">×</button>
            </li>`).join('')}
        </ul>
        <input type="text" id="f-sub" placeholder="Add a step, press Enter" data-subadd>
      </div>

      <label class="checkline">
        <input type="checkbox" data-field="done" ${task.done ? 'checked' : ''}>
        Mark this task done
      </label>
    </div>
    <div class="sheet-foot">
      <button type="button" class="btn danger" data-delete>Delete task</button>
      <span class="spacer"></span>
      <span class="mono" style="font-size:10px;color:var(--ink-3)">${task.q !== null ? esc(QUADS[task.q].verb) : 'Not plotted yet'}</span>
      <button type="button" class="btn solid" data-close>Done</button>
    </div>`;
}

/* Sheet interactions — one delegated listener over the whole overlay. */
$('#overlay').addEventListener('click', (e) => {
  if (e.target.id === 'overlay') { closeSheet(); return; }
  const t = e.target;

  if (t.closest('[data-close]')) { closeSheet(); return; }
  if (t.closest('[data-back]')) { openSheet({ mode: 'cell', q: sheetView.from.q, cell: sheetView.from.cell }); return; }

  const open = t.closest('[data-open]');
  if (open) {
    openSheet({ mode: 'task', taskId: open.dataset.open, from: { q: sheetView.q, cell: sheetView.cell } });
    return;
  }

  if (t.closest('[data-newhere]')) {
    const { q, cell } = sheetView;
    snapshot('the new task');
    const task = addTask({ title: 'Untitled task', q, cell });
    render(); save();
    openSheet({ mode: 'task', taskId: task.id, from: { q, cell } });
    return;
  }

  if (t.closest('[data-delete]')) {
    const id = sheetView.taskId;
    closeSheet();
    removeTask(id);
    return;
  }

  const del = t.closest('[data-subdel]');
  if (del) {
    const task = byId(sheetView.taskId);
    task.subtasks = task.subtasks.filter((s) => s.id !== del.dataset.subdel);
    paintSheet('[data-subadd]'); render(); save();
  }
});

$('#overlay').addEventListener('change', (e) => {
  const task = sheetView && sheetView.mode === 'task' ? byId(sheetView.taskId) : null;
  if (!task) return;
  const el = e.target;

  if (el.dataset.field === 'done') { task.done = el.checked; render(); save(); return; }
  if (el.dataset.field === 'due')  { task.due = el.value; render(); save(); return; }
  if (el.dataset.field === 'tags') {
    task.tags = el.value.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean);
    render(); save(); return;
  }
  if (el.dataset.sub) {
    const sub = task.subtasks.find((s) => s.id === el.dataset.sub);
    if (sub) sub.done = el.checked;
    paintSheet(`[data-sub="${el.dataset.sub}"]`); render(); save(); return;
  }
  if (el.dataset.move === 'quad') {
    const q = el.value === '' ? null : +el.value;
    place(task.id, q, q === null ? null : firstOpenCell(q));
    sheetView.from = null;
    paintSheet(); return;
  }
  if (el.dataset.move === 'cell') {
    place(task.id, task.q, +el.value);
    paintSheet(); return;
  }
});

$('#overlay').addEventListener('input', (e) => {
  const task = sheetView && sheetView.mode === 'task' ? byId(sheetView.taskId) : null;
  if (!task) return;
  const f = e.target.dataset.field;
  if (f === 'title' || f === 'notes') {
    task[f] = e.target.value;
    renderTray(); renderQuads(); renderReadout(); applySearch();
    save();
  }
});

$('#overlay').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.subadd !== undefined) {
    e.preventDefault();
    const text = e.target.value.trim();
    if (!text) return;
    const task = byId(sheetView.taskId);
    task.subtasks.push({ id: uid(), text, done: false });
    save();
    render();
    paintSheet('[data-subadd]');
    return;
  }
  if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); return; }
  if (e.key === 'Tab') trapFocus(e);
});

function trapFocus(e) {
  const nodes = $$('#sheet button, #sheet input, #sheet textarea, #sheet select')
    .filter((n) => !n.disabled && n.offsetParent !== null);
  if (!nodes.length) return;
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* ---------- board interactions ---------- */

document.addEventListener('click', (e) => {
  const size = e.target.closest('[data-size]');
  if (size) {
    const [q, key, delta] = size.dataset.size.split(':');
    resizeGrid(+q, key, +delta);
    return;
  }

  const add = e.target.closest('[data-add]');
  if (add) {
    e.stopPropagation();
    const [q, cell] = add.dataset.add.split(':').map(Number);
    snapshot('the new task');
    const task = addTask({ q, cell });
    render(); save();
    openSheet({ mode: 'task', taskId: task.id, from: { q, cell } });
    return;
  }

  const chip = e.target.closest('.chip');
  if (chip) {
    const task = byId(chip.dataset.id);
    const from = task.q === null ? null : { q: task.q, cell: task.cell };
    openSheet({ mode: 'task', taskId: chip.dataset.id, from: inCell(task.q, task.cell).length > 1 ? from : null });
    return;
  }

  const cell = e.target.closest('.cell');
  if (cell) {
    const q = +cell.dataset.q, i = +cell.dataset.cell;
    const items = inCell(q, i);
    if (items.length === 1) openSheet({ mode: 'task', taskId: items[0].id });
    else if (items.length > 1) openSheet({ mode: 'cell', q, cell: i });
    else openSheet({ mode: 'cell', q, cell: i });
  }
});

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

  if (e.key === 'Enter' || e.key === ' ') {
    const target = e.target.closest('.chip, .cell');
    if (target && !typing) { e.preventDefault(); target.click(); return; }
  }
  if (e.key === 'Escape' && !$('#overlay').hasAttribute('hidden')) { closeSheet(); return; }
  if (typing) return;

  if (e.key === '/') { e.preventDefault(); $('#search').focus(); return; }
  if (e.key.toLowerCase() === 'n') { e.preventDefault(); $('#quick-input').focus(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
});

/* ---------- chrome ---------- */

$('#quick-add').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#quick-input');
  const raw = input.value.trim();
  if (!raw) return;
  const { title, tags, q, due } = parseQuickAdd(raw);
  if (!title) { toast('Give the task a name as well as its tags'); return; }
  snapshot('the new task');
  addTask({ title, tags, due, q, cell: q === null ? null : firstOpenCell(q) });
  input.value = '';
  render();
  save();
});

/* Prefer an empty cell so new tasks don't stack out of sight. */
function firstOpenCell(q) {
  const g = state.grids[q];
  for (let i = 0; i < g.cols * g.rows; i++) if (!inCell(q, i).length) return i;
  return 0;
}

$('#search').addEventListener('input', applySearch);
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.target.value = ''; applySearch(); e.target.blur(); }
});

$('#toggle-done').addEventListener('click', () => {
  state.showDone = !state.showDone;
  render();
  save();
});

$('#theme').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  render();
  save();
});

$('.menu-panel').addEventListener('click', (e) => {
  const action = e.target.dataset.action;
  if (!action) return;
  $('.menu').removeAttribute('open');

  if (action === 'export') {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `plotting-bed-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Exported the board as JSON');
  }

  if (action === 'import') $('#file-input').click();

  if (action === 'clear-done') {
    const count = state.tasks.filter((t) => t.done).length;
    if (!count) { toast('No completed tasks to clear'); return; }
    snapshot('the clear');
    state.tasks = state.tasks.filter((t) => !t.done);
    render(); save();
    toast(`Cleared ${count} completed task${count === 1 ? '' : 's'}`, 'Undo', undo);
  }

  if (action === 'reset-grids') {
    snapshot('the grid reset');
    state.grids = state.grids.map(() => ({ cols: 2, rows: 2 }));
    state.tasks.forEach((t) => { if (t.q !== null) t.cell = clamp(t.cell, 0, 3); });
    render(); save();
    toast('Every sub-grid is back to 2×2', 'Undo', undo);
  }

  if (action === 'clear-all') {
    if (!state.tasks.length) { toast('The board is already empty'); return; }
    const n = state.tasks.length;
    snapshot('the wipe');
    state.tasks = [];
    render(); save();
    toast(`Deleted ${n} task${n === 1 ? '' : 's'}`, 'Undo', undo);
  }
});

$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.tasks)) throw new Error('no tasks array');
    snapshot('the import');
    state.tasks = parsed.tasks;
    if (Array.isArray(parsed.grids) && parsed.grids.length === 4) state.grids = parsed.grids;
    render(); save();
    toast(`Imported ${parsed.tasks.length} tasks`, 'Undo', undo);
  } catch (err) {
    toast('That file is not a Plotting Bed export');
  }
  e.target.value = '';
});

document.addEventListener('click', (e) => {
  const menu = $('.menu');
  if (menu.hasAttribute('open') && !e.target.closest('.menu')) menu.removeAttribute('open');
});

/* ---------- toasts ---------- */

function toast(message, actionLabel, action) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(message)}</span>`;
  if (actionLabel) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = actionLabel;
    b.addEventListener('click', () => { el.remove(); action(); });
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), actionLabel ? 7000 : 3200);
}

/* ---------- go ---------- */

render();
save();
