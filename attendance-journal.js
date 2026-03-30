/**
 * Журнал присутніх — файл «ТБА-35 test.xlsx» (матриця як у шаблоні групи).
 * Лист за замовчуванням: «бакалавр» (ATTENDANCE_JOURNAL_SHEET у .env).
 * Колонка B — ПІБ (за замовч. з рядка 5). Рядок дат — рядок 4 Excel, колонки AZ…MM,
 * формат дати в клітинках дд.мм.рррр (див. ATTENDANCE_JOURNAL_* у .env).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import XlsxPopulate from 'xlsx-populate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ATTENDANCE_JOURNAL_FILENAME = 'ТБА-35 test.xlsx';

/**
 * Шлях до файлу журналу:
 * - ATTENDANCE_JOURNAL_PATH — повний шлях до .xlsx
 * - або ATTENDANCE_JOURNAL_DIR — каталог, у ньому зберігається «ТБА-35 test.xlsx»
 * - інакше — поруч із index.js
 */
export function getResolvedJournalPath() {
  const full = process.env.ATTENDANCE_JOURNAL_PATH?.trim();
  if (full) return path.resolve(full);
  const dir = process.env.ATTENDANCE_JOURNAL_DIR?.trim();
  if (dir) return path.join(path.resolve(dir), ATTENDANCE_JOURNAL_FILENAME);
  return path.join(__dirname, ATTENDANCE_JOURNAL_FILENAME);
}

/** Колонка B — ПІБ */
const NAME_COL_INDEX = 1;

/** Рядок Excel з датами дд.мм.рррр (1-based). За замовч. 4 — колонки AZ…MM. */
function getDateRowIndex() {
  const n = parseInt(process.env.ATTENDANCE_JOURNAL_DATE_ROW, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 200) return n - 1;
  return 3; // Excel рядок 4
}

/** Перший рядок з ПІБ (1-based). За замовч. 5. */
function getFirstStudentRowIndex() {
  const n = parseInt(process.env.ATTENDANCE_JOURNAL_FIRST_STUDENT_ROW, 10);
  if (Number.isFinite(n) && n >= 2 && n <= 500) return n - 1;
  return 4; // Excel рядок 5
}

/**
 * Діапазон колонок з парами (AZ:MM за замовч.).
 * ATTENDANCE_JOURNAL_COL_RANGE=AZ:MM
 */
function getScanColumnBounds() {
  const raw = process.env.ATTENDANCE_JOURNAL_COL_RANGE?.trim();
  if (raw && raw.includes(':')) {
    const [a, b] = raw.split(':').map((s) => s.trim().toUpperCase());
    try {
      const minC = XLSX.utils.decode_col(a);
      const maxC = XLSX.utils.decode_col(b);
      if (Number.isFinite(minC) && Number.isFinite(maxC) && minC <= maxC) {
        return { minC, maxC };
      }
    } catch (_) {}
  }
  return {
    minC: XLSX.utils.decode_col('AZ'),
    maxC: XLSX.utils.decode_col('MM'),
  };
}

function getJournalPath() {
  return getResolvedJournalPath();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Нормалізує дату з Excel/тексту до YYYY-MM-DD (/, . , як роздільники) */
export function normalizeDateToIso(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${pad2(raw.getMonth() + 1)}-${pad2(raw.getDate())}`;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + raw * 86400000);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    }
  }
  const s = String(raw).trim().replace(/\s+/g, ' ');
  const compact = s.replace(/\s/g, '');
  let m = compact.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = +m[1];
    const mo = +m[2];
    const d = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  m = compact.match(/^(\d{1,2})([\/.,])(\d{1,2})\2(\d{2,4})$/);
  if (m) {
    let a = +m[1];
    const sep = m[2];
    let b = +m[3];
    let y = +m[4];
    if (y < 100) y += 2000;
    // Для "/" у цьому файлі часто формат m/d/yy; для "." зазвичай d.m.yy.
    if (sep === '/') {
      const mo = a;
      const d = b;
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
      const mo2 = b;
      const d2 = a;
      if (mo2 >= 1 && mo2 <= 12 && d2 >= 1 && d2 <= 31) return `${y}-${pad2(mo2)}-${pad2(d2)}`;
      return null;
    }
    const d = a;
    const mo = b;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  return null;
}

function normKey(s) {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function presentToLetter(present) {
  if (present == null || present === '') return ' ';
  if (present === false || present === 'false' || present === 0 || present === '0') return 'н';
  if (present === true || present === 'true' || present === 1 || present === '1') return ' ';
  const s = String(present ?? '').trim().toLowerCase();
  if (s === 'п' || s === 'p' || s === 'так' || s === '+') return ' ';
  if (s === 'н' || s === 'n' || s === 'ні' || s === '-') return 'н';
  if (s === 'так' || s === 'yes') return ' ';
  if (s === 'ні' || s === 'no') return 'н';
  return 'н';
}

export function readLetterFromCell(val) {
  const s = String(val ?? '').trim().toLowerCase();
  if (s === 'п' || s === 'p' || s === 'так' || s === 'yes' || s === '1' || s === '+') return 'п';
  if (s === 'н' || s === 'n' || s === 'ні' || s === 'no' || s === '0' || s === '-') return 'н';
  return s ? s[0] : '';
}

function getCellValue(ws, r, c) {
  const addr = XLSX.utils.encode_cell({ r, c });
  let cell = ws[addr];
  if (!cell && ws['!merges']) {
    for (const m of ws['!merges']) {
      if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) {
        cell = ws[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })];
        break;
      }
    }
  }
  if (!cell) return '';
  if (cell.w != null) return String(cell.w).trim();
  if (cell.v != null) {
    if (cell.t === 'n' && typeof cell.v === 'number') {
      const asIso = normalizeDateToIso(cell.v);
      if (asIso) return asIso;
    }
    return String(cell.v).trim();
  }
  return '';
}

function getCellValueRaw(ws, r, c) {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = ws[addr];
  if (!cell) return '';
  if (cell.w != null) return String(cell.w).trim();
  if (cell.v != null) return String(cell.v).trim();
  return '';
}

async function writeCellsPreserveStyle(filePath, sheetName, updates) {
  const wb = await XlsxPopulate.fromFileAsync(filePath);
  const ws = wb.sheet(sheetName);
  if (!ws) throw new Error('Аркуш не знайдено');
  for (const u of updates) {
    const cell = ws.cell(u.rowIndex + 1, u.columnIndex + 1);
    // Only value changes. Existing border/fill/alignment remain untouched.
    cell.value(String(u.letter ?? ''));
  }
  await wb.toFileAsync(filePath);
}

/** Зберегти .xlsx на сервер (після завантаження з адмінки) */
export function saveJournalFileBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Некоректні дані файлу');
  }
  if (buffer.length < 64) {
    throw new Error('Файл занадто малий');
  }
  try {
    XLSX.read(buffer, { type: 'buffer', cellStyles: false });
  } catch {
    throw new Error('Файл не є коректним Excel (.xlsx)');
  }
  const p = getJournalPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buffer);
}

export function loadJournalWorkbook() {
  const p = getJournalPath();
  if (!fs.existsSync(p)) {
    throw new Error(
      'Файл журналу не знайдено. Завантажте «ТБА-35 test.xlsx» кнопкою «Відправити Excel на сервер» у журналі або покладіть файл у корінь проєкту / задайте ATTENDANCE_JOURNAL_PATH у змінних середовища.',
    );
  }
  // cellStyles: false — значно швидше й менше RAM; стилі для запису бере xlsx-populate з файлу окремо
  const wb = XLSX.readFile(p, { cellDates: true, cellStyles: false });
  return { wb, path: p };
}

export function getAvailableJournalSheets(wb) {
  const preferred = ['бакалавр', 'київ', 'львів'];
  const lower = new Map(wb.SheetNames.map((n) => [n.toLowerCase(), n]));
  const out = [];
  for (const p of preferred) {
    const actual = lower.get(p);
    if (actual) out.push(actual);
  }
  if (!out.length && wb.SheetNames.length) out.push(wb.SheetNames[0]);
  return out;
}

export function getTargetSheetName(wb, requestedSheet) {
  const available = getAvailableJournalSheets(wb);
  const req = String(requestedSheet || '').trim();
  if (req) {
    const hit = available.find((s) => s.toLowerCase() === req.toLowerCase());
    if (hit) return hit;
    throw new Error(`Аркуш «${req}» не знайдено`);
  }
  const env = process.env.ATTENDANCE_JOURNAL_SHEET?.trim();
  if (env) {
    const byEnv = available.find((s) => s.toLowerCase() === env.toLowerCase());
    if (byEnv) return byEnv;
  }
  return available[0];
}

/** Рядок дат: лише день тижня (без числа) — окрема колонка перед першою датою дня */
function isWeekdayOnlyMarker(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  if (normalizeDateToIso(s)) return false;
  return /^(Пн|Вт|Ср|Чт|Пт|Сб|Нд)$/i.test(s);
}

/**
 * Назва пари: один рядок (рядок предмета зазвичай на 2 вище за рядок дат у шаблоні).
 * Не склеюємо кілька рядків через « · », щоб не дублювати предмети з об’єднаних клітинок.
 */
function buildClassLabel(ws, colIndex) {
  const dateRow = getDateRowIndex();
  const subjectRow = Math.max(0, dateRow - 2);
  let v = getCellValue(ws, subjectRow, colIndex);
  if (!v) {
    for (let r = 0; r < dateRow; r++) {
      v = getCellValue(ws, r, colIndex);
      if (v) break;
    }
  }
  const s = String(v || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 500);
  return s || `Колонка ${colIndex + 1}`;
}

export function listMatrixStudents(ws) {
  const ref = ws['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const out = [];
  const firstStudent = getFirstStudentRowIndex();
  for (let r = firstStudent; r <= range.e.r; r++) {
    const name = String(getCellValue(ws, r, NAME_COL_INDEX)).trim();
    if (!name) continue;
    if (/^№\s*з\/п|^прізвище/i.test(name)) continue;
    out.push({ excelRow: r + 1, rowIndex: r, name });
    if (out.length > 120) break;
  }
  return out;
}

function isoSameDayMonth(a, b) {
  const pa = String(a || '').split('-');
  const pb = String(b || '').split('-');
  if (pa.length !== 3 || pb.length !== 3) return false;
  return pa[1] === pb[1] && pa[2] === pb[2];
}

/** Усі колонки, де в рядку дат збігається дата (повна або день+місяць, якщо рік у файлі інший) */
function findDateColumnsInner(ws, isoDate, dayMonthOnly) {
  const { minC, maxC } = getScanColumnBounds();
  const dateRow = getDateRowIndex();
  const anchors = [];
  for (let c = minC; c <= maxC; c++) {
    // Date row in this workbook usually has one explicit date per day.
    const raw = getCellValueRaw(ws, dateRow, c);
    const iso = normalizeDateToIso(raw);
    let match = iso === isoDate;
    if (!match && dayMonthOnly && iso) {
      match = isoSameDayMonth(iso, isoDate);
    }
    if (match) anchors.push(c);
  }
  const seen = new Set();
  const out = [];
  for (const anchor of anchors) {
    const pushIfPair = (col) => {
      if (seen.has(col)) return;
      let label = buildClassLabel(ws, col);
      if (/^Колонка\s+\d+$/i.test(String(label || '').trim())) {
        label = `Заняття (кол. ${col + 1})`;
      }
      seen.add(col);
      out.push({ columnIndex: col, pairLabel: label });
    };
    // Колонка з «Пн»/«Вт» без дати — перша пара дня; дата стоїть у наступній колонці
    const prefix = [];
    let c0 = anchor - 1;
    while (c0 >= minC) {
      const t = String(getCellValueRaw(ws, dateRow, c0) || '').trim();
      if (isWeekdayOnlyMarker(t)) {
        prefix.push(c0);
        c0 -= 1;
      } else {
        break;
      }
    }
    prefix.sort((a, b) => a - b);
    for (const c of prefix) {
      pushIfPair(c);
    }
    pushIfPair(anchor);
    // Include subsequent columns for the same day until next non-empty date-row marker.
    for (let c = anchor + 1; c <= maxC; c++) {
      const marker = String(getCellValueRaw(ws, dateRow, c) || '').trim();
      if (marker) break;
      pushIfPair(c);
    }
  }
  return out;
}

export function findDateColumns(ws, isoDate) {
  const full = findDateColumnsInner(ws, isoDate, false);
  if (full.length) return full;
  return findDateColumnsInner(ws, isoDate, true);
}

function findStudentRowByName(ws, name) {
  const target = normKey(name);
  const ref = ws['!ref'];
  if (!ref) return -1;
  const range = XLSX.utils.decode_range(ref);
  const firstStudent = getFirstStudentRowIndex();
  for (let r = firstStudent; r <= range.e.r; r++) {
    const cellName = String(getCellValue(ws, r, NAME_COL_INDEX)).trim();
    if (!cellName) continue;
    if (normKey(cellName) === target) return r;
  }
  for (let r = firstStudent; r <= range.e.r; r++) {
    const cellName = String(getCellValue(ws, r, NAME_COL_INDEX)).trim();
    if (!cellName) continue;
    if (cellName.includes(name.trim()) || name.trim().includes(cellName)) return r;
  }
  return -1;
}

/** Дані для адмінки: дата → пари (колонки) з Excel + студенти з відмітками */
export function getMatrixDayData(isoDate, sheetName) {
  const { wb } = loadJournalWorkbook();
  const resolvedSheetName = getTargetSheetName(wb, sheetName);
  const ws = wb.Sheets[resolvedSheetName];
  if (!ws) throw new Error('Аркуш журналу не знайдено');
  const students = listMatrixStudents(ws);
  const dateCols = findDateColumns(ws, isoDate);
  const pairs = dateCols.map(({ columnIndex, pairLabel }) => ({
    pairLabel,
    columnIndex,
    names: students.map((s) => {
      const raw = getCellValue(ws, s.rowIndex, columnIndex);
      const letter = readLetterFromCell(raw);
      return {
        name: s.name,
        rowIndex: s.rowIndex,
        excelRow: s.excelRow,
        present: letter !== 'н',
        letter: letter || '',
      };
    }),
  }));
  return {
    format: 'matrix',
    sheetName: resolvedSheetName,
    sheets: getAvailableJournalSheets(wb),
    date: isoDate,
    pairs,
    students,
    rowsForDay: [],
    unpaired: [],
  };
}

export async function writeMatrixAttendanceBatch({ dateIso, columnIndex, sheetName, items }) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('Потрібен непорожній список items');
  }
  const col = parseInt(columnIndex, 10);
  if (!Number.isFinite(col) || col < 0) throw new Error('Некоректний індекс колонки');
  const dIso = normalizeDateToIso(dateIso) || String(dateIso || '').trim();
  if (!dIso || !/^\d{4}-\d{2}-\d{2}$/.test(dIso)) throw new Error('Некоректна дата');

  const { wb, path: p } = loadJournalWorkbook();
  const resolvedSheetName = getTargetSheetName(wb, sheetName);
  const ws = wb.Sheets[resolvedSheetName];
  if (!ws) throw new Error('Аркуш не знайдено');

  const colsForDay = findDateColumns(ws, dIso);
  if (!colsForDay.some((x) => x.columnIndex === col)) {
    throw new Error('Дата в обраній колонці не збігається з обраною датою');
  }

  const updates = [];
  for (const item of items) {
    const fullName = typeof item?.fullName === 'string' ? item.fullName.trim().slice(0, 200) : '';
    if (!fullName) continue;
    const rowIdx = findStudentRowByName(ws, fullName);
    if (rowIdx < 0) continue;
    updates.push({ rowIndex: rowIdx, columnIndex: col, letter: presentToLetter(item.present) });
  }
  if (updates.length) {
    await writeCellsPreserveStyle(p, resolvedSheetName, updates);
  }
  const mtime = fs.statSync(p).mtimeMs;
  return {
    ok: true,
    format: 'matrix',
    sheetName: resolvedSheetName,
    sheets: getAvailableJournalSheets(wb),
    fileName: ATTENDANCE_JOURNAL_FILENAME,
    updatedAt: Math.round(mtime),
    rows: [],
    studentCount: listMatrixStudents(ws).length,
  };
}

/** Сумарна інформація після зміни */
export function readJournalRows(sheetName) {
  const { wb, path: p } = loadJournalWorkbook();
  const resolvedSheetName = getTargetSheetName(wb, sheetName);
  const ws = wb.Sheets[resolvedSheetName];
  const students = ws ? listMatrixStudents(ws) : [];
  const mtime = fs.statSync(p).mtimeMs;
  return {
    format: 'matrix',
    rows: [],
    sheetName: resolvedSheetName,
    sheets: getAvailableJournalSheets(wb),
    fileName: ATTENDANCE_JOURNAL_FILENAME,
    updatedAt: Math.round(mtime),
    studentCount: students.length,
  };
}

export function getJournalFileBuffer() {
  const p = getJournalPath();
  if (!fs.existsSync(p)) {
    throw new Error('Файл журналу не знайдено');
  }
  return fs.readFileSync(p);
}
