// /api/aroma-sync — סנכרון "צי חכם" מהענן של Aroma Link (Vercel Serverless, Node.js).
//
// pg_cron (כל 5 דקות) → כאן → התחברות ל-aroma-link.com → קריאת סטטוס המכשירים
// → RPC ingest_aroma_snapshot ב-Supabase (iconair_schema_phase55_smart_fleet.sql).
//
// קריאה בלבד: הקובץ הזה לא שולח שום פקודה למכשירים.
//
// אבטחה:
//  - הקריאה חייבת לכלול כותרת x-sync-secret. הסוד נבדק מול ה-Vault ב-Supabase
//    (iot_check_sync_secret) לפני שמתחברים ל-Aroma Link בכלל.
//  - שם המשתמש והסיסמה של Aroma Link נמצאים רק במשתני הסביבה של Vercel:
//      AROMA_USERNAME / AROMA_PASSWORD   (משתמש נפרד שנפתח במיוחד למערכת)
//    ולא בקוד ולא ב-UI.
//
// השעון (7 ימים × עד 5 תוכניות) דורש 7 קריאות לכל מכשיר, לכן הוא לא נמשך
// בכל ריצה: כל מכשיר מקבל "תור" קבוע פעם ביום (לפי מספר המכשיר), או מיד
// כשהמכשיר חדש במערכת / כשמבקשים {"schedule": true}.

import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

const AROMA = 'https://www.aroma-link.com';
const TZ = 'Asia/Jerusalem';
const SLOTS_PER_DAY = 288; // 24 שעות × 12 ריצות בשעה (כל 5 דקות)
const CONCURRENCY = 6;

const env = (name) => (process.env[name] || '').trim();
const SUPABASE_URL = () => env('VITE_SUPABASE_URL') || env('SUPABASE_URL');
const SUPABASE_ANON = () => env('VITE_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY');

// ---------------------------------------------------------------------
// Aroma Link — התחברות וקריאות
// ---------------------------------------------------------------------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

// אוסף את העוגיות שהשרת מחזיר (Set-Cookie) לתוך "צנצנת" אחת
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

// כמו בדפדפן: קודם פותחים את דף הכניסה (מקבלים עוגיית סשן),
// ואז שולחים שם משתמש וסיסמה עם אותה עוגייה. הצלחה = code 0.
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
  if (!jar.size) throw new Error(`Aroma login OK (code 0) but no session cookie (HTTP ${res.status})`);
  return jarToHeader(jar);
}

async function aromaGet(cookie, path) {
  const res = await fetch(`${AROMA}${path}`, {
    headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json', 'User-Agent': UA },
    redirect: 'manual',
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // דף HTML במקום JSON = ההתחברות נכשלה או פגה
    throw new Error(`Aroma ${path}: not JSON (HTTP ${res.status}) — session expired or wrong credentials?`);
  }
}

async function listAllDevices(cookie) {
  const rows = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const q = `limit=100&offset=${offset}&selectUserId=&groupId=&deviceName=&imei=&deviceNo=&workStatus=&continentId=&countryId=&areaId=&sort=&order=`;
    const page = await aromaGet(cookie, `/device/list/v2?${q}`);
    rows.push(...(page.rows || []));
    if (!page.rows || page.rows.length < 100 || rows.length >= (page.total || 0)) break;
  }
  return rows;
}

// ---------------------------------------------------------------------
// עזרים
// ---------------------------------------------------------------------
// "20261010171409" (שעון ישראל) → ISO עם ההיסט הנכון (קיץ/חורף)
function hostTimeToIso(s) {
  if (!/^\d{14}$/.test(s || '')) return null;
  const [y, mo, d, h, mi, se] = [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8), s.slice(8, 10), s.slice(10, 12), s.slice(12, 14)];
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  const tzName = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(new Date(asUtc)).find((p) => p.type === 'timeZoneName')?.value || 'GMT+02:00';
  const m = tzName.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  const offsetMin = m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0)) : 120;
  return new Date(asUtc - offsetMin * 60000).toISOString();
}

function currentSlot() {
  const now = new Date();
  return Math.floor((now.getUTCHours() * 60 + now.getUTCMinutes()) / 5) % SLOTS_PER_DAY;
}

async function pool(items, worker) {
  const out = new Array(items.length);
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await worker(items[idx]); } catch (e) { out[idx] = { error: String(e.message || e) }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return out;
}

async function readSchedule(cookie, deviceId) {
  const days = [];
  for (let week = 0; week < 7; week++) {
    const r = await aromaGet(cookie, `/device/workTime/${deviceId}?week=${week}`);
    if (r.code !== 200) return null;
    days.push({
      week,
      programs: (r.data || []).map((p) => ({
        enabled: p.enabled === 1,
        start: p.startHour,
        end: p.endHour,
        work_sec: p.workSec,
        pause_sec: p.pauseSec,
        level: p.consistenceLevel,
      })),
    });
  }
  return days;
}

// ---------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, service: 'aroma-sync' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!SUPABASE_URL() || !SUPABASE_ANON()) {
    res.status(500).json({ error: 'Supabase env vars missing' });
    return;
  }
  if (!env('AROMA_USERNAME') || !env('AROMA_PASSWORD')) {
    res.status(500).json({ error: 'AROMA_USERNAME / AROMA_PASSWORD missing in Vercel env' });
    return;
  }

  const secret = String(req.headers['x-sync-secret'] || '');
  const supabase = createClient(SUPABASE_URL(), SUPABASE_ANON(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: okSecret, error: secretErr } = await supabase.rpc('iot_check_sync_secret', { p_secret: secret });
  if (secretErr || okSecret !== true) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  let body = {};
  try { body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}'); } catch { body = {}; }
  const forceSchedule = body.schedule === true;
  const slot = currentSlot();

  try {
    const cookie = await aromaLogin();
    const rows = await listAllDevices(cookie);

    const devices = await pool(rows, async (r) => {
      const online = r.onlineStatus === 1;
      const item = {
        aroma_device_id: r.deviceId,
        mac: r.deviceNo,
        aroma_name: r.deviceName,
        aroma_type_code: r.typeCode,
        firmware: r.version,
        net_type: r.netType,
        online,
        online_error: r.onlineErrorStatus,
        is_locked: r.isLock === 1,
        has_weight_sensor: r.hasWeight === 1,
        remain_oil: r.remainOil,
        raw: r,
      };

      // תקלה בקריאת הפרטים של מכשיר אחד לא מפילה את הסטטוס שלו
      if (online) {
        try {
          const now = await aromaGet(cookie, `/device/deviceInfoNow/${r.deviceId}`);
          if (now.code === 200 && now.data) {
            item.power_on = now.data.onOff === 1;
            item.work_status = now.data.workStatus;
            item.work_remain_sec = now.data.workRemainTime;
            item.pause_remain_sec = now.data.pauseRemainTime;
            item.device_time = hostTimeToIso(now.data.hostTime);
          }
          if (forceSchedule || r.deviceId % SLOTS_PER_DAY === slot) {
            const schedule = await readSchedule(cookie, r.deviceId);
            if (schedule) item.schedule = schedule;
          }
        } catch (e) {
          item.detail_error = String(e.message || e);
        }
      }
      return item;
    });

    const good = devices.filter((d) => d && !d.error);
    const failed = devices.filter((d) => d && (d.error || d.detail_error));

    const { data, error } = await supabase.rpc('ingest_aroma_snapshot', { p_secret: secret, p_devices: good });
    if (error) {
      console.error('ingest_aroma_snapshot failed', error.code, error.message);
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ ...data, failed: failed.length });
  } catch (e) {
    console.error('aroma-sync failed', e);
    res.status(502).json({ error: String(e.message || e) });
  }
}
