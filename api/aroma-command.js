// /api/aroma-command — שינוי שעון ועוצמה במכשיר דרך הענן של Aroma Link.
//
// מסך "צי חכם" → כאן (עם החיבור של המנהל המחובר) → iot_begin_command
// (בודק מנהל + מכשיר מורשה + מחובר, פותח שורה ביומן) → Aroma Link
// device/workSet → קריאה חוזרת של השעון מהמכשיר ואימות → iot_finish_command
// (סוגר את היומן ושומר את השעון החדש ב-iot_devices).
//
// אבטחה:
//  - חובה כותרת Authorization: Bearer <access token של המשתמש המחובר>.
//    כל הבדיקות (מנהל בלבד, control_enabled, online) נעשות ב-Supabase.
//  - שם המשתמש והסיסמה של Aroma Link רק במשתני הסביבה של Vercel.
//
// גוף הבקשה:
//  { iot_device_id, weeks: [0..6], programs: [5 × { enabled, start "HH:MM",
//    end "HH:MM", work_sec 5–900, pause_sec 5–900, level 1|2|3 }] }
//  0 = ראשון. עוצמה: 1=A, 2=B, 3=C.

import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

const AROMA = 'https://www.aroma-link.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const env = (name) => (process.env[name] || '').trim();
const SUPABASE_URL = () => env('VITE_SUPABASE_URL') || env('SUPABASE_URL');
const SUPABASE_ANON = () => env('VITE_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY');

// ---------------------------------------------------------------------
// Aroma Link — התחברות וקריאות (אותו מנגנון כמו /api/aroma-sync)
// ---------------------------------------------------------------------
function collectCookies(res, jar) {
  const list = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') || '').split(/,(?=\s*\w+=)/);
  for (const c of list) {
    const pair = String(c).split(';')[0].trim();
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}
const jarToHeader = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function aromaLogin() {
  const jar = new Map();
  const first = await fetch(`${AROMA}/login`, { headers: { 'User-Agent': UA }, redirect: 'manual' });
  collectCookies(first, jar);
  await first.text().catch(() => '');

  const res = await fetch(`${AROMA}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'User-Agent': UA,
      Origin: AROMA,
      Referer: `${AROMA}/login`,
      ...(jar.size ? { Cookie: jarToHeader(jar) } : {}),
    },
    body: new URLSearchParams({ username: env('AROMA_USERNAME'), password: env('AROMA_PASSWORD') }),
    redirect: 'manual',
  });
  collectCookies(res, jar);
  const text = await res.text();
  let r = null;
  try { r = JSON.parse(text); } catch { r = null; }
  if (!r) throw new Error(`Aroma login: not JSON (HTTP ${res.status})`);
  if (r.code !== 0) throw new Error(`Aroma login rejected: code ${r.code} — ${r.msg || 'no message'}`);
  if (!jar.size) throw new Error('Aroma login OK but no session cookie');
  return jarToHeader(jar);
}

async function aromaRequest(cookie, path, { method = 'GET', json } = {}) {
  const res = await fetch(`${AROMA}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
      'User-Agent': UA,
      ...(json ? { 'Content-Type': 'application/json;charset=utf-8', Origin: AROMA, Referer: `${AROMA}/device` } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Aroma ${path}: not JSON (HTTP ${res.status})`);
  }
}

async function readDay(cookie, deviceId, week) {
  const r = await aromaRequest(cookie, `/device/workTime/${deviceId}?week=${week}`);
  if (r.code !== 200) throw new Error(`קריאת השעון נכשלה (יום ${week}, code ${r.code})`);
  return {
    week,
    programs: (r.data || []).map((p) => ({
      enabled: p.enabled === 1,
      start: p.startHour,
      end: p.endHour,
      work_sec: p.workSec,
      pause_sec: p.pauseSec,
      level: p.consistenceLevel,
    })),
  };
}

async function readWeeks(cookie, deviceId, weeks) {
  const out = [];
  for (const w of weeks) out.push(await readDay(cookie, deviceId, w));
  return out;
}

// ---------------------------------------------------------------------
// בדיקת הקלט — אותם גבולות כמו בפורטל של Aroma Link
// ---------------------------------------------------------------------
function validate(body) {
  const weeks = [...new Set((body.weeks || []).map(Number))].filter((w) => Number.isInteger(w) && w >= 0 && w <= 6).sort();
  if (!weeks.length) throw new Error('צריך לבחור לפחות יום אחד');

  const programs = body.programs;
  if (!Array.isArray(programs) || programs.length !== 5) throw new Error('צריך בדיוק 5 תוכניות');

  const clean = programs.map((p, i) => {
    const enabled = p.enabled === true;
    const start = String(p.start || '00:00');
    const end = String(p.end || '00:00');
    const work = Number(p.work_sec);
    const pause = Number(p.pause_sec);
    const level = Number(p.level || 1);
    if (enabled) {
      const n = i + 1;
      if (!HHMM.test(start) || !HHMM.test(end)) throw new Error(`תוכנית ${n}: שעה לא תקינה`);
      if (end <= start) throw new Error(`תוכנית ${n}: שעת הסיום חייבת להיות אחרי שעת ההתחלה`);
      if (!Number.isInteger(work) || work < 5 || work > 900) throw new Error(`תוכנית ${n}: זמן ריסוס 5–900 שניות`);
      if (!Number.isInteger(pause) || pause < 5 || pause > 900) throw new Error(`תוכנית ${n}: זמן הפסקה 5–900 שניות`);
      if (![1, 2, 3].includes(level)) throw new Error(`תוכנית ${n}: עוצמה לא תקינה`);
    }
    return {
      enabled,
      start: HHMM.test(start) ? start : '00:00',
      end: HHMM.test(end) ? end : '00:00',
      work_sec: Number.isInteger(work) && work >= 5 && work <= 900 ? work : 10,
      pause_sec: Number.isInteger(pause) && pause >= 5 && pause <= 900 ? pause : 120,
      level: [1, 2, 3].includes(level) ? level : 1,
    };
  });
  return { weeks, programs: clean };
}

// האם השעון שנקרא מהמכשיר תואם למה ששלחנו
function matches(day, programs) {
  const got = day.programs || [];
  return programs.every((p, i) => {
    const g = got[i];
    if (!g) return !p.enabled;
    if (Boolean(g.enabled) !== p.enabled) return false;
    if (!p.enabled) return true;
    return g.start === p.start && g.end === p.end
      && Number(g.work_sec) === p.work_sec && Number(g.pause_sec) === p.pause_sec
      && Number(g.level) === p.level;
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!SUPABASE_URL() || !SUPABASE_ANON() || !env('AROMA_USERNAME') || !env('AROMA_PASSWORD')) {
    res.status(500).json({ error: 'חסרים משתני סביבה ב-Vercel' });
    return;
  }

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'צריך להתחבר למערכת' });
    return;
  }

  let body = {};
  try { body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}'); } catch { body = {}; }

  let input;
  try {
    input = validate(body);
  } catch (e) {
    res.status(400).json({ error: e.message });
    return;
  }

  // Supabase עם החיבור של המנהל עצמו — כל ההרשאות נבדקות שם
  const supabase = createClient(SUPABASE_URL(), SUPABASE_ANON(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: begin, error: beginErr } = await supabase.rpc('iot_begin_command', {
    p_iot_device_id: body.iot_device_id,
    p_command: 'work_time',
    p_payload: input,
  });
  if (beginErr) {
    res.status(403).json({ error: beginErr.message });
    return;
  }

  const logId = begin.log_id;
  const deviceId = begin.aroma_device_id;
  let before = null;

  const finish = (ok, result, schedule) => supabase.rpc('iot_finish_command', {
    p_log_id: logId, p_ok: ok, p_before: before, p_result: result, p_schedule: schedule,
  });

  try {
    const cookie = await aromaLogin();

    // 1. השעון לפני השינוי — נשמר ביומן כדי שתמיד אפשר יהיה לחזור
    before = await readWeeks(cookie, deviceId, input.weeks);

    // 2. שליחה — בדיוק במבנה שהפורטל של Aroma Link שולח
    const r = await aromaRequest(cookie, '/device/workSet', {
      method: 'POST',
      json: {
        deviceId: String(deviceId),
        week: input.weeks,
        type: 'workTime',
        workTimeList: input.programs.map((p) => ({
          startTime: p.start,
          endTime: p.end,
          enabled: p.enabled ? 1 : 0,
          consistenceLevel: String(p.level),
          workDuration: String(p.work_sec),
          pauseDuration: String(p.pause_sec),
        })),
      },
    });

    if (r.code !== 200) {
      await finish(false, { aroma: r }, null);
      res.status(502).json({ error: `Aroma Link דחו את השינוי (code ${r.code}${r.msg ? ` — ${r.msg}` : ''})` });
      return;
    }

    // 3. קריאה חוזרת של כל השבוע מהמכשיר ואימות
    await sleep(2500);
    const after = await readWeeks(cookie, deviceId, [0, 1, 2, 3, 4, 5, 6]);
    const verified = input.weeks.every((w) => matches(after.find((d) => d.week === w) || {}, input.programs));

    const { error: finErr } = await finish(verified, { aroma: r, verified }, after);
    if (finErr) console.error('iot_finish_command failed', finErr.message);

    res.status(200).json({ ok: true, verified });
  } catch (e) {
    console.error('aroma-command failed', e);
    await finish(false, { error: String(e.message || e) }, null).catch(() => {});
    res.status(502).json({ error: String(e.message || e) });
  }
}
