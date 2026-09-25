(function () {
  const PRIO_ORDER = { high: 0, medium: 1, low: 2 };
  const PRIO_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
  const LOCAL_KEY = 'taskLedger.tasks.v1';
  const LOCAL_SEED_KEY = 'taskLedger.seeded.v1';

  let db = null;
  let tasksCol = null;
  let tasks = [];
  let unsub = null;

  const listEl = document.getElementById('list');
  const seedHint = document.getElementById('seedHint');

  document.getElementById('todayLabel').textContent =
    new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  const modalOverlay = document.getElementById('modalOverlay');

  function openModal() {
    document.getElementById('titleInput').value = '';
    document.getElementById('tagsInput').value = '';
    document.getElementById('descInput').value = '';
    document.getElementById('prioInput').value = 'medium';
    document.getElementById('dueInput').value = selectedDate || '';
    modalOverlay.hidden = false;
    requestAnimationFrame(() => modalOverlay.classList.add('show'));
    document.getElementById('titleInput').focus();
  }

  function closeModal() {
    closeAllPickers();
    modalOverlay.classList.remove('show');
    setTimeout(() => { modalOverlay.hidden = true; }, 180);
  }

  document.getElementById('fabAdd').addEventListener('click', openModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

  const editOverlay = document.getElementById('editOverlay');
  let editingId = null;

  function openEditModal(t) {
    editingId = t.id;
    document.getElementById('editTitle').value = t.title;
    document.getElementById('editDue').value = t.dueDate || '';
    document.getElementById('editPrio').value = t.priority;
    document.getElementById('editTags').value = (t.tags || []).join(', ');
    document.getElementById('editDesc').value = t.description || '';
    editOverlay.hidden = false;
    requestAnimationFrame(() => editOverlay.classList.add('show'));
  }

  function closeEditModal() {
    closeAllPickers();
    editOverlay.classList.remove('show');
    setTimeout(() => { editOverlay.hidden = true; editingId = null; }, 180);
  }

  document.getElementById('editCancel').addEventListener('click', closeEditModal);
  editOverlay.addEventListener('click', e => { if (e.target === editOverlay) closeEditModal(); });

  document.getElementById('editForm').addEventListener('submit', e => {
    e.preventDefault();
    const title = document.getElementById('editTitle').value.trim();
    if (!title) return;
    const dueDate = document.getElementById('editDue').value;
    const priority = document.getElementById('editPrio').value;
    const tags = document.getElementById('editTags').value.split(',').map(s => s.trim()).filter(Boolean);
    const description = document.getElementById('editDesc').value.trim();
    updateTask(editingId, { title, description, dueDate, priority, tags });
    closeEditModal();
  });

  document.getElementById('editDelete').addEventListener('click', () => {
    const id = editingId;
    const li = listEl.querySelector(`.task[data-id="${id}"]`);
    if (li) li.classList.add('row-exit');
    closeEditModal();
    setTimeout(() => deleteTask(id), li ? 180 : 0);
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!editOverlay.hidden) closeEditModal();
    else if (!modalOverlay.hidden) closeModal();
  });

  // ---------- custom pickers (priority list, calendar) ----------
  // The native <select> / <input type="date"> stay in the DOM as hidden value holders,
  // so the rest of the code keeps reading and writing .value exactly as before.
  const pickers = [];

  function onValueSet(el, cb) {
    const native = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    Object.defineProperty(el, 'value', {
      configurable: true,
      get() { return native.get.call(this); },
      set(v) { native.set.call(this, v); cb(); },
    });
  }

  function closeAllPickers(except) {
    pickers.forEach(p => { if (p !== except) p.hide(); });
  }

  function placePopup(p) {
    const r = p.btn.getBoundingClientRect();
    const popH = p.pop.offsetHeight;
    const popW = p.pop.offsetWidth;
    const spaceBelow = window.innerHeight - r.bottom;
    const above = spaceBelow < popH + 12 && r.top > spaceBelow;
    p.pop.classList.toggle('above', above);
    p.pop.style.top = (above ? r.top - popH - 6 : r.bottom + 6) + 'px';
    p.pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - popW - 8)) + 'px';
  }

  function makePicker(nativeEl, kind) {
    const wrap = document.createElement('div');
    wrap.className = 'picker picker-' + kind;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-btn';
    btn.setAttribute('aria-expanded', 'false');
    const pop = document.createElement('div');
    pop.className = 'picker-pop';
    pop.id = nativeEl.id + 'Pop';
    btn.setAttribute('aria-controls', pop.id);
    nativeEl.before(wrap);
    wrap.append(btn, pop, nativeEl);
    nativeEl.hidden = true;
    nativeEl.tabIndex = -1;

    const p = {
      wrap, btn, pop, isOpen: false,
      render() {}, focusInside() {},
      show() {
        closeAllPickers(p);
        p.isOpen = true;
        wrap.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
        p.render();
        placePopup(p);
        p.focusInside();
      },
      hide(refocus) {
        if (!p.isOpen) return;
        p.isOpen = false;
        wrap.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        if (refocus) btn.focus({ preventScroll: true });
      },
    };
    btn.addEventListener('click', () => (p.isOpen ? p.hide() : p.show()));
    // clicks inside the popup must not steal focus, or focusout below would close it mid-click
    pop.addEventListener('mousedown', e => e.preventDefault());
    // checked a tick later: re-rendering the calendar removes the focused day, which fires
    // focusout with no target even though focus is about to land on the new day
    wrap.addEventListener('focusout', () => {
      setTimeout(() => { if (!wrap.contains(document.activeElement)) p.hide(); });
    });
    // Escape closes only the popup, not the whole modal (the modal listens on document)
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape' && p.isOpen) { e.stopPropagation(); p.hide(true); }
    });
    pickers.push(p);
    return p;
  }

  document.addEventListener('pointerdown', e => {
    pickers.forEach(p => { if (p.isOpen && !p.wrap.contains(e.target)) p.hide(); });
  });
  document.addEventListener('scroll', () => pickers.forEach(p => { if (p.isOpen) placePopup(p); }), true);
  window.addEventListener('resize', () => closeAllPickers());

  function enhanceSelect(sel) {
    const p = makePicker(sel, 'select');
    const opts = Array.from(sel.options);
    p.btn.setAttribute('aria-haspopup', 'listbox');
    p.btn.innerHTML = '<span class="picker-labels">' + opts.map(o => `<span>${escapeHtml(o.text)}</span>`).join('') + '</span>';
    const labels = Array.from(p.btn.firstChild.children);
    p.pop.setAttribute('role', 'listbox');
    p.pop.tabIndex = -1;
    p.pop.innerHTML = opts.map((o, i) =>
      `<div class="picker-opt" role="option" id="${sel.id}Opt${i}" data-i="${i}">${escapeHtml(o.text)}</div>`).join('');
    const items = Array.from(p.pop.children);
    let active = 0;

    function setActive(i) {
      active = (i + items.length) % items.length;
      items.forEach((el, j) => el.classList.toggle('active', j === active));
      p.pop.setAttribute('aria-activedescendant', items[active].id);
    }
    function sync() {
      const cur = sel.selectedIndex;
      labels.forEach((el, j) => el.classList.toggle('on', j === cur));
      items.forEach((el, j) => el.setAttribute('aria-selected', String(j === cur)));
    }
    function choose(i) {
      sel.value = opts[i].value;
      p.hide(true);
    }

    p.render = () => {
      p.pop.style.minWidth = p.btn.offsetWidth + 'px';
      setActive(Math.max(0, sel.selectedIndex));
    };
    p.focusInside = () => p.pop.focus({ preventScroll: true });

    p.btn.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); p.show(); }
    });
    p.pop.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') setActive(active + 1);
      else if (e.key === 'ArrowUp') setActive(active - 1);
      else if (e.key === 'Home') setActive(0);
      else if (e.key === 'End') setActive(items.length - 1);
      else if (e.key === 'Enter' || e.key === ' ') choose(active);
      else return;
      e.preventDefault();
    });
    p.pop.addEventListener('mousemove', e => {
      const opt = e.target.closest('.picker-opt');
      if (opt && +opt.dataset.i !== active) setActive(+opt.dataset.i);
    });
    p.pop.addEventListener('click', e => {
      const opt = e.target.closest('.picker-opt');
      if (opt) choose(+opt.dataset.i);
    });

    onValueSet(sel, sync);
    sync();
  }

  function enhanceDate(input) {
    const p = makePicker(input, 'date');
    p.btn.setAttribute('aria-haspopup', 'dialog');
    p.pop.setAttribute('role', 'dialog');
    p.pop.setAttribute('aria-label', 'Choose due date');
    p.pop.innerHTML = `
      <div class="cal-head">
        <button type="button" class="cal-nav cal-prev" aria-label="Previous month"></button>
        <div class="cal-title" aria-live="polite"></div>
        <button type="button" class="cal-nav cal-next" aria-label="Next month"></button>
      </div>
      <div class="cal-grid"></div>
      <div class="cal-foot">
        <button type="button" class="cal-link" data-act="clear">Clear</button>
        <button type="button" class="cal-link" data-act="today">Today</button>
      </div>`;
    const titleEl = p.pop.querySelector('.cal-title');
    const grid = p.pop.querySelector('.cal-grid');
    const fmtLong = new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    let focusIso = todayISO();

    function sync() {
      const v = input.value;
      p.btn.textContent = v ? v.split('-').reverse().join('.') : 'Due date';
      p.btn.classList.toggle('no-value', !v);
      p.btn.setAttribute('aria-label', v ? 'Due date: ' + fmtLong.format(new Date(v + 'T00:00:00')) : 'Due date: none');
    }

    function renderMonth(moveFocus) {
      const f = new Date(focusIso + 'T00:00:00');
      const first = new Date(f.getFullYear(), f.getMonth(), 1);
      const lead = (first.getDay() + 6) % 7; // Monday-first, like the week strip
      const daysInMonth = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate();
      const today = todayISO();
      const chosen = input.value;
      if (grid.contains(document.activeElement)) moveFocus = true; // keep focus inside when the days are replaced
      titleEl.textContent = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(first);
      let html = WEEKDAY_SHORT.map(w => `<span class="cal-wd" aria-hidden="true">${w.slice(0, 2)}</span>`).join('');
      html += '<span></span>'.repeat(lead);
      for (let n = 1; n <= daysInMonth; n++) {
        const d = new Date(f.getFullYear(), f.getMonth(), n);
        const iso = toISO(d);
        const cls = ['cal-day'];
        if (iso === today) cls.push('today');
        if (iso === chosen) cls.push('selected');
        html += `<button type="button" class="${cls.join(' ')}" data-date="${iso}" tabindex="${iso === focusIso ? 0 : -1}"`
          + ` aria-label="${fmtLong.format(d)}"${iso === chosen ? ' aria-pressed="true"' : ''}>${n}</button>`;
      }
      grid.innerHTML = html;
      if (p.isOpen) placePopup(p); // 5- vs 6-row months change the height
      if (moveFocus) grid.querySelector(`[data-date="${focusIso}"]`).focus({ preventScroll: true });
    }

    function shiftMonth(n) {
      const f = new Date(focusIso + 'T00:00:00');
      const day = f.getDate();
      f.setDate(1);
      f.setMonth(f.getMonth() + n);
      f.setDate(Math.min(day, new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate()));
      focusIso = toISO(f);
    }

    function choose(iso) {
      input.value = iso;
      p.hide(true);
    }

    p.render = () => {
      focusIso = input.value || todayISO();
      renderMonth(false);
    };
    p.focusInside = () => grid.querySelector(`[data-date="${focusIso}"]`).focus({ preventScroll: true });

    p.btn.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); p.show(); }
    });
    p.pop.querySelector('.cal-prev').addEventListener('click', () => { shiftMonth(-1); renderMonth(false); });
    p.pop.querySelector('.cal-next').addEventListener('click', () => { shiftMonth(1); renderMonth(false); });
    p.pop.querySelector('.cal-foot').addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (act) choose(act.dataset.act === 'today' ? todayISO() : '');
    });
    grid.addEventListener('click', e => {
      const day = e.target.closest('.cal-day');
      if (day) choose(day.dataset.date);
    });
    grid.addEventListener('keydown', e => {
      const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      const weekday = (new Date(focusIso + 'T00:00:00').getDay() + 6) % 7;
      if (e.key in moves) focusIso = addDays(focusIso, moves[e.key]);
      else if (e.key === 'Home') focusIso = addDays(focusIso, -weekday);
      else if (e.key === 'End') focusIso = addDays(focusIso, 6 - weekday);
      else if (e.key === 'PageUp') shiftMonth(-1);
      else if (e.key === 'PageDown') shiftMonth(1);
      else return;
      e.preventDefault();
      renderMonth(true);
    });

    onValueSet(input, sync);
    sync();
  }

  document.querySelectorAll('.f-prio').forEach(enhanceSelect);
  document.querySelectorAll('.f-due').forEach(enhanceDate);

  function uid() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function toISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function todayISO() {
    return toISO(new Date());
  }

  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return toISO(d);
  }

  function mondayOf(iso) {
    const d = new Date(iso + 'T00:00:00');
    const offset = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - offset);
    return toISO(d);
  }

  const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // ---------- week planner state ----------
  let weekAnchor = todayISO();
  let selectedDate = todayISO();

  function setSelectedDate(iso) {
    selectedDate = iso;
    document.getElementById('dueInput').value = iso || '';
  }

  function renderWeek() {
    const monday = mondayOf(weekAnchor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const today = todayISO();

    const first = new Date(days[0] + 'T00:00:00');
    const last = new Date(days[6] + 'T00:00:00');
    const sameMonth = first.getMonth() === last.getMonth();
    const fmtDay = d => new Intl.DateTimeFormat('en-US', { day: 'numeric', month: sameMonth ? undefined : 'short' }).format(d);
    const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(last);
    document.getElementById('weekLabel').textContent = sameMonth
      ? `${fmtDay(first)} – ${new Intl.DateTimeFormat('en-US', { day: 'numeric' }).format(last)} ${monthLabel}`
      : `${fmtDay(first)} – ${fmtDay(last)}, ${last.getFullYear()}`;

    const MAX_DOTS = 6;
    const stripEl = document.getElementById('weekStrip');
    stripEl.innerHTML = days.map((iso, i) => {
      const dayTasks = tasks
        .filter(t => !t.completed && t.dueDate === iso)
        .sort((a, b) => PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority]);
      const shown = dayTasks.slice(0, MAX_DOTS);
      const extra = dayTasks.length - shown.length;
      const dotsHtml = shown.map(t => `<span class="ddot p-${t.priority}"></span>`).join('')
        + (extra > 0 ? `<span class="ddot-more">+${extra}</span>` : '');
      const dnum = new Date(iso + 'T00:00:00').getDate();
      const cls = ['day-chip'];
      if (iso === today) cls.push('today');
      if (iso === selectedDate) cls.push('selected');
      return `<button type="button" class="${cls.join(' ')}" data-date="${iso}">
        <span class="wd">${WEEKDAY_SHORT[i]}</span>
        <span class="dnum">${dnum}</span>
        <span class="day-dots">${dotsHtml}</span>
      </button>`;
    }).join('');
  }

  document.getElementById('weekPrev').addEventListener('click', () => { weekAnchor = addDays(weekAnchor, -7); renderWeek(); });
  document.getElementById('weekNext').addEventListener('click', () => { weekAnchor = addDays(weekAnchor, 7); renderWeek(); });
  document.getElementById('weekToday').addEventListener('click', () => { weekAnchor = todayISO(); setSelectedDate(todayISO()); render(); });
  document.getElementById('weekStrip').addEventListener('click', e => {
    const chip = e.target.closest('.day-chip');
    if (!chip) return;
    const iso = chip.dataset.date;
    setSelectedDate(selectedDate === iso ? null : iso);
    render();
  });
  document.getElementById('clearDayBtn').addEventListener('click', () => { setSelectedDate(null); render(); });
  setSelectedDate(selectedDate);

  function exampleTasks() {
    const in3 = new Date(Date.now() + 3 * 86400000);
    const tomorrow = new Date(Date.now() + 86400000);
    const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return [
      { title: 'Pay the internet bill', description: '', dueDate: fmt(tomorrow), priority: 'medium', tags: ['home'], completed: false },
      { title: 'Book a doctor appointment', description: '', dueDate: fmt(in3), priority: 'high', tags: ['health'], completed: false },
      { title: 'Read the article for the presentation', description: 'Link saved in browser bookmarks', dueDate: '', priority: 'low', tags: ['work'], completed: false },
    ];
  }

  // ---------- persistence layer ----------
  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(tasks)); } catch (e) {}
  }
  function seedLocalIfNeeded() {
    if (localStorage.getItem(LOCAL_SEED_KEY)) return;
    tasks = exampleTasks().map(t => ({ id: uid(), createdAt: new Date().toISOString(), completedAt: null, ...t }));
    saveLocal();
    localStorage.setItem(LOCAL_SEED_KEY, '1');
    seedHint.hidden = false;
  }

  async function seedDbIfNeeded() {
    const metaRef = db.doc('meta/seeded');
    const snap = await metaRef.get();
    if (snap.exists) return;
    for (const t of exampleTasks()) {
      await tasksCol.add({ ...t, createdAt: new Date().toISOString(), completedAt: null });
    }
    await metaRef.set({ done: true, at: new Date().toISOString() });
    seedHint.hidden = false;
  }

  async function initStore() {
    try {
      db = await claude.use('db');
    } catch (e) {
      db = null;
    }

    if (db) {
      tasksCol = db.collection('tasks');
      try {
        await seedDbIfNeeded();
      } catch (e) { /* ignore seed race */ }
      unsub = tasksCol.onSnapshot(
        snap => {
          tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          render();
        },
        err => {
          db = null; tasksCol = null;
          tasks = loadLocal();
          seedLocalIfNeeded();
          render();
        }
      );
    } else {
      tasks = loadLocal();
      seedLocalIfNeeded();
      render();
    }
  }

  async function addTask(data) {
    if (tasksCol) {
      await tasksCol.add({ ...data, createdAt: new Date().toISOString(), completedAt: null });
    } else {
      tasks.push({ id: uid(), createdAt: new Date().toISOString(), completedAt: null, ...data });
      saveLocal();
      render();
    }
  }

  async function updateTask(id, patch) {
    if (tasksCol) {
      await tasksCol.doc(id).update(patch);
    } else {
      const t = tasks.find(x => x.id === id);
      if (t) Object.assign(t, patch);
      saveLocal();
      render();
    }
  }

  async function deleteTask(id) {
    if (tasksCol) {
      await tasksCol.doc(id).delete();
    } else {
      tasks = tasks.filter(x => x.id !== id);
      saveLocal();
      render();
    }
  }

  // ---------- rendering ----------
  let knownIds = new Set();

  function collectTags() {
    const s = new Set();
    tasks.forEach(t => (t.tags || []).forEach(tag => s.add(tag)));
    return Array.from(s).sort();
  }

  function refreshTagFilter() {
    const sel = document.getElementById('tagFilter');
    const current = sel.value;
    const tags = collectTags();
    sel.innerHTML = '<option value="">All tags</option>' + tags.map(t => `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`).join('');
    if (tags.includes(current)) sel.value = current;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function formatDue(iso) {
    const d = new Date(iso + 'T00:00:00');
    return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' }).format(d);
  }

  function byDueThenPriority(a, b) {
    const ad = a.dueDate || '9999', bd = b.dueDate || '9999';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority];
  }

  function taskLiHtml(t) {
    const today = todayISO();
    const isOverdue = !t.completed && t.dueDate && t.dueDate < today;
    const isNew = !knownIds.has(t.id);
    const tagsHtml = (t.tags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
    const dueHtml = t.dueDate ? `<span class="due ${isOverdue ? 'overdue' : ''}">${isOverdue ? 'Overdue · ' : ''}${formatDue(t.dueDate)}</span>` : '';
    return `
      <div class="task ${t.completed ? 'done' : ''} ${isNew ? 'enter' : ''}" data-id="${t.id}">
        <div class="task-row" data-role="row">
          <div class="checkbox" data-role="check"><svg viewBox="0 0 12 12"><path d="M1.5 6.5L4.5 9.5L10.5 2.5" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <div class="task-main">
            <div class="task-title p-${t.priority}"><span class="dot"></span>${escapeHtml(t.title)}</div>
            <div class="task-meta">
              ${dueHtml}
              ${dueHtml ? '' : `<span>${PRIO_LABEL[t.priority]}</span>`}
              ${tagsHtml}
            </div>
          </div>
          <div class="chevron">▸</div>
        </div>
      </div>`;
  }

  function groupHtml(cls, label, count, itemsHtml) {
    return `<div class="group ${cls}">
      <div class="group-header ${cls}"><span>${label}</span><span class="gh-count">${count}</span></div>
      ${itemsHtml}
    </div>`;
  }

  function render() {
    refreshTagFilter();
    renderWeek();

    const listTitleEl = document.getElementById('listTitle');
    const clearDayBtn = document.getElementById('clearDayBtn');
    if (selectedDate) {
      const label = new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(selectedDate + 'T00:00:00'));
      listTitleEl.textContent = label.charAt(0).toUpperCase() + label.slice(1);
      clearDayBtn.hidden = false;
    } else {
      listTitleEl.textContent = 'All tasks';
      clearDayBtn.hidden = true;
    }

    const active = tasks.filter(t => !t.completed).length;
    const overdue = tasks.filter(t => !t.completed && t.dueDate && t.dueDate < todayISO()).length;
    const done = tasks.filter(t => t.completed).length;
    document.getElementById('statActive').textContent = active;
    document.getElementById('statOverdue').textContent = overdue;
    document.getElementById('statDone').textContent = done;

    const search = document.getElementById('searchInput').value.trim().toLowerCase();
    const tagFilter = document.getElementById('tagFilter').value;
    const showDone = document.getElementById('showDone').checked;
    const sortMode = document.getElementById('sortSelect').value;

    let items = tasks.filter(t => {
      if (selectedDate && t.dueDate !== selectedDate) return false;
      if (!showDone && t.completed) return false;
      if (tagFilter && !(t.tags || []).includes(tagFilter)) return false;
      if (search && !(t.title.toLowerCase().includes(search) || (t.description || '').toLowerCase().includes(search))) return false;
      return true;
    });

    const currentIds = new Set(items.map(t => t.id));

    if (items.length === 0) {
      listEl.innerHTML = selectedDate
        ? `<div class="empty"><div class="big">Nothing planned for this day</div>Tap the “+” button in the bottom right — the task will be added to this day.</div>`
        : `<div class="empty"><div class="big">Nothing here yet</div>Tap the “+” button in the bottom right to add your first task.</div>`;
      knownIds = currentIds;
      return;
    }

    const useGroups = !selectedDate && sortMode === 'smart';

    if (!useGroups) {
      items.sort((a, b) => {
        if (sortMode === 'due') return byDueThenPriority(a, b);
        if (sortMode === 'priority') return PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority];
        if (sortMode === 'created') return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1;
        // smart, single-day view: overdue/undone first, then priority
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority];
      });
      listEl.innerHTML = items.map(taskLiHtml).join('');
      knownIds = currentIds;
      return;
    }

    // grouped "smart" view across all dates: Overdue / Today / This week / Later / No due date / Done
    const today = todayISO();
    const weekEnd = addDays(mondayOf(today), 6);
    const buckets = { overdue: [], today: [], week: [], later: [], noDate: [], done: [] };
    items.forEach(t => {
      if (t.completed) { buckets.done.push(t); return; }
      if (!t.dueDate) { buckets.noDate.push(t); return; }
      if (t.dueDate < today) buckets.overdue.push(t);
      else if (t.dueDate === today) buckets.today.push(t);
      else if (t.dueDate <= weekEnd) buckets.week.push(t);
      else buckets.later.push(t);
    });
    buckets.overdue.sort(byDueThenPriority);
    buckets.today.sort((a, b) => PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority]);
    buckets.week.sort(byDueThenPriority);
    buckets.later.sort(byDueThenPriority);
    buckets.noDate.sort((a, b) => PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority]);
    buckets.done.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));

    const sections = [
      ['overdue', 'Overdue', buckets.overdue],
      ['today', 'Today', buckets.today],
      ['week', 'This week', buckets.week],
      ['later', 'Later', buckets.later],
      ['noDate', 'No due date', buckets.noDate],
      ['done', 'Done', buckets.done],
    ];
    listEl.innerHTML = sections
      .filter(([, , list]) => list.length)
      .map(([cls, label, list]) => groupHtml(cls, label, list.length, list.map(taskLiHtml).join('')))
      .join('');
    knownIds = currentIds;
  }

  // ---------- events ----------
  document.getElementById('addForm').addEventListener('submit', e => {
    e.preventDefault();
    const title = document.getElementById('titleInput').value.trim();
    if (!title) return;
    const dueDate = document.getElementById('dueInput').value;
    const priority = document.getElementById('prioInput').value;
    const tagsRaw = document.getElementById('tagsInput').value;
    const tags = tagsRaw.split(',').map(s => s.trim()).filter(Boolean);
    const description = document.getElementById('descInput').value.trim();
    addTask({ title, description, dueDate, priority, tags, completed: false });
    closeModal();
  });

  ['searchInput'].forEach(id => document.getElementById(id).addEventListener('input', render));
  ['tagFilter', 'sortSelect', 'showDone'].forEach(id => document.getElementById(id).addEventListener('change', render));

  listEl.addEventListener('click', e => {
    const li = e.target.closest('.task');
    if (!li) return;
    const id = li.dataset.id;

    if (e.target.closest('[data-role="check"]')) {
      const t = tasks.find(x => x.id === id);
      if (!t.completed) {
        li.classList.add('checking');
        setTimeout(() => updateTask(id, { completed: true, completedAt: new Date().toISOString() }), 260);
      } else {
        updateTask(id, { completed: false, completedAt: null });
      }
      return;
    }
    if (e.target.closest('[data-role="row"]')) {
      const t = tasks.find(x => x.id === id);
      if (t) openEditModal(t);
      return;
    }
  });

  initStore();
})();
