/**
 * Екзамени: файл exams.json (локально / DATA_DIR) або Supabase (після деплою на Render).
 * Змінні: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (ті самі, що для reminder)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isSupabaseExamsEnabled() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return Boolean(url && key);
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

function getExamsFilePath() {
  const full = process.env.EXAMS_FILE?.trim();
  if (full) return path.resolve(full);
  const dataDir = process.env.DATA_DIR?.trim();
  if (dataDir) return path.join(path.resolve(dataDir), 'exams.json');
  return path.join(__dirname, 'exams.json');
}

function readAllExamsFromDisk() {
  try {
    const raw = fs.readFileSync(getExamsFilePath(), 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j.exams) ? j.exams : [];
  } catch {
    return [];
  }
}

function writeAllExamsToDisk(exams) {
  const file = getExamsFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ exams }, null, 2)}\n`, 'utf8');
}

function rowToExam(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    date: String(row.exam_date),
    subject: String(row.subject ?? ''),
    timeText: String(row.time_text ?? ''),
    topic: String(row.topic ?? ''),
    zoomUrl: String(row.zoom_url ?? ''),
    createdAt: Number(row.created_at) || 0,
  };
}

function normalizeExamPayload(body) {
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  if (!DATE_RE.test(date)) return { error: 'Некоректна дата (YYYY-MM-DD)' };
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (!subject || subject.length > 200) return { error: 'Предмет обовʼязковий (до 200 символів)' };
  const timeText = typeof body.timeText === 'string' ? body.timeText.trim() : '';
  if (!timeText || timeText.length > 120) return { error: 'Час обовʼязковий (довільний текст, до 120 символів)' };
  let topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  if (topic.length > 500) return { error: 'Тема не довша за 500 символів' };
  if (!topic) topic = '';
  let zoomUrl = typeof body.zoomUrl === 'string' ? body.zoomUrl.trim() : '';
  if (zoomUrl.length > 2000) return { error: 'Посилання занадто довге' };
  if (zoomUrl && !/^https?:\/\//i.test(zoomUrl)) {
    return { error: 'Посилання має починатися з http:// або https://' };
  }
  if (!zoomUrl) zoomUrl = '';
  return { value: { date, subject, timeText, topic, zoomUrl } };
}

export async function getExamsByDate(date) {
  if (!DATE_RE.test(String(date))) return [];

  if (isSupabaseExamsEnabled()) {
    try {
      const supabase = getSupabase();
      if (!supabase) return [];
      const { data, error } = await supabase.from('schedule_exams').select('*').eq('exam_date', date);
      if (error) throw error;
      const list = (data || []).map(rowToExam).filter(Boolean);
      return list.sort((a, b) => String(a.timeText || '').localeCompare(String(b.timeText || ''), 'uk'));
    } catch (err) {
      console.error('exams Supabase read:', err);
      return [];
    }
  }

  return readAllExamsFromDisk()
    .filter((e) => e && e.date === date)
    .sort((a, b) => String(a.timeText || '').localeCompare(String(b.timeText || ''), 'uk'));
}

export async function addExam(body) {
  const v = normalizeExamPayload(body);
  if (v.error) return { error: v.error };
  const id = `exam_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const exam = { id, ...v.value, createdAt: Date.now() };

  if (isSupabaseExamsEnabled()) {
    try {
      const supabase = getSupabase();
      if (!supabase) return { error: 'Supabase не налаштовано' };
      const { error } = await supabase.from('schedule_exams').insert({
        id: exam.id,
        exam_date: exam.date,
        subject: exam.subject,
        time_text: exam.timeText,
        topic: exam.topic,
        zoom_url: exam.zoomUrl,
        created_at: exam.createdAt,
      });
      if (error) throw error;
      return { ok: true, exam };
    } catch (err) {
      console.error('exams Supabase add:', err);
      return { error: 'Не вдалося зберегти екзамен' };
    }
  }

  const exams = readAllExamsFromDisk();
  exams.push(exam);
  try {
    writeAllExamsToDisk(exams);
  } catch (err) {
    console.error('exams write:', err);
    return { error: 'Не вдалося записати файл (права доступу або диск)' };
  }
  return { ok: true, exam };
}

export async function updateExam(body) {
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return { error: 'Потрібне поле id' };
  const v = normalizeExamPayload(body);
  if (v.error) return { error: v.error };

  if (isSupabaseExamsEnabled()) {
    try {
      const supabase = getSupabase();
      if (!supabase) return { error: 'Supabase не налаштовано' };
      const { data: existing, error: e0 } = await supabase.from('schedule_exams').select('id').eq('id', id).maybeSingle();
      if (e0) throw e0;
      if (!existing) return { error: 'Екзамен не знайдено' };
      const { error } = await supabase
        .from('schedule_exams')
        .update({
          exam_date: v.value.date,
          subject: v.value.subject,
          time_text: v.value.timeText,
          topic: v.value.topic,
          zoom_url: v.value.zoomUrl,
        })
        .eq('id', id);
      if (error) throw error;
      const { data: row } = await supabase.from('schedule_exams').select('*').eq('id', id).maybeSingle();
      const full = row ? rowToExam(row) : null;
      if (full) return { ok: true, exam: full };
      return { ok: true, exam: { id, ...v.value, createdAt: 0 } };
    } catch (err) {
      console.error('exams Supabase update:', err);
      return { error: 'Не вдалося оновити екзамен' };
    }
  }

  const exams = readAllExamsFromDisk();
  const i = exams.findIndex((e) => e && e.id === id);
  if (i < 0) return { error: 'Екзамен не знайдено' };
  const prev = exams[i];
  exams[i] = { ...prev, ...v.value, id };
  try {
    writeAllExamsToDisk(exams);
  } catch (err) {
    console.error('exams write:', err);
    return { error: 'Не вдалося записати файл (права доступу або диск)' };
  }
  return { ok: true, exam: exams[i] };
}

export async function deleteExam(id) {
  const sid = typeof id === 'string' ? id.trim() : '';
  if (!sid) return { error: 'Потрібне поле id' };

  if (isSupabaseExamsEnabled()) {
    try {
      const supabase = getSupabase();
      if (!supabase) return { error: 'Supabase не налаштовано' };
      const { data: existing, error: e0 } = await supabase.from('schedule_exams').select('id').eq('id', sid).maybeSingle();
      if (e0) throw e0;
      if (!existing) return { error: 'Екзамен не знайдено' };
      const { error } = await supabase.from('schedule_exams').delete().eq('id', sid);
      if (error) throw error;
      return { ok: true };
    } catch (err) {
      console.error('exams Supabase delete:', err);
      return { error: 'Не вдалося видалити екзамен' };
    }
  }

  const exams = readAllExamsFromDisk();
  const next = exams.filter((e) => !e || e.id !== sid);
  if (next.length === exams.length) return { error: 'Екзамен не знайдено' };
  try {
    writeAllExamsToDisk(next);
  } catch (err) {
    console.error('exams write:', err);
    return { error: 'Не вдалося записати файл (права доступу або диск)' };
  }
  return { ok: true };
}
