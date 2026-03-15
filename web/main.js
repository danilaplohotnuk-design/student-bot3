const tg = window.Telegram?.WebApp;

if (tg) {
  tg.expand();
  tg.enableClosingConfirmation();
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dateInput = document.getElementById('date-input');
const dateLabel = document.getElementById('date-label');
const todayBtn = document.getElementById('today-btn');
const tomorrowBtn = document.getElementById('tomorrow-btn');
const scheduleContainer = document.getElementById('schedule');

let currentScheduleDate = ''; // дата відкритого розкладу (для форми зміни пари)
const TIME_SLOTS = [
  { label: '09:00–10:20', startTime: '09:00', endTime: '10:20' },
  { label: '10:40–12:00', startTime: '10:40', endTime: '12:00' },
  { label: '12:30–13:50', startTime: '12:30', endTime: '13:50' },
  { label: '14:10–15:30', startTime: '14:10', endTime: '15:30' },
];

function setDateLabel(dateStr) {
  const d = new Date(dateStr);
  const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  dateLabel.textContent = d.toLocaleDateString('uk-UA', options);
}

async function loadSchedule(date) {
  scheduleContainer.innerHTML = `
    <div class="state-message">
      Завантаження
      <div class="loading-dots"><span></span><span></span><span></span></div>
    </div>
  `;
  try {
    const res = await fetch(`/api/schedule?date=${encodeURIComponent(date)}`);
    if (!res.ok) throw new Error('Помилка завантаження');
    const data = await res.json();
    renderSchedule(data.date, data.lessons || []);
  } catch (err) {
    scheduleContainer.innerHTML = '<p class="state-message error">Не вдалося завантажити розклад</p>';
    console.error(err);
  }
}

function renderSchedule(date, lessons) {
  setDateLabel(date);
  currentScheduleDate = date || '';

  if (!lessons.length) {
    scheduleContainer.innerHTML = '<p class="state-message empty">На цю дату пар немає</p>';
    return;
  }

  scheduleContainer.innerHTML = '';
  lessons.forEach((lesson) => {
    const card = document.createElement('div');
    card.className = 'lesson-card lesson-card--clickable';
    card.dataset.title = lesson.title;
    card.dataset.teacher = lesson.teacher || '';

    const title = document.createElement('h2');
    title.className = 'lesson-title';
    title.textContent = lesson.title;

    const meta = document.createElement('div');
    meta.className = 'lesson-meta';

    const time = document.createElement('div');
    time.className = 'lesson-time';
    time.textContent = `${lesson.startTime} — ${lesson.endTime}`;
    meta.appendChild(time);

    if (lesson.teacher) {
      const teacherEl = document.createElement('div');
      teacherEl.className = 'lesson-teacher';
      teacherEl.textContent = lesson.teacher;
      meta.appendChild(teacherEl);
    }

    const place = document.createElement('div');
    place.className = 'lesson-place';
    place.textContent = `Корпус ${lesson.building}, ауд. ${lesson.room}`;
    meta.appendChild(place);

    const zoomHint = document.createElement('div');
    zoomHint.className = 'lesson-zoom-hint';
    zoomHint.textContent = 'Натисни для посилання в Zoom';

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(zoomHint);
    scheduleContainer.appendChild(card);

    let longPressHandled = false;
    let longPressTimer = null;

    const clearLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const startLongPress = () => {
      longPressHandled = false;
      longPressTimer = setTimeout(() => {
        longPressHandled = true;
        longPressTimer = null;
        openPasswordModal();
      }, 500);
    };

    card.addEventListener('click', (e) => {
      if (longPressHandled) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      openOrCopyZoomLink(card);
    });

    card.addEventListener('touchstart', (e) => { startLongPress(); }, { passive: true });
    card.addEventListener('touchend', clearLongPress);
    card.addEventListener('touchcancel', clearLongPress);
    card.addEventListener('mousedown', () => startLongPress());
    card.addEventListener('mouseup', clearLongPress);
    card.addEventListener('mouseleave', clearLongPress);
  });
}

function showToast(message) {
  const existing = document.getElementById('zoom-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'zoom-toast';
  toast.className = 'zoom-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('zoom-toast--visible'));
  setTimeout(() => {
    toast.classList.remove('zoom-toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// --------- Модалки: пароль і форма зміни пари ---------
let storedAdminPassword = '';

function closeModals() {
  const overlay = document.getElementById('schedule-modal-overlay');
  if (overlay) overlay.remove();
}

function openPasswordModal() {
  closeModals();
  const overlay = document.createElement('div');
  overlay.id = 'schedule-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box modal-password">
      <h3 class="modal-title">Пароль</h3>
      <p class="modal-hint">Введіть пароль для зміни пари</p>
      <input type="password" id="modal-password-input" class="modal-input" placeholder="Пароль" autocomplete="off" />
      <p id="modal-password-error" class="modal-error" style="display:none;">Невірний пароль</p>
      <div class="modal-actions">
        <button type="button" class="modal-btn modal-btn-cancel" data-action="cancel">Скасувати</button>
        <button type="button" class="modal-btn modal-btn-primary" data-action="submit">Продовжити</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#modal-password-input');
  const errorEl = overlay.querySelector('#modal-password-error');
  input.focus();

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.dataset.action === 'cancel') closeModals();
  });

  const submitPassword = async () => {
    const password = input.value.trim();
    if (!password) return;
    errorEl.style.display = 'none';
    try {
      const res = await fetch('/api/admin/check', {
        headers: { 'x-admin-password': password },
      });
      if (res.ok) {
        storedAdminPassword = password;
        closeModals();
        openAddPairFormModal();
      } else {
        errorEl.style.display = 'block';
      }
    } catch (_) {
      errorEl.style.display = 'block';
    }
  };

  overlay.querySelector('[data-action="submit"]').addEventListener('click', submitPassword);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitPassword();
  });
}

async function openAddPairFormModal() {
  if (!currentScheduleDate) {
    showToast('Оберіть дату в розкладі');
    return;
  }
  closeModals();

  let subjects = [];
  try {
    const res = await fetch('/api/schedule/subjects');
    const data = await res.json();
    subjects = data.subjects || [];
  } catch (_) {}

  const overlay = document.createElement('div');
  overlay.id = 'schedule-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box modal-form">
      <h3 class="modal-title">Зміна пари</h3>
      <p class="modal-hint">Додати пару на ${currentScheduleDate}</p>
      <label class="modal-label">Предмет</label>
      <select id="modal-subject" class="modal-select">
        <option value="">Оберіть предмет</option>
        ${subjects.map((s) => `<option value="${s.replace(/"/g, '&quot;')}">${s}</option>`).join('')}
      </select>
      <label class="modal-label">Час</label>
      <select id="modal-time" class="modal-select">
        ${TIME_SLOTS.map((t) => `<option value="${t.startTime}|${t.endTime}">${t.label}</option>`).join('')}
      </select>
      <label class="modal-label">Корпус</label>
      <input type="text" id="modal-building" class="modal-input" placeholder="Наприклад: 2" />
      <label class="modal-label">Аудиторія</label>
      <input type="text" id="modal-room" class="modal-input" placeholder="Наприклад: 104" />
      <p id="modal-form-error" class="modal-error" style="display:none;"></p>
      <div class="modal-actions">
        <button type="button" class="modal-btn modal-btn-cancel" data-action="cancel">Скасувати</button>
        <button type="button" class="modal-btn modal-btn-primary" data-action="add">Додати пару</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const subjectSelect = overlay.querySelector('#modal-subject');
  const timeSelect = overlay.querySelector('#modal-time');
  const buildingInput = overlay.querySelector('#modal-building');
  const roomInput = overlay.querySelector('#modal-room');
  const errorEl = overlay.querySelector('#modal-form-error');

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.dataset.action === 'cancel') closeModals();
  });

  overlay.querySelector('[data-action="add"]').addEventListener('click', async () => {
    const title = subjectSelect.value.trim();
    const timeVal = timeSelect.value;
    const building = buildingInput.value.trim();
    const room = roomInput.value.trim();
    errorEl.style.display = 'none';
    if (!title || !timeVal || !building || !room) {
      errorEl.textContent = 'Заповніть усі поля';
      errorEl.style.display = 'block';
      return;
    }
    const [startTime, endTime] = timeVal.split('|');
    try {
      const res = await fetch('/api/admin/schedule/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': storedAdminPassword,
        },
        body: JSON.stringify({
          date: currentScheduleDate,
          startTime,
          endTime,
          title,
          teacher: null,
          building,
          room,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        closeModals();
        showToast('Пару додано');
        loadSchedule(currentScheduleDate);
      } else {
        errorEl.textContent = data.error || 'Помилка збереження';
        errorEl.style.display = 'block';
      }
    } catch (_) {
      errorEl.textContent = 'Помилка мережі';
      errorEl.style.display = 'block';
    }
  });
}

async function openOrCopyZoomLink(card) {
  const title = card.dataset.title || '';
  const teacher = card.dataset.teacher || '';
  try {
    const res = await fetch(`/api/zoom-link?title=${encodeURIComponent(title)}&teacher=${encodeURIComponent(teacher)}`);
    const data = await res.json();
    if (data.url) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(data.url);
          showToast('Посилання скопійовано');
        } catch (_) {}
      }
      // Комп і телефон: у Telegram (WebView) — openLink відкриває у зовнішньому браузері; у звичайному браузері — window.open
      let opened = false;
      if (tg && tg.openLink) {
        try {
          tg.openLink(data.url);
          opened = true;
        } catch (_) {}
      }
      if (!opened) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      }
    } else {
      showToast('Посилання для цього предмету немає');
    }
  } catch (err) {
    showToast('Помилка');
  }
}

dateInput.addEventListener('change', () => {
  if (dateInput.value) loadSchedule(dateInput.value);
});

todayBtn.addEventListener('click', () => {
  const today = todayISO();
  dateInput.value = today;
  loadSchedule(today);
});

tomorrowBtn.addEventListener('click', () => {
  const tomorrow = tomorrowISO();
  dateInput.value = tomorrow;
  loadSchedule(tomorrow);
});

const initialDate = todayISO();
dateInput.value = initialDate;
loadSchedule(initialDate);
