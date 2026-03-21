// In-memory статистика відвідувань (перезапуск сервера обнуляє)

import crypto from 'crypto';

let pageVisits = 0;
/** Унікальні відвідувачі за відбитком IP + User-Agent */
const uniqueFingerprints = new Set();
/** Запити до /api/health (cron-job.org тощо) — не входять у pageVisits */
let healthPings = 0;

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) {
    return xf.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '';
}

function fingerprint(req) {
  const ip = getClientIp(req);
  const ua = (req.headers['user-agent'] || '').slice(0, 200);
  return crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 32);
}

/** Викликати лише для реальних заходів на головну сторінку (не API, не cron) */
export function recordPageVisit(req) {
  pageVisits += 1;
  uniqueFingerprints.add(fingerprint(req));
}

export function recordHealthPing() {
  healthPings += 1;
}

export function getStats() {
  return {
    pageVisits,
    uniqueVisitors: uniqueFingerprints.size,
    /** Запити keep-alive / cron до /api/health (не заходи на сайт) */
    healthPingsCron: healthPings,
  };
}
