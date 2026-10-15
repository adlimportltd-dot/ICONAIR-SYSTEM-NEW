import { supabase } from './supabase';
import { getOpenServiceCalls, listFieldNotes, resolveFieldNote } from './queries';
import { listOpenDisconnections, daysUntil, fmtDay } from './disconnections';

/**
 * מרכז התראות (phase69) — כל מה שדורש טיפול, ממקום אחד, בפעמון למעלה (מנהלים בלבד).
 *
 * מקורות:
 *   צי חכם (iot_devices) — מנותק 30+ דק', מיכל ריק/נמוך, שעון לא מדויק, נעול, לא מסווג.
 *   דיווחי מכשיר חסר/נגנב (device_theft_reports, status=pending) — מאשרים בטאב מסלולים.
 *   קריאות שירות פתוחות (getOpenServiceCalls) — מטפלים בטאב קריאות שירות.
 *   הערות שטח פתוחות (listFieldNotes) — "טופל" מסמן אותן ב-field_note_flags (הקיים).
 *
 * "טופל" בהתראות הצי החכם נשמר ב-alert_acks עם signature. אם הבעיה חוזרת (ניתוק
 * חדש = last_offline_at אחר, התראת מיכל חדשה = oil_alert_sent_at אחר) ה-signature
 * משתנה וההתראה מופיעה שוב.
 */

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/* =====================================================================
   phase77 — בדיקת תקינות (קריאה בלבד, לא משנה שום נתון).
   תופסת מוקדם את סוגי הטעויות שמצאנו ב-15.10:
     1. מילוי כפול — אותו מכשיר, שני מילויים בהפרש של פחות משעה.
     2. מילוי 0 מ"ל בלי הערה.
     3. מילוי חריג — יותר מנפח המכל של הדגם.
     4. תחנה שסומנה "בוצע" החודש בלי אף רישום שמן באותה כתובת.
     5. אחרי סוף מחזור הקו — תחנות שעוד לא בוצעו (שורה אחת לכל קו).
   כל התראה ניתנת לסימון "טופל" (alert_acks), וחוזרת רק אם הנתון משתנה.
   ===================================================================== */
const INTEGRITY_DAYS = 14;
const DUP_MINUTES = 60;
const RESET_NOTE = 'איפוס תחילת מחזור';

function stopLabel(dev) {
  const name = dev?.customer?.name ?? 'לקוח';
  const where = [dev?.site?.label, dev?.location_note].filter(Boolean).join(' · ');
  return where ? `${name} — ${where}` : name;
}
const ml = (liters) => `${Math.round(Number(liters || 0) * 1000)} מ"ל`;
const dayLabel = (iso) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' });

async function loadIntegrityAlerts() {
  const now = new Date();
  const since = new Date(now.getTime() - INTEGRITY_DAYS * 86400000).toISOString();
  const pad = (n) => String(n).padStart(2, '0');
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthStart = `${nextMonth.getFullYear()}-${pad(nextMonth.getMonth() + 1)}-01`;
  const monthStartTs = new Date(`${monthStart}T00:00:00+03:00`).toISOString();

  const [oil, models, monthOil, assignments] = await Promise.all([
    supabase
      .from('oil_tracking')
      .select('id, device_id, event_type, liters_added, notes, recorded_at, device:devices(model, location_note, customer:customers(name), site:customer_sites(label))')
      .gte('recorded_at', since)
      .order('recorded_at', { ascending: true })
      .limit(5000)
      .then(unwrap),
    supabase.from('device_models').select('name, capacity_ml').then(unwrap),
    supabase
      .from('oil_tracking')
      .select('notes, device:devices(customer_id, site_id)')
      .gte('recorded_at', monthStartTs)
      .limit(10000)
      .then(unwrap),
    supabase
      .from('route_assignments')
      .select('id, customer_id, site_id, status, visit_date, route:routes(name, cycle_end_day), customer:customers(name, status), site:customer_sites(label)')
      .gte('visit_date', monthStart)
      .lt('visit_date', nextMonthStart)
      .then(unwrap),
  ]);

  const list = [];
  const capacity = new Map(models.map((m) => [m.name, Number(m.capacity_ml) || null]));

  // 1–3: מילויים
  // מילוי 0 שיש לידו (±12 שעות) מילוי אמיתי לאותו מכשיר = שארית של "סיום ביקור" כפול — לא חשוד
  const realRefillTimes = new Map();
  for (const r of oil) {
    if (r.event_type !== 'refill' || !(Number(r.liters_added) > 0)) continue;
    if (!realRefillTimes.has(r.device_id)) realRefillTimes.set(r.device_id, []);
    realRefillTimes.get(r.device_id).push(new Date(r.recorded_at).getTime());
  }
  const hasRealNear = (r) => (realRefillTimes.get(r.device_id) ?? [])
    .some((t) => Math.abs(t - new Date(r.recorded_at).getTime()) <= 12 * 3600000);
  const lastRefill = new Map();
  for (const r of oil) {
    if (r.event_type !== 'refill') continue;
    const liters = Number(r.liters_added || 0);
    const title = stopLabel(r.device);
    const model = r.device?.model ?? '';

    const prev = lastRefill.get(r.device_id);
    if (prev && liters > 0 && Number(prev.liters_added || 0) > 0) {
      const gap = (new Date(r.recorded_at) - new Date(prev.recorded_at)) / 60000;
      if (gap < DUP_MINUTES) {
        list.push({
          key: `int-dup:${r.id}`, sig: `${prev.id}`, level: 'crit', group: 'integrity', title,
          text: `מילוי כפול? ${model} · ${ml(prev.liters_added)} ואז ${ml(liters)} בהפרש ${Math.max(1, Math.round(gap))} דק' (${dayLabel(r.recorded_at)})`,
          at: r.recorded_at, target: 'oils',
        });
      }
    }
    lastRefill.set(r.device_id, r);

    if (liters === 0 && !String(r.notes ?? '').trim() && !hasRealNear(r)) {
      list.push({
        key: `int-zero:${r.id}`, sig: '0', level: 'warn', group: 'integrity', title,
        text: `מילוי של 0 מ"ל בלי הערה · ${model} (${dayLabel(r.recorded_at)}) — לבדוק עם הטכנאי כמה מילא`,
        at: r.recorded_at, target: 'oils',
      });
    }

    const cap = capacity.get(model);
    if (cap && liters * 1000 > cap) {
      list.push({
        key: `int-over:${r.id}`, sig: String(liters), level: 'warn', group: 'integrity', title,
        text: `מילוי חריג: ${ml(liters)} ב-${model} שהמכל שלו ${cap} מ"ל (${dayLabel(r.recorded_at)})`,
        at: r.recorded_at, target: 'oils',
      });
    }
  }

  // 4–5: תחנות החודש
  const withOil = new Set();
  for (const r of monthOil) {
    if (String(r.notes ?? '').startsWith(RESET_NOTE)) continue;
    const k = r.device?.site_id ?? r.device?.customer_id;
    if (k) withOil.add(k);
  }

  const RANK = { done: 2, skipped: 1, pending: 0 };
  const stops = new Map();
  for (const a of assignments) {
    if (a.customer && a.customer.status !== 'active') continue;
    const k = a.site_id ?? a.customer_id;
    const prev = stops.get(k);
    if (!prev || (RANK[a.status] ?? 0) > (RANK[prev.status] ?? 0)) stops.set(k, a);
  }

  const today = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', day: 'numeric' }));
  const lateByRoute = new Map();
  for (const [k, a] of stops) {
    const name = a.site?.label ? `${a.customer?.name ?? 'לקוח'} — ${a.site.label}` : (a.customer?.name ?? 'לקוח');
    if (a.status === 'done' && !withOil.has(k)) {
      list.push({
        key: `int-doneempty:${a.id}`, sig: monthStart, level: 'warn', group: 'integrity', title: name,
        text: 'סומן "בוצע" החודש אבל אין אף רישום שמן בכתובת — ייתכן שהביקור לא נקלט',
        target: 'routes',
      });
    }
    const end = a.route?.cycle_end_day;
    if (a.status === 'pending' && end && today > end) {
      const r = a.route.name;
      if (!lateByRoute.has(r)) lateByRoute.set(r, { end, names: [] });
      lateByRoute.get(r).names.push(name);
    }
  }
  for (const [route, { end, names }] of lateByRoute) {
    list.push({
      key: `int-late:${route}:${monthStart}`, sig: String(names.length), level: 'warn', group: 'integrity',
      title: `${route}: ${names.length} תחנות לא בוצעו במחזור`,
      text: `המחזור נגמר ב-${end} לחודש. ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` ועוד ${names.length - 4}` : ''}`,
      target: 'routes',
    });
  }

  return list;
}

const OFFLINE_MIN = 30;
const DRIFT_MIN = 10;

function iotName(d) {
  if (d.owner_type === 'rental' && d.device?.customer?.name) {
    const where = [d.device.site?.label, d.device.location_note].filter(Boolean).join(' · ');
    return where ? `${d.device.customer.name} — ${where}` : d.device.customer.name;
  }
  if (d.owner_type === 'private' && d.owner_name) return d.owner_name;
  return d.aroma_name ?? 'מכשיר';
}

export async function loadAlerts() {
  const [iot, acks, thefts, calls, notes, queues, disconnections, integrity] = await Promise.all([
    supabase
      .from('iot_devices')
      .select(`id, aroma_name, owner_type, owner_name, online, is_locked, last_online_at, last_offline_at,
        last_sync_at, device_time, has_oil_gauge, remain_oil, oil_alert_sent_at,
        device:devices(location_note, site:customer_sites(label), customer:customers(name))`)
      .then(unwrap),
    supabase.from('alert_acks').select('alert_key, signature').then(unwrap).catch(() => []),
    supabase
      .from('device_theft_reports')
      .select('id, reported_at, device:devices(serial, model, location_note, customer:customers(name)), site:customer_sites(label)')
      .eq('status', 'pending')
      .order('reported_at', { ascending: true })
      .then(unwrap)
      .catch(() => []),
    getOpenServiceCalls(30).catch(() => []),
    listFieldNotes({ onlyOpen: true, limit: 200 }).catch(() => []),
    // phase74: ביקורים שתקועים בטלפון של טכנאי ולא נקלטו בשרת
    supabase
      .from('offline_queue_status')
      .select('user_id, pending, failed, oldest_pending_at, updated_at, user:profiles(full_name)')
      .or('pending.gt.0,failed.gt.0')
      .then(unwrap)
      .catch(() => []),
    // phase75: ניתוקי לקוחות מתוכננים
    listOpenDisconnections().catch(() => []),
    // phase77: בדיקת תקינות
    loadIntegrityAlerts().catch((e) => { console.warn('integrity check failed', e); return []; }),
  ]);

  const acked = new Map(acks.map((a) => [a.alert_key, a.signature]));
  const isAcked = (key, sig) => acked.has(key) && acked.get(key) === String(sig ?? '');
  const now = Date.now();
  const list = [];

  for (const d of iot) {
    if (d.owner_type === 'test') continue;
    const name = iotName(d);

    if (!d.online) {
      const since = d.last_offline_at || d.last_online_at;
      const mins = since ? (now - new Date(since).getTime()) / 60000 : Infinity;
      if (mins >= OFFLINE_MIN) {
        list.push({ key: `iot-offline:${d.id}`, sig: since ?? '', level: 'crit', group: 'fleet', title: name, text: 'מכשיר מנותק', at: since, target: 'smart_fleet' });
      }
      continue; // מכשיר מנותק — שאר הבדיקות לא רלוונטיות
    }
    if (d.has_oil_gauge && d.remain_oil != null && Number(d.remain_oil) < 15) {
      const empty = Number(d.remain_oil) <= 0;
      list.push({
        key: `iot-oil:${d.id}`, sig: d.oil_alert_sent_at ?? `${empty ? 'empty' : 'low'}`,
        level: empty ? 'crit' : 'warn', group: 'fleet', title: name,
        text: empty ? 'המיכל ריק' : `מיכל נמוך · ${Math.round(Number(d.remain_oil))}%`, at: d.oil_alert_sent_at, target: 'smart_fleet',
      });
    }
    if (d.is_locked) {
      list.push({ key: `iot-locked:${d.id}`, sig: 'locked', level: 'warn', group: 'fleet', title: name, text: 'המכשיר נעול מהענן — לא מרסס', target: 'smart_fleet' });
    }
    if (d.device_time && d.last_sync_at) {
      const drift = Math.abs(new Date(d.device_time).getTime() - new Date(d.last_sync_at).getTime()) / 60000;
      if (drift >= DRIFT_MIN) {
        list.push({ key: `iot-drift:${d.id}`, sig: 'drift', level: 'info', group: 'fleet', title: name, text: `השעון במכשיר לא מדויק (${Math.round(drift)} דק')`, target: 'smart_fleet' });
      }
    }
    if (!d.owner_type) {
      list.push({ key: `iot-unclassified:${d.id}`, sig: 'x', level: 'info', group: 'fleet', title: name, text: 'מכשיר חדש בענן — צריך סיווג', target: 'smart_fleet' });
    }
  }

  // phase74: טלפון של טכנאי עם ביקורים שלא נקלטו. ההתראה נעלמת לבד כשהתור מתרוקן.
  const hhmm = (iso) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  for (const q of queues) {
    const who = q.user?.full_name || 'טכנאי';
    if (q.failed > 0) {
      list.push({
        key: `queue-failed:${q.user_id}`, level: 'crit', group: 'queue', fixed: true, title: who,
        text: `${q.failed} ביקורים נכשלו בשליחה מהטלפון ולא נקלטו במערכת — צריך לבדוק איתו`, at: q.updated_at,
      });
    }
    const oldMin = q.oldest_pending_at ? (now - new Date(q.oldest_pending_at).getTime()) / 60000 : 0;
    if (q.pending > 0 && oldMin >= 30) {
      list.push({
        key: `queue-pending:${q.user_id}`, level: 'warn', group: 'queue', fixed: true, title: who,
        text: `${q.pending} ביקורים ממתינים בטלפון ועוד לא נקלטו (הוותיק מ-${hhmm(q.oldest_pending_at)}). ייקלטו לבד כשתהיה קליטה`, at: q.oldest_pending_at,
      });
    }
  }

  for (const t of thefts) {
    const name = t.device?.customer?.name ?? 'לקוח';
    list.push({
      key: `theft:${t.id}`, level: 'crit', group: 'theft', fixed: true,
      title: t.site?.label ? `${name} — ${t.site.label}` : name,
      text: `דיווח מכשיר חסר · ${t.device?.model ?? ''} ${t.device?.serial ?? ''} — ממתין לאישור`, at: t.reported_at, target: 'routes',
    });
  }

  // phase75: ניתוק לקוח — התראה מ-7 ימים לפני; ביום עצמו או באיחור = אדום. לא מופיע שוב כקריאה רגילה.
  const disconnectionIds = new Set(disconnections.map((d) => d.id));
  for (const d of disconnections) {
    const days = daysUntil(d.scheduled_at);
    if (days == null || days > 7) continue;
    const who = d.assignee?.full_name ? ` · ${d.assignee.full_name}` : ' · לא שובץ טכנאי';
    list.push({
      key: `disconnect:${d.id}`, level: days <= 0 ? 'crit' : 'warn', group: 'disconnect', fixed: true,
      title: d.customer?.name ?? 'לקוח',
      text: days < 0
        ? `ניתוק באיחור — היה מתוכנן ל-${fmtDay(d.scheduled_at)}${who}`
        : days === 0 ? `ניתוק היום${who}` : `ניתוק בעוד ${days} ימים (${fmtDay(d.scheduled_at)})${who}`,
      at: d.scheduled_at, target: 'service',
    });
  }

  for (const c of calls) {
    if (disconnectionIds.has(c.id)) continue;
    list.push({
      key: `call:${c.id}`, level: c.severity === 'crit' ? 'crit' : 'warn', group: 'calls', fixed: true,
      title: c.customer?.name ?? 'קריאת שירות',
      text: `${c.code ? `${c.code} · ` : ''}${c.title ?? 'קריאת שירות פתוחה'}`, at: c.opened_at, target: 'service',
    });
  }

  // הערות שטח: רק מ-3 הימים האחרונים בנפרד. הערות ישנות שעוד פתוחות (backlog)
  // מוצגות כשורה אחת שמובילה לכרטיס הערות השטח בדשבורד, כדי שלא יציפו את הפעמון.
  const NOTE_DAYS = 3;
  const fresh = notes.filter((n) => now - new Date(n.recordedAt).getTime() <= NOTE_DAYS * 86400000);
  const older = notes.length - fresh.length;
  for (const n of fresh) {
    list.push({
      key: `note:${n.id}`, noteId: n.id, level: 'info', group: 'notes',
      title: n.customerName, text: `הערת שטח (${n.recorderName}): ${n.notes}`, at: n.recordedAt, target: 'dashboard',
    });
  }
  if (older > 0) {
    list.push({
      key: 'notes-backlog', level: 'info', group: 'notes', fixed: true,
      title: `${older} הערות שטח ישנות עדיין פתוחות`,
      text: 'מעל 3 ימים. אפשר לעבור עליהן ולסמן "טופל" בכרטיס הערות השטח בדשבורד.', target: 'dashboard',
    });
  }

  // phase77: בדיקת תקינות — ניתנות לסימון "טופל" (alert_acks)
  list.push(...integrity);

  const visible = list.filter((a) => a.fixed || a.noteId || !isAcked(a.key, a.sig));
  const rank = { crit: 0, warn: 1, info: 2 };
  visible.sort((a, b) => rank[a.level] - rank[b.level] || String(b.at ?? '').localeCompare(String(a.at ?? '')));
  return visible;
}

/** "טופל": הערת שטח → field_note_flags (הקיים). התראת צי חכם → alert_acks עם ה-signature הנוכחי. */
export async function ackAlert(alert, email) {
  if (alert.group === 'notes') return resolveFieldNote(alert.noteId);
  return supabase
    .from('alert_acks')
    .upsert({ alert_key: alert.key, signature: String(alert.sig ?? ''), acked_at: new Date().toISOString(), acked_by_email: email ?? null }, { onConflict: 'alert_key' })
    .then(unwrap);
}
