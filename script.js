(function () {
  const PRIO_ORDER = { high: 0, medium: 1, low: 2 };
  const PRIO_LABEL = { high: 'Высокий', medium: 'Средний', low: 'Низкий' };
  const LOCAL_KEY = 'taskLedger.tasks.v1';
  const LOCAL_SEED_KEY = 'taskLedger.seeded.v1';

  let db = null;
  let tasksCol = null;
  let tasks = [];
  let unsub = null;
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
  const syncStateEl = document.getElementById('syncState');
  const syncLabelEl = document.getElementById('syncLabel');

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
    modalOverlay.classList.remove('show');
    setTimeout(() => { modalOverlay.hidden = true; }, 180);
  }

  document.getElementById('fabAdd').addEventListener('click', openModal);
  document.getElementById('modalClose').addEventListener('click', closeModal);
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
    editOverlay.classList.remove('show');
    setTimeout(() => { editOverlay.hidden = true; editingId = null; }, 180);
  }

  document.getElementById('editClose').addEventListener('click', closeEditModal);
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

  function setSync(label, offline) {
    syncLabelEl.textContent = label;
    syncStateEl.classList.toggle('offline', !!offline);
  }

  async function initStore() {
    try {
      db = await claude.use('db');
    } catch (e) {
      db = null;
    }

    if (db) {
      tasksCol = db.collection('tasks');
      setSync('Syncing across devices');
      try {
        await seedDbIfNeeded();
      } catch (e) { /* ignore seed race */ }
      unsub = tasksCol.onSnapshot(
        snap => {
          tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          render();
        },
        err => {
          setSync('Storage unavailable — working locally', true);
          db = null; tasksCol = null;
          tasks = loadLocal();
          seedLocalIfNeeded();
          render();
        }
      );
    } else {
      setSync('This device only', true);
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

  const listEl = document.getElementById('list');
  const seedHint = document.getElementById('seedHint');
  const syncStateEl = document.getElementById('syncState');
  const syncLabelEl = document.getElementById('syncLabel');

  document.getElementById('todayLabel').textContent =
    new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

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
    modalOverlay.classList.remove('show');
    setTimeout(() => { modalOverlay.hidden = true; }, 180);
  }

  document.getElementById('fabAdd').addEventListener('click', openModal);
  document.getElementById('modalClose').addEventListener('click', closeModal);
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
    editOverlay.classList.remove('show');
    setTimeout(() => { editOverlay.hidden = true; editingId = null; }, 180);
  }

  document.getElementById('editClose').addEventListener('click', closeEditModal);
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

  const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

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
    const fmtDay = d => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: sameMonth ? undefined : 'short' }).format(d);
    const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(last);
    document.getElementById('weekLabel').textContent = sameMonth
      ? `${fmtDay(first)} – ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric' }).format(last)} ${monthLabel}`
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
      { title: 'Оплатить интернет', description: '', dueDate: fmt(tomorrow), priority: 'medium', tags: ['дом'], completed: false },
      { title: 'Записаться к врачу', description: '', dueDate: fmt(in3), priority: 'high', tags: ['здоровье'], completed: false },
      { title: 'Прочитать статью для доклада', description: 'Ссылка сохранена в закладках браузера', dueDate: '', priority: 'low', tags: ['работа'], completed: false },
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

  function setSync(label, offline) {
    syncLabelEl.textContent = label;
    syncStateEl.classList.toggle('offline', !!offline);
  }

  async function initStore() {
    try {
      db = await claude.use('db');
    } catch (e) {
      db = null;
    }

    if (db) {
      tasksCol = db.collection('tasks');
      setSync('Синхронизация между устройствами');
      try {
        await seedDbIfNeeded();
      } catch (e) { /* ignore seed race */ }
      unsub = tasksCol.onSnapshot(
        snap => {
          tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          render();
        },
        err => {
          setSync('Нет связи с хранилищем — работа локально', true);
          db = null; tasksCol = null;
          tasks = loadLocal();
          seedLocalIfNeeded();
          render();
        }
      );
    } else {
      setSync('Только на этом устройстве', true);
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
    sel.innerHTML = '<option value="">Все теги</option>' + tags.map(t => `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`).join('');
    if (tags.includes(current)) sel.value = current;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function formatDue(iso) {
    const d = new Date(iso + 'T00:00:00');
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(d);
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
    const dueHtml = t.dueDate ? `<span class="due ${isOverdue ? 'overdue' : ''}">${isOverdue ? 'Просрочено · ' : ''}${formatDue(t.dueDate)}</span>` : '';
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
      const label = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(selectedDate + 'T00:00:00'));
      listTitleEl.textContent = label.charAt(0).toUpperCase() + label.slice(1);
      clearDayBtn.hidden = false;
    } else {
      listTitleEl.textContent = 'Все дела';
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
        ? `<div class="empty"><div class="big">На этот день ничего не запланировано</div>Нажмите «+» внизу справа — дело сразу встанет на выбранный день.</div>`
        : `<div class="empty"><div class="big">Пока пусто</div>Нажмите «+» внизу справа, чтобы добавить первое дело.</div>`;
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

    // grouped "smart" view across all dates: Просрочено / Сегодня / На этой неделе / Позже / Без срока / Выполнено
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
      ['overdue', 'Просрочено', buckets.overdue],
      ['today', 'Сегодня', buckets.today],
      ['week', 'На этой неделе', buckets.week],
      ['later', 'Позже', buckets.later],
      ['noDate', 'Без срока', buckets.noDate],
      ['done', 'Выполнено', buckets.done],
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
