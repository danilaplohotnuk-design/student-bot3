/**
 * Журнал присутніх — файл «ТБА-35 test.xlsx» (матриця як у шаблоні групи).
 * Лист за замовчуванням: «бакалавр» (ATTENDANCE_JOURNAL_SHEET у .env).
 * Колонка B — ПІБ (з рядка 5), рядок 4 Excel — дні/дати, на перетині — «п» / «н».
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

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

/** Excel рядок 4 (індекс 0-based: 3) — дата / день */
const DATE_ROW_INDEX = 3;
/** Excel рядок 5 (індекс 4) — перший рядок студентів */
const FIRST_STUDENT_ROW_INDEX = 4;
/** Колонка B — ПІБ */
const NAME_COL_INDEX = 1;

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
  m = compact.match(/^(\d{1,2})[\/.,](\d{1,2})[\/.,](\d{2,4})$/);
  if (m) {
    const d = +m[1];
    const mo = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
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
  if (present === false || present === 'false' || present === 0 || present === '0') return 'н';
  if (present === true || present === 'true' || present === 1 || present === '1') return 'п';
  const s = String(present ?? '').trim().toLowerCase();
  if (s === 'п' || s === 'p' || s === 'так' || s === '+') return 'п';
  if (s === 'н' || s === 'n' || s === 'ні' || s === '-') return 'н';
  if (s === 'так' || s === 'yes') return 'п';
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

function setCell(ws, r, c, v) {
  const addr = XLSX.utils.encode_cell({ r, c });
  const str = String(v);
  ws[addr] = { t: 's', v: str };
  if (!ws['!ref']) {
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c } });
  } else {
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (r > range.e.r) range.e.r = r;
    if (c > range.e.c) range.e.c = c;
    if (r < range.s.r) range.s.r = r;
    if (c < range.s.c) range.s.c = c;
    ws['!ref'] = XLSX.utils.encode_range(range);
  }
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
    XLSX.read(buffer, { type: 'buffer' });
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
  const wb = XLSX.readFile(p, { cellDates: true });
  return { wb, path: p };
}

export function getTargetSheetName(wb) {
  const env = process.env.ATTENDANCE_JOURNAL_SHEET?.trim();
  if (env && wb.SheetNames.includes(env)) return env;
  if (wb.SheetNames.includes('бакалавр')) return 'бакалавр';
  return wb.SheetNames[0];
}

/** Заголовок заняття над колонкою (рядки 1–3 Excel) */
function buildClassLabel(ws, colIndex) {
  const bits = [];
  for (let r = 0; r <= 2; r++) {
    const v = getCellValue(ws, r, colIndex);
    if (v) bits.push(v);
    if (colIndex > 0) {
      const v2 = getCellValue(ws, r, colIndex - 1);
      if (v2 && !bits.includes(v2)) bits.push(v2);
    }
  }
  const s = [...new Set(bits)].join(' · ').slice(0, 500);
  return s || `Колонка ${colIndex + 1}`;
}

export function listMatrixStudents(ws) {
  const ref = ws['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const out = [];
  for (let r = FIRST_STUDENT_ROW_INDEX; r <= range.e.r; r++) {
    const name = String(getCellValue(ws, r, NAME_COL_INDEX)).trim();
    if (!name) continue;
    if (/^№\s*з\/п|^прізвище/i.test(name)) continue;
    out.push({ excelRow: r + 1, rowIndex: r, name });
    if (out.length > 120) break;
  }
  return out;
}

/** Усі колонки, де в рядку дат збігається дата */
export function findDateColumns(ws, isoDate) {
  const ref = ws['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const seen = new Set();
  const out = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const raw = getCellValue(ws, DATE_ROW_INDEX, c);
    const iso = normalizeDateToIso(raw);
    if (iso === isoDate && !seen.has(c)) {
      seen.add(c);
      out.push({
        columnIndex: c,
        pairLabel: buildClassLabel(ws, c),
      });
    }
  }
  return out;
}

function findStudentRowByName(ws, name) {
  const target = normKey(name);
  const ref = ws['!ref'];
  if (!ref) return -1;
  const range = XLSX.utils.decode_range(ref);
  for (let r = FIRST_STUDENT_ROW_INDEX; r <= range.e.r; r++) {
    const cellName = String(getCellValue(ws, r, NAME_COL_INDEX)).trim();
    if (!cellName) continue;
    if (normKey(cellName) === target) return r;
  }
  for (let r = FIRST_STUDENT_ROW_INDEX; r <= range.e.r; r++) {
    const cellName = String(getCellValue(ws, r, NAME_COL_INDEX)).trim();
    if (!cellName) continue;
    if (cellName.includes(name.trim()) || name.trim().includes(cellName)) return r;
  }
  return -1;
}

/** Дані для адмінки: дата → пари (колонки) з Excel + студенти з відмітками */
export function getMatrixDayData(isoDate) {
  const { wb } = loadJournalWorkbook();
  const sheetName = getTargetSheetName(wb);
  const ws = wb.Sheets[sheetName];
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
        present: letter === 'п',
        letter: letter || '',
      };
    }),
  }));
  return {
    format: 'matrix',
    sheetName,
    date: isoDate,
    pairs,
    students,
    rowsForDay: [],
    unpaired: [],
  };
}

/** Запис «п»/«н» у клітинку на перетині студента та колонки дати */
export function writeMatrixAttendance({ dateIso, columnIndex, fullName, present }) {
  const col = parseInt(columnIndex, 10);
  if (!Number.isFinite(col) || col < 0) throw new Error('Некоректний індекс колонки');
  const letter = presentToLetter(present);
  const name = typeof fullName === 'string' ? fullName.trim().slice(0, 200) : '';
  if (!name) throw new Error('Потрібне ПІБ');
  const dIso = normalizeDateToIso(dateIso) || String(dateIso || '').trim();
  if (!dIso || !/^\d{4}-\d{2}-\d{2}$/.test(dIso)) {
    throw new Error('Некоректна дата');
  }

  const { wb, path: p } = loadJournalWorkbook();
  const sheetName = getTargetSheetName(wb);
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error('Аркуш не знайдено');

  const cellDate = normalizeDateToIso(getCellValue(ws, DATE_ROW_INDEX, col));
  if (cellDate !== dIso) {
    throw new Error('Дата в обраній колонці не збігається з обраною датою');
  }

  const rowIdx = findStudentRowByName(ws, name);
  if (rowIdx < 0) {
    throw new Error('Студента не знайдено в колонці «Прізвище та ініціали»');
  }

  setCell(ws, rowIdx, col, letter);
  XLSX.writeFile(wb, p);

  const mtime = fs.statSync(p).mtimeMs;
  return {
    ok: true,
    format: 'matrix',
    sheetName,
    fileName: ATTENDANCE_JOURNAL_FILENAME,
    updatedAt: Math.round(mtime),
    rows: [],
    studentCount: listMatrixStudents(ws).length,
  };
}

/** Сумарна інформація після зміни */
export function readJournalRows() {
  const { wb, path: p } = loadJournalWorkbook();
  const sheetName = getTargetSheetName(wb);
  const ws = wb.Sheets[sheetName];
  const students = ws ? listMatrixStudents(ws) : [];
  const mtime = fs.statSync(p).mtimeMs;
  return {
    format: 'matrix',
    rows: [],
    sheetName,
    fileName: ATTENDANCE_JOURNAL_FILENAME,
    updatedAt: Math.round(mtime),
    studentCount: students.length,
  };
}

/**
 * Ручне додавання: знайти колонку за датою (+ опційно фрагмент назви пари) і записати клітинку
 */
export function appendJournalRow({ date, fullName, present, pair, columnIndex }) {
  const dIso = normalizeDateToIso(date) || String(date || '').trim();
  if (!dIso) throw new Error('Потрібні поля date та fullName');
  const n = typeof fullName === 'string' ? fullName.trim().slice(0, 200) : '';
  if (!n) throw new Error('Потрібні поля date та fullName');

  if (columnIndex != null && columnIndex !== '') {
    return writeMatrixAttendance({
      dateIso: dIso,
      columnIndex,
      fullName: n,
      present,
    });
  }

  const { wb } = loadJournalWorkbook();
  const sheetName = getTargetSheetName(wb);
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error('Аркуш не знайдено');

  const cols = findDateColumns(ws, dIso);
  if (!cols.length) throw new Error('У рядку дат немає цієї дати — перевірте файл Excel');
  let chosen = cols[0];
  const pl = typeof pair === 'string' ? pair.trim() : '';
  if (pl && cols.length > 1) {
    const hit = cols.find(
      (c) =>
        normKey(c.pairLabel).includes(normKey(pl)) || normKey(pl).includes(normKey(c.pairLabel)),
    );
    if (hit) chosen = hit;
  }
  return writeMatrixAttendance({
    dateIso: dIso,
    columnIndex: chosen.columnIndex,
    fullName: n,
    present,
  });
}

export function getJournalFileBuffer() {
  const p = getJournalPath();
  if (!fs.existsSync(p)) {
    throw new Error('Файл журналу не знайдено');
  }
  return fs.readFileSync(p);
}
