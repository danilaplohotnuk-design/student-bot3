/**
 * Збільшує patch у version.json і синхронізує package.json.
 * Використовується в GitHub Actions після push.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const versionPath = path.join(root, 'version.json');
const pkgPath = path.join(root, 'package.json');

const data = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
const raw = String(data.version || '0.0.0').trim();
const parts = raw.split('.').map((p) => {
  const n = parseInt(p, 10);
  return Number.isFinite(n) ? n : 0;
});
while (parts.length < 3) parts.push(0);
const [major, minor, patch] = parts;
const next = `${major}.${minor}.${patch + 1}`;

fs.writeFileSync(versionPath, JSON.stringify({ version: next }, null, 2) + '\n', 'utf8');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

console.log(`Version: ${raw} → ${next}`);
