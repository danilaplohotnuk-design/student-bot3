/**
 * Очищає відмітки відвідуваності за 23.03 та 24.03 (будь-який рік у файлі)
 * на аркушах бакалавр / київ / львів. Колонки беруться так само, як для списку пар.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XlsxPopulate from 'xlsx-populate';
import {
  loadJournalWorkbook,
  getTargetSheetName,
  findDateColumns,
} from '../attendance-journal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const file = path.join(projectRoot, 'ТБА-35 test.xlsx');

const backup = path.join(
  projectRoot,
  `ТБА-35 test.backup-before-clear-23-24-03-${Date.now()}.xlsx`,
);
fs.copyFileSync(file, backup);

const dates = ['2026-03-23', '2026-03-24'];
const firstStudentRow = 5;

const { wb } = loadJournalWorkbook();
const sheetNames = ['бакалавр', 'київ', 'львів'];
const report = {};

const wbPop = await XlsxPopulate.fromFileAsync(file);

for (const requested of sheetNames) {
  const resolved = getTargetSheetName(wb, requested);
  const wsXlsx = wb.Sheets[resolved];
  const wsPop = wbPop.sheet(resolved);
  if (!wsXlsx || !wsPop) {
    report[requested] = { cleared: 0, columns: 0, missing: !wsPop };
    continue;
  }

  const colSet = new Set();
  for (const iso of dates) {
    for (const { columnIndex } of findDateColumns(wsXlsx, iso)) {
      colSet.add(columnIndex);
    }
  }

  const used = wsPop.usedRange();
  const maxRow = used ? used.endCell().rowNumber() : firstStudentRow;

  let cleared = 0;
  for (const colIdx of colSet) {
    const c = colIdx + 1;
    for (let r = firstStudentRow; r <= maxRow; r++) {
      const studentName = String(wsPop.cell(r, 2).value() ?? '').trim();
      if (!studentName) continue;
      const cell = wsPop.cell(r, c);
      const val = cell.value();
      if (val !== null && val !== undefined && String(val).trim() !== '') {
        cell.value('');
        cleared++;
      }
    }
  }

  report[resolved] = {
    cleared,
    columns: colSet.size,
    columnNumbers: [...colSet].sort((a, b) => a - b).map((i) => i + 1),
  };
}

await wbPop.toFileAsync(file);

console.log(
  JSON.stringify(
    {
      ok: true,
      backup: path.basename(backup),
      dates,
      report,
    },
    null,
    2,
  ),
);
