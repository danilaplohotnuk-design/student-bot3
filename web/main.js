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

/** Текст, коли на обрану дату немає жодної пари (режим перегляду) */
function emptyDayScheduleMessage(dateStr) {
  if (dateStr === todayISO()) return 'На сьогодні пар немає, відпочиваємо';
  if (dateStr === tomorrowISO()) return 'На завтра пар немає, відпочиваємо';
  return 'У цей день пар немає, відпочиваємо';
}

const dateInput = document.getElementById('date-input');
const dateLabel = document.getElementById('date-label');
const todayBtn = document.getElementById('today-btn');
const tomorrowBtn = document.getElementById('tomorrow-btn');
const scheduleContainer = document.getElementById('schedule');

/** Порядкова анімація появи карток пар (падіння + відскок) */
let scheduleCardEnterIndex = 0;
const LESSON_ENTER_STAGGER_MS = 72;

function stampLessonCardEnter(el) {
  if (!el) return;
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  } catch (_) {}
  el.style.setProperty('--lesson-enter-delay', `${scheduleCardEnterIndex * LESSON_ENTER_STAGGER_MS}ms`);
  scheduleCardEnterIndex += 1;
  el.classList.add('lesson-card--enter');
}

let currentScheduleDate = ''; // дата відкритого розкладу (для форми зміни пари)

// Захист від випадкового натискання: подвійний тап для Zoom
const ZOOM_DOUBLE_TAP_MS = 2000;
let zoomPendingKey = null;
let zoomPendingTimer = null;

// --------- Фон: колір або зображення (localStorage) ---------
const BG_STORAGE_KEY = 'schedule_app_bg';
const BG_LAYER_ID = 'schedule-bg-root';
const LUMINANCE_THRESHOLD = 0.45; // вище = світлий фон → темний текст
/** Легке світіння зліва → вправо (~7% білого), поверх кольору фону (як --bg-shine у styles.css) */
const BG_SHINE_GRADIENT =
  'linear-gradient(to right, rgba(255,255,255,0), rgba(255,255,255,0.07))';
/** Колір під фото / до завантаження — узгоджено з --bg-depth у styles.css */
const BG_FALLBACK_SOLID = '#0b0f18';

function clampBg(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function normalizeImageBgPrefs(prefs) {
  if (!prefs || prefs.type !== 'image' || !prefs.value) return null;
  let d = Number(prefs.darken);
  if (!Number.isFinite(d)) d = 0;
  d = clampBg(d, 0, 100);
  let br = Number(prefs.brightness);
  if (!Number.isFinite(br)) br = 100;
  br = clampBg(br, 50, 150);
  let bs = Number(prefs.blurSharp);
  if (!Number.isFinite(bs)) bs = 50;
  bs = clampBg(bs, 0, 100);
  return { type: 'image', value: prefs.value, darken: d, brightness: br, blurSharp: bs };
}

function ensureBgLayer() {
  let root = document.getElementById(BG_LAYER_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = BG_LAYER_ID;
    root.className = 'schedule-bg-root';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '<div class="schedule-bg-root__img"></div><div class="schedule-bg-root__shade"></div>';
    document.body.insertBefore(root, document.body.firstChild);
  }
  root.style.display = '';
  return root;
}

function hideBgLayer() {
  const root = document.getElementById(BG_LAYER_ID);
  if (root) root.style.display = 'none';
}

function applyImageLayer(prefs) {
  const p = normalizeImageBgPrefs(prefs);
  if (!p) return;
  const root = ensureBgLayer();
  const imgEl = root.querySelector('.schedule-bg-root__img');
  const shade = root.querySelector('.schedule-bg-root__shade');
  imgEl.style.backgroundImage = `url(${JSON.stringify(p.value)})`;
  imgEl.style.filter = buildBgImageFilter(p.brightness, p.blurSharp);
  shade.style.backgroundColor = `rgba(0,0,0,${p.darken / 100})`;
}

/** Єдиний повзунок 0–100: ліворуч темніше (затемнення + нижча яскравість), праворуч світліше */
function darkBrightFromUnifiedSlider(v) {
  const x = clampBg(v, 0, 100);
  if (x <= 50) {
    const t = (50 - x) / 50;
    return {
      darken: Math.round(t * 100),
      brightness: Math.round(100 - t * 25),
    };
  }
  const t = (x - 50) / 50;
  return { darken: 0, brightness: Math.round(100 + t * 50) };
}

/** Відновлення позиції повзунка зі збережених darken / brightness */
function unifiedSliderFromStored(darken, brightness) {
  const d = clampBg(Number(darken), 0, 100);
  const b = clampBg(Number(brightness), 50, 150);
  if (d > 0) {
    return clampBg(Math.round(50 - (d / 100) * 50), 0, 50);
  }
  if (b > 100) {
    return clampBg(Math.round(50 + ((b - 100) / 50) * 50), 50, 100);
  }
  if (b < 100) {
    const t = (100 - b) / 25;
    return clampBg(Math.round(50 - Math.min(1, t) * 50), 0, 50);
  }
  return 50;
}

function readUnifiedDarkBrightSlider(el) {
  const n = parseInt(el.value, 10);
  if (!Number.isFinite(n)) return 50;
  return clampBg(n, 0, 100);
}

function formatDarkBrightLabel(v) {
  const x = clampBg(v, 0, 100);
  if (x === 50) return 'Нейтрально';
  if (x < 50) return `Темніше ${Math.round(((50 - x) / 50) * 100)}%`;
  return `Світліше ${Math.round(((x - 50) / 50) * 100)}%`;
}

/** 0 — макс. розмиття, 50 — нейтрально, 100 — більша різкість (через contrast) */
function readBlurSharpSlider(el) {
  const n = parseInt(el.value, 10);
  if (!Number.isFinite(n)) return 50;
  return clampBg(n, 0, 100);
}

function formatBlurSharpLabel(v) {
  const x = clampBg(v, 0, 100);
  if (x === 50) return 'Нейтрально';
  if (x < 50) return `Розмиття ${Math.round(((50 - x) / 50) * 100)}%`;
  return `Різкість ${Math.round(((x - 50) / 50) * 100)}%`;
}

/** Яскравість + один повзунок «розмиття / різкість» */
function buildBgImageFilter(brightnessPct, blurSharpPct) {
  const b = clampBg(brightnessPct, 50, 150) / 100;
  const v = clampBg(blurSharpPct, 0, 100);
  const parts = [`brightness(${b})`];
  if (v < 50) {
    const t = (50 - v) / 50;
    parts.push(`blur(${t * 12}px)`);
  } else if (v > 50) {
    const t = (v - 50) / 50;
    parts.push(`contrast(${1 + t * 0.35})`);
  }
  return parts.join(' ');
}

function isValidStoredImageValue(v) {
  if (typeof v !== 'string' || !v) return false;
  if (/^https?:\/\//i.test(v)) return true;
  return /^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(v);
}

function getStoredBackground() {
  try {
    const raw = localStorage.getItem(BG_STORAGE_KEY);
    if (!raw) return null;
    const prefs = JSON.parse(raw);
    if (!prefs || !prefs.value) return null;
    if (prefs.type === 'color') return prefs;
    if (prefs.type === 'image' && isValidStoredImageValue(prefs.value)) return prefs;
  } catch (_) {}
  return null;
}

/** Макс. довжина рядка data URL у localStorage (~2.4 МБ під типовий ліміт 5 МБ) */
const BG_MAX_DATA_URL_CHARS = 2_400_000;

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const u = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(u);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(u);
      reject(new Error('Не вдалося прочитати зображення'));
    };
    img.src = u;
  });
}

/** Стиснення JPEG для збереження в localStorage (галерея / файл з ПК) */
async function imageFileToStoredDataUrl(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Оберіть файл зображення');
  }
  const img = await loadImageFromFile(file);
  let maxSide = 1920;
  let quality = 0.82;
  for (let attempt = 0; attempt < 10; attempt++) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, tw, th);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length <= BG_MAX_DATA_URL_CHARS) return dataUrl;
    maxSide = Math.round(maxSide * 0.72);
    quality = Math.max(0.45, quality - 0.09);
  }
  throw new Error('Зображення завелике навіть після стиснення. Спробуйте інший файл або посилання.');
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

/** HSL для гармонійної палітри (аналог ідеї Coolors, але без їхнього API — його немає для сторонніх сайтів) */
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return { h: h * 360, s, l };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) {
    rp = c;
    gp = x;
  } else if (h < 120) {
    rp = x;
    gp = c;
  } else if (h < 180) {
    gp = c;
    bp = x;
  } else if (h < 240) {
    gp = x;
    bp = c;
  } else if (h < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

function hslToHex(h, s, l) {
  const { r, g, b } = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

/**
 * Текст на світлому фону: завжди хроматичний (темніший відтінок кольору тла), не нейтральний чорний.
 */
function lightModeTextFromBg(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return { main: '#1e3a5f', muted: '#3d5a80', dim: '#5a6f8a' };
  }
  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const hue = h;
  const baseS = Math.max(0.12, s || 0.15);
  if (s < 0.07) {
    return {
      main: hslToHex(220, 0.22, 0.3),
      muted: hslToHex(218, 0.18, 0.44),
      dim: hslToHex(215, 0.14, 0.52),
    };
  }
  const sm = Math.min(0.55, baseS + 0.1);
  const sd = Math.max(0.1, sm * 0.5);
  return {
    main: hslToHex(hue, sm, 0.22),
    muted: hslToHex(hue, sm * 0.72, 0.36),
    dim: hslToHex(hue, sd, 0.48),
  };
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
  document.body.style.removeProperty('--accent-soft');
  document.body.style.removeProperty('--bg-card');
  document.body.style.removeProperty('--bg-card-hover');
  document.body.style.removeProperty('--border');
  document.body.style.removeProperty('--border-light');
}

/** Текст + локальні гармонійні акценти й «скло» панелей під колір фону */
function setAdaptiveColorsFromBg(hex, luminance) {
  const rgb = hexToRgb(hex);
  if (!rgb) return;

  const isLight = luminance > LUMINANCE_THRESHOLD;
  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const sat = Math.max(0.12, s || 0.15);

  if (isLight) {
    /* Світлий фон: скляні панелі з CSS; текст — затемнений відтінок кольору фону, не «чорний» slate */
    document.body.style.removeProperty('--bg-card');
    document.body.style.removeProperty('--bg-card-hover');
    document.body.style.removeProperty('--border');
    document.body.style.removeProperty('--border-light');
    const t = lightModeTextFromBg(hex);
    document.body.style.setProperty('--text', t.main);
    document.body.style.setProperty('--text-muted', t.muted);
    document.body.style.setProperty('--text-dim', t.dim);
  } else {
    document.body.style.setProperty('--text', blendHex(hex, '#f8fafc', 0.86));
    document.body.style.setProperty('--text-muted', blendHex(hex, '#e2e8f0', 0.69));
    document.body.style.setProperty('--text-dim', blendHex(hex, '#94a3b8', 0.64));
  }

  /* Акцент / час / місце — гармонія з відтінком фону; на світлому — приглушеніші */
  const accentHex = hslToHex(
    (h + 218) % 360,
    Math.min(isLight ? 0.58 : 0.85, sat + (isLight ? 0.22 : 0.38)),
    isLight ? 0.44 : 0.68,
  );
  const timeHex = hslToHex(
    (h + 32) % 360,
    Math.min(isLight ? 0.72 : 0.88, sat + (isLight ? 0.35 : 0.5)),
    isLight ? 0.36 : 0.62,
  );
  const placeHex = hslToHex(h, Math.min(isLight ? 0.22 : 0.42, sat + 0.08), isLight ? 0.4 : 0.7);

  document.body.style.setProperty('--accent', accentHex);
  document.body.style.setProperty('--time', timeHex);
  document.body.style.setProperty('--place', placeHex);

  const accRgb = hexToRgb(accentHex);
  if (accRgb) {
    document.body.style.setProperty(
      '--accent-soft',
      `rgba(${accRgb.r},${accRgb.g},${accRgb.b},${isLight ? 0.18 : 0.22})`,
    );
  }

  /* Темний фон: панелі підлаштовуємо під колір; світлий — лише з CSS */
  if (!isLight) {
    const cardTint = blendHex(hex, '#ffffff', 0.22);
    const cm = hexToRgb(cardTint);
    if (cm) {
      document.body.style.setProperty('--bg-card', `rgba(${cm.r},${cm.g},${cm.b},0.11)`);
      document.body.style.setProperty('--bg-card-hover', `rgba(${cm.r},${cm.g},${cm.b},0.16)`);
      document.body.style.setProperty('--border', `rgba(${cm.r},${cm.g},${cm.b},0.28)`);
      document.body.style.setProperty('--border-light', `rgba(${cm.r},${cm.g},${cm.b},0.36)`);
    }
  }
}

function computeImageLuminanceAndColor(url, done) {
  const img = new Image();
  if (!/^data:/i.test(String(url))) {
    img.crossOrigin = 'anonymous';
  }
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
    document.body.removeAttribute('data-bg-kind');
    clearAdaptiveColors();
    hideBgLayer();
    b.background = '';
    b.backgroundImage = '';
    b.backgroundSize = '';
    b.backgroundPosition = '';
    b.backgroundAttachment = '';
    return;
  }
  if (prefs.type === 'color') {
    document.body.dataset.bgKind = 'color';
    hideBgLayer();
    b.background = `${BG_SHINE_GRADIENT}, ${prefs.value}`;
    b.backgroundSize = '';
    b.backgroundPosition = '';
    b.backgroundAttachment = '';
    const lum = getLuminanceForColor(prefs.value);
    setTextModeByLuminance(lum);
    setAdaptiveColorsFromBg(prefs.value, lum);
  } else {
    const p = normalizeImageBgPrefs(prefs);
    if (!p) {
      document.body.removeAttribute('data-bg-kind');
      hideBgLayer();
      return;
    }
    document.body.dataset.bgKind = 'image';
    b.background = `${BG_SHINE_GRADIENT}, ${BG_FALLBACK_SOLID}`;
    b.backgroundSize = '';
    b.backgroundPosition = '';
    b.backgroundAttachment = '';
    applyImageLayer(p);
    clearAdaptiveColors();
    setTextModeByLuminance(0);
    computeImageLuminanceAndColor(p.value, (lum, avgHex) => {
      setTextModeByLuminance(lum);
      setAdaptiveColorsFromBg(avgHex, lum);
    });
  }
}

function openBackgroundModal() {
  closeModals();
  const stored = getStoredBackground();
  const existingFileDataUrl =
    stored?.type === 'image' && String(stored.value).startsWith('data:image/') ? stored.value : null;
  const initialImageUrl =
    stored?.type === 'image' && /^https?:\/\//i.test(String(stored.value)) ? stored.value : '';
  const storedUnified =
    stored?.type === 'image'
      ? unifiedSliderFromStored(
          Number.isFinite(Number(stored.darken)) ? Number(stored.darken) : 0,
          Number.isFinite(Number(stored.brightness)) ? Number(stored.brightness) : 100,
        )
      : 50;
  const storedBlurSharp =
    stored?.type === 'image' && Number.isFinite(Number(stored.blurSharp))
      ? clampBg(Number(stored.blurSharp), 0, 100)
      : 50;

  let newFileDataUrl = null;
  let stripExistingFileBg = false;

  const overlay = document.createElement('div');
  overlay.id = 'schedule-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box modal-form">
      <h3 class="modal-title">Фон екрана</h3>
      <p class="modal-hint">Колір, посилання на зображення або файл із галереї / комп’ютера</p>
      <div class="bg-options">
        <label class="modal-label">Колір</label>
        <div class="bg-color-row">
          <input type="color" id="modal-bg-color" value="${stored?.type === 'color' ? stored.value : '#1a1f35'}" class="modal-color-input" />
          <input type="text" id="modal-bg-color-hex" class="modal-input modal-input-inline" placeholder="#1a1f35" maxlength="7" value="${stored?.type === 'color' ? stored.value : ''}" />
        </div>
        <label class="modal-label" style="margin-top:16px">Зображення з телефону чи ПК</label>
        <div class="bg-file-row">
          <input type="file" id="modal-bg-file" class="modal-file-input" accept="image/*" tabindex="-1" aria-hidden="true" />
          <button type="button" class="modal-btn modal-btn-secondary modal-btn-file" id="modal-bg-file-trigger">Обрати зображення</button>
          <span class="bg-file-hint" id="modal-bg-file-hint"></span>
        </div>
        <label class="modal-label" style="margin-top:16px">Зображення (URL)</label>
        <input type="url" id="modal-bg-image" class="modal-input" placeholder="https://..." value="${escapeHtml(initialImageUrl)}" />
        <p class="modal-hint modal-hint-sm" style="margin-top:8px">Тут ви можете завантажити зображення через посилання</p>
        <div id="modal-bg-preview-wrap" class="bg-preview-wrap" hidden>
          <div class="bg-preview-stage">
            <img id="modal-bg-preview-img" class="bg-preview-img" alt="" />
            <div id="modal-bg-preview-shade" class="bg-preview-shade"></div>
          </div>
          <button type="button" class="modal-btn-text" id="modal-bg-remove-file">Прибрати фото</button>
        </div>
        <div id="modal-bg-adjust" class="bg-adjust-wrap" hidden>
          <label class="modal-label" for="modal-bg-dark-bright">Затемнення / яскравість</label>
          <div class="bg-adjust-row">
            <input type="range" id="modal-bg-dark-bright" class="bg-adjust-slider" min="0" max="100" value="${storedUnified}" />
            <span id="modal-bg-dark-bright-val" class="bg-adjust-value bg-adjust-value--wide">${escapeHtml(formatDarkBrightLabel(storedUnified))}</span>
          </div>
          <label class="modal-label" for="modal-bg-blur-sharp">Розмиття / різкість</label>
          <div class="bg-adjust-row">
            <input type="range" id="modal-bg-blur-sharp" class="bg-adjust-slider" min="0" max="100" value="${storedBlurSharp}" />
            <span id="modal-bg-blur-sharp-val" class="bg-adjust-value bg-adjust-value--wide">${escapeHtml(formatBlurSharpLabel(storedBlurSharp))}</span>
          </div>
        </div>
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
  const fileInput = overlay.querySelector('#modal-bg-file');
  const fileTrigger = overlay.querySelector('#modal-bg-file-trigger');
  const fileHint = overlay.querySelector('#modal-bg-file-hint');
  const previewWrap = overlay.querySelector('#modal-bg-preview-wrap');
  const previewImg = overlay.querySelector('#modal-bg-preview-img');
  const previewShade = overlay.querySelector('#modal-bg-preview-shade');
  const adjustWrap = overlay.querySelector('#modal-bg-adjust');
  const darkBrightRange = overlay.querySelector('#modal-bg-dark-bright');
  const blurSharpRange = overlay.querySelector('#modal-bg-blur-sharp');
  const darkBrightValEl = overlay.querySelector('#modal-bg-dark-bright-val');
  const blurSharpValEl = overlay.querySelector('#modal-bg-blur-sharp-val');
  const removeFileBtn = overlay.querySelector('#modal-bg-remove-file');
  const errorEl = overlay.querySelector('#modal-bg-error');

  const syncModalPreviewAdjust = () => {
    const u = readUnifiedDarkBrightSlider(darkBrightRange);
    const { darken: d, brightness: br } = darkBrightFromUnifiedSlider(u);
    const bs = readBlurSharpSlider(blurSharpRange);
    darkBrightValEl.textContent = formatDarkBrightLabel(u);
    blurSharpValEl.textContent = formatBlurSharpLabel(bs);
    if (!previewWrap.hidden && previewImg.getAttribute('src')) {
      previewImg.style.filter = buildBgImageFilter(br, bs);
      previewShade.style.backgroundColor = `rgba(0,0,0,${d / 100})`;
    }
  };

  const refreshAdjustVisibility = () => {
    const urlOk = /^https?:\/\//i.test(imageInput.value.trim());
    const hasPreview = !previewWrap.hidden && !!previewImg.getAttribute('src');
    adjustWrap.hidden = !(urlOk || hasPreview);
  };

  const showPreview = (src) => {
    previewImg.src = src;
    previewWrap.hidden = false;
    syncModalPreviewAdjust();
    refreshAdjustVisibility();
  };
  const hidePreview = () => {
    previewWrap.hidden = true;
    previewImg.removeAttribute('src');
    previewImg.style.filter = '';
    previewShade.style.backgroundColor = 'rgba(0,0,0,0)';
    refreshAdjustVisibility();
  };

  if (existingFileDataUrl) {
    previewImg.onload = () => {
      syncModalPreviewAdjust();
      refreshAdjustVisibility();
    };
    previewImg.onerror = () => {
      hidePreview();
      refreshAdjustVisibility();
    };
    previewImg.src = existingFileDataUrl;
    previewWrap.hidden = false;
    syncModalPreviewAdjust();
    refreshAdjustVisibility();
    fileHint.textContent = 'Зараз використовується зображення з файлу';
  } else if (initialImageUrl) {
    previewImg.onload = () => {
      syncModalPreviewAdjust();
      refreshAdjustVisibility();
    };
    previewImg.onerror = () => {
      hidePreview();
      refreshAdjustVisibility();
    };
    previewImg.src = initialImageUrl;
    previewWrap.hidden = false;
    syncModalPreviewAdjust();
    refreshAdjustVisibility();
  } else {
    refreshAdjustVisibility();
  }

  darkBrightRange.addEventListener('input', () => {
    syncModalPreviewAdjust();
  });
  blurSharpRange.addEventListener('input', () => {
    syncModalPreviewAdjust();
  });

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

  fileTrigger.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    errorEl.style.display = 'none';
    fileHint.textContent = 'Обробка…';
    try {
      newFileDataUrl = await imageFileToStoredDataUrl(f);
      stripExistingFileBg = false;
      imageInput.value = '';
      showPreview(newFileDataUrl);
      fileHint.textContent = f.name ? `Обрано: ${f.name}` : 'Файл обрано';
      refreshAdjustVisibility();
    } catch (err) {
      newFileDataUrl = null;
      fileHint.textContent = '';
      errorEl.textContent = err.message || 'Не вдалося обробити файл';
      errorEl.style.display = 'block';
      refreshAdjustVisibility();
    }
  });

  imageInput.addEventListener('input', () => {
    const v = imageInput.value.trim();
    if (v) {
      newFileDataUrl = null;
      stripExistingFileBg = true;
      fileHint.textContent = '';
      if (/^https?:\/\//i.test(v)) {
        previewImg.onload = () => {
          syncModalPreviewAdjust();
          refreshAdjustVisibility();
        };
        previewImg.onerror = () => {
          hidePreview();
          refreshAdjustVisibility();
          syncModalPreviewAdjust();
        };
        previewImg.src = v;
        previewWrap.hidden = false;
      } else {
        hidePreview();
      }
    } else {
      hidePreview();
    }
    refreshAdjustVisibility();
    syncModalPreviewAdjust();
  });

  removeFileBtn.addEventListener('click', () => {
    newFileDataUrl = null;
    stripExistingFileBg = true;
    hidePreview();
    fileHint.textContent = '';
    refreshAdjustVisibility();
  });

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

      const saveImage = (value) => {
        const u = readUnifiedDarkBrightSlider(darkBrightRange);
        const { darken, brightness } = darkBrightFromUnifiedSlider(u);
        const blurSharp = readBlurSharpSlider(blurSharpRange);
        const payload = { type: 'image', value, darken, brightness, blurSharp };
        try {
          localStorage.setItem(BG_STORAGE_KEY, JSON.stringify(payload));
          applyBackground(payload);
          closeModals();
          showToast('Фон застосовано');
        } catch (err) {
          if (err?.name === 'QuotaExceededError') {
            errorEl.textContent = 'Недостатньо місця в браузері. Спробуйте менше зображення або посилання.';
          } else {
            errorEl.textContent = 'Не вдалося зберегти фон';
          }
          errorEl.style.display = 'block';
        }
      };

      if (newFileDataUrl) {
        saveImage(newFileDataUrl);
        return;
      }
      if (imageUrl) {
        if (!/^https?:\/\//i.test(imageUrl)) {
          errorEl.textContent = 'Введіть коректне посилання (https://…)';
          errorEl.style.display = 'block';
          return;
        }
        saveImage(imageUrl);
        return;
      }
      if (existingFileDataUrl && !stripExistingFileBg) {
        saveImage(existingFileDataUrl);
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
        errorEl.textContent =
          'Оберіть колір, файл зображення або посилання https://…';
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

/** Дні тижня — іменний відмінок (Intl для uk часто дає форму з прийменником / не іменний). */
const UK_WEEKDAY_NOMINATIVE = [
  'неділя',
  'понеділок',
  'вівторок',
  'середа',
  'четвер',
  "п'ятниця",
  'субота',
];

/** Місяці — родовий відмінок для «24 березня». */
const UK_MONTH_GENITIVE = [
  'січня',
  'лютого',
  'березня',
  'квітня',
  'травня',
  'червня',
  'липня',
  'серпня',
  'вересня',
  'жовтня',
  'листопада',
  'грудня',
];

/** Підзаголовок під «Розклад» — завжди реальна сьогоднішня дата пристрою (не дата з календаря розкладу). */
function setHeaderTodayDateLabel() {
  const d = new Date();
  const weekday = UK_WEEKDAY_NOMINATIVE[d.getDay()];
  const day = d.getDate();
  const month = UK_MONTH_GENITIVE[d.getMonth()];
  const year = d.getFullYear();
  dateLabel.textContent = `${weekday}, ${day} ${month} ${year} р.`;
}

async function loadSchedule(date) {
  setHeaderTodayDateLabel();
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
    setHeaderTodayDateLabel();
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
  stampLessonCardEnter(card);
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
    stampLessonCardEnter(card);
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
  stampLessonCardEnter(wrap);
}

function renderSchedule(date, lessons) {
  setHeaderTodayDateLabel();
  currentScheduleDate = date || '';
  scheduleContainer.innerHTML = '';
  scheduleCardEnterIndex = 0;

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

  if (!adminMode && list.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'state-message empty schedule-empty-day';
    msg.textContent = emptyDayScheduleMessage(date);
    scheduleContainer.appendChild(msg);
  }
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
/** Текст нагадування з GET /api/reminder */
let reminderText = '';
/** Час останньої зміни на сервері (ms) — для непрочитаного */
let reminderUpdatedAt = 0;
/** Після першого запиту /api/reminder (щоб у звичайному режимі не миготіла кнопка до відповіді) */
let reminderFetchSettled = false;

const REMINDER_SEEN_KEY = 'schedule_app_reminder_seen_ts';

function getReminderSeenTs() {
  try {
    const n = parseInt(localStorage.getItem(REMINDER_SEEN_KEY) || '0', 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function markReminderSeen() {
  if (!reminderUpdatedAt) return;
  try {
    localStorage.setItem(REMINDER_SEEN_KEY, String(reminderUpdatedAt));
  } catch (_) {}
}

/** Кожен рядок тексту — окремий абзац (новий рядок у редакторі = новий блок) */
function fillReminderReadonlyBody(el, text) {
  if (!el) return;
  el.textContent = '';
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line) => {
    const p = document.createElement('p');
    p.className = 'reminder-readonly-para';
    if (line === '') {
      p.classList.add('reminder-readonly-para--empty');
      p.textContent = '\u00A0';
    } else {
      p.textContent = line;
    }
    el.appendChild(p);
  });
}

function isReminderUnreadForUser() {
  if (adminMode) return false;
  if (!reminderText || !reminderText.trim()) return false;
  if (!reminderUpdatedAt) return false;
  return reminderUpdatedAt > getReminderSeenTs();
}

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

// --------- Дні народження ---------
let birthdaysList = [];

function padBirthdayNum(n) {
  return String(n).padStart(2, '0');
}

function normalizeBirthdayEntry(raw) {
  const m = parseInt(String(raw?.month), 10);
  const d = parseInt(String(raw?.day), 10);
  const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > 200 || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { month: m, day: d, name };
}

async function loadBirthdaysJson() {
  try {
    const r = await fetch('/api/birthdays', { cache: 'no-store' });
    if (!r.ok) return;
    const data = await r.json();
    const arr = Array.isArray(data?.birthdays) ? data.birthdays : [];
    birthdaysList = arr.map(normalizeBirthdayEntry).filter(Boolean);
  } catch (_) {
    birthdaysList = [];
  }
}

async function saveBirthdaysListToServer(list) {
  const errEl = document.getElementById('birthdays-admin-error');
  if (errEl) {
    errEl.style.display = 'none';
    errEl.textContent = '';
  }
  try {
    const res = await fetch('/api/admin/birthdays', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': storedAdminPassword,
      },
      body: JSON.stringify({ birthdays: list }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error || 'Не вдалося зберегти';
      if (errEl) {
        errEl.textContent = msg;
        errEl.style.display = 'block';
      } else {
        showToast(msg);
      }
      return false;
    }
    const arr = Array.isArray(data.birthdays) ? data.birthdays : list;
    birthdaysList = arr.map(normalizeBirthdayEntry).filter(Boolean);
    return true;
  } catch (_) {
    const msg = 'Немає звʼязку з сервером';
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }
    showToast(msg);
    return false;
  }
}

async function birthdaysAdminSubmitAdd() {
  if (!adminMode || !storedAdminPassword) return;
  const dayEl = document.getElementById('birthdays-admin-day');
  const monthEl = document.getElementById('birthdays-admin-month');
  const nameEl = document.getElementById('birthdays-admin-name');
  const errEl = document.getElementById('birthdays-admin-error');
  if (errEl) {
    errEl.style.display = 'none';
    errEl.textContent = '';
  }
  const entry = normalizeBirthdayEntry({
    day: dayEl?.value,
    month: monthEl?.value,
    name: nameEl?.value,
  });
  if (!entry) {
    if (errEl) {
      errEl.textContent =
        'Вкажіть день (1–31), місяць (1–12) і прізвище та імʼя (до 200 символів).';
      errEl.style.display = 'block';
    }
    return;
  }
  const dup = birthdaysList.some(
    (b) => b.month === entry.month && b.day === entry.day && b.name === entry.name,
  );
  if (dup) {
    if (errEl) {
      errEl.textContent = 'Такий запис уже є в списку.';
      errEl.style.display = 'block';
    }
    return;
  }
  const next = [...birthdaysList, entry];
  const ok = await saveBirthdaysListToServer(next);
  if (!ok) return;
  if (dayEl) dayEl.value = '';
  if (monthEl) monthEl.value = '';
  if (nameEl) nameEl.value = '';
  renderBirthdaysPageContent();
  updateBirthdayHomeNotice();
  showToast('День народження додано');
}

async function birthdaysAdminRemove(entry) {
  if (!adminMode || !storedAdminPassword) return;
  const v = normalizeBirthdayEntry(entry);
  if (!v) return;
  const next = birthdaysList.filter(
    (b) => !(b.month === v.month && b.day === v.day && b.name === v.name),
  );
  if (next.length === birthdaysList.length) return;
  const ok = await saveBirthdaysListToServer(next);
  if (!ok) return;
  renderBirthdaysPageContent();
  updateBirthdayHomeNotice();
  showToast('Запис видалено');
}

function sortBirthdaysChrono(items) {
  return [...items].sort((a, b) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name, 'uk'));
}

function birthdaysOnCalendarDay(month, day) {
  return birthdaysList.filter((b) => b.month === month && b.day === day);
}

function todayLocalMd() {
  const x = new Date();
  return { month: x.getMonth() + 1, day: x.getDate() };
}

function tomorrowLocalMd() {
  const x = new Date();
  x.setDate(x.getDate() + 1);
  return { month: x.getMonth() + 1, day: x.getDate() };
}

/** Текст рядків «Сьогодні» / «Завтра день народження» для головної панелі та сторінки ДН. */
function getBirthdayUpcomingLinesHtml() {
  if (!birthdaysList.length) return { html: '', hasAny: false };
  const t = todayLocalMd();
  const tm = tomorrowLocalMd();
  const todayNames = birthdaysOnCalendarDay(t.month, t.day);
  const tomorrowNames = birthdaysOnCalendarDay(tm.month, tm.day);
  if (!todayNames.length && !tomorrowNames.length) return { html: '', hasAny: false };
  const blocks = [];
  if (todayNames.length) {
    const joined = todayNames.map((n) => n.name).join(', ');
    blocks.push(`<p class="birthdays-page__upcoming-line">Сьогодні: ${escapeHtml(joined)}</p>`);
  }
  if (tomorrowNames.length) {
    const joined = tomorrowNames.map((n) => n.name).join(', ');
    blocks.push(`<p class="birthdays-page__upcoming-line">Завтра день народження: ${escapeHtml(joined)}</p>`);
  }
  return { html: blocks.join(''), hasAny: true };
}

function updateBirthdayHomeNotice() {
  const root = document.getElementById('birthday-home-notice');
  const inner = document.getElementById('birthday-home-notice-inner');
  if (!root || !inner) return;
  const { html, hasAny } = getBirthdayUpcomingLinesHtml();
  if (!hasAny) {
    root.hidden = true;
    inner.innerHTML = '';
    return;
  }
  inner.innerHTML = html;
  root.hidden = false;
}

async function openBirthdaysPageWithLoad() {
  await loadBirthdaysJson();
  if (!birthdaysList.length && !adminMode) {
    showToast('Не вдалося завантажити дні народження або список порожній');
    return;
  }
  showBirthdaysPage();
}

function isBirthdaysPageVisible() {
  const p = document.getElementById('birthdays-page');
  return Boolean(p && !p.hidden);
}

function renderBirthdaysPageContent() {
  const listEl = document.getElementById('birthdays-page-list');
  const upcomingEl = document.getElementById('birthdays-page-upcoming');
  if (!listEl || !upcomingEl) return;

  if (!birthdaysList.length) {
    listEl.innerHTML = adminMode
      ? '<p class="birthdays-page__empty">Список порожній. Додайте запис у формі вище.</p>'
      : '<p class="birthdays-page__empty">Немає записів.</p>';
  } else {
    const sorted = sortBirthdaysChrono(birthdaysList);
    listEl.innerHTML = sorted
      .map((b) => {
        const payload = encodeURIComponent(JSON.stringify({ month: b.month, day: b.day, name: b.name }));
        const delBtn = adminMode
          ? `<button type="button" class="birthdays-list__delete" data-birthday-entry="${payload}" aria-label="Видалити запис">Видалити</button>`
          : '';
        return `<div class="birthdays-list__row birthdays-list__row--with-actions" role="listitem"><span class="birthdays-list__date">${escapeHtml(
          padBirthdayNum(b.day),
        )}.${escapeHtml(padBirthdayNum(b.month))}</span><span class="birthdays-list__name">${escapeHtml(b.name)}</span>${delBtn}</div>`;
      })
      .join('');
  }

  const { html, hasAny } = getBirthdayUpcomingLinesHtml();
  if (!hasAny) {
    upcomingEl.hidden = true;
    upcomingEl.innerHTML = '';
  } else {
    upcomingEl.innerHTML = html;
    upcomingEl.hidden = false;
  }
}

function isWeatherPageVisible() {
  const p = document.getElementById('weather-page');
  return Boolean(p && !p.hidden);
}

function scheduleSubpageEscapeHandler(e) {
  if (e.key !== 'Escape') return;
  if (isWeatherPageVisible()) {
    const dim = document.getElementById('weather-search-dim');
    if (dim && dim.classList.contains('weather-search-dim--visible')) {
      closeWeatherSearchOverlay();
      e.preventDefault();
      return;
    }
    hideWeatherPage();
    return;
  }
  if (isBirthdaysPageVisible()) hideBirthdaysPage();
}

/** Київ — Open-Meteo WMO weathercode → короткий опис українською */
const WMO_WEATHER_UK = {
  0: 'Ясно',
  1: 'Майже ясно',
  2: 'Хмарно',
  3: 'Похмуро',
  45: 'Туман',
  48: 'Туман з інеєм',
  51: 'Мряка',
  53: 'Мряка',
  55: 'Мряка',
  56: 'Морозна мряка',
  57: 'Морозна мряка',
  61: 'Дощ',
  63: 'Дощ',
  65: 'Сильний дощ',
  66: 'Крижаний дощ',
  67: 'Крижаний дощ',
  71: 'Сніг',
  73: 'Сніг',
  75: 'Сильний сніг',
  77: 'Сніжинки',
  80: 'Зливи',
  81: 'Зливи',
  82: 'Сильні зливи',
  85: 'Снігові зливи',
  86: 'Снігові зливи',
  95: 'Гроза',
  96: 'Гроза з градом',
  99: 'Гроза з градом',
};

function wmoWeatherLabel(code) {
  const c = Number(code);
  return WMO_WEATHER_UK[c] || 'Невідомо';
}

const KYIV_LAT = 50.4501;
const KYIV_LON = 30.5234;

const WEATHER_LOC_KEY = 'tg_schedule_weather_location_v1';

function defaultWeatherLocation() {
  return {
    lat: KYIV_LAT,
    lon: KYIV_LON,
    label: 'Київ',
    source: 'default',
  };
}

function readWeatherLocation() {
  try {
    const raw = localStorage.getItem(WEATHER_LOC_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    const lat = Number(o.lat);
    const lon = Number(o.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : 'Обране місце';
    return { lat, lon, label, source: o.source || 'saved' };
  } catch (_) {
    return null;
  }
}

function writeWeatherLocation({ lat, lon, label, source }) {
  try {
    localStorage.setItem(
      WEATHER_LOC_KEY,
      JSON.stringify({
        lat,
        lon,
        label,
        source: source || 'saved',
      }),
    );
  } catch (_) {}
}

/** Сьогодні YYYY-MM-DD у заданому часовому поясі (як у відповіді Open-Meteo). */
function localTodayIso(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    return y && m && d ? `${y}-${m}-${d}` : '';
  } catch (_) {
    return '';
  }
}

function formatDayHeaderUk(dayStr, timeZone) {
  const [y, m, d] = dayStr.split('-').map(Number);
  if (!y || !m || !d) return dayStr;
  const utc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  try {
    return new Intl.DateTimeFormat('uk-UA', {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(utc);
  } catch (_) {
    return new Date(`${dayStr}T12:00:00`).toLocaleDateString('uk-UA', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }
}

function setWeatherHeaderTitle(label) {
  const el = document.getElementById('weather-page-title');
  const sub = document.getElementById('weather-page-subtitle');
  const short = label ? weatherPlaceTitleShort(label) : '';
  if (el) el.textContent = short || 'Погода';
  if (sub) {
    sub.textContent = 'Прогноз на 7 днів';
  }
}

function showWeatherPageMessage(text, isError) {
  const el = document.getElementById('weather-page-msg');
  if (!el) return;
  if (!text) {
    el.textContent = '';
    el.hidden = true;
    el.classList.remove('weather-page__msg--error');
    return;
  }
  el.textContent = text;
  el.hidden = false;
  el.classList.toggle('weather-page__msg--error', !!isError);
}

function formatGeoResult(r) {
  const parts = [r.name];
  if (r.admin1) parts.push(r.admin1);
  if (r.country) parts.push(r.country);
  return parts.join(', ');
}

/** Назва міста / пункту для заголовка та збереження (лише `name` з API). */
function geoPlaceNameOnly(r) {
  if (!r || typeof r !== 'object') return '';
  const n = typeof r.name === 'string' ? r.name.trim() : '';
  return n || formatGeoResult(r);
}

/** Старі збереження могли мати «Київ, область, країна» — для заголовка беремо лише перший фрагмент. */
function weatherPlaceTitleShort(label) {
  if (!label || typeof label !== 'string') return '';
  const t = label.trim();
  if (!t) return '';
  const i = t.indexOf(',');
  if (i === -1) return t;
  const first = t.slice(0, i).trim();
  return first || t;
}

/** Другий рядок у картці пошуку: область · країна (без повтору назви). */
function geoResultSubtitle(r) {
  if (!r || typeof r !== 'object') return '';
  const parts = [];
  if (r.admin1) parts.push(String(r.admin1).trim());
  if (r.country) parts.push(String(r.country).trim());
  return parts.filter(Boolean).join(' · ');
}

async function searchGeocoding(query) {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', q);
  url.searchParams.set('count', '10');
  url.searchParams.set('language', 'uk');
  url.searchParams.set('format', 'json');
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
}

/** Назва місця за координатами (клієнтський API без ключа). */
async function reverseGeocodeLabel(lat, lon) {
  try {
    const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('localityLanguage', 'uk');
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    const city = j.city || j.locality || j.principalSubdivision || '';
    const line = typeof city === 'string' ? city.trim() : '';
    return line || 'Моє розташування';
  } catch (_) {
    return 'Моє розташування';
  }
}

let weatherSearchSeq = 0;
let weatherSearchDebounceTimer;
/** true після вибору пункту зі списку — щоб при blur не стерти поле до вибору */
let weatherSearchPickedThisSession = false;

function hideWeatherSearchResults() {
  const panel = document.getElementById('weather-search-results');
  if (panel) {
    panel.hidden = true;
    panel.innerHTML = '';
  }
  updateWeatherSearchDim();
}

/** Закрити пошук: стерти текст, прибрати розмиття, показати знову «Тут». */
function closeWeatherSearchOverlay() {
  const input = document.getElementById('weather-search-input');
  if (input) input.value = '';
  weatherSearchPickedThisSession = false;
  hideWeatherSearchResults();
  if (input) {
    try {
      input.blur();
    } catch (_) {}
  }
  updateWeatherSearchDim();
}

/** Розмиття решти сторінки, коли активний пошук (фокус / введення / відкриті результати). */
function updateWeatherSearchDim() {
  const dim = document.getElementById('weather-search-dim');
  const input = document.getElementById('weather-search-input');
  const results = document.getElementById('weather-search-results');
  const locateBtn = document.getElementById('weather-locate-btn');
  const exitBtn = document.getElementById('weather-search-exit-btn');
  const toolbarSwitch =
    locateBtn?.closest('.weather-toolbar-switch') ||
    exitBtn?.closest('.weather-toolbar-switch') ||
    null;
  if (!dim || !input) return;
  const typing = input.value.trim().length >= 1;
  const focused = document.activeElement === input;
  const hasResultsOpen = Boolean(results && !results.hidden && results.childElementCount > 0);
  const show = focused || typing || hasResultsOpen;
  dim.classList.toggle('weather-search-dim--visible', show);
  dim.setAttribute('aria-hidden', show ? 'false' : 'true');
  if (toolbarSwitch) toolbarSwitch.classList.toggle('weather-toolbar-switch--search', show);
  if (locateBtn) {
    locateBtn.classList.toggle('weather-toolbar-switch__btn--hidden', show);
    locateBtn.setAttribute('aria-hidden', show ? 'true' : 'false');
    locateBtn.tabIndex = show ? -1 : 0;
  }
  if (exitBtn) {
    exitBtn.classList.toggle('weather-toolbar-switch__btn--hidden', !show);
    exitBtn.setAttribute('aria-hidden', !show ? 'true' : 'false');
    exitBtn.tabIndex = !show ? -1 : 0;
  }
}

/** Великі градуси справа: візуальне центрування лише по цифрах; «°» не зміщує центр */
function weatherNowTempDigitsHtml(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return '—';
  return `<span class="weather-now__numwrap"><span class="weather-now__num">${escapeHtml(String(n))}</span><span class="weather-now__deg" aria-hidden="true">°</span></span>`;
}

async function loadWeatherForecast() {
  const body = document.getElementById('weather-page-body');
  if (!body) return;
  showWeatherPageMessage('');
  const loc = readWeatherLocation() || defaultWeatherLocation();
  setWeatherHeaderTitle(loc.label);
  body.innerHTML =
    '<p class="weather-page__state" id="weather-page-state">Завантаження…</p>';
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(loc.lat));
    url.searchParams.set('longitude', String(loc.lon));
    url.searchParams.set(
      'daily',
      'weathercode,temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_probability_max',
    );
    url.searchParams.set('hourly', 'temperature_2m');
    url.searchParams.set('current', 'temperature_2m,weather_code');
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', '7');
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const daily = data?.daily;
    const times = daily?.time;
    if (!Array.isArray(times) || !times.length) throw new Error('no daily');
    const codes = daily.weathercode || [];
    const tMax = daily.temperature_2m_max || [];
    const tMin = daily.temperature_2m_min || [];
    const tMean = daily.temperature_2m_mean || [];
    const precip = daily.precipitation_probability_max || [];

    const hTimes = data?.hourly?.time || [];
    const hTemps = data?.hourly?.temperature_2m || [];

    function medianRounded(nums) {
      if (!nums.length) return null;
      const s = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      const v = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      return Math.round(v);
    }

    /** Погодинні значення за календарний день (локальний час прогнозу). */
    function tempsForCalendarDay(dayStr) {
      const list = [];
      for (let j = 0; j < hTimes.length; j++) {
        const t = hTimes[j];
        if (typeof t !== 'string' || t.length < 10) continue;
        if (t.slice(0, 10) !== dayStr) continue;
        const v = hTemps[j];
        if (Number.isFinite(Number(v))) list.push(Number(v));
      }
      return list;
    }

    /**
     * Найімовірніша температура за добу: медіана погодинних значень
     * (типовий день без акценту на «середню» арифметично).
     * Якщо погодинних даних немає — добова середня з API, далі (макс+мін)/2.
     */
    function dayMostLikelyTempRounded(i) {
      const dayStr = times[i];
      const fromHourly = medianRounded(tempsForCalendarDay(dayStr));
      if (fromHourly !== null) return fromHourly;
      const m = tMean[i];
      if (Number.isFinite(Number(m))) return Math.round(Number(m));
      const hi = tMax[i];
      const lo = tMin[i];
      if (Number.isFinite(Number(hi)) && Number.isFinite(Number(lo))) {
        return Math.round((Number(hi) + Number(lo)) / 2);
      }
      return null;
    }

    const cur = data?.current;
    const curTemp = cur?.temperature_2m;
    const tz = data?.timezone || 'UTC';
    const todayIso = localTodayIso(tz);
    const placeLabel = weatherPlaceTitleShort(loc.label) || loc.label;

    body.innerHTML = '';
    times.forEach((dayStr, i) => {
      const dateLine = formatDayHeaderUk(dayStr, tz);
      const code = codes[i];
      const desc = wmoWeatherLabel(code);
      const hi = tMax[i];
      const lo = tMin[i];
      const pr = precip[i];
      const hiT = Number.isFinite(Number(hi)) ? `${Math.round(Number(hi))}°` : '—';
      const loT = Number.isFinite(Number(lo)) ? `${Math.round(Number(lo))}°` : '—';
      let rainLine = '';
      if (Number.isFinite(Number(pr))) {
        rainLine = `<div class="weather-day__rain">Ймовірність опадів: ${Math.round(Number(pr))}%</div>`;
      }

      const isToday = todayIso && dayStr === todayIso;
      let nowBlock = '';
      if (isToday && Number.isFinite(Number(curTemp))) {
        nowBlock = `<aside class="weather-day__now" aria-label="Погода зараз: ${escapeHtml(placeLabel)}">
          <div class="weather-now__temp">${weatherNowTempDigitsHtml(curTemp)}</div>
          <div class="weather-now__desc weather-now__desc--likely">температура зараз</div>
        </aside>`;
      } else if (isToday) {
        nowBlock =
          '<aside class="weather-day__now weather-day__now--empty" aria-hidden="true"><span class="weather-now__muted">—</span></aside>';
      } else {
        const likelyRounded = dayMostLikelyTempRounded(i);
        if (likelyRounded !== null) {
          nowBlock = `<aside class="weather-day__now weather-day__now--forecast" aria-label="Ймовірна температура">
            <div class="weather-now__temp">${weatherNowTempDigitsHtml(likelyRounded)}</div>
            <div class="weather-now__desc weather-now__desc--likely">ймовірна температура</div>
          </aside>`;
        } else {
          nowBlock =
            '<aside class="weather-day__now weather-day__now--empty" aria-hidden="true"><span class="weather-now__muted">—</span></aside>';
        }
      }

      const card = document.createElement('div');
      card.className = 'weather-day';
      card.innerHTML = `
        <div class="weather-day__main">
          <div class="weather-day__date">${escapeHtml(dateLine)}</div>
          <div class="weather-day__desc">${escapeHtml(desc)}</div>
          <div class="weather-day__temps">${escapeHtml(hiT)} / ${escapeHtml(loT)} <span class="weather-day__temps-note">(макс / мін)</span></div>
          ${rainLine}
        </div>
        ${nowBlock}
      `;
      body.appendChild(card);
    });
  } catch (_) {
    body.innerHTML = `<p class="weather-page__state weather-page__state--error" id="weather-page-state">Не вдалося завантажити прогноз. Перевірте інтернет.</p>`;
  }
}

function initWeatherPageControls() {
  const input = document.getElementById('weather-search-input');
  const resultsPanel = document.getElementById('weather-search-results');
  const locateBtn = document.getElementById('weather-locate-btn');
  const dim = document.getElementById('weather-search-dim');
  if (!input || !resultsPanel) return;

  if (dim) {
    dim.addEventListener('click', () => closeWeatherSearchOverlay());
  }

  const exitBtn = document.getElementById('weather-search-exit-btn');
  if (exitBtn) {
    exitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeWeatherSearchOverlay();
    });
  }

  const runSearch = async () => {
    const q = input.value;
    if (q.trim().length < 2) {
      hideWeatherSearchResults();
      return;
    }
    const seq = ++weatherSearchSeq;
    try {
      const results = await searchGeocoding(q);
      if (seq !== weatherSearchSeq) return;
      resultsPanel.innerHTML = '';
      if (!results.length) {
        const empty = document.createElement('div');
        empty.className = 'weather-search-results__empty';
        empty.textContent = 'Нічого не знайдено. Спробуйте іншу назву.';
        resultsPanel.appendChild(empty);
        resultsPanel.hidden = false;
        updateWeatherSearchDim();
        return;
      }
      results.forEach((r) => {
        const titleShort = geoPlaceNameOnly(r);
        const sub = geoResultSubtitle(r);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'weather-search-card';
        btn.setAttribute('aria-label', formatGeoResult(r));
        btn.dataset.lat = String(r.latitude);
        btn.dataset.lon = String(r.longitude);
        btn.dataset.label = titleShort;

        const titleEl = document.createElement('span');
        titleEl.className = 'weather-search-card__title';
        titleEl.textContent = titleShort || r.name || '—';

        const metaEl = document.createElement('span');
        metaEl.className = 'weather-search-card__meta';
        metaEl.textContent = sub;
        metaEl.hidden = !sub;

        btn.appendChild(titleEl);
        btn.appendChild(metaEl);

        const pick = () => {
          weatherSearchPickedThisSession = true;
          hideWeatherSearchResults();
          input.value = '';
          writeWeatherLocation({
            lat: r.latitude,
            lon: r.longitude,
            label: titleShort,
            source: 'search',
          });
          setWeatherHeaderTitle(titleShort);
          loadWeatherForecast();
        };
        btn.addEventListener('mousedown', () => {
          weatherSearchPickedThisSession = true;
        });
        btn.addEventListener('click', pick);
        resultsPanel.appendChild(btn);
      });
      resultsPanel.hidden = false;
      updateWeatherSearchDim();
    } catch (_) {
      if (seq !== weatherSearchSeq) return;
      resultsPanel.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'weather-search-results__empty';
      empty.textContent = 'Не вдалося підвантажити пошук. Перевірте інтернет.';
      resultsPanel.appendChild(empty);
      resultsPanel.hidden = false;
      updateWeatherSearchDim();
    }
  };

  input.addEventListener('input', () => {
    updateWeatherSearchDim();
    clearTimeout(weatherSearchDebounceTimer);
    weatherSearchDebounceTimer = setTimeout(runSearch, 320);
  });

  input.addEventListener('focus', () => {
    weatherSearchPickedThisSession = false;
    updateWeatherSearchDim();
    if (input.value.trim().length >= 2 && resultsPanel.childElementCount) resultsPanel.hidden = false;
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (weatherSearchPickedThisSession) {
        updateWeatherSearchDim();
        return;
      }
      const ae = document.activeElement;
      if (resultsPanel && ae && resultsPanel.contains(ae)) {
        updateWeatherSearchDim();
        return;
      }
      input.value = '';
      updateWeatherSearchDim();
    }, 220);
  });

  if (locateBtn) {
    locateBtn.addEventListener('click', async () => {
      if (!navigator.geolocation) {
        showWeatherPageMessage('Геолокація не підтримується цим браузером.', true);
        return;
      }
      showWeatherPageMessage('');
      locateBtn.disabled = true;
      locateBtn.setAttribute('aria-busy', 'true');
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 22000,
            maximumAge: 60000,
          });
        });
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const label = await reverseGeocodeLabel(lat, lon);
        writeWeatherLocation({ lat, lon, label, source: 'geo' });
        setWeatherHeaderTitle(label);
        hideWeatherSearchResults();
        await loadWeatherForecast();
      } catch (e) {
        const denied = e && (e.code === 1 || e.code === '1');
        showWeatherPageMessage(
          denied
            ? 'Доступ до геолокації заборонено. Дозвольте доступ у налаштуваннях або оберіть місце вручну.'
            : 'Не вдалося визначити місцезнаходження. Спробуйте кнопку «Тут» ще раз або оберіть місто в пошуку.',
          true,
        );
      } finally {
        locateBtn.disabled = false;
        locateBtn.removeAttribute('aria-busy');
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (!isWeatherPageVisible()) return;
    const wrap = input.closest('.weather-page__search');
    if (wrap && !wrap.contains(e.target)) hideWeatherSearchResults();
  });

  updateWeatherSearchDim();
}

function hideWeatherPage() {
  window.removeEventListener('keydown', scheduleSubpageEscapeHandler);
  const sv = document.getElementById('schedule-view');
  const wp = document.getElementById('weather-page');
  if (sv) sv.hidden = false;
  if (wp) wp.hidden = true;
}

async function showWeatherPage() {
  const sv = document.getElementById('schedule-view');
  const wp = document.getElementById('weather-page');
  if (!sv || !wp) return;
  closeReminderPopover();
  document.getElementById('schedule-modal-overlay')?.remove();
  if (isBirthdaysPageVisible()) hideBirthdaysPage();
  sv.hidden = true;
  wp.hidden = false;
  window.removeEventListener('keydown', scheduleSubpageEscapeHandler);
  window.addEventListener('keydown', scheduleSubpageEscapeHandler);
  try {
    window.scrollTo(0, 0);
  } catch (_) {}
  await loadWeatherForecast();
}

function showBirthdaysPage() {
  const sv = document.getElementById('schedule-view');
  const bp = document.getElementById('birthdays-page');
  if (!sv || !bp) return;
  closeReminderPopover();
  const overlay = document.getElementById('schedule-modal-overlay');
  if (overlay) overlay.remove();
  if (isWeatherPageVisible()) hideWeatherPage();
  sv.hidden = true;
  bp.hidden = false;
  const bap = document.getElementById('birthdays-admin-panel');
  if (bap) bap.hidden = !adminMode;
  renderBirthdaysPageContent();
  window.removeEventListener('keydown', scheduleSubpageEscapeHandler);
  window.addEventListener('keydown', scheduleSubpageEscapeHandler);
  try {
    window.scrollTo(0, 0);
  } catch (_) {}
}

function hideBirthdaysPage() {
  window.removeEventListener('keydown', scheduleSubpageEscapeHandler);
  const sv = document.getElementById('schedule-view');
  const bp = document.getElementById('birthdays-page');
  if (sv) sv.hidden = false;
  if (bp) bp.hidden = true;
  updateBirthdayHomeNotice();
}

function closeModals() {
  closeReminderPopover();
  const overlay = document.getElementById('schedule-modal-overlay');
  if (overlay) overlay.remove();
}

let reminderPopoverOpen = false;

function reminderEscapeHandler(e) {
  if (e.key === 'Escape') closeReminderPopover();
}

function positionReminderPopover() {
  const btn = document.getElementById('reminder-trigger');
  const pop = document.querySelector('#reminder-popover-root .reminder-popover');
  if (!btn || !pop) return;

  const vv = window.visualViewport;
  const vvTop = vv ? vv.offsetTop : 0;
  const vvH = vv ? vv.height : window.innerHeight;
  const margin = 12;
  const gap = 10;

  /* Висота над клавіатурою (Telegram / iOS Safari) */
  const usableH = Math.max(180, Math.floor(vvH - margin * 2));
  pop.style.maxHeight = `${usableH}px`;

  const r = btn.getBoundingClientRect();
  pop.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  pop.style.left = 'auto';
  pop.style.bottom = 'auto';
  pop.style.top = `${Math.round(r.bottom + gap)}px`;

  const clamp = () => {
    const pr = pop.getBoundingClientRect();
    const visibleTop = vvTop + margin;
    const visibleBottom = vvTop + vvH - margin;

    let newTop = pr.top;
    if (pr.bottom > visibleBottom) {
      newTop = Math.max(visibleTop, visibleBottom - pr.height);
    }
    if (newTop < visibleTop) {
      newTop = visibleTop;
    }
    if (Math.abs(newTop - pr.top) > 0.5) {
      pop.style.top = `${Math.round(newTop)}px`;
    }

    const pr2 = pop.getBoundingClientRect();
    const maxAllowedH = Math.max(160, visibleBottom - pr2.top - margin);
    if (pr2.height > maxAllowedH) {
      pop.style.maxHeight = `${Math.floor(maxAllowedH)}px`;
    }
  };

  requestAnimationFrame(() => {
    clamp();
    requestAnimationFrame(clamp);
  });
}

function bindReminderPopoverViewport() {
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', positionReminderPopover);
    window.visualViewport.addEventListener('scroll', positionReminderPopover);
  }
}

function unbindReminderPopoverViewport() {
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', positionReminderPopover);
    window.visualViewport.removeEventListener('scroll', positionReminderPopover);
  }
}

function closeReminderPopover() {
  window.removeEventListener('keydown', reminderEscapeHandler);
  window.removeEventListener('resize', positionReminderPopover);
  unbindReminderPopoverViewport();
  reminderPopoverOpen = false;
  const root = document.getElementById('reminder-popover-root');
  if (!root) return;
  root.classList.remove('reminder-popover-root--open');
  setTimeout(() => {
    root.remove();
  }, 280);
}

async function fetchReminderFromServer() {
  try {
    const res = await fetch('/api/reminder');
    if (res.ok) {
      const data = await res.json();
      if (typeof data.text === 'string') reminderText = data.text;
      const ts = Number(data.updatedAt);
      reminderUpdatedAt = Number.isFinite(ts) && ts > 0 ? ts : 0;
    }
  } catch (_) {}
  reminderFetchSettled = true;
  syncReminderTrigger();
}

function syncReminderTrigger() {
  const btn = document.getElementById('reminder-trigger');
  if (!btn) return;
  const hasText = !!(reminderText && reminderText.trim());
  btn.classList.remove('reminder-trigger--unread');

  if (adminMode) {
    btn.hidden = false;
    btn.removeAttribute('aria-hidden');
    btn.setAttribute('aria-label', 'Редагувати нагадування для студентів');
    return;
  }

  /* Звичайний режим: кнопка лише після відповіді сервера і лише якщо є текст */
  if (!reminderFetchSettled) {
    btn.hidden = true;
    btn.setAttribute('aria-hidden', 'true');
    return;
  }

  btn.hidden = !hasText;
  if (btn.hidden) btn.setAttribute('aria-hidden', 'true');
  else btn.removeAttribute('aria-hidden');
  btn.setAttribute('aria-label', 'Важливе нагадування');
  if (!btn.hidden && isReminderUnreadForUser()) {
    btn.classList.add('reminder-trigger--unread');
  }
}

function openReminderPopover() {
  if (reminderPopoverOpen) return;
  const stale = document.getElementById('reminder-popover-root');
  if (stale) {
    stale.remove();
    window.removeEventListener('keydown', reminderEscapeHandler);
    window.removeEventListener('resize', positionReminderPopover);
    unbindReminderPopoverViewport();
  }
  const editable = adminMode;
  const root = document.createElement('div');
  root.id = 'reminder-popover-root';
  root.className = 'reminder-popover-root';
  root.setAttribute('role', 'presentation');

  const backdrop = document.createElement('div');
  backdrop.className = 'reminder-popover-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('div');
  panel.className = 'reminder-popover' + (editable ? ' reminder-popover--edit' : '');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'reminder-popover-title');

  if (editable) {
    panel.innerHTML = `
      <h3 id="reminder-popover-title" class="reminder-popover__title">Нагадування</h3>
      <p class="reminder-popover__hint">Текст побачать усі студенти.</p>
      <div class="reminder-popover__edit-scroll">
        <textarea id="reminder-modal-text" class="reminder-popover__textarea reminder-popover__field" rows="6" maxlength="4000" placeholder="Важлива інформація для студентів…"></textarea>
        <p id="reminder-modal-error" class="modal-error" style="display:none;"></p>
      </div>
      <div class="reminder-popover__actions">
        <button type="button" class="modal-btn modal-btn-cancel" data-action="cancel">Скасувати</button>
        <button type="button" class="modal-btn modal-btn-secondary" data-action="clear">Очистити</button>
        <button type="button" class="modal-btn modal-btn-primary" data-action="save">Зберегти</button>
      </div>`;
  } else {
    panel.innerHTML = `
      <h3 id="reminder-popover-title" class="reminder-popover__title">Важливо</h3>
      <div class="reminder-readonly reminder-popover__body" id="reminder-readonly-text"></div>`;
  }

  root.appendChild(backdrop);
  root.appendChild(panel);
  document.body.appendChild(root);

  let allowBackdropClose = false;
  setTimeout(() => {
    allowBackdropClose = true;
  }, 450);

  backdrop.addEventListener('click', () => {
    if (!allowBackdropClose) return;
    closeReminderPopover();
  });

  panel.addEventListener('click', (e) => e.stopPropagation());

  window.addEventListener('resize', positionReminderPopover);
  bindReminderPopoverViewport();
  window.addEventListener('keydown', reminderEscapeHandler);

  reminderPopoverOpen = true;
  requestAnimationFrame(() => {
    positionReminderPopover();
    root.classList.add('reminder-popover-root--open');
    requestAnimationFrame(() => positionReminderPopover());
  });

  if (editable) {
    const ta = panel.querySelector('#reminder-modal-text');
    ta.value = reminderText;
    const reflowAfterKeyboard = () => {
      requestAnimationFrame(() => positionReminderPopover());
    };
    ta.addEventListener('focus', reflowAfterKeyboard);
    setTimeout(() => {
      ta.focus();
      reflowAfterKeyboard();
    }, 0);
    const err = panel.querySelector('#reminder-modal-error');

    panel.querySelector('[data-action="cancel"]').addEventListener('click', closeReminderPopover);

    panel.querySelector('[data-action="clear"]').addEventListener('click', () => {
      ta.value = '';
      ta.focus();
    });

    panel.querySelector('[data-action="save"]').addEventListener('click', async () => {
      err.style.display = 'none';
      err.textContent = '';
      try {
        const res = await fetch('/api/admin/reminder', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-password': storedAdminPassword,
          },
          body: JSON.stringify({ text: ta.value }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          reminderText = typeof data.text === 'string' ? data.text : ta.value;
          const ts = Number(data.updatedAt);
          if (Number.isFinite(ts) && ts > 0) reminderUpdatedAt = ts;
          closeReminderPopover();
          syncReminderTrigger();
          showToast('Нагадування збережено');
        } else {
          err.textContent = data.error || 'Не вдалося зберегти';
          err.style.display = 'block';
        }
      } catch (_) {
        err.textContent = 'Немає зв’язку з сервером';
        err.style.display = 'block';
      }
    });
  } else {
    const readEl = panel.querySelector('#reminder-readonly-text');
    fillReminderReadonlyBody(readEl, reminderText);
    markReminderSeen();
    syncReminderTrigger();
  }
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
      if (document.getElementById('reminder-popover-root')) return;
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
  const bap = document.getElementById('birthdays-admin-panel');
  if (bap) bap.hidden = !adminMode;
  if (isBirthdaysPageVisible()) renderBirthdaysPageContent();
  syncReminderTrigger();
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
          fetchReminderFromServer();
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
setHeaderTodayDateLabel();
loadSchedule(initialDate);
fetchReminderFromServer();
loadBirthdaysJson().then(() => {
  updateBirthdayHomeNotice();
  if (isBirthdaysPageVisible()) renderBirthdaysPageContent();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    setHeaderTodayDateLabel();
    updateBirthdayHomeNotice();
    if (isBirthdaysPageVisible()) renderBirthdaysPageContent();
  }
});

document.getElementById('bg-btn').addEventListener('click', () => openBackgroundModal());

const birthdaysBtn = document.getElementById('birthdays-btn');
if (birthdaysBtn) {
  birthdaysBtn.addEventListener('click', () => openBirthdaysPageWithLoad());
}

document.getElementById('birthdays-back-btn')?.addEventListener('click', () => hideBirthdaysPage());

document.getElementById('header-weather-btn')?.addEventListener('click', () => showWeatherPage());
document.getElementById('weather-back-btn')?.addEventListener('click', () => hideWeatherPage());
initWeatherPageControls();

document.getElementById('birthdays-admin-add')?.addEventListener('click', () => birthdaysAdminSubmitAdd());

['birthdays-admin-day', 'birthdays-admin-month', 'birthdays-admin-name'].forEach((id) => {
  document.getElementById(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      birthdaysAdminSubmitAdd();
    }
  });
});

const birthdaysPageEl = document.getElementById('birthdays-page');
if (birthdaysPageEl) {
  birthdaysPageEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-birthday-entry]');
    if (!btn || !adminMode) return;
    let entry;
    try {
      entry = JSON.parse(decodeURIComponent(btn.getAttribute('data-birthday-entry') || ''));
    } catch (_) {
      return;
    }
    e.preventDefault();
    birthdaysAdminRemove(entry);
  });
}

const birthdayHomeNotice = document.getElementById('birthday-home-notice');
if (birthdayHomeNotice) {
  birthdayHomeNotice.addEventListener('click', () => openBirthdaysPageWithLoad());
  birthdayHomeNotice.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openBirthdaysPageWithLoad();
    }
  });
}

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

const reminderTrigger = document.getElementById('reminder-trigger');
if (reminderTrigger) {
  reminderTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!adminMode && (!reminderText || !reminderText.trim())) return;
    openReminderPopover();
  });
}

registerGlobalSwipeDismiss();
syncAdminChrome();
