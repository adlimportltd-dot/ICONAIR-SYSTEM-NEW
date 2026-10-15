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
  const [iot, acks, thefts, calls, notes, queues, disconnections] = await Promise.all([
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
