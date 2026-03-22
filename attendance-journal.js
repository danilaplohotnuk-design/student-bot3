/**
 * Журнал присутніх у файлі Excel (ТБА-35 test.xlsx у корені проєкту).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ATTENDANCE_JOURNAL_FILENAME = 'ТБА-35 test.xlsx';

function getJournalPath() {
  return path.join(__dirname, ATTENDANCE_JOURNAL_FILENAME);
}

const HEADERS = ['Дата', 'ПІБ', 'Присутність', 'Примітка'];

function ensureWorkbook() {
  const p = getJournalPath();
  if (!fs.existsSync(p)) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([HEADERS]);
    XLSX.utils.book_append_sheet(wb, ws, 'Журнал');
    XLSX.writeFile(wb, p);
  }
}

export function readJournalRows() {
  ensureWorkbook();
  const p = getJournalPath();
  const wb = XLSX.readFile(p);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const mtime = fs.statSync(p).mtimeMs;
  return { rows, sheetName, fileName: ATTENDANCE_JOURNAL_FILENAME, updatedAt: Math.round(mtime) };
}

function nextDataRowIndex(ws) {
  const ref = ws['!ref'];
  if (!ref) return 0;
  return XLSX.utils.decode_range(ref).e.r + 1;
}

export function appendJournalRow({ date, fullName, present, note }) {
  ensureWorkbook();
  const p = getJournalPath();
  const wb = XLSX.readFile(p);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  let r = nextDataRowIndex(ws);
  if (r === 0) {
    XLSX.utils.sheet_add_aoa(ws, [HEADERS], { origin: { r: 0, c: 0 } });
    r = 1;
  }
  const presentStr =
    present === true || present === 'true' || present === '1' || present === 'Так' || present === 'так'
      ? 'Так'
      : 'Ні';
  const d = typeof date === 'string' ? date.trim() : '';
  const n = typeof fullName === 'string' ? fullName.trim().slice(0, 200) : '';
  if (!d || !n) {
    throw new Error('Потрібні поля date та fullName');
  }
  const noteStr = typeof note === 'string' ? note.trim().slice(0, 500) : '';
  XLSX.utils.sheet_add_aoa(ws, [[d, n, presentStr, noteStr]], { origin: { r, c: 0 } });
  wb.Sheets[sheetName] = ws;
  XLSX.writeFile(wb, p);
  return readJournalRows();
}

export function getJournalFileBuffer() {
  ensureWorkbook();
  const p = getJournalPath();
  return fs.readFileSync(p);
}
