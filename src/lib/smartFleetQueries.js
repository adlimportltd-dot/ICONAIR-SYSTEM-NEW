import { supabase } from './supabase';

/**
 * שאילתות "צי חכם" (iot_devices, iconair_schema_phase55_smart_fleet.sql).
 * בקובץ נפרד כדי לא לגעת ב-queries.js הקיים בשלב הפיילוט.
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
      owner_type, owner_name, owner_phone,
      device:devices(id, serial, model, location_note, customer:customers(name, city))
    `)
    .order('online', { ascending: true })
    .order('aroma_name', { ascending: true })
    .then(unwrap);

export const listIotModelMap = () =>
  supabase.from('iot_model_map').select('supplier_model, iconair_model').order('supplier_model').then(unwrap);

/** מכשירים קיימים במערכת שעוד לא שויכו לענן — לבחירה בשיוך */
export const listLinkableDevices = () =>
  supabase
    .from('devices')
    .select('id, serial, model, location_note, customer:customers(name, city)')
    .neq('status', 'uninstalled')
    .order('serial')
    .then(unwrap);

/** מנהל בלבד (RLS): שיוך מכשיר ענן למכשיר במערכת ולדגם */
export const updateIotDevice = (id, patch) =>
  supabase.from('iot_devices').update(patch).eq('id', id).then(unwrap);
