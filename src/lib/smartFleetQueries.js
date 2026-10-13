import { supabase } from './supabase';

/**
 * שאילתות "צי חכם" (iot_devices, iconair_schema_phase55_smart_fleet.sql).
 * בקובץ נפרד כדי לא לגעת ב-queries.js הקיים בשלב הפיילוט.
 * phase56: owner_type (rental/private/test), owner_name, owner_phone.
 * phase57: control_enabled, iot_command_log, /api/aroma-command (עריכת שעון).
 */

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export const listIotDevices = () =>
  supabase
    .from('iot_devices')
    .select(`
      id, aroma_device_id, mac, aroma_name, supplier_model, aroma_type_code, firmware, net_type,
      online, online_error, is_locked, power_on, work_status, work_remain_sec, pause_remain_sec,
      device_time, schedule, last_online_at, last_offline_at, last_sync_at,
      owner_type, owner_name, owner_phone, control_enabled, remain_oil, has_oil_gauge,
      device:devices(id, serial, model, fill_ml, location_note, customer:customers(name, city))
    `)
    .order('online', { ascending: true })
    .order('aroma_name', { ascending: true })
    .then(unwrap);

export const listIotModelMap = () =>
  supabase.from('iot_model_map').select('supplier_model, iconair_model, factory_model, ml_per_sec, tank_ml').order('supplier_model').then(unwrap);

/** המילוי האחרון (או החלפת מיכל) לכל מכשיר במערכת — לחישוב ימים עד ריק במכשירים בלי מד (phase62) */
export const listLastRefills = (deviceIds) =>
  deviceIds.length
    ? supabase
        .from('oil_tracking')
        .select('device_id, event_type, level_after_pct, recorded_at')
        .in('device_id', deviceIds)
        .in('event_type', ['refill', 'replacement'])
        .order('recorded_at', { ascending: false })
        .limit(1000)
        .then(unwrap)
    : Promise.resolve([]);

/** כמות המילוי שמוגדרת לכל דגם במערכת (device_models.capacity_ml) — בסיס לימים עד ריק אחרי מילוי (phase63) */
export const listModelCapacity = () =>
  supabase.from('device_models').select('name, capacity_ml').then(unwrap);

/** מכשירים קיימים במערכת שעוד לא שויכו לענן — לבחירה בשיוך */
export const listLinkableDevices = () =>
  supabase
    .from('devices')
    .select('id, serial, model, location_note, customer:customers(name, city)')
    .neq('status', 'uninstalled')
    .order('serial')
    .then(unwrap);

/** מנהל בלבד (RLS): סיווג מכשיר ענן (סוג, מכשיר במערכת / לקוח פרטי) ודגם */
export const updateIotDevice = (id, patch) =>
  supabase.from('iot_devices').update(patch).eq('id', id).then(unwrap);

/** 5 השינויים האחרונים שנשלחו למכשיר (מנהלים בלבד, RLS) */
export const listCommandLog = (iotDeviceId) =>
  supabase
    .from('iot_command_log')
    .select('id, command, payload, ok, created_by_email, created_at, finished_at')
    .eq('iot_device_id', iotDeviceId)
    .order('created_at', { ascending: false })
    .limit(5)
    .then(unwrap);

/**
 * שליחת שעון ועוצמה למכשיר דרך /api/aroma-command.
 * weeks: [0..6] (0 = ראשון) · programs: 5 × { enabled, start, end, work_sec, pause_sec, level }
 */
export async function sendWorkTime(iotDeviceId, weeks, programs) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('צריך להתחבר מחדש למערכת');
  const res = await fetch('/api/aroma-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ iot_device_id: iotDeviceId, weeks, programs }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `השליחה נכשלה (${res.status})`);
  return json;
}
