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

// Захист від випадкового натискання: подвійний тап для Zoom
const ZOOM_DOUBLE_TAP_MS = 2000;
let zoomPendingKey = null;
let zoomPendingTimer = null;

// Довге натискання: скасувати, якщо був скрол (рух пальця/миші)
const LONG_PRESS_MOVE_THRESHOLD_PX = 12;
let longPressState = null;

// --------- Фон: колір або зображення (localStorage) ---------
const BG_STORAGE_KEY = 'schedule_app_bg';
const LUMINANCE_THRESHOLD = 0.45; // вище = світлий фон → темний текст

function getStoredBackground() {
  try {
    const raw = localStorage.getItem(BG_STORAGE_KEY);
    if (!raw) return null;
    const prefs = JSON.parse(raw);
    if (prefs && (prefs.type === 'color' || prefs.type === 'image') && prefs.value) return prefs;
  } catch (_) {}
  return null;
}

function hexToRgb(hex) {
  const m = hex.replace(/^#/, '').match(/^([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

function getLuminanceFromRgb(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getLuminanceForColor(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? getLuminanceFromRgb(rgb.r, rgb.g, rgb.b) : 0;
}

function rgbToHex(r, g, b) {
  const pad = (n) => String(Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0'));
  return '#' + pad(r) + pad(g) + pad(b);
}

function blendHex(hex1, hex2, t) {
  const r1 = hexToRgb(hex1);
  const r2 = hexToRgb(hex2);
  if (!r1 || !r2) return hex1;
  const r = r1.r * (1 - t) + r2.r * t;
  const g = r1.g * (1 - t) + r2.g * t;
  const b = r1.b * (1 - t) + r2.b * t;
  return rgbToHex(r, g, b);
}

function setTextModeByLuminance(luminance) {
  document.body.dataset.bgMode = luminance > LUMINANCE_THRESHOLD ? 'light' : 'dark';
}

function clearAdaptiveColors() {
  document.body.style.removeProperty('--text');
  document.body.style.removeProperty('--text-muted');
  document.body.style.removeProperty('--text-dim');
  document.body.style.removeProperty('--time');
  document.body.style.removeProperty('--place');
  document.body.style.removeProperty('--accent');
}

function setAdaptiveColorsFromBg(hex, luminance) {
  const isLight = luminance > LUMINANCE_THRESHOLD;
  if (isLight) {
    document.body.style.setProperty('--text', blendHex(hex, '#0a0a0f', 0.82));
    document.body.style.setProperty('--text-muted', blendHex(hex, '#0a0a0f', 0.59));
    document.body.style.setProperty('--text-dim', blendHex(hex, '#0a0a0f', 0.44));
    document.body.style.setProperty('--time', blendHex(hex, '#5c2e0a', 0.28));
    document.body.style.setProperty('--place', blendHex(hex, '#0a0a0f', 0.52));
    document.body.style.setProperty('--accent', blendHex('#3b82f6', hex, 0.21));
  } else {
    document.body.style.setProperty('--text', blendHex(hex, '#f8fafc', 0.86));
    document.body.style.setProperty('--text-muted', blendHex(hex, '#e2e8f0', 0.69));
    document.body.style.setProperty('--text-dim', blendHex(hex, '#94a3b8', 0.64));
    document.body.style.setProperty('--time', blendHex(hex, '#fde047', 0.18));
    document.body.style.setProperty('--place', blendHex(hex, '#cbd5e1', 0.72));
    document.body.style.setProperty('--accent', blendHex('#93c5fd', hex, 0.26));
  }
}

function computeImageLuminanceAndColor(url, done) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      const size = 64;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let sumLum = 0;
      let r = 0, g = 0, b = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        sumLum += getLuminanceFromRgb(data[i], data[i + 1], data[i + 2]);
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count += 1;
      }
      const avgLum = count ? sumLum / count : 0;
      const avgHex = count ? rgbToHex(r / count, g / count, b / count) : '#0f1320';
      done(avgLum, avgHex);
    } catch (_) {
      done(0, '#0f1320');
    }
  };
  img.onerror = () => done(0, '#0f1320');
  img.src = url;
}

function applyBackground(prefs) {
  const b = document.body.style;
  if (!prefs) {
    document.body.removeAttribute('data-bg-mode');
    clearAdaptiveColors();
    b.background = '';
    b.backgroundImage = '';
    b.backgroundSize = '';
    b.backgroundPosition = '';
    b.backgroundAttachment = '';
    return;
  }
  if (prefs.type === 'color') {
    b.background = prefs.value;
    b.backgroundImage = 'none';
    b.backgroundSize = '';
    b.backgroundPosition = '';
    b.backgroundAttachment = '';
    const lum = getLuminanceForColor(prefs.value);
    setTextModeByLuminance(lum);
    setAdaptiveColorsFromBg(prefs.value, lum);
  } else {
    b.background = '#0f1320';
    b.backgroundImage = `url(${prefs.value})`;
    b.backgroundSize = 'cover';
    b.backgroundPosition = 'center';
    b.backgroundAttachment = 'fixed';
    clearAdaptiveColors();
    setTextModeByLuminance(0);
    computeImageLuminanceAndColor(prefs.value, (lum, avgHex) => {
      setTextModeByLuminance(lum);
      setAdaptiveColorsFromBg(avgHex, lum);
    });
  }
}

function openBackgroundModal() {
  closeModals();
  const stored = getStoredBackground();
  const overlay = document.createElement('div');
  overlay.id = 'schedule-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box modal-form">
      <h3 class="modal-title">Фон екрана</h3>
      <p class="modal-hint">Оберіть колір або вставте посилання на зображення</p>
      <div class="bg-options">
        <label class="modal-label">Колір</label>
        <div class="bg-color-row">
          <input type="color" id="modal-bg-color" value="${stored?.type === 'color' ? stored.value : '#1a1f35'}" class="modal-color-input" />
          <input type="text" id="modal-bg-color-hex" class="modal-input modal-input-inline" placeholder="#1a1f35" maxlength="7" value="${stored?.type === 'color' ? stored.value : ''}" />
        </div>
        <label class="modal-label" style="margin-top:16px">Зображення (URL)</label>
        <input type="url" id="modal-bg-image" class="modal-input" placeholder="https://..." value="${stored?.type === 'image' ? stored.value : ''}" />
        <p class="modal-hint modal-hint-sm" style="margin-top:12px">Колір тексту підлаштовується під фон для кращої читабельності</p>
      </div>
      <p id="modal-bg-error" class="modal-error" style="display:none;"></p>
      <div class="modal-actions" style="margin-top:20px">
        <button type="button" class="modal-btn modal-btn-secondary" data-action="reset-bg">Скинути</button>
        <button type="button" class="modal-btn modal-btn-cancel" data-action="cancel">Скасувати</button>
        <button type="button" class="modal-btn modal-btn-primary" data-action="save-bg">Застосувати</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const colorInput = overlay.querySelector('#modal-bg-color');
  const hexInput = overlay.querySelector('#modal-bg-color-hex');
  const imageInput = overlay.querySelector('#modal-bg-image');
  const errorEl = overlay.querySelector('#modal-bg-error');

  const syncColorToHex = () => {
    hexInput.value = colorInput.value;
  };
  const syncHexToColor = () => {
    const hex = hexInput.value.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) colorInput.value = hex;
  };
  colorInput.addEventListener('input', syncColorToHex);
  hexInput.addEventListener('input', syncHexToColor);
  hexInput.addEventListener('blur', syncHexToColor);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.dataset.action === 'cancel') closeModals();
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'reset-bg') {
      try { localStorage.removeItem(BG_STORAGE_KEY); } catch (_) {}
      applyBackground(null);
      closeModals();
      showToast('Фон скинуто');
      return;
    }
    if (action === 'save-bg') {
      errorEl.style.display = 'none';
      const imageUrl = imageInput.value.trim();
      const colorHex = hexInput.value.trim() || colorInput.value;
      if (imageUrl) {
        try {
          localStorage.setItem(BG_STORAGE_KEY, JSON.stringify({ type: 'image', value: imageUrl }));
          applyBackground({ type: 'image', value: imageUrl });
          closeModals();
          showToast('Фон застосовано');
        } catch (_) {
          errorEl.textContent = 'Невірне посилання';
          errorEl.style.display = 'block';
        }
        return;
      }
      if (colorHex && /^#[0-9A-Fa-f]{6}$/.test(colorHex)) {
        try {
          localStorage.setItem(BG_STORAGE_KEY, JSON.stringify({ type: 'color', value: colorHex }));
          applyBackground({ type: 'color', value: colorHex });
          closeModals();
          showToast('Фон застосовано');
        } catch (_) {
          errorEl.style.display = 'block';
        }
        return;
      }
      try {
        const hex = colorInput.value;
        localStorage.setItem(BG_STORAGE_KEY, JSON.stringify({ type: 'color', value: hex }));
        applyBackground({ type: 'color', value: hex });
        closeModals();
        showToast('Фон застосовано');
      } catch (_) {
        errorEl.textContent = 'Оберіть колір або введіть URL зображення';
        errorEl.style.display = 'block';
      }
    }
  });
}

function cancelLongPressIfMoved(e) {
  if (!longPressState) return;
  const x = e.touches ? e.touches[0].clientX : e.clientX;
  const y = e.touches ? e.touches[0].clientY : e.clientY;
  const dx = x - longPressState.startX;
  const dy = y - longPressState.startY;
  if (dx * dx + dy * dy > LONG_PRESS_MOVE_THRESHOLD_PX * LONG_PRESS_MOVE_THRESHOLD_PX) {
    clearTimeout(longPressState.timerId);
    longPressState = null;
  }
}

document.addEventListener('touchmove', cancelLongPressIfMoved, { passive: true });
document.addEventListener('mousemove', cancelLongPressIfMoved);

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
    card.dataset.date = date;
    card.dataset.startTime = lesson.startTime;
    card.dataset.endTime = lesson.endTime || '';
    card.dataset.title = lesson.title;
    card.dataset.teacher = lesson.teacher || '';
    card.dataset.building = lesson.building || '';
    card.dataset.room = lesson.room || '';

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
    zoomHint.textContent = 'Натисни двічі для посилання в Zoom';

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(zoomHint);
    scheduleContainer.appendChild(card);

    let longPressHandled = false;

    const clearLongPress = () => {
      if (longPressState && longPressState.card === card) {
        clearTimeout(longPressState.timerId);
        longPressState = null;
      }
    };

    const startLongPress = (e) => {
      longPressHandled = false;
      clearLongPress();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const lesson = {
        date: card.dataset.date,
        startTime: card.dataset.startTime,
        endTime: card.dataset.endTime,
        title: card.dataset.title,
        teacher: card.dataset.teacher || '',
        building: card.dataset.building || '',
        room: card.dataset.room || '',
      };
      longPressState = {
        card,
        startX: clientX,
        startY: clientY,
        timerId: setTimeout(() => {
          if (longPressState && longPressState.card === card) {
            longPressState = null;
            longPressHandled = true;
            openPasswordModal(lesson);
          }
        }, 500),
      };
    };

    card.addEventListener('click', (e) => {
      if (longPressHandled) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const key = `${card.dataset.date}|${card.dataset.startTime}|${card.dataset.title}`;
      if (zoomPendingKey === key && zoomPendingTimer !== null) {
        clearTimeout(zoomPendingTimer);
        zoomPendingTimer = null;
        zoomPendingKey = null;
        openOrCopyZoomLink(card);
        return;
      }
      if (zoomPendingTimer) clearTimeout(zoomPendingTimer);
      zoomPendingKey = key;
      showToast('Натисніть ще раз для посилання в Zoom');
      zoomPendingTimer = setTimeout(() => {
        zoomPendingTimer = null;
        zoomPendingKey = null;
      }, ZOOM_DOUBLE_TAP_MS);
    });

    card.addEventListener('touchstart', (e) => { startLongPress(e); }, { passive: true });
    card.addEventListener('touchend', clearLongPress);
    card.addEventListener('touchcancel', clearLongPress);
    card.addEventListener('mousedown', (e) => startLongPress(e));
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

function openPasswordModal(lessonOrNull) {
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
        openChoiceModalAfterPassword(lessonOrNull);
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

function openChoiceModalAfterPassword(lessonOrNull) {
  closeModals();
  const overlay = document.createElement('div');
  overlay.id = 'schedule-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box modal-choice">
      <h3 class="modal-title">Що робити?</h3>
      <div class="modal-choice-buttons">
        <button type="button" class="modal-btn modal-btn-primary modal-choice-btn" data-action="add">Додати / змінити пару</button>
        ${lessonOrNull ? '<button type="button" class="modal-btn modal-btn-danger modal-choice-btn" data-action="delete">Видалити цю пару</button>' : ''}
        <button type="button" class="modal-btn modal-btn-secondary modal-choice-btn" data-action="restore">Відновити весь розклад</button>
      </div>
      <div class="modal-actions">
        <button type="button" class="modal-btn modal-btn-cancel" data-action="cancel">Закрити</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.dataset.action === 'cancel') {
      closeModals();
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'add') {
      closeModals();
      openAddPairFormModal(lessonOrNull);
    } else if (action === 'delete' && lessonOrNull) {
      closeModals();
      confirmDeletePair(lessonOrNull);
    } else if (action === 'restore') {
      closeModals();
      confirmRestoreSchedule();
    }
  });
}

function confirmDeletePair(lesson) {
  if (!confirm(`Видалити пару «${lesson.title}» (${lesson.startTime})?`)) return;
  deletePair(lesson).then((ok) => {
    if (ok) {
      showToast('Пару видалено');
      loadSchedule(lesson.date);
    } else {
      showToast('Помилка видалення');
    }
  });
}

async function deletePair(lesson) {
  try {
    const res = await fetch('/api/admin/schedule/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': storedAdminPassword,
      },
      body: JSON.stringify({
        date: lesson.date,
        startTime: lesson.startTime,
        title: lesson.title,
      }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.ok;
  } catch (_) {
    return false;
  }
}

function confirmRestoreSchedule() {
  if (!confirm('Відновити весь розклад до початкового? Усі зміни будуть втрачені.')) return;
  restoreSchedule().then((ok) => {
    if (ok) {
      showToast('Розклад відновлено');
      if (currentScheduleDate) loadSchedule(currentScheduleDate);
    } else {
      showToast('Помилка відновлення');
    }
  });
}

async function restoreSchedule() {
  try {
    const res = await fetch('/api/admin/schedule/restore', {
      method: 'POST',
      headers: { 'x-admin-password': storedAdminPassword },
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.ok;
  } catch (_) {
    return false;
  }
}

async function openAddPairFormModal(lessonOrNull) {
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

  const isEdit = Boolean(lessonOrNull);
  const timeVal = lessonOrNull
    ? `${lessonOrNull.startTime}|${lessonOrNull.endTime || TIME_SLOTS.find((t) => t.startTime === lessonOrNull.startTime)?.endTime || ''}`
    : '';

  const overlay = document.createElement('div');
  overlay.id = 'schedule-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box modal-form">
      <h3 class="modal-title">${isEdit ? 'Зміна пари' : 'Додати пару'}</h3>
      <p class="modal-hint">${isEdit ? 'Змінити пару на ' : 'Додати пару на '}${currentScheduleDate}</p>
      <label class="modal-label">Предмет</label>
      <select id="modal-subject" class="modal-select">
        <option value="">Оберіть предмет</option>
        ${subjects.map((s) => `<option value="${s.replace(/"/g, '&quot;')}"${lessonOrNull && s === lessonOrNull.title ? ' selected' : ''}>${s}</option>`).join('')}
      </select>
      <label class="modal-label">Час</label>
      <select id="modal-time" class="modal-select">
        ${TIME_SLOTS.map((t) => {
          const val = `${t.startTime}|${t.endTime}`;
          return `<option value="${val}"${timeVal === val ? ' selected' : ''}>${t.label}</option>`;
        }).join('')}
      </select>
      <label class="modal-label">Корпус</label>
      <input type="text" id="modal-building" class="modal-input" placeholder="Наприклад: 2" value="${lessonOrNull?.building ? String(lessonOrNull.building).replace(/"/g, '&quot;') : ''}" />
      <label class="modal-label">Аудиторія</label>
      <input type="text" id="modal-room" class="modal-input" placeholder="Наприклад: 104" value="${lessonOrNull?.room ? String(lessonOrNull.room).replace(/"/g, '&quot;') : ''}" />
      <p id="modal-form-error" class="modal-error" style="display:none;"></p>
      <div class="modal-actions">
        <button type="button" class="modal-btn modal-btn-cancel" data-action="cancel">Скасувати</button>
        <button type="button" class="modal-btn modal-btn-primary" data-action="add">${isEdit ? 'Зберегти' : 'Додати пару'}</button>
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
    const timeValSel = timeSelect.value;
    const building = buildingInput.value.trim();
    const room = roomInput.value.trim();
    errorEl.style.display = 'none';
    if (!title || !timeValSel || !building || !room) {
      errorEl.textContent = 'Заповніть усі поля';
      errorEl.style.display = 'block';
      return;
    }
    const [startTime, endTime] = timeValSel.split('|');
    try {
      const scheduleRes = await fetch(`/api/schedule?date=${encodeURIComponent(currentScheduleDate)}`);
      const scheduleData = await scheduleRes.json().catch(() => ({}));
      const lessons = scheduleData.lessons || [];
      const existingAtTime = lessons.find((l) => l.startTime === startTime);
      if (existingAtTime) {
        const delRes = await fetch('/api/admin/schedule/delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-password': storedAdminPassword,
          },
          body: JSON.stringify({
            date: currentScheduleDate,
            startTime: existingAtTime.startTime,
            title: existingAtTime.title,
          }),
        });
        if (!delRes.ok) {
          const d = await delRes.json().catch(() => ({}));
          errorEl.textContent = d.error || 'Помилка заміни';
          errorEl.style.display = 'block';
          return;
        }
      }
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
        showToast(existingAtTime ? 'Пару оновлено' : 'Пару додано');
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

applyBackground(getStoredBackground());

const initialDate = todayISO();
dateInput.value = initialDate;
loadSchedule(initialDate);

document.getElementById('bg-btn').addEventListener('click', () => openBackgroundModal());
