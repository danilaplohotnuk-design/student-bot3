const tg = window.Telegram?.WebApp;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

if (tg) {
  tg.expand();
  tg.enableClosingConfirmation();
}

// Підрахунок відкриття додатку (не залежить від GET /; cron не виконує JS)
fetch('/api/track/pageview', { method: 'POST', credentials: 'same-origin' }).catch(() => {});

fetch('/api/version')
  .then((r) => r.json())
  .then((d) => {
    const el = document.getElementById('app-version');
    if (el && d.display) el.textContent = `Версія ${d.display}`;
  })
  .catch(() => {});

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

function appendEmptySlotCard(date, slot) {
  /* У режимі перегляду вільні слоти не показуємо — список пар зсувається вгору */
  if (!adminMode) return;

  const card = document.createElement('div');
  card.className = 'lesson-card lesson-card--empty';
  card.dataset.date = date;
  card.dataset.startTime = slot.startTime;
  card.dataset.endTime = slot.endTime;

  const label = document.createElement('p');
  label.className = 'lesson-empty-label';
  label.appendChild(document.createTextNode('Додати пару'));
  const timeEl = document.createElement('span');
  timeEl.className = 'lesson-empty-time';
  timeEl.textContent = slot.label;
  label.appendChild(timeEl);
  card.appendChild(label);

  card.addEventListener('click', () => {
    runAdminUiAction(() => {
      openAddPairFormModal({
        startTime: slot.startTime,
        endTime: slot.endTime,
        title: null,
        teacher: null,
        building: '',
        room: '',
        date,
      });
    });
  });

  scheduleContainer.appendChild(card);
}

function attachLessonZoomDoubleTap(cardEl) {
  cardEl.addEventListener('click', () => {
    if (cardEl.dataset.skipZoomClick === '1') {
      delete cardEl.dataset.skipZoomClick;
      return;
    }
    const key = `${cardEl.dataset.date}|${cardEl.dataset.startTime}|${cardEl.dataset.title}`;
    if (zoomPendingKey === key && zoomPendingTimer !== null) {
      clearTimeout(zoomPendingTimer);
      zoomPendingTimer = null;
      zoomPendingKey = null;
      openOrCopyZoomLink(cardEl);
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
}

function appendLessonCard(date, lesson) {
  const fillLessonCardContent = (card) => {
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
  };

  if (!adminMode) {
    const card = document.createElement('div');
    card.className = 'lesson-card lesson-card--clickable';
    fillLessonCardContent(card);
    scheduleContainer.appendChild(card);
    attachLessonZoomDoubleTap(card);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'lesson-card-swipe-wrap';

  const actions = document.createElement('div');
  actions.className = 'lesson-card-swipe-actions';
  actions.setAttribute('aria-hidden', 'true');

  const btnReplace = document.createElement('button');
  btnReplace.type = 'button';
  btnReplace.className = 'lesson-swipe-btn lesson-swipe-btn--replace';
  btnReplace.innerHTML = `
    <svg class="lesson-swipe-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>
    </svg>
    <span class="lesson-swipe-label">Замінити</span>
  `;
  btnReplace.addEventListener('click', (e) => {
    e.stopPropagation();
    runAdminUiAction(() => {
      openAddPairFormModal(lesson);
    });
  });

  const btnDelete = document.createElement('button');
  btnDelete.type = 'button';
  btnDelete.className = 'lesson-swipe-btn lesson-swipe-btn--delete';
  btnDelete.innerHTML = `
    <svg class="lesson-swipe-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"/>
    </svg>
    <span class="lesson-swipe-label">Видалити</span>
  `;
  btnDelete.addEventListener('click', (e) => {
    e.stopPropagation();
    runAdminUiAction(() => {
      confirmDeletePair(lesson);
    });
  });

  actions.appendChild(btnReplace);
  actions.appendChild(btnDelete);

  const front = document.createElement('div');
  front.className = 'lesson-card lesson-card--clickable lesson-card--swipe-front';
  fillLessonCardContent(front);

  attachSwipeToLessonFront(front, SWIPE_ACTIONS_WIDTH);
  attachLessonZoomDoubleTap(front);

  wrap.appendChild(actions);
  wrap.appendChild(front);
  scheduleContainer.appendChild(wrap);
}

function renderSchedule(date, lessons) {
  setDateLabel(date);
  currentScheduleDate = date || '';
  scheduleContainer.innerHTML = '';

  const list = lessons || [];
  const byStart = new Map();
  list.forEach((l) => {
    byStart.set(l.startTime, l);
  });

  TIME_SLOTS.forEach((slot) => {
    const lesson = byStart.get(slot.startTime);
    if (lesson) {
      appendLessonCard(date, lesson);
    } else {
      appendEmptySlotCard(date, slot);
    }
  });

  list
    .filter((l) => !TIME_SLOTS.some((s) => s.startTime === l.startTime))
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .forEach((l) => appendLessonCard(date, l));
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
/** Після 8 тапів по версії та вірного пароля — свайп на парах і «Додати пару» на вільних слотах */
let adminMode = false;

/** Захист від випадкових подвійних натискань у режимі адміна (мс) */
const ADMIN_UI_COOLDOWN_MS = 450;
let lastAdminUiTapAt = 0;

/**
 * Виконати дію лише в режимі адміна й не частіше за ADMIN_UI_COOLDOWN_MS.
 */
function runAdminUiAction(fn) {
  if (!adminMode) return;
  const now = Date.now();
  if (now - lastAdminUiTapAt < ADMIN_UI_COOLDOWN_MS) return;
  lastAdminUiTapAt = now;
  fn();
}

/** Ширина зони дій справа (дві кнопки + відступи) — узгоджувати з CSS */
const SWIPE_ACTIONS_WIDTH = 200;
/** Розгортання — швидко й передбачувано */
const SWIPE_MS_OPEN = 280;
const SWIPE_EASE_OPEN = 'cubic-bezier(0.25, 0.82, 0.2, 1)';
/** Згортання — довше, «важкий м'яч» з легким відскоком (ease-out-back) */
const SWIPE_MS_CLOSE = 580;
const SWIPE_EASE_CLOSE = 'cubic-bezier(0.175, 0.885, 0.32, 1.275)';

/**
 * Фінальний кадр після відпускання: плавно підтягує панель і opacity кнопок тим самим easing.
 * finalX === 0 — згортання з «важким» відскоком; інакше — розгортання.
 */
function applySwipeSnapAnimation(front, actions, finalX) {
  const closing = finalX === 0;
  const ms = closing ? SWIPE_MS_CLOSE : SWIPE_MS_OPEN;
  const ease = closing ? SWIPE_EASE_CLOSE : SWIPE_EASE_OPEN;
  front.style.transition = `transform ${ms}ms ${ease}`;
  front.style.transform = `translateX(${finalX}px)`;
  if (actions) {
    actions.style.transition = `opacity ${ms}ms ${ease}`;
    if (closing) {
      actions.style.opacity = '0';
      actions.style.pointerEvents = 'none';
      actions.setAttribute('aria-hidden', 'true');
    } else {
      actions.style.opacity = '1';
      actions.style.pointerEvents = 'auto';
      actions.setAttribute('aria-hidden', 'false');
    }
  }
}

function closeModals() {
  const overlay = document.getElementById('schedule-modal-overlay');
  if (overlay) overlay.remove();
}

/**
 * Під час перетягування — кнопки поступово з’являються разом із зсувом (0…1).
 * Після відпускання незавершеного свайпу opacity доводить до 0 через applySwipeSnapAnimation(…, 0).
 */
function updateSwipeActionsVisibility(front, maxW) {
  const wrap = front.parentElement;
  if (!wrap) return;
  const actions = wrap.querySelector('.lesson-card-swipe-actions');
  if (!actions) return;
  const m = front.style.transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
  const tx = m ? parseFloat(m[1], 10) : 0;
  const reveal = Math.max(0, Math.min(1, -tx / maxW));
  actions.style.transition = 'none';
  actions.style.opacity = String(reveal);
  actions.style.pointerEvents = reveal > 0.12 ? 'auto' : 'none';
  actions.setAttribute('aria-hidden', reveal < 0.08 ? 'true' : 'false');
}

function closeAllLessonSwipes() {
  document.querySelectorAll('.lesson-card--swipe-front').forEach((el) => {
    const actions = el.parentElement?.querySelector('.lesson-card-swipe-actions');
    applySwipeSnapAnimation(el, actions, 0);
  });
}

function hasOpenSwipe() {
  return [...document.querySelectorAll('.lesson-card--swipe-front')].some((el) => {
    const m = el.style.transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
    return m && parseFloat(m[1], 10) < -2;
  });
}

/**
 * Тап поза кнопками «Замінити»/«Видалити» згортає свайп з анімацією «важкий м'яч».
 * Натиск на самій панелі пари лишається в attachSwipeToLessonFront; на кнопках дій — без згортання (дія триває).
 */
function registerGlobalSwipeDismiss() {
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!adminMode) return;
      if (e.target.closest('.lesson-swipe-btn')) return;
      if (document.getElementById('schedule-modal-overlay')) return;
      if (!hasOpenSwipe()) return;
      if (e.target.closest('.lesson-card--swipe-front')) return;
      closeAllLessonSwipes();
    },
    true,
  );
}

function syncAdminChrome() {
  document.body.classList.toggle('admin-mode', adminMode);
  const strip = document.getElementById('admin-exit-strip');
  const banner = document.getElementById('admin-mode-banner');
  if (strip) strip.hidden = !adminMode;
  if (banner) banner.hidden = !adminMode;
}

function exitAdminMode() {
  adminMode = false;
  storedAdminPassword = '';
  lastAdminUiTapAt = 0;
  closeModals();
  closeAllLessonSwipes();
  syncAdminChrome();
  showToast('Режим редагування вимкнено');
  if (currentScheduleDate) loadSchedule(currentScheduleDate);
}

function attachSwipeToLessonFront(front, maxW) {
  const wrap = front.parentElement;
  const actions = wrap?.querySelector('.lesson-card-swipe-actions');

  let startX = 0;
  let lastTx = 0;
  let active = false;

  front.addEventListener(
    'touchstart',
    (e) => {
      closeAllLessonSwipes();
      front.style.transition = 'none';
      const m = front.style.transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
      lastTx = m ? parseFloat(m[1], 10) : 0;
      startX = e.touches[0].clientX;
      active = true;
      updateSwipeActionsVisibility(front, maxW);
    },
    { passive: true },
  );

  front.addEventListener(
    'touchmove',
    (e) => {
      if (!active) return;
      const dx = e.touches[0].clientX - startX;
      let x = lastTx + dx;
      x = Math.max(-maxW, Math.min(0, x));
      front.style.transform = `translateX(${x}px)`;
      updateSwipeActionsVisibility(front, maxW);
    },
    { passive: true },
  );

  front.addEventListener(
    'touchend',
    (e) => {
      if (!active) return;
      active = false;
      const dx = e.changedTouches[0].clientX - startX;
      const x = lastTx + dx;
      const finalX = x < -maxW / 2 ? -maxW : 0;
      applySwipeSnapAnimation(front, actions, finalX);
      front.dataset.skipZoomClick = Math.abs(dx) > 14 ? '1' : '0';
    },
    { passive: true },
  );

  front.addEventListener(
    'touchcancel',
    () => {
      if (!active) return;
      active = false;
      applySwipeSnapAnimation(front, actions, 0);
    },
    { passive: true },
  );

  updateSwipeActionsVisibility(front, maxW);
}

const SECRET_TAPS = 8;
const SECRET_TAP_WINDOW_MS = 2800;
let secretTapCount = 0;
let secretTapTimer = null;

function onVersionSecretTap() {
  if (secretTapTimer) clearTimeout(secretTapTimer);
  secretTapCount += 1;
  if (secretTapCount >= SECRET_TAPS) {
    secretTapCount = 0;
    openPasswordModal(null, { mode: 'secretVersion' });
    return;
  }
  secretTapTimer = setTimeout(() => {
    secretTapCount = 0;
    secretTapTimer = null;
  }, SECRET_TAP_WINDOW_MS);
}

/**
 * @param {object | null} lessonOrNull — зарезервовано (наприклад для майбутніх сценаріїв); пароль перевіряється без прив’язки до пари
 * @param {{ mode?: 'secretVersion' }} [options]
 */
function openPasswordModal(lessonOrNull, options = {}) {
  const { mode } = options;
  closeModals();
  const overlay = document.createElement('div');
  overlay.id = 'schedule-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box modal-password">
      <h3 class="modal-title">Пароль</h3>
      <p class="modal-hint">Введіть пароль адміністратора</p>
      <input type="password" id="modal-password-input" class="modal-input" placeholder="Пароль" autocomplete="off" />
      <p id="modal-password-error" class="modal-error" style="display:none;"></p>
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
    errorEl.textContent = 'Невірний пароль';
    try {
      const res = await fetch('/api/admin/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        storedAdminPassword = password;
        closeModals();
        if (mode === 'secretVersion') {
          adminMode = true;
          lastAdminUiTapAt = 0;
          closeAllLessonSwipes();
          syncAdminChrome();
          if (currentScheduleDate) loadSchedule(currentScheduleDate);
          return;
        }
      } else if (res.status === 401) {
        errorEl.style.display = 'block';
      } else {
        errorEl.textContent = `Помилка сервера (${res.status})`;
        errorEl.style.display = 'block';
      }
    } catch (_) {
      errorEl.textContent = 'Немає зв’язку з сервером. Відкрийте додаток через той самий хост, де запущено API.';
      errorEl.style.display = 'block';
    }
  };

  overlay.querySelector('[data-action="submit"]').addEventListener('click', submitPassword);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitPassword();
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
        date: currentScheduleDate,
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

function confirmDeletePair(lesson) {
  if (!confirm('Видалити цю пару?')) {
    closeAllLessonSwipes();
    return;
  }
  deletePair(lesson).then((ok) => {
    if (ok) {
      showToast('Пару видалено');
      if (currentScheduleDate) loadSchedule(currentScheduleDate);
    } else {
      showToast('Помилка видалення');
      closeAllLessonSwipes();
    }
  });
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

  const isEdit = Boolean(lessonOrNull?.title);
  const timeVal = lessonOrNull
    ? `${lessonOrNull.startTime}|${lessonOrNull.endTime || TIME_SLOTS.find((t) => t.startTime === lessonOrNull.startTime)?.endTime || ''}`
    : '';

  const overlay = document.createElement('div');
  overlay.id = 'schedule-modal-overlay';
  overlay.className = 'modal-overlay modal-overlay--pair';

  const subjectItems = [{ value: '', label: 'Оберіть предмет' }, ...subjects.map((s) => ({ value: s, label: s }))];
  const subjectInitial = lessonOrNull?.title != null ? String(lessonOrNull.title) : '';

  const timePanelsHtml = TIME_SLOTS.map(
    (t) =>
      `<button type="button" class="building-panel time-panel" data-time="${escapeHtml(`${t.startTime}|${t.endTime}`)}" aria-pressed="false">${escapeHtml(t.label)}</button>`,
  ).join('');

  const subjectOptionsHtml = subjectItems
    .map(
      (it) => `<option value="${escapeHtml(it.value)}">${escapeHtml(it.label)}</option>`,
    )
    .join('');

  overlay.innerHTML = `
    <div class="modal-box modal-form modal-pair-glass">
      <h3 class="modal-title">${isEdit ? 'Зміна пари' : 'Додати пару'}</h3>
      <p class="modal-hint">${isEdit ? 'Змінити пару на ' : 'Додати пару на '}${currentScheduleDate}</p>
      <div class="pair-wheels" role="group" aria-label="Предмет і час">
        <div class="pair-wheels__subject">
          <label for="modal-subject-select" class="modal-label">ПРЕДМЕТ</label>
          <select id="modal-subject-select" name="subject" class="modal-select modal-subject-select">
            ${subjectOptionsHtml}
          </select>
        </div>
        <div class="pair-wheels__time">
          <label class="modal-label">ЧАС</label>
          <div class="time-panels" id="modal-time-panels" role="radiogroup" aria-label="Час">
            ${timePanelsHtml}
          </div>
        </div>
      </div>
      <label class="modal-label">КОРПУС</label>
      <div class="building-panels" id="modal-building-panels" role="radiogroup" aria-label="Корпус">
        <button type="button" class="building-panel" data-building="1" aria-pressed="false">1</button>
        <button type="button" class="building-panel" data-building="2" aria-pressed="false">2</button>
        <button type="button" class="building-panel" data-building="3" aria-pressed="false">3</button>
      </div>
      <label for="modal-room" class="modal-label">АУДИТОРІЯ</label>
      <input
        type="text"
        id="modal-room"
        name="room"
        class="modal-input modal-input--room"
        placeholder="Наприклад: 104"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="done"
        inputmode="text"
      />
      <p id="modal-form-error" class="modal-error" style="display:none;"></p>
      <div class="modal-actions">
        <button type="button" class="modal-btn modal-btn-cancel" data-action="cancel">Скасувати</button>
        <button type="button" class="modal-btn modal-btn-primary" data-action="add">${isEdit ? 'Зберегти' : 'Додати пару'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const subjectSelect = overlay.querySelector('#modal-subject-select');
  if (subjectSelect) {
    if (subjectInitial) {
      subjectSelect.value = subjectInitial;
    }
    const stop = (e) => e.stopPropagation();
    subjectSelect.addEventListener('pointerdown', stop);
    subjectSelect.addEventListener('touchstart', stop, { passive: true });
    subjectSelect.addEventListener('click', stop);
  }

  const timePanels = overlay.querySelector('#modal-time-panels');
  const setTimeSelection = (value) => {
    if (!timePanels) return;
    timePanels.querySelectorAll('.time-panel').forEach((btn) => {
      const sel = btn.dataset.time === value;
      btn.classList.toggle('building-panel--selected', sel);
      btn.setAttribute('aria-pressed', sel ? 'true' : 'false');
    });
  };
  if (timeVal) {
    setTimeSelection(timeVal);
  }

  timePanels?.addEventListener('click', (e) => {
    const btn = e.target.closest('.time-panel');
    if (!btn || !timePanels.contains(btn)) return;
    setTimeSelection(btn.dataset.time);
  });

  const buildingPanels = overlay.querySelector('#modal-building-panels');
  const roomInput = overlay.querySelector('#modal-room');
  const errorEl = overlay.querySelector('#modal-form-error');

  if (roomInput) {
    if (lessonOrNull != null && lessonOrNull.room != null && String(lessonOrNull.room).trim() !== '') {
      roomInput.value = String(lessonOrNull.room);
    }
    /* Telegram WebView: не даємо подіям «з’їдати» фокус поля */
    const stop = (e) => e.stopPropagation();
    roomInput.addEventListener('pointerdown', stop);
    roomInput.addEventListener('touchstart', stop, { passive: true });
    roomInput.addEventListener('click', stop);
  }

  const setBuildingSelection = (value) => {
    if (!buildingPanels) return;
    buildingPanels.querySelectorAll('.building-panel').forEach((btn) => {
      const sel = btn.dataset.building === value;
      btn.classList.toggle('building-panel--selected', sel);
      btn.setAttribute('aria-pressed', sel ? 'true' : 'false');
    });
  };

  const initialBuilding =
    lessonOrNull?.building != null ? String(lessonOrNull.building).trim() : '';
  if (['1', '2', '3'].includes(initialBuilding)) {
    setBuildingSelection(initialBuilding);
  }

  buildingPanels?.addEventListener('click', (e) => {
    const btn = e.target.closest('.building-panel');
    if (!btn || !buildingPanels.contains(btn)) return;
    setBuildingSelection(btn.dataset.building);
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.dataset.action === 'cancel') {
      closeModals();
      closeAllLessonSwipes();
    }
  });

  overlay.querySelector('[data-action="add"]').addEventListener('click', async () => {
    const title = (subjectSelect?.value ?? '').trim();
    const timeValSel =
      overlay.querySelector('.time-panel.building-panel--selected')?.dataset.time ?? '';
    /* Тільки панелі 1/2/3 — не плутати з .time-panel, у яких теж клас building-panel */
    const building =
      buildingPanels?.querySelector('.building-panel--selected')?.dataset.building?.trim() ?? '';
    const room = roomInput.value.trim();
    errorEl.style.display = 'none';
    if (!title) {
      errorEl.textContent = 'Оберіть предмет';
      errorEl.style.display = 'block';
      return;
    }
    if (!timeValSel) {
      errorEl.textContent = 'Оберіть час пари';
      errorEl.style.display = 'block';
      return;
    }
    if (!building) {
      errorEl.textContent = 'Оберіть корпус (1, 2 або 3)';
      errorEl.style.display = 'block';
      return;
    }
    if (!room) {
      errorEl.textContent = 'Введіть аудиторію';
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
        closeAllLessonSwipes();
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

const versionSecretBtn = document.getElementById('version-secret-trigger');
if (versionSecretBtn) {
  versionSecretBtn.addEventListener('click', (e) => {
    e.preventDefault();
    onVersionSecretTap();
  });
}

const adminExitBtn = document.getElementById('admin-exit-btn');
if (adminExitBtn) {
  adminExitBtn.addEventListener('click', () => runAdminUiAction(() => exitAdminMode()));
}

registerGlobalSwipeDismiss();
syncAdminChrome();
