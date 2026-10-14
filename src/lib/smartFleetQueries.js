import { supabase } from './supabase';

/**
 * שאילתות "צי חכם" (iot_devices, iconair_schema_phase55_smart_fleet.sql).
 * בקובץ נפרד כדי לא לגעת ב-queries.js הקיים בשלב הפיילוט.
 * phase56: owner_type (rental/private/test), owner_name, owner_phone.
 * phase57: control_enabled, iot_command_log, /api/aroma-command (עריכת שעון).
 * phase66: קיבוץ לפי קו ותת-קו — המכשיר מביא גם עיר, אתר (customer_sites)
 * ו-route_name/sub_route_id של הלקוח, ו-listFleetRouteMaps מביא את
 * city_routes ו-sub_routes, כדי לחשב את הקו באותו כלל בדיוק כמו מסך המסלולים.
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
      device:devices(id, serial, model, fill_ml, location_note, city,
        site:customer_sites(label, city, sub_route_id),
        customer:customers(name, city, route_name, sub_route_id))
    `)
    .order('online', { ascending: true })
    .order('aroma_name', { ascending: true })
    .then(unwrap);

/**
 * מפות הקווים (phase66): עיר → קו (city_routes) ותתי-קווים (sub_routes).
 * אם אחת מהן לא נטענת (הרשאה/טבלה) — מחזירים רשימה ריקה, והמסך פשוט
 * נופל ל-route_name של הלקוח. לא מפילים את הטאב בגלל קיבוץ.
 */
export async function listFleetRouteMaps() {
  const [cityRoutes, subRoutes] = await Promise.all([
    supabase.from('city_routes').select('city, route_name').then(unwrap).catch(() => []),
    supabase.from('sub_routes').select('id, name, sort_order').then(unwrap).catch(() => []),
  ]);
  return { cityRoutes, subRoutes };
}

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

/* =====================================================================
   מפה חיה (phase67) — כל המיקומים בשטח (לקוח חד-כתובתי או אתר של לקוח
   ריבוי-כתובות) עם הקואורדינטות שנשמרו (lat/lng). מיקום בלי קואורדינטות
   מומר לנקודה פעם אחת דרך Google Geocoder בצד הדפדפן ונשמר כאן.
   ===================================================================== */

export async function listMapLocations() {
  const [customers, sites] = await Promise.all([
    supabase
      .from('customers')
      .select('id, name, address, city, route_name, status, lat, lng, geocode_query, devices(id, status)')
      .eq('status', 'active')
      .then(unwrap),
    supabase
      .from('customer_sites')
      .select('id, customer_id, label, city, lat, lng, geocode_query, customer:customers(name, status), devices(id, status)')
      .then(unwrap),
  ]);
  const withSites = new Set(sites.map((s) => s.customer_id));
  const live = (list) => (list ?? []).filter((d) => d.status !== 'uninstalled');

  const fromCustomers = customers
    .filter((c) => !withSites.has(c.id))
    .map((c) => ({
      kind: 'customer',
      id: c.id,
      name: c.name,
      address: [c.address, c.city].filter(Boolean).join(', '),
      city: c.city,
      routeName: c.route_name?.trim() || null,
      lat: c.lat,
      lng: c.lng,
      geocodeQuery: c.geocode_query,
      deviceIds: live(c.devices).map((d) => d.id),
    }));

  const fromSites = sites
    .filter((s) => s.customer?.status === 'active')
    .map((s) => ({
      kind: 'site',
      id: s.id,
      name: `${s.customer?.name ?? ''} — ${s.label}`,
      address: [s.label, s.city].filter(Boolean).join(', '),
      city: s.city,
      routeName: null, // אתר: הקו נקבע לפי העיר (city_routes) במסך
      lat: s.lat,
      lng: s.lng,
      geocodeQuery: s.geocode_query,
      deviceIds: live(s.devices).map((d) => d.id),
    }));

  return [...fromCustomers, ...fromSites].filter((l) => l.deviceIds.length > 0);
}

/** שמירת קואורדינטות של מיקום (מנהל בלבד, RLS). query = הכתובת שהומרה, כדי לזהות שינוי כתובת בעתיד. */
export const saveLocationCoords = (loc, lat, lng, query) =>
  supabase
    .from(loc.kind === 'site' ? 'customer_sites' : 'customers')
    .update({ lat, lng, geocode_query: query, geocoded_at: new Date().toISOString() })
    .eq('id', loc.id)
    .then(unwrap);

/* =====================================================================
   היסטוריה לכל מכשיר (phase68) — בלי שינוי במסד הנתונים:
   iot_status_events (מעברי מחובר/מנותק מהסנכרון) + oil_tracking (מילויים).
   ===================================================================== */

export async function getDeviceHistory(iotDeviceId, deviceId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [events, before, refills] = await Promise.all([
    supabase
      .from('iot_status_events')
      .select('online, happened_at')
      .eq('iot_device_id', iotDeviceId)
      .gte('happened_at', since)
      .order('happened_at', { ascending: true })
      .then(unwrap),
    // המצב בתחילת החלון = האירוע האחרון שלפניו (אם יש)
    supabase
      .from('iot_status_events')
      .select('online, happened_at')
      .eq('iot_device_id', iotDeviceId)
      .lt('happened_at', since)
      .order('happened_at', { ascending: false })
      .limit(1)
      .then(unwrap),
    deviceId
      ? supabase
        .from('oil_tracking')
        .select('id, event_type, liters_added, level_after_pct, recorded_at, notes, recorder:profiles(full_name)')
        .eq('device_id', deviceId)
        // בלי 'reading' — אלה איפוסי תחילת מחזור אוטומטיים (phase27), לא ביקורים בשטח
        .neq('event_type', 'reading')
        .order('recorded_at', { ascending: false })
        .limit(8)
        .then(unwrap)
      : Promise.resolve([]),
  ]);
  return { since, days, events, before: before[0] ?? null, refills };
}
