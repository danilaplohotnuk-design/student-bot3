/**
 * Журнал присутніх у файлі Excel (ТБА-35 test.xlsx у корені проєкту).
 * Колонки: Дата | Пара | ПІБ | Присутність (п/н) | Примітка
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ATTENDANCE_JOURNAL_FILENAME = 'ТБА-35 test.xlsx';

const CANON_HEADERS = ['Дата', 'Пара', 'ПІБ', 'Присутність', 'Примітка'];

function getJournalPath() {
  return path.join(__dirname, ATTENDANCE_JOURNAL_FILENAME);
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

export function formatPairLabel(lesson) {
  if (!lesson) return '';
  const t = lesson.teacher ? ` (${lesson.teacher})` : '';
  return `${lesson.startTime}–${lesson.endTime} — ${lesson.title}${t}`;
}

function normKey(s) {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Чи відповідає рядок журналу обраній парі (назва/час з розкладу) */
export function rowMatchesPair(rowPairRaw, pairLabel, lessonTitle) {
  const rp = normKey(rowPairRaw);
  const pl = normKey(pairLabel);
  if (!rp) return false;
  if (rp === pl) return true;
  if (lessonTitle && rp === normKey(lessonTitle)) return true;
  if (pl.includes(rp) || rp.includes(pl)) return true;
  return false;
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

function readLetterFromCell(val) {
  const s = String(val ?? '').trim().toLowerCase();
  if (s === 'п' || s === 'p' || s === 'так' || s === 'yes' || s === '1' || s === '+') return 'п';
  if (s === 'н' || s === 'n' || s === 'ні' || s === 'no' || s === '0' || s === '-') return 'н';
  return s ? s[0] : '';
}

function ensureWorkbook() {
  const p = getJournalPath();
  if (!fs.existsSync(p)) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([CANON_HEADERS]);
    XLSX.utils.book_append_sheet(wb, ws, 'Журнал');
    XLSX.writeFile(wb, p);
  }
}

function loadSheetAoa() {
  ensureWorkbook();
  const p = getJournalPath();
  const wb = XLSX.readFile(p);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  let aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!aoa.length) {
    aoa = [CANON_HEADERS];
  }
  return { wb, sheetName, ws, aoa, path: p };
}

/** Старий формат: Дата, ПІБ, Присутність, Примітка — вставляємо колонку Пара */
function migrateAoaIfNeeded(aoa) {
  if (!aoa.length) return [[...CANON_HEADERS]];
  const h = aoa[0].map((c) => String(c).trim());
  if (h.includes('Пара') || h.includes('Предмет')) return aoa;
  if (h[0] === 'Дата' && h[1] === 'ПІБ' && h.length >= 4) {
    const out = [['Дата', 'Пара', 'ПІБ', 'Присутність', 'Примітка']];
    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      out.push([row[0] ?? '', '', row[1] ?? '', row[2] ?? '', row[3] ?? '']);
    }
    return out;
  }
  return aoa;
}

function headerIndices(headerRow) {
  const h = headerRow.map((c) => String(c).trim());
  const idx = { date: -1, pair: -1, name: -1, pres: -1, note: -1 };
  h.forEach((cell, i) => {
    if (cell === 'Дата') idx.date = i;
    if (cell === 'Пара' || cell === 'Предмет') idx.pair = i;
    if (cell === 'ПІБ') idx.name = i;
    if (cell === 'Присутність') idx.pres = i;
    if (cell === 'Примітка') idx.note = i;
  });
  return idx;
}

function aoaToObjects(aoa) {
  if (!aoa.length) return [];
  const idx = headerIndices(aoa[0]);
  const rows = [];
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const get = (i) => (i >= 0 ? row[i] ?? '' : '');
    rows.push({
      Дата: get(idx.date),
      Пара: idx.pair >= 0 ? get(idx.pair) : '',
      ПІБ: get(idx.name),
      Присутність: get(idx.pres),
      Примітка: idx.note >= 0 ? get(idx.note) : '',
    });
  }
  return rows;
}

function saveAoa(aoa) {
  const { wb, sheetName, path: p } = loadSheetAoa();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  wb.Sheets[sheetName] = ws;
  XLSX.writeFile(wb, p);
}

function loadMigratedAoa() {
  let { aoa } = loadSheetAoa();
  const before = JSON.stringify(aoa);
  aoa = migrateAoaIfNeeded(aoa);
  if (JSON.stringify(aoa) !== before) saveAoa(aoa);
  return aoa;
}

export function readJournalRows() {
  const aoa = loadMigratedAoa();
  const p = getJournalPath();
  const mtime = fs.statSync(p).mtimeMs;
  const rows = aoaToObjects(aoa);
  const { sheetName } = loadSheetAoa();
  return {
    rows,
    sheetName,
    fileName: ATTENDANCE_JOURNAL_FILENAME,
    updatedAt: Math.round(mtime),
  };
}

/** Рядки журналу, у яких дата збігається з обраною (різні формати дат у клітинках) */
export function getRowsForIsoDate(isoDate) {
  const aoa = loadMigratedAoa();
  const rows = aoaToObjects(aoa);
  return rows.filter((row) => normalizeDateToIso(row['Дата']) === isoDate);
}

export function appendJournalRow({ date, fullName, present, note, pair }) {
  let aoa = loadMigratedAoa();
  const idx = headerIndices(aoa[0]);
  const presentBool =
    present === true ||
    present === 'true' ||
    present === '1' ||
    present === 'Так' ||
    present === 'так';
  const letter = presentToLetter(presentBool);
  const d = typeof date === 'string' ? date.trim() : '';
  const n = typeof fullName === 'string' ? fullName.trim().slice(0, 200) : '';
  if (!d || !n) {
    throw new Error('Потрібні поля date та fullName');
  }
  const pairStr = typeof pair === 'string' ? pair.trim().slice(0, 300) : '';
  const noteStr = typeof note === 'string' ? note.trim().slice(0, 500) : '';
  const newRow = new Array(Math.max(aoa[0].length, 5)).fill('');
  newRow[idx.date >= 0 ? idx.date : 0] = d;
  if (idx.pair >= 0) newRow[idx.pair] = pairStr;
  else newRow[1] = pairStr;
  newRow[idx.name >= 0 ? idx.name : 2] = n;
  newRow[idx.pres >= 0 ? idx.pres : 3] = letter;
  newRow[idx.note >= 0 ? idx.note : 4] = noteStr;
  aoa.push(newRow);
  saveAoa(aoa);
  return readJournalRows();
}

/**
 * Оновити або додати рядок: дата (ISO), назва пари (як у розкладу), ПІБ, присутність
 */
export function upsertAttendanceByPair({ dateIso, pairLabel, fullName, present }) {
  const dIso = normalizeDateToIso(dateIso) || String(dateIso).trim();
  if (!dIso) throw new Error('Некоректна дата');
  const pl = typeof pairLabel === 'string' ? pairLabel.trim().slice(0, 400) : '';
  const name = typeof fullName === 'string' ? fullName.trim().slice(0, 200) : '';
  if (!name) throw new Error('Потрібне ПІБ');
  const letter = presentToLetter(present);

  let aoa = loadMigratedAoa();
  const idx = headerIndices(aoa[0]);
  if (idx.date < 0 || idx.name < 0 || idx.pres < 0) {
    throw new Error('Некоректна структура журналу');
  }
  if (idx.pair < 0) {
    const hdr = [...aoa[0]];
    hdr.splice(1, 0, 'Пара');
    const newAoa = [hdr];
    for (let r = 1; r < aoa.length; r++) {
      const row = [...(aoa[r] || [])];
      row.splice(1, 0, '');
      newAoa.push(row);
    }
    aoa = newAoa;
  }
  const idx2 = headerIndices(aoa[0]);

  let found = -1;
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const rd = normalizeDateToIso(row[idx2.date]);
    const rp = idx2.pair >= 0 ? String(row[idx2.pair] ?? '').trim() : '';
    const rn = String(row[idx2.name] ?? '').trim();
    if (rd === dIso && normKey(rp) === normKey(pl) && rn === name) {
      found = r;
      break;
    }
  }

  if (found >= 0) {
    aoa[found][idx2.pres] = letter;
  } else {
    const newRow = new Array(aoa[0].length).fill('');
    newRow[idx2.date] = dIso;
    if (idx2.pair >= 0) newRow[idx2.pair] = pl;
    newRow[idx2.name] = name;
    newRow[idx2.pres] = letter;
    if (idx2.note >= 0) newRow[idx2.note] = '';
    aoa.push(newRow);
  }
  saveAoa(aoa);
  return readJournalRows();
}

/** Імена для пари: рядки з цією датою, де Пара збігається або порожня (показуємо в «без пари» окремо на клієнті) */
export function getNamesForPair(rowsForDay, pairLabel, lessonTitle) {
  const filtered = rowsForDay.filter((row) => {
    const rp = String(row['Пара'] ?? '').trim();
    if (!rp) return false;
    return rowMatchesPair(rp, pairLabel, lessonTitle);
  });
  const map = new Map();
  for (const row of filtered) {
    const name = String(row['ПІБ'] ?? '').trim();
    if (!name) continue;
    const letter = readLetterFromCell(row['Присутність']);
    map.set(name, { name, present: letter === 'п', letter: letter || 'н' });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'uk'));
}

export function getUnpairedNames(rowsForDay) {
  const map = new Map();
  for (const row of rowsForDay) {
    const rp = String(row['Пара'] ?? '').trim();
    if (rp) continue;
    const name = String(row['ПІБ'] ?? '').trim();
    if (!name) continue;
    const letter = readLetterFromCell(row['Присутність']);
    map.set(name, { name, present: letter === 'п', letter: letter || 'н' });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'uk'));
}

export function getJournalFileBuffer() {
  ensureWorkbook();
  return fs.readFileSync(getJournalPath());
}
