/**
 * «Важливо»: файл (локально) або Supabase (Render без платного Disk).
 * Змінні: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function isSupabaseReminderEnabled() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return Boolean(url && key);
}

function getReminderFilePath() {
  const full = process.env.REMINDER_FILE?.trim();
  if (full) return path.resolve(full);
  const dataDir = process.env.DATA_DIR?.trim();
  if (dataDir) return path.join(path.resolve(dataDir), 'reminder.json');
  return path.join(__dirname, 'reminder.json');
}

/** Короткий кеш readReminder — зменшує подвійні запити до Supabase при GET /api/reminder */
let reminderReadCache = null;
const REMINDER_READ_CACHE_MS = 45_000;

function invalidateReminderReadCache() {
  reminderReadCache = null;
}

let supabaseClient = null;
function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  supabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
}

/** --- Файл (sync) --- */

function readReminderFromDisk() {
  const reminderFile = getReminderFilePath();
  try {
    const raw = fs.readFileSync(reminderFile, 'utf8');
    const j = JSON.parse(raw);
    const text = typeof j.text === 'string' ? j.text : '';
    let updatedAt = Number(j.updatedAt);
    if (text && (!Number.isFinite(updatedAt) || updatedAt <= 0)) {
      updatedAt = Date.now();
      const hist = Array.isArray(j.history) ? j.history : [];
      fs.mkdirSync(path.dirname(reminderFile), { recursive: true });
      fs.writeFileSync(reminderFile, JSON.stringify({ text, updatedAt, history: hist }), 'utf8');
    }
    if (!Number.isFinite(updatedAt)) updatedAt = 0;
    let history = [];
    if (Array.isArray(j.history)) {
      history = j.history
        .filter((h) => h && typeof h.text === 'string' && Number.isFinite(Number(h.updatedAt)))
        .map((h) => ({ text: h.text, updatedAt: Number(h.updatedAt) }));
    }
    return { text, updatedAt, history };
  } catch {
    return { text: '', updatedAt: 0, history: [] };
  }
}

function writeReminderPayload(payload) {
  const reminderFile = getReminderFilePath();
  fs.mkdirSync(path.dirname(reminderFile), { recursive: true });
  fs.writeFileSync(reminderFile, JSON.stringify(payload), 'utf8');
  return payload;
}

function writeReminderToDisk(text) {
  const prev = readReminderFromDisk();
  const history = Array.isArray(prev.history) ? [...prev.history] : [];
  const newText = String(text ?? '');
  if (prev.text && prev.text.trim() && prev.text !== newText && prev.updatedAt > 0) {
    history.unshift({ text: prev.text, updatedAt: prev.updatedAt });
  }
  while (history.length > 50) history.pop();
  const updatedAt = Date.now();
  return writeReminderPayload({ text: newText, updatedAt, history });
}

function deleteReminderScopeDisk(scope) {
  const r = readReminderFromDisk();
  if (scope === 'current') {
    return writeReminderPayload({ text: '', updatedAt: 0, history: r.history });
  }
  if (scope === 'history') {
    return writeReminderPayload({ text: r.text, updatedAt: r.updatedAt, history: [] });
  }
  if (scope === 'all') {
    return writeReminderPayload({ text: '', updatedAt: 0, history: [] });
  }
  throw new Error('Невідомий scope');
}

function deleteReminderHistoryItemDisk(index) {
  const r = readReminderFromDisk();
  const hist = Array.isArray(r.history) ? [...r.history] : [];
  if (!Number.isFinite(index) || index < 0 || index >= hist.length) {
    throw new Error('Некоректний індекс історії');
  }
  hist.splice(index, 1);
  return writeReminderPayload({ text: r.text, updatedAt: r.updatedAt, history: hist });
}

/** --- Supabase --- */

async function readReminderFromSupabase() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase не налаштовано');

  const { data: cur, error: e1 } = await supabase
    .from('reminder_current')
    .select('body,updated_at')
    .eq('id', 1)
    .maybeSingle();
  if (e1) throw e1;

  const text = typeof cur?.body === 'string' ? cur.body : '';
  let updatedAt = Number(cur?.updated_at ?? 0);
  if (!Number.isFinite(updatedAt)) updatedAt = 0;

  const { data: rows, error: e2 } = await supabase
    .from('reminder_history')
    .select('body,updated_at')
    .order('updated_at', { ascending: false })
    .limit(50);
  if (e2) throw e2;

  const history = (rows || []).map((r) => ({
    text: typeof r.body === 'string' ? r.body : '',
    updatedAt: Number(r.updated_at) || 0,
  }));

  return { text, updatedAt, history };
}

async function writeReminderToSupabase(text) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase не налаштовано');

  const prev = await readReminderFromSupabase();
  const newText = String(text ?? '');
  if (prev.text && prev.text.trim() && prev.text !== newText && prev.updatedAt > 0) {
    const { error: insErr } = await supabase.from('reminder_history').insert({
      body: prev.text,
      updated_at: prev.updatedAt,
    });
    if (insErr) throw insErr;

    const { data: idsRows, error: listErr } = await supabase
      .from('reminder_history')
      .select('id')
      .order('updated_at', { ascending: false });
    if (listErr) throw listErr;
    const ids = (idsRows || []).map((r) => r.id);
    if (ids.length > 50) {
      const toRemove = ids.slice(50);
      const { error: delErr } = await supabase.from('reminder_history').delete().in('id', toRemove);
      if (delErr) throw delErr;
    }
  }

  const updatedAt = Date.now();
  const { error: upErr } = await supabase.from('reminder_current').upsert(
    { id: 1, body: newText, updated_at: updatedAt },
    { onConflict: 'id' },
  );
  if (upErr) throw upErr;

  return readReminderFromSupabase();
}

async function deleteReminderScopeSupabase(scope) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase не налаштовано');

  if (scope === 'current') {
    const r = await readReminderFromSupabase();
    const { error } = await supabase
      .from('reminder_current')
      .upsert({ id: 1, body: '', updated_at: 0 }, { onConflict: 'id' });
    if (error) throw error;
    return { text: '', updatedAt: 0, history: r.history };
  }
  if (scope === 'history') {
    const r = await readReminderFromSupabase();
    const { error } = await supabase.from('reminder_history').delete().gte('id', 0);
    if (error) throw error;
    return { text: r.text, updatedAt: r.updatedAt, history: [] };
  }
  if (scope === 'all') {
    const { error: e1 } = await supabase.from('reminder_history').delete().gte('id', 0);
    if (e1) throw e1;
    const { error: e2 } = await supabase
      .from('reminder_current')
      .upsert({ id: 1, body: '', updated_at: 0 }, { onConflict: 'id' });
    if (e2) throw e2;
    return { text: '', updatedAt: 0, history: [] };
  }
  throw new Error('Невідомий scope');
}

async function deleteReminderHistoryItemSupabase(index) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase не налаштовано');

  const { data: rows, error: e1 } = await supabase
    .from('reminder_history')
    .select('id')
    .order('updated_at', { ascending: false })
    .limit(50);
  if (e1) throw e1;
  const list = rows || [];
  if (!Number.isFinite(index) || index < 0 || index >= list.length) {
    throw new Error('Некоректний індекс історії');
  }
  const id = list[index].id;
  const { error: e2 } = await supabase.from('reminder_history').delete().eq('id', id);
  if (e2) throw e2;
  return readReminderFromSupabase();
}

/** --- Уніфікований API --- */

export async function readReminder() {
  const now = Date.now();
  if (reminderReadCache && now - reminderReadCache.at < REMINDER_READ_CACHE_MS) {
    return reminderReadCache.data;
  }
  let data;
  if (isSupabaseReminderEnabled()) {
    data = await readReminderFromSupabase();
  } else {
    data = readReminderFromDisk();
  }
  reminderReadCache = { at: now, data };
  return data;
}

export async function writeReminder(text) {
  invalidateReminderReadCache();
  if (isSupabaseReminderEnabled()) {
    return writeReminderToSupabase(text);
  }
  return writeReminderToDisk(text);
}

export async function deleteReminderScope(scope) {
  invalidateReminderReadCache();
  if (isSupabaseReminderEnabled()) {
    return deleteReminderScopeSupabase(scope);
  }
  return deleteReminderScopeDisk(scope);
}

export async function deleteReminderHistoryItem(index) {
  invalidateReminderReadCache();
  if (isSupabaseReminderEnabled()) {
    return deleteReminderHistoryItemSupabase(index);
  }
  return deleteReminderHistoryItemDisk(index);
}
