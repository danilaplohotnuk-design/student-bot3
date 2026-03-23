// Статистика відвідувань: пам’ять + файл (переживає рестарт; на Render — покладіть DATA_DIR на Persistent Disk)

import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getStatsFilePath() {
  const full = process.env.STATS_FILE?.trim();
  if (full) return path.resolve(full);
  const dataDir = process.env.DATA_DIR?.trim();
  if (dataDir) return path.join(path.resolve(dataDir), 'stats.json');
  return path.join(__dirname, 'stats.json');
}

let pageVisits = 0;
/** Унікальні відвідувачі за відбитком IP + User-Agent */
const uniqueFingerprints = new Set();
/** Запити до /api/health (cron-job.org тощо) — не входять у pageVisits */
let healthPings = 0;

let saveDebounceTimer = null;

function saveStatsToDiskSync() {
  const filePath = getStatsFilePath();
  const payload = {
    pageVisits,
    fingerprints: [...uniqueFingerprints],
    healthPings,
    savedAt: Date.now(),
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function scheduleSaveStats() {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    try {
      saveStatsToDiskSync();
    } catch (err) {
      console.error('stats save:', err.message || err);
    }
  }, 450);
}

function loadStatsFromDisk() {
  try {
    const filePath = getStatsFilePath();
    const raw = fs.readFileSync(filePath, 'utf8');
    const j = JSON.parse(raw);
    if (typeof j.pageVisits === 'number' && Number.isFinite(j.pageVisits) && j.pageVisits >= 0) {
      pageVisits = Math.floor(j.pageVisits);
    }
    if (typeof j.healthPings === 'number' && Number.isFinite(j.healthPings) && j.healthPings >= 0) {
      healthPings = Math.floor(j.healthPings);
    }
    if (Array.isArray(j.fingerprints)) {
      uniqueFingerprints.clear();
      for (const fp of j.fingerprints) {
        if (typeof fp === 'string' && /^[a-f0-9]{32}$/i.test(fp)) {
          uniqueFingerprints.add(fp.slice(0, 32).toLowerCase());
        }
      }
    }
  } catch {
    // файлу ще немає або пошкоджений — стартуємо з нуля
  }
}

loadStatsFromDisk();

function flushStatsOnExit() {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
  try {
    saveStatsToDiskSync();
  } catch (_) {}
}

process.once('SIGTERM', flushStatsOnExit);
process.once('SIGINT', flushStatsOnExit);

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) {
    return xf.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '';
}

export function fingerprint(req) {
  const ip = getClientIp(req);
  const ua = (req.headers['user-agent'] || '').slice(0, 200);
  return crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 32);
}

const DEFAULT_UA_EXCLUDE = ['cron-job', 'console.cron'];

function buildUaExcludeList() {
  const raw = process.env.STATS_EXCLUDE_UA_SUBSTR;
  const extra = raw
    ? String(raw)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];
  return [...new Set([...DEFAULT_UA_EXCLUDE, ...extra])];
}

const UA_EXCLUDE_SUBSTR = buildUaExcludeList();

function buildExcludedFingerprintSet() {
  const raw = process.env.STATS_EXCLUDE_FINGERPRINTS || '';
  return new Set(
    String(raw)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

const EXCLUDED_FINGERPRINTS = buildExcludedFingerprintSet();

function shouldExcludeByUserAgent(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  return UA_EXCLUDE_SUBSTR.some((sub) => sub && ua.includes(sub));
}

function shouldExcludeByFingerprint(req) {
  return EXCLUDED_FINGERPRINTS.has(fingerprint(req));
}

/** Не враховувати в заходах та унікальних (cron-боти, власний браузер за env) */
export function shouldExcludeFromPageStats(req) {
  if (!req) return false;
  if (shouldExcludeByUserAgent(req)) return true;
  if (shouldExcludeByFingerprint(req)) return true;
  return false;
}

/** Запити до /api/health з тим самим «cron» UA — не збільшуємо лічильник ping */
export function shouldExcludeHealthPing(req) {
  if (!req) return false;
  return shouldExcludeByUserAgent(req);
}

/** Викликати лише для реальних заходів на головну сторінку (не API, не cron) */
export function recordPageVisit(req) {
  if (shouldExcludeFromPageStats(req)) return;
  pageVisits += 1;
  uniqueFingerprints.add(fingerprint(req));
  scheduleSaveStats();
}

export function recordHealthPing(req) {
  if (req && shouldExcludeHealthPing(req)) return;
  healthPings += 1;
  scheduleSaveStats();
}

export function getStats() {
  return {
    pageVisits,
    uniqueVisitors: uniqueFingerprints.size,
    /** Запити keep-alive / cron до /api/health (не заходи на сайт) */
    healthPingsCron: healthPings,
  };
}
