import { supabase } from './supabase';

/**
 * phase75 — ניתוק לקוח כמשימה (service_calls.call_type = 'disconnection').
 * נפתח בטאב קריאות שירות/התקנות עם תאריך ניתוק וטכנאי. התראה בפעמון שבוע לפני
 * וביום עצמו, כרטיס בטאב מסלולים, ו"בוצע ניתוק" מריץ בשרת את complete_disconnection:
 * המכשירים → "הוסר" + חוזרים למלאי הנייד, הלקוח → "עזב" (יוצא מהמסלול ומהחיוב).
 */

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/** פתיחת משימת ניתוק. scheduledDate = 'YYYY-MM-DD' */
export const createDisconnection = ({ customerId, scheduledDate, assignedTo = null, notes = '' }) =>
  supabase
    .from('service_calls')
    .insert({
      customer_id: customerId,
      call_type: 'disconnection',
      title: 'ניתוק לקוח',
      description: notes?.trim() || null,
      severity: 'sched',
      assigned_to: assignedTo || null,
      // 09:00 שעון ישראל בתאריך שנבחר — כדי שהתאריך לא "יזוז" ביום בגלל אזור זמן
      scheduled_at: scheduledDate ? new Date(`${scheduledDate}T09:00:00+03:00`).toISOString() : null,
    })
    .select('id, code')
    .single()
    .then(unwrap);

/** "בוצע ניתוק" — הכל אטומי בשרת */
export const completeDisconnection = (callId, notes = null) =>
  supabase.rpc('complete_disconnection', { p_call_id: callId, p_notes: notes || null }).then(unwrap);

/** ניתוקים פתוחים (לכרטיס במסלולים ולפעמון) */
export const listOpenDisconnections = () =>
  supabase
    .from('service_calls')
    .select('id, code, scheduled_at, description, assigned_to, customer:customers(id, name, city, address, route_name), assignee:profiles(full_name)')
    .eq('call_type', 'disconnection')
    .in('status', ['open', 'in_progress'])
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .then(unwrap);

/** המכשירים שייאספו בניתוק (כל מה שעדיין לא "הוסר") */
export const listDevicesToCollect = (customerId) =>
  supabase
    .from('devices')
    .select('id, serial, model, scent_name, location_note')
    .eq('customer_id', customerId)
    .neq('status', 'uninstalled')
    .order('serial')
    .then(unwrap);

/** ימים עד הניתוק לפי שעון ישראל (0 = היום, שלילי = באיחור) */
export function daysUntil(iso) {
  if (!iso) return null;
  const tz = 'Asia/Jerusalem';
  const day = (d) => new Date(new Date(d).toLocaleString('en-US', { timeZone: tz })).setHours(0, 0, 0, 0);
  return Math.round((day(iso) - day(Date.now())) / 86400000);
}

export const fmtDay = (iso) =>
  iso ? new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' }) : '—';
