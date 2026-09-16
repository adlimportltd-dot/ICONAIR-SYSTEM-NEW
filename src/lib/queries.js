import { supabase } from './supabase';
import { enqueue, isNetworkError } from './offlineQueue';

/**
 * כל הגישה ל-Supabase עוברת דרך הקובץ הזה.
 * קומפוננטה אף פעם לא קוראת ל-supabase.from() ישירות — כך שינוי בסכימה
 * נוגע במקום אחד, ולא בעשרה מסכים.
 *
 * הסכימה כאן היא הגרסה הפשוטה שרצה בפועל ב-Supabase: customers, devices,
 * oil_tracking, service_calls, profiles. אין views, אין טבלת routes ואין
 * טבלת scents נפרדת — route_name ו-scent_name הם שדות טקסט חופשיים.
 * לכן כל מדדי הדשבורד מחושבים כאן, בצד הלקוח, מתוך שאילתות ישירות.
 *
 * כל פונקציה זורקת שגיאה במקום להחזיר {data, error}, כי ה-hook
 * שמעליה (useQuery) כבר יודע לתפוס ולהציג אותה.
 */

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/**
 * המחרוזת נכנסת לתוך תחביר המסננים של PostgREST, שבו פסיק מפריד בין
 * תנאים וסוגריים פותחים קבוצה. חיפוש של "ג'ימס (רעננה)" היה שובר את
 * הבקשה — לכן מנקים את התווים המבניים לפני שמשרשרים.
 */
function safeSearch(value) {
  return value.replace(/[,()%\\]/g, ' ').trim();
}

async function countRows(table, build) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });
  if (build) query = build(query);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);

function monthsAgo(n) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return d;
}

const sumLiters = (rows = []) => rows.reduce((sum, r) => sum + Number(r.liters_added ?? 0), 0);

/* =====================================================================
   דשבורד — בלי views: כמה שאילתות קלות במקביל + חישוב בצד הלקוח.
   ===================================================================== */

export async function getDashboardKpis() {
  const monthStart = startOfMonth(new Date());
  const prevMonthStart = monthsAgo(1);

  const [
    devicesTotal,
    devicesOnline,
    devicesInstalledThisMonth,
    customersActive,
    customersOnboarding,
    callsOpen,
    callsCritical,
    resolvedCalls,
    oilThisMonthRows,
    oilPrevMonthRows,
  ] = await Promise.all([
    countRows('devices'),
    countRows('devices', (q) => q.eq('status', 'active')),
    countRows('devices', (q) => q.gte('installed_at', monthStart.toISOString().slice(0, 10))),
    countRows('customers', (q) => q.eq('status', 'active')),
    countRows('customers', (q) => q.eq('status', 'onboarding')),
    countRows('service_calls', (q) => q.in('status', ['open', 'in_progress'])),
    countRows('service_calls', (q) => q.eq('severity', 'crit').in('status', ['open', 'in_progress'])),
    supabase
      .from('service_calls')
      .select('opened_at, closed_at')
      .eq('status', 'resolved')
      .not('closed_at', 'is', null)
      .order('closed_at', { ascending: false })
      .limit(200)
      .then(unwrap),
    supabase.from('oil_tracking').select('liters_added').gte('recorded_at', monthStart.toISOString()).then(unwrap),
    supabase
      .from('oil_tracking')
      .select('liters_added')
      .gte('recorded_at', prevMonthStart.toISOString())
      .lt('recorded_at', monthStart.toISOString())
      .then(unwrap),
  ]);

  const avgCloseHours = resolvedCalls.length
    ? resolvedCalls.reduce((sum, r) => sum + (new Date(r.closed_at) - new Date(r.opened_at)) / 3_600_000, 0)
      / resolvedCalls.length
    : null;

  return {
    devices_total: devicesTotal,
    devices_online: devicesOnline,
    devices_installed_this_month: devicesInstalledThisMonth,
    customers_active: customersActive,
    customers_onboarding: customersOnboarding,
    calls_open: callsOpen,
    calls_critical: callsCritical,
    avg_close_hours: avgCloseHours,
    oil_liters_this_month: sumLiters(oilThisMonthRows),
    oil_liters_prev_month: sumLiters(oilPrevMonthRows),
  };
}

/** פילוח הצי לפי דגם, כולל מפלס שמן ממוצע — מחושב מתוך כל שורות devices */
export async function getFleetByModel() {
  const rows = await supabase.from('devices').select('model, oil_level_pct').then(unwrap);

  const groups = new Map();
  for (const row of rows) {
    const g = groups.get(row.model) ?? { model: row.model, device_count: 0, oilSum: 0 };
    g.device_count += 1;
    g.oilSum += Number(row.oil_level_pct ?? 0);
    groups.set(row.model, g);
  }

  return [...groups.values()].map((g) => ({
    model: g.model,
    device_count: g.device_count,
    avg_oil_pct: g.device_count ? g.oilSum / g.device_count : 0,
  }));
}

/**
 * צריכת שמן חודשית. אין טבלת יעדים (oil_targets) בסכימה הפשוטה,
 * אז קו ההשוואה הוא ממוצע נגרר של 3 החודשים הקודמים — לא יעד קבוע.
 */
export async function getOilMonthly({ months = 6 } = {}) {
  const start = monthsAgo(months - 1);
  const rows = await supabase
    .from('oil_tracking')
    .select('liters_added, recorded_at')
    .gte('recorded_at', start.toISOString())
    .then(unwrap);

  const buckets = new Map();
  for (let i = 0; i < months; i += 1) {
    const d = monthsAgo(months - 1 - i);
    buckets.set(`${d.getFullYear()}-${d.getMonth()}`, { month: d.toISOString(), actual_liters: 0 });
  }
  for (const row of rows) {
    const d = new Date(row.recorded_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (buckets.has(key)) buckets.get(key).actual_liters += Number(row.liters_added ?? 0);
  }

  const list = [...buckets.values()];
  return list.map((row, i) => {
    const window = list.slice(Math.max(0, i - 3), i);
    const target_liters = window.length
      ? window.reduce((s, r) => s + r.actual_liters, 0) / window.length
      : row.actual_liters;
    return { ...row, target_liters };
  });
}

export const getLowOilAlerts = (limit = 4) =>
  supabase
    .from('devices')
    .select('serial, oil_level_pct, estimated_days_left, scent_name, customer:customers(name, city, route_name)')
    .eq('status', 'active')
    .order('oil_level_pct', { ascending: true })
    .limit(limit)
    .then(unwrap);

export const getOpenServiceCalls = (limit = 5) =>
  supabase
    .from('service_calls')
    .select(`
      id, code, title, severity, status, opened_at,
      customer:customers(name, city),
      device:devices(model),
      assignee:profiles(full_name)
    `)
    .in('status', ['open', 'in_progress'])
    .order('opened_at', { ascending: false })
    .limit(limit)
    .then(unwrap);

/** אין טבלת route_stops (ביקורים מתוכננים) — הפילוח כאן הוא לפי מכשירים בפועל לכל קו */
export async function getRouteBreakdown() {
  const rows = await supabase
    .from('devices')
    .select('status, oil_level_pct, customer:customers(route_name)')
    .then(unwrap);

  const groups = new Map();
  for (const row of rows) {
    const name = row.customer?.route_name?.trim() || 'ללא שיוך לקו';
    const g = groups.get(name) ?? { name, total: 0, active: 0, oilSum: 0 };
    g.total += 1;
    if (row.status === 'active') g.active += 1;
    g.oilSum += Number(row.oil_level_pct ?? 0);
    groups.set(name, g);
  }

  return [...groups.values()]
    .map((g) => ({ name: g.name, total: g.total, active: g.active, avgOil: g.total ? g.oilSum / g.total : 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
}

/** אין טבלת מלאי מחסן (scents) — זו תצרוכת בפועל מתוך oil_tracking החודש */
export async function getOilByScent({ limit = 6 } = {}) {
  const monthStart = startOfMonth(new Date());
  const rows = await supabase
    .from('oil_tracking')
    .select('scent_name, liters_added')
    .gte('recorded_at', monthStart.toISOString())
    .then(unwrap);

  const groups = new Map();
  for (const row of rows) {
    const name = row.scent_name?.trim() || 'ללא ניחוח';
    groups.set(name, (groups.get(name) ?? 0) + Number(row.liters_added ?? 0));
  }
  const total = [...groups.values()].reduce((sum, v) => sum + v, 0);

  return [...groups.entries()]
    .map(([name, liters]) => ({ name, liters, pct: total ? (liters / total) * 100 : 0 }))
    .sort((a, b) => b.liters - a.liters)
    .slice(0, limit);
}

/** כל בקשות הדשבורד יוצאות במקביל — לא בזו אחר זו */
export async function getDashboard() {
  const [kpis, fleet, oil, alerts, calls, routes, scentUsage] = await Promise.all([
    getDashboardKpis(),
    getFleetByModel(),
    getOilMonthly(),
    getLowOilAlerts(4),
    getOpenServiceCalls(5),
    getRouteBreakdown(),
    getOilByScent(),
  ]);

  return { kpis, fleet, oil, alerts, calls, routes, scentUsage };
}

/* =====================================================================
   רשימות עזר לטפסים
   ===================================================================== */

export const listProfiles = () =>
  supabase.from('profiles').select('id, full_name, role').order('full_name').then(unwrap);

export const listCustomerOptions = () =>
  supabase.from('customers').select('id, name, city, address').order('name').then(unwrap);

export const listDeviceOptions = () =>
  supabase
    .from('devices')
    .select(`
      id, serial, model, oil_level_pct, location_note,
      customer:customers(id, name, address, city, phone, email),
      site:customer_sites(id, label, city)
    `)
    .neq('status', 'uninstalled')
    .order('serial')
    .then(unwrap);

/* =====================================================================
   מסלולים — עצירה היא "לקוח" (customers.route_name, הרוב המוחלט —
   לקוח חד-כתובתי) או "אתר" (customer_sites, לקוח ריבוי-כתובות כמו
   חברת ניהול עם עשרות בניינים בכמה ערים — כל בניין הוא עצירה נפרדת,
   עם הקו שלו-עצמו, לא של הלקוח). לקוח שיש לו אתרים מוצא מהרשימה
   ברמת-לקוח לגמרי (customersWithSites) כדי שלא יופיע פעמיים.
   route_assignments הוא רק "שכבת עריכה" של סדר וסטטוס לכל יום —
   מי בעצם בקו נקבע כאן, לא שם.
   ===================================================================== */

/** כל הקווים עם ספירת עצירות (לקוחות חד-כתובתיים + אתרים) ומכשירים, כולל "ללא שיוך לקו". */
export async function listRoutes() {
  const [customers, sites, cityRoutes, cycles] = await Promise.all([
    supabase.from('customers').select('id, route_name, devices(count)').eq('status', 'active').then(unwrap),
    supabase.from('customer_sites').select('customer_id, city, devices(count)').then(unwrap),
    loadCityRoutesMap(),
    listRouteCycles(),
  ]);

  const cycleByName = new Map(cycles.map((r) => [r.name, r]));
  const customersWithSites = new Set(sites.map((s) => s.customer_id));
  const groups = new Map();

  const bump = (name, stopDelta, deviceDelta) => {
    const key = name ?? '__none__';
    const g = groups.get(key) ?? {
      name,
      customers: 0,
      devices: 0,
      cycle_start_day: cycleByName.get(name)?.cycle_start_day ?? 1,
      cycle_end_day: cycleByName.get(name)?.cycle_end_day ?? 12,
    };
    g.customers += stopDelta;
    g.devices += deviceDelta;
    groups.set(key, g);
  };

  for (const c of customers) {
    if (customersWithSites.has(c.id)) continue; // הצירים שלו נספרים כאתרים למטה
    bump(c.route_name?.trim() || null, 1, c.devices?.[0]?.count ?? 0);
  }
  for (const s of sites) {
    bump(cityRoutes.get(s.city) ?? null, 1, s.devices?.[0]?.count ?? 0);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.name === null) return 1;
    if (b.name === null) return -1;
    return b.customers - a.customers;
  });
}

/**
 * מחזוריות חודשית לכל קו: מ-1 לחודש עד יום-סיום קבוע (10–12, שדה
 * cycle_end_day) — ר' iconair_schema_phase20_route_cycles.sql. קו
 * שעדיין אין לו שורה ב-routes (עוד לא "נראה" ע"י ensureRouteId) מקבל
 * את ברירת המחדל 1–12 בצד הלקוח, לא נכשל.
 */
export const listRouteCycles = () =>
  supabase.from('routes').select('name, cycle_start_day, cycle_end_day').eq('active', true).then(unwrap);

/**
 * עדכון יום-הסיום של מחזור קו — מנהל בלבד (RLS). יום ההתחלה קבוע ב-1.
 * מבטיח קודם ששורת ה-routes קיימת (ensureRouteId — לא כל קו שרואים
 * ב-listRoutes בהכרח "נראה" כבר ב-routes), אחרת update על שם שלא קיים
 * לא עושה כלום בשקט.
 */
export async function updateRouteCycle(routeName, cycleEndDay) {
  await ensureRouteId(routeName);
  return supabase.from('routes').update({ cycle_end_day: cycleEndDay }).eq('name', routeName)
    .select('name, cycle_start_day, cycle_end_day').single().then(unwrap);
}

/**
 * עצירות פעילות על קו נתון — לקוחות חד-כתובתיים (route_name תואם,
 * ואין להם שום אתר) + אתרים שהעיר שלהם ממופה לקו הזה. שתי הצורות
 * מוחזרות באותה צורה בדיוק (kind מבדיל ביניהן רק לצורך תצוגה),
 * כדי ש-RouteStops לא יצטרך לדעת איזה סוג עצירה זה.
 */
export async function listStopsByRoute(routeName) {
  const [customers, sites, cityRoutes] = await Promise.all([
    supabase.from('customers')
      .select('id, name, address, city, phone, email, notes, route_name, sub_route_id, route_position, devices(id, serial, model, scent_name, oil_level_pct, location_note)')
      .eq('status', 'active').then(unwrap),
    supabase.from('customer_sites')
      .select('id, customer_id, label, city, sub_route_id, route_position, customer:customers(name, phone, email, notes), devices(id, serial, model, scent_name, oil_level_pct, location_note)')
      .then(unwrap),
    loadCityRoutesMap(),
  ]);

  const customersWithSites = new Set(sites.map((s) => s.customer_id));

  const customerStops = customers
    .filter((c) => !customersWithSites.has(c.id))
    .filter((c) => (routeName === null ? !c.route_name : c.route_name === routeName))
    .map((c) => ({
      kind: 'customer',
      customer_id: c.id,
      site_id: null,
      name: c.name,
      address: c.address,
      city: c.city,
      phone: c.phone,
      email: c.email,
      notes: c.notes,
      devices: c.devices,
      permanentSubRouteId: c.sub_route_id,
      permanentPosition: c.route_position,
    }));

  const siteStops = sites
    .filter((s) => (cityRoutes.get(s.city) ?? null) === routeName)
    .map((s) => ({
      kind: 'site',
      customer_id: s.customer_id,
      site_id: s.id,
      name: `${s.customer?.name ?? ''} — ${s.label}`,
      address: `${s.label}${s.city ? `, ${s.city}` : ''}`,
      city: s.city,
      phone: s.customer?.phone,
      email: s.customer?.email,
      notes: s.customer?.notes,
      devices: s.devices,
      permanentSubRouteId: s.sub_route_id,
      permanentPosition: s.route_position,
    }));

  return [...customerStops, ...siteStops].sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

/**
 * city_routes — טבלת בקרה קטנה (עיר → שם קו), ר' city_routes.sql.
 * קיימת כי לקוח ריבוי-כתובות (כמו חברת ניהול עם עשרות בניינים בכמה
 * ערים) לא יכול להיות "קו אחד" ברמת הלקוח — הקו הנכון הוא תכונה של
 * המכשיר/הכתובת שלו (devices.city), לא של הלקוח.
 */
export const listCityRoutes = () =>
  supabase.from('city_routes').select('city, route_name').then(unwrap);

/**
 * הקו האמיתי של מכשיר: אם יש לו devices.city מפורש (רלוונטי בעיקר
 * ללקוחות ריבוי-כתובות), הוא קובע דרך city_routes; אחרת נופלים חזרה
 * ל-customer.route_name הרגיל (כל שאר הלקוחות, חד-כתובתיים). cityRoutes
 * הוא Map<city, route_name> שכבר נטען פעם אחת ע"י הקורא.
 */
function effectiveDeviceRoute(device, cityRoutes) {
  if (device.city) return cityRoutes.get(device.city) ?? device.customer?.route_name ?? null;
  return device.customer?.route_name ?? null;
}

async function loadCityRoutesMap() {
  const rows = await listCityRoutes();
  return new Map(rows.map((r) => [r.city, r.route_name]));
}

/**
 * תכנון העמסה לקו: כמה ליטרים מכל ניחוח צריך הטכנאי לטעון הבוקר,
 * כדי למלא עד הסוף כל מכשיר פעיל בקו לפי המצב שלו עכשיו.
 *
 * הנוסחה לכל מכשיר: capacity_ml (נפח המכל של הדגם, מ-device_models) ×
 * (100 − oil_level_pct) ÷ 100 = כמה מ"ל חסרים לו למילוי מלא. מצטבר
 * לפי scent_name (זה מה שבאמת נטען לרכב — נוזל, לא "יחידות מכשיר"),
 * וממיר לליטרים כי כך technician_stock/warehouse_stock מנהלים שורות ניחוח.
 *
 * שולף את כל המכשירים הפעילים (לא רק לפי customer.route_name בשאילתה)
 * כי הקו נקבע פר-מכשיר (ר' effectiveDeviceRoute) — לא ניתן לסנן בצד
 * השרת לפי שדה מחושב, אז הסינון לפי routeName קורה כאן אחרי החישוב.
 *
 * מכשיר בלי ניחוח משויך או בלי capacity_ml לדגם שלו מוצא בנפרד
 * ב-missing, כדי שהמנהל יראה בדיוק למה החישוב לא מלא — לא רק מספר
 * חסר בשקט.
 *
 * לא מסונן לפי תאריך בכוונה: בעסק הזה קו מבוקר במלואו כל יום (אין
 * "תת-קבוצת לקוחות להיום") — route_assignments מוסיף רק סדר/סטטוס-
 * ביקור, לא קובע אילו לקוחות בכלל בקו. "היום" = "כל הקו", תמיד.
 *
 * newDevices (2026-09-09, ל"הכנה לקו"): מכשירים בקו שאף פעם לא קיבלו
 * רישום ב-oil_tracking — סימן שהם נוספו למערכת אבל עדיין לא הותקנו
 * בפועל בשטח. הטכנאי צריך לקחת אותם פיזית מהמחסן/מהמדף לפני שיוצא.
 *
 * routeName === null (2026-09-10, "כל הקווים"): מרכז את כל המכשירים
 * הפעילים במערכת לדוח העמסה אחיד אחד — לא רק קו ספציפי. שימושי כשיש
 * טכנאי אחד שמעמיס רכב יחיד לכל הקווים באותו יום. כולל גם מכשירים בלי
 * שיוך-קו כלל (route_name null בלקוח) — "הכל" אומר הכל, לא רק הקווים
 * בעלי שם. missing/newDevices מקבלים route_name פר-מכשיר כדי שאפשר
 * יהיה להבדיל בתצוגה מאיזה קו כל שורה הגיעה כשהכול מאוחד יחד.
 */
export async function getRouteLoadPlan(routeName) {
  const [devicesRows, models, cityRoutes, settings] = await Promise.all([
    supabase
      .from('devices')
      .select(`
        id, model, oil_level_pct, scent_name, serial, city, location_note, created_at,
        customer:customers(id, name, route_name, address, city),
        site:customer_sites(label, city)
      `)
      .neq('status', 'uninstalled')
      .then(unwrap),
    listAllDeviceModels(),
    loadCityRoutesMap(),
    getNotificationSettings(),
  ]);

  // מרווח ביטחון (2026-09-10, בקשה מפורשת): הטכנאי לא טוען בדיוק את
  // המינימום המתמטי — אם לקוח שינה תוכנית או מכשיר צרך יותר מהצפוי,
  // הוא לא אמור להיתקע בשטח בלי גיבוי. אחוז קבוע-לעריכה (Settings),
  // לא הערכה סטטיסטית — אין למערכת הזו נתוני שונות-צריכה להתבסס עליהם.
  const bufferMultiplier = 1 + (Number(settings?.route_load_buffer_pct ?? 0) / 100);

  const capacityByModel = new Map(models.map((m) => [m.name, m.capacity_ml]));

  const routeDevices = routeName === null
    ? devicesRows
    : devicesRows.filter((d) => effectiveDeviceRoute(d, cityRoutes) === routeName);

  const neverServiced = routeDevices.length
    ? await supabase
        .from('oil_tracking')
        .select('device_id')
        .in('device_id', routeDevices.map((d) => d.id))
        .then(unwrap)
    : [];
  const servicedIds = new Set(neverServiced.map((r) => r.device_id));

  const byScent = new Map();
  const missing = [];
  const newDevices = [];
  const deviceRows = [];

  for (const device of routeDevices) {
    const deviceRoute = effectiveDeviceRoute(device, cityRoutes);
    // כתובת קצרה למכשיר: אתר (ריבוי-כתובות) קודם, אחרת עיר/כתובת
    // הלקוח עצמו (חד-כתובתי, הרוב המכריע) — אותה קדימות בדיוק כמו
    // בחישוב הקו עצמו (effectiveDeviceRoute), רק לשדה תצוגה.
    const shortAddress =
      [device.site?.label, device.site?.city ?? device.city].filter(Boolean).join(' · ')
      || device.city
      || [device.customer?.address, device.customer?.city].filter(Boolean).join(', ')
      || null;

    if (!servicedIds.has(device.id)) {
      newDevices.push({
        id: device.id,
        serial: device.serial,
        model: device.model,
        customer_name: device.customer?.name ?? '—',
        address: [device.site?.label, device.site?.city ?? device.city].filter(Boolean).join(' · ') || device.city || null,
        route_name: deviceRoute,
      });
    }

    const capacity = capacityByModel.get(device.model);
    const scent = device.scent_name?.trim();

    // דוח ה-PDF (loadPlanReport.js) צריך שורה לכל מכשיר בהיקף — גם
    // מכשיר שנפל ל-missing למטה (בלי ניחוח/קיבולת) עדיין מוצג שם
    // עם needed_ml=null, לא נעלם בשקט מהטבלה המפורטת.
    deviceRows.push({
      id: device.id,
      customer_id: device.customer?.id ?? null,
      customer_name: device.customer?.name ?? '—',
      address: shortAddress,
      model: device.model,
      oil_level_pct: Number(device.oil_level_pct ?? 0),
      scent_name: scent || null,
      needed_ml: capacity ? Math.round(capacity * (100 - Number(device.oil_level_pct ?? 0)) / 100) : null,
      route_name: deviceRoute,
    });

    if (!scent || !capacity) {
      // id/customer_name/address נוספו כאן (2026-09-15, בקשה מפורשת: רשימה
      // שמית עם כתובת וקישור מהיר לתיקון) — שדות תצוגה בלבד (address הוא
      // אותו shortAddress שכבר חושב למעלה בלולאה), לא נוגעים בשום חישוב קיים.
      missing.push({
        id: device.id, customer_name: device.customer?.name ?? '—', address: shortAddress,
        serial: device.serial, model: device.model, scent_name: device.scent_name,
        reason: !scent ? 'no_scent' : 'no_capacity', route_name: deviceRoute,
      });
      continue;
    }

    const neededMl = capacity * (100 - Number(device.oil_level_pct ?? 0)) / 100;
    byScent.set(scent, (byScent.get(scent) ?? 0) + neededMl);
  }

  deviceRows.sort((a, b) => a.customer_name.localeCompare(b.customer_name, 'he') || (a.address ?? '').localeCompare(b.address ?? '', 'he'));

  const items = [...byScent.entries()]
    .map(([scent_name, ml]) => {
      const exactLiters = Math.round((ml / 1000) * 100) / 100;
      const liters = Math.round(exactLiters * bufferMultiplier * 100) / 100;
      return { scent_name, exactLiters, liters };
    })
    .filter((row) => row.liters > 0)
    .sort((a, b) => b.liters - a.liters);

  return {
    items, missing, newDevices, deviceRows, deviceCount: routeDevices.length,
    deviceIds: routeDevices.map((d) => d.id),
    bufferPct: Number(settings?.route_load_buffer_pct ?? 0),
  };
}

/**
 * "איפוס לתחילת מחזור חדש" (phase27) — מאפס את **כל** המכשירים בהיקף
 * שנבחר (קו יחיד, או deviceIds ממכלול "כל הקווים") ל-0%, בלי קשר להאם
 * כבר טופלו בעבר. לפי בקשה מפורשת (2026-09-10): "בתחילת מחזור חדש הכל
 * ריק ודורש מילוי מלא" — מדיניות עסקית, לא רק "מכשיר חדש שטרם הותקן".
 *
 * זה *מרחיב* את reset_route_initial_fill הישן (phase26, ששם היה מוגבל
 * רק למכשירים שמעולם לא קיבלו רישום) — reset_route_initial_fill עדיין
 * קיימת בשרת אבל אין לה יותר קורא מה-UI, הוחלפה בפונקציה הזו שמכסה גם
 * אותה וגם מכשירים שכבר טופלו במחזורים קודמים. אותה שיטת רישום בדיוק:
 * INSERT אמיתי ל-oil_tracking (event_type='reading', 0 ליטר, לא
 * "מילוי") כדי שההיסטוריה תישאר שקופה — לא UPDATE שקט על devices —
 * ר' reset_route_cycle ב-iconair_schema_phase27_route_cycle_reset.sql.
 */
export const resetRouteCycle = (deviceIds) =>
  supabase.rpc('reset_route_cycle', { p_device_ids: deviceIds }).then(unwrap);

/** yyyy-mm-dd מקומי (לא UTC) — ברירת המחדל של יומן מעקב שמנים היא "היום". */
export const todayISO = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** yyyy-mm-01 מקומי — ה-1 לחודש הנוכחי. ר' listRouteAssignments: מסך המסלולים עובד במחזור חודשי, לא יומי. */
export const monthStartISO = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
};

/** מזיז yyyy-mm-01 נתון ב-delta חודשים (יכול להיות שלילי) — חשבון קלנדרי מקומי טהור, בלי עיגול/timezone. */
function addMonthsISO(monthStartYmd, delta) {
  const [y, m] = monthStartYmd.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

/**
 * מחזיר את מזהה הקו לפי שם, ויוצר אותו אם עוד לא קיים.
 * "יצירה עצלה": הקו הראשון שנפתח במסך המסלולים מייצר את השורה שלו
 * ב-routes, בלי צורך במסך ניהול קווים נפרד.
 */
async function ensureRouteId(name) {
  if (!name) return null;

  const existing = await supabase.from('routes').select('id').eq('name', name).maybeSingle().then(unwrap);
  if (existing) return existing.id;

  try {
    const created = await supabase.from('routes').insert({ name }).select('id').single().then(unwrap);
    return created.id;
  } catch (err) {
    // מרוץ: שני משתמשים פתחו את אותו קו חדש בו-זמנית — השני נתקל ב-unique
    // violation; פשוט שולפים את השורה שהראשון כבר יצר.
    const retry = await supabase.from('routes').select('id').eq('name', name).single().then(unwrap);
    return retry.id;
  }
}

/**
 * מפתח ייחודי לעצירה בצד הלקוח בלבד (לא נשמר) — site_id אם יש,
 * אחרת customer_id. שני סוגי העצירה לא יכולים להתנגש כי הם UUID-ים
 * מטבלאות שונות.
 */
export const stopKey = (stop) => stop.site_id ?? stop.customer_id;

/**
 * עצירות הקו לחודש נתון (monthStart = yyyy-mm-01) — 2026-09-15, בעקבות
 * בקשה מפורשת: "אנחנו עובדים במחזור שירות חודשי, לא יומי". זה שינוי
 * משמעות מהותי מהגרסה הקודמת (phase29/30): שם כל תאריך קלנדרי חדש קיבל
 * שורת route_assignments נפרדת משלו, אז סטטוס "בוצע" התאפס בכל יום.
 * העמודה visit_date עצמה **לא השתנתה** ואף שורה היסטורית לא נמחקת/
 * נדרסת (ר' גם CLAUDE.md/ הבטחה מפורשת לשמור על כל נתוני הביקורים) —
 * מה שהשתנה הוא רק *איזו* שורה נחשבת "השורה החיה" של תחנה: זו עם
 * visit_date הכי מאוחר בטווח החודש המבוקש (ולא שורה נעולה לתאריך מדויק).
 * סימון בוצע/סגור על ID של שורה כזו (setStopStatus/closeVisit) ממשיך
 * לעדכן אותה שורה בדיוק לאורך כל החודש — לא נוצרת שורה נוספת ליום חדש.
 * ברגע שנפתח חודש קלנדרי חדש (אין עדיין אף שורה לתחנה בטווח החדש) —
 * נזרעת שורה טרייה 'pending' פעם אחת, בדיוק כמו האיפוס היומי הישן, רק
 * שעכשיו זה קורה פעם בחודש (לא נדרש שום cron/job — זה קורה באופן טבעי
 * בפעם הראשונה שמישהו פותח את המסך אחרי שהחודש התחלף, בדיוק כמו שהאיפוס
 * היומי הישן קרה בפעם הראשונה שמישהו פתח את המסך באותו יום).
 */
export async function listRouteAssignments(routeName, monthStart) {
  const stops = await listStopsByRoute(routeName);
  if (stops.length === 0) return [];

  const siteIds = stops.filter((s) => s.site_id).map((s) => s.site_id);
  const customerIds = stops.filter((s) => !s.site_id).map((s) => s.customer_id);
  const nextMonthStart = addMonthsISO(monthStart, 1);

  const existing = await supabase
    .from('route_assignments')
    .select('id, customer_id, site_id, stop_order, status, sub_route_id, updated_at, closed_reason, visit_date')
    .gte('visit_date', monthStart)
    .lt('visit_date', nextMonthStart)
    .or([
      customerIds.length ? `and(site_id.is.null,customer_id.in.(${customerIds.join(',')}))` : null,
      siteIds.length ? `site_id.in.(${siteIds.join(',')})` : null,
    ].filter(Boolean).join(','))
    .then(unwrap);

  // תחנה עלולה להחזיק כמה שורות בטווח החודש (שארית מהמערכת היומית
  // הישנה, מלפני 2026-09-15 — כל יום קלנדרי קיבל שורה טרייה משלו, אז
  // תחנה שטופלה ב-14/9 יכולה "לשבת" גם עם שורת pending אוטומטית מ-15/9).
  // "השורה החיה" אסור שתיבחר לפי visit_date הכי מאוחר סתם — שורה מאוחרת
  // יותר לא בהכרח אמיתית יותר, היא עלולה להיות בדיוק שריד האיפוס היומי
  // הישן. הכלל הנכון (ולפי הדרישה המפורשת "בוצע נשאר בוצע לאורך החודש"):
  // עדיפות סטטוס — done > skipped > pending, בלי קשר לתאריך; רק כשובר-
  // שוויון בין שתי שורות עם אותו סטטוס-מנצח (למשל "בוצע" גם ב-3/9 וגם
  // ב-14/9) נבחרת האינסטנס העדכני יותר, כדי שהפרטים (updated_at וכו')
  // יהיו הכי מדויקים.
  const STATUS_RANK = { done: 2, skipped: 1, pending: 0 };
  const byKey = new Map();
  for (const row of existing) {
    const key = row.site_id ?? row.customer_id;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, row); continue; }

    const rowRank = STATUS_RANK[row.status] ?? 0;
    const prevRank = STATUS_RANK[prev.status] ?? 0;
    if (rowRank > prevRank) { byKey.set(key, row); continue; }
    if (rowRank === prevRank && (row.visit_date > prev.visit_date || (row.visit_date === prev.visit_date && row.updated_at > prev.updated_at))) {
      byKey.set(key, row);
    }
  }

  const missing = stops.filter((s) => !byKey.has(stopKey(s)));

  if (missing.length) {
    const routeId = await ensureRouteId(routeName);
    const maxOrder = [...byKey.values()].reduce((max, a) => Math.max(max, a.stop_order), 0);

    // עצירה חדשה (חודש שנפתח לראשונה) נזרעת מהשיוך/סדר ה*קבועים* של
    // הלקוח/האתר (sub_route_id/route_position, ר' phase29) אם הוגדרו,
    // ולא מברירת מחדל שרירותית — כך שחלוקה לתתי-קווים שנקבעה פעם אחת
    // ממשיכה לחול בכל חודש חדש, בלי שמישהו יצטרך לגרור מחדש. p_visit_date
    // הוא ה-1-לחודש (לא "היום") כדי שהשורה תישאר בטווח החודש הנצפה גם
    // כשמישהו מעיין בחודש עבר/עתידי דרך בורר החודש במסך.
    const created = await Promise.all(missing.map((s, i) =>
      supabase.rpc('upsert_route_stop', {
        p_customer_id: s.customer_id,
        p_site_id: s.site_id,
        p_route_id: routeId,
        p_visit_date: monthStart,
        p_stop_order: s.permanentPosition ?? (maxOrder + i + 1),
        p_sub_route_id: s.permanentSubRouteId ?? null,
      }).then(unwrap)
    ));

    for (const row of created) byKey.set(row.site_id ?? row.customer_id, row);
  }

  return stops
    .map((s) => {
      const a = byKey.get(stopKey(s));
      return {
        ...s, id: a.id, stopOrder: a.stop_order, status: a.status,
        sub_route_id: a.sub_route_id ?? null, statusUpdatedAt: a.updated_at ?? null,
        closedReason: a.closed_reason ?? null,
      };
    })
    .sort((a, b) => a.stopOrder - b.stopOrder);
}

/* =====================================================================
   תתי-קווים (sub_routes, phase28) — אשכולות גיאוגרפיים בתוך קו, כדי
   לפצל קו גדול (למשל קו חיפה, 68+ עצירות) להיקפים קטנים מ-25 עצירות
   שכל אחד ניתן לאופטימיזציה נפרדת מול Google (ר' googleMaps.js —
   optimizeStopOrder זורק שגיאה מעל 25). "לא משויך" (sub_route_id null)
   הוא מצב תקין ונשאר ברירת המחדל — זו תוספת, לא שינוי-שובר להתנהגות
   הקיימת של קו בלי תתי-קווים בכלל.
   ===================================================================== */

export async function listSubRoutesForRoute(routeName) {
  if (!routeName) return [];
  const routeId = await ensureRouteId(routeName);
  return supabase
    .from('sub_routes')
    .select('id, route_id, name, sort_order')
    .eq('route_id', routeId)
    .order('sort_order')
    .order('name')
    .then(unwrap);
}

export async function createSubRoute(routeName, name) {
  const routeId = await ensureRouteId(routeName);
  return supabase
    .from('sub_routes')
    .insert({ route_id: routeId, name: name.trim() })
    .select('id, route_id, name, sort_order')
    .single()
    .then(unwrap);
}

export const deleteSubRoute = (id) =>
  supabase.from('sub_routes').delete().eq('id', id).then(unwrap);

/**
 * משייך/מוציא-משיוך (subRouteId=null) עצירה בודדת לתת-קו — גם לשורת
 * route_assignments של היום (מה שהמסך רואה מיד) וגם לשדה ה*קבוע* על
 * הלקוח/האתר עצמו (sub_route_id, ר' phase29), כדי שהשיוך יישאר בתוקף
 * גם בתאריכים עתידיים שעוד לא נפתחו, לא רק להיום. `stop` הוא אובייקט
 * עצירה מלא (מ-listRouteAssignments) — צריך גם id (assignment) וגם
 * customer_id/site_id כדי לדעת איזו טבלה קבועה לעדכן.
 *
 * עדכון השדה הקבוע הוא "best effort" (נבלע בשקט אם נכשל): RLS מתיר
 * כתיבה ל-customer_sites/customers רק למנהל (או ליוצר הרשומה) — טכנאי
 * שאין לו הרשאה כזו עדיין יצליח לעדכן את route_assignments של היום
 * (מה שהוא רואה על המסך), רק בלי לקבוע מדיניות-על לתאריכים עתידיים.
 * זה גם ההתנהגות הרצויה, לא רק מגבלה: שינוי ארעי-לרגע של טכנאי לא
 * אמור לדרוס את התכנון ה"רשמי" שמנהל קבע.
 */
export async function assignStopToSubRoute(stop, subRouteId) {
  const assignmentRow = await supabase
    .from('route_assignments').update({ sub_route_id: subRouteId }).eq('id', stop.id)
    .select('id, sub_route_id').single().then(unwrap);

  if (stop.site_id) {
    supabase.from('customer_sites').update({ sub_route_id: subRouteId }).eq('id', stop.site_id).then(unwrap).catch(() => null);
  } else if (stop.customer_id) {
    supabase.from('customers').update({ sub_route_id: subRouteId }).eq('id', stop.customer_id).then(unwrap).catch(() => null);
  }
  return assignmentRow;
}

/**
 * שומר סדר עצירות חדש (אחרי גרירה/חצים/מיון/Google) — גם ל-stop_order
 * של route_assignments להיום (מה שהמסך רואה מיד), וגם ל-route_position
 * ה*קבוע* על הלקוח/האתר (ר' phase29), כדי שהסדר הזה יהיה ברירת המחדל
 * גם בתאריכים עתידיים שעוד לא נפתחו — לא יתאפס מחר לסדר אלפביתי שרירותי.
 * `rows` הם אובייקטי עצירה מלאים (id/customer_id/site_id), לא רק מזהים.
 *
 * עדכון route_position הקבוע הוא "best effort" (לא await-ed, שגיאה
 * נבלעת) מאותה סיבה כמו ב-assignStopToSubRoute למעלה — RLS מתיר כתיבה
 * ל-customer_sites/customers רק למנהל, וסידור-יומי ארעי של טכנאי לא
 * אמור להיכשל (או לדרוס בטעות מדיניות-על) רק כי אין לו הרשאה כזו.
 */
export async function saveRouteOrder(rows) {
  await Promise.all(
    rows.map(async (row, i) => {
      const position = i + 1;
      await supabase.from('route_assignments').update({ stop_order: position }).eq('id', row.id).then(unwrap);
      if (row.site_id) {
        supabase.from('customer_sites').update({ route_position: position }).eq('id', row.site_id).then(unwrap).catch(() => null);
      } else if (row.customer_id) {
        supabase.from('customers').update({ route_position: position }).eq('id', row.customer_id).then(unwrap).catch(() => null);
      }
    })
  );
}

/** מסמן עצירה כבוצעה/לא-בוצעה, לפי מזהה שורת route_assignments. מניח שהשורה כבר קיימת (ר' listRouteAssignments). */
export const setStopStatus = (rowId, status) =>
  supabase.from('route_assignments').update({ status }).eq('id', rowId).then(unwrap);

/**
 * "העסק סגור / לא נמצא" — 2026-09-14, בקשה מפורשת: לטכנאי צריכה להיות
 * דרך לסגור עצירה בלי לגעת בכלל בנתוני שמן/מכשיר. status='skipped'
 * כבר נתמך ב-CHECK constraint מאז ומעולם (ר' phase35), פשוט לא נכתב
 * אליו קוד עד עכשיו. reason חופשי ואופציונלי — נשמר גם אם ריק/null,
 * כדי שסימון-חוזר ינקה הערה קודמת אם לא הוזנה חדשה.
 */
export const closeVisit = (rowId, reason) =>
  supabase.from('route_assignments')
    .update({ status: 'skipped', closed_reason: reason?.trim() || null })
    .eq('id', rowId)
    .select('id, status, closed_reason')
    .single()
    .then(unwrap);

/* =====================================================================
   לקוחות
   ===================================================================== */

export function listCustomers({ search = '', status = '', paymentStatus = '', paymentType = '' } = {}) {
  let query = supabase
    .from('customers_secure')
    .select('*, devices(model, status, scent_name)')
    .order('name');

  const needle = safeSearch(search);
  if (needle) {
    query = query.or(`name.ilike.%${needle}%,contact_name.ilike.%${needle}%,city.ilike.%${needle}%`);
  }
  if (status) query = query.eq('status', status);
  if (paymentStatus) query = query.eq('is_paid', paymentStatus === 'paid');
  if (paymentType) query = query.eq('payment_type', paymentType);

  return query.then(unwrap);
}

/**
 * שתי שאילתות גורפות (לא N+1 פר-לקוח) שמזינות את computeAllCustomerTotals
 * ב-pricing.js — כל מכשיר פעיל + כל שורת מחיר-דגם-לכתובת במערכת, כדי
 * שרשימת הלקוחות/הדוחות יוכלו לחשב "כמה כל לקוח באמת משלם" (כולל
 * לקוחות ריבוי-כתובות כמו אוורסט) בלי לעבור פר-לקוח על השרת.
 * admin בלבד בצד ה-UI (unit_price רגיש כספית) — ר' קריאה ב-CustomersScreen.
 */
export async function listAllCustomerDevicePricing() {
  const [devices, sitePrices] = await Promise.all([
    supabase.from('devices').select('customer_id, site_id, model, unit_price, status').then(unwrap),
    supabase.from('customer_site_model_prices').select('site_id, model, unit_price').then(unwrap),
  ]);
  return { devices, sitePrices };
}

export const createCustomer = (payload) =>
  supabase.from('customers').insert(payload).select('*, devices(model, status, scent_name)').single().then(unwrap);

export const updateCustomer = (id, patch) =>
  supabase.from('customers').update(patch).eq('id', id).then(unwrap);

/**
 * לקוח בודד, טרי מה-DB — כרטיס הלקוח המאוחד (CustomerProfileModal) טוען
 * את עצמו דרך זה במקום להסתמך על השורה שהגיעה מרשימת הלקוחות, כדי
 * שעריכת פרטים בתוך הכרטיס תשתקף מייד בלי לחכות שהרשימה תרענן.
 * customers_secure ולא customers — כדי שנתונים כספיים יחזרו רק למי
 * שמורשה לראות אותם, בדיוק כמו ברשימה.
 */
export const getCustomer = (id) =>
  supabase
    .from('customers_secure')
    .select('*, devices(model, status)')
    .eq('id', id)
    .single()
    .then(unwrap);

/** טוגל מהיר לסטטוס גבייה — ישירות משורת הטבלה, בלי לפתוח טופס עריכה. לא מחזיר נתונים בכוונה — אין צורך, וכך אין סיכון שמידע כספי יחזור בתשובה למי שלא אמור לראות אותו. */
export const setCustomerPaid = (id, is_paid) =>
  supabase.from('customers').update({ is_paid }).eq('id', id).then(unwrap);

/**
 * מחיקת לקוח לגמרי — כולל כל המכשירים שלו וקריאות השירות (חוזים,
 * אתרי-לקוח ושיוכי מסלול נמחקים אוטומטית ב-DB, on delete cascade).
 * devices.customer_id ו-service_calls.customer_id הם on delete restrict
 * בכוונה, אז מחיקה ישירה של שורת הלקוח הייתה נכשלת אם יש לו מכשירים —
 * זה בדיוק למה יש RPC ולא .delete() רגיל: הפונקציה בצד ה-DB
 * (delete_customer_cascade, ר' iconair_schema_phase15) מוחקת קודם
 * מכשירים+קריאות שירות ורק אז את הלקוח, הכול בטרנזקציה אחת. מוגבל
 * למנהלים גם ב-RLS על כל טבלה בנפרד וגם בבדיקה מפורשת בפונקציה עצמה.
 */
export const deleteCustomerCascade = (customerId) =>
  supabase.rpc('delete_customer_cascade', { p_customer_id: customerId }).then(unwrap);

/* =====================================================================
   מכשירים
   ===================================================================== */

export function listDevices({ search = '', model = '', scent = '', status = '', customerId = '' } = {}) {
  let query = supabase
    .from('devices')
    .select('*, customer:customers(id, name, city, route_name)')
    .order('serial');

  const needle = safeSearch(search);
  if (needle) query = query.ilike('serial', `%${needle}%`);
  if (model) query = query.eq('model', model);
  if (scent) query = query.eq('scent_name', scent);
  if (status) query = query.eq('status', status);
  if (customerId) query = query.eq('customer_id', customerId);

  return query.then(unwrap);
}

/**
 * כל המכשירים של לקוח אחד — ללקוח יכולים להיות עשרות.
 * הסדר לפי מיקום במתחם ולא לפי מספר סידורי, כי טכנאי שמסייר
 * עובר לובי → חדר כושר → קומה 2, ולא לפי סדר הרכישה.
 */
export const listCustomerDevices = (customerId) =>
  supabase
    .from('devices')
    .select('*')
    .eq('customer_id', customerId)
    .order('location_note', { nullsFirst: false })
    .order('serial')
    .then(unwrap);

/**
 * הכתובות (אתרים) של לקוח רב-כתובתי כמו אוורסט — כל כתובת עם המכשירים
 * ששייכים אליה (site_id, לא customer_id) ומחירי הדגמים שהוגדרו לה
 * (customer_site_model_prices, ר' phase17 — מחיר ליחידה לכל דגם,
 * לפני מע"מ; הסכום לכתובת נסכם בצד הלקוח מכמות המכשירים × המחיר
 * לדגם שלהם, עם דריסה ידנית למכשיר ב-devices.unit_price, phase18).
 * ללקוח חד-כתובתי הרגיל תמיד תחזור רשימה ריקה — כרטיס הלקוח
 * (CustomerProfile) מציג אז את המכשירים כקבוצה אחת בלי פילוח לכתובות.
 */
export const listCustomerSites = (customerId) =>
  supabase
    .from('customer_sites')
    .select('*, devices(id, model, status), prices:customer_site_model_prices(model, unit_price)')
    .eq('customer_id', customerId)
    .order('label')
    .then(unwrap);

/** יצירת כתובת/אתר חדש ללקוח קיים — עוד לא משויכים אליה מכשירים, זה קורה דרך DeviceFormModal (lockedSite) */
export const createCustomerSite = (customerId, { label, city, building_code }) =>
  supabase
    .from('customer_sites')
    .insert({ customer_id: customerId, label, city: city || null, building_code: building_code || null })
    .select()
    .single()
    .then(unwrap);

/** עריכת כתובת: שם, עיר, קוד בניין. שינוי עיר מזיז את הכתובת אוטומטית לקו ההפצה של העיר החדשה (ר' loadCityRoutesMap). */
export const updateCustomerSite = (siteId, patch) =>
  supabase.from('customer_sites').update(patch).eq('id', siteId).then(unwrap);

/**
 * מחיקת כתובת. המכשירים שלה לא נמחקים — devices.site_id הוא on delete
 * set null, אז הם פשוט חוזרים ל"ללא כתובת משוייכת" בכרטיס הלקוח (ומשם
 * אפשר לשייך אותם מחדש). מחירי-הדגם ושיוכי-המסלול של הכתובת נמחקים
 * איתה (cascade).
 */
export const deleteCustomerSite = (siteId) =>
  supabase.from('customer_sites').delete().eq('id', siteId).then(unwrap);

/* =====================================================================
   לידים (Prospects / קמפיין פייסבוק) — phase36/37. טבלה+ממשק ידניים
   בלבד, בלי שום אינטגרציה אוטומטית עם Meta (ר' CLAUDE.md).
   ===================================================================== */

/** כל הלידים, מיון חדש→ישן. status/date מסוננים בשרת כדי שהמונה בכותרת ישקף רק את הנבחר. */
export function listLeads({ status = '', date = '' } = {}) {
  let query = supabase.from('leads').select('*, converted_customer:customers(id, name)').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (date) {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    query = query.gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
  }
  return query.then(unwrap);
}

export const createLead = (payload) => supabase.from('leads').insert(payload).select().single().then(unwrap);

/** טוגל מהיר של סטטוס ליד — ישירות מהטבלה, כמו setCustomerPaid */
export const updateLeadStatus = (id, status) =>
  supabase.from('leads').update({ status }).eq('id', id).select().single().then(unwrap);

/**
 * "הפוך ללקוח במסלול" — קורא ל-RPC אטומי (convert_lead_to_customer,
 * phase37) שיוצר את הלקוח ומסמן את הליד כ-converted באותה טרנזקציה,
 * כדי שלא יישאר ליד "converted" בלי לקוח בפועל אם משהו נופל באמצע.
 * routeName הוא route_name חופשי (בדיוק כמו בטופס לקוח רגיל) — ריק=ללא שיוך לקו עדיין.
 */
export const convertLeadToCustomer = (leadId, routeName) =>
  supabase.rpc('convert_lead_to_customer', { p_lead_id: leadId, p_route_name: routeName || null }).then(unwrap);

/* =====================================================================
   הערות שטח (Field Notes) — 2026-09-16, בקשה מפורשת: מרכז מעקב
   והתראות להערות שטח (oil_tracking.notes, קיים כבר — לא נוסף שום שדה
   טקסט חדש). "פתוחה"/"טופלה" מנוהל בטבלה נפרדת (field_note_flags,
   phase38) שרק *מוסיפה* שורה כשמסמנים טופל — אף שורה קיימת ב-
   oil_tracking לא נוגעת בה, ואין ALTER על הטבלה הזו בכלל.
   ===================================================================== */

/**
 * כל הערות השטח (או רק הפתוחות), חדש→ישן. משתמש באותו דפוס-הצטרפות
 * בדיוק כמו getRouteLoadPlan (effectiveDeviceRoute/loadCityRoutesMap)
 * כדי שהקו המוצג יהיה נכון גם ללקוח ריבוי-כתובות, לא רק customer.route_name.
 */
export async function listFieldNotes({ onlyOpen = false, limit = 200 } = {}) {
  const [entries, cityRoutes, flags] = await Promise.all([
    supabase
      .from('oil_tracking')
      .select(`
        id, notes, recorded_at,
        device:devices(id, serial, city, customer_id, site_id, customer:customers(id, name, route_name)),
        recorder:profiles(id, full_name)
      `)
      .not('notes', 'is', null)
      .neq('notes', '')
      .order('recorded_at', { ascending: false })
      .limit(limit)
      .then(unwrap),
    loadCityRoutesMap(),
    supabase.from('field_note_flags').select('oil_tracking_id, resolved_at').then(unwrap),
  ]);

  const resolvedIds = new Set(flags.map((f) => f.oil_tracking_id));

  const rows = entries
    .filter((e) => e.notes?.trim())
    .map((e) => ({
      id: e.id,
      notes: e.notes,
      recordedAt: e.recorded_at,
      recorderName: e.recorder?.full_name ?? 'המערכת',
      customerId: e.device?.customer_id ?? null,
      siteId: e.device?.site_id ?? null,
      customerName: e.device?.customer?.name ?? '—',
      routeName: e.device ? effectiveDeviceRoute(e.device, cityRoutes) : null,
      resolved: resolvedIds.has(e.id),
    }));

  return onlyOpen ? rows.filter((r) => !r.resolved) : rows;
}

/** סימון הערה כטופלה — upsert כדי שיהיה בטוח גם אם כבר סומנה בעבר. */
export const resolveFieldNote = (oilTrackingId) =>
  supabase
    .from('field_note_flags')
    .upsert({ oil_tracking_id: oilTrackingId, resolved_at: new Date().toISOString() }, { onConflict: 'oil_tracking_id' })
    .then(unwrap);

/** פתיחה מחדש — פשוט מוחקת את דגל-הטיפול; ההערה עצמה ב-oil_tracking לא נוגעת. */
export const reopenFieldNote = (oilTrackingId) =>
  supabase.from('field_note_flags').delete().eq('oil_tracking_id', oilTrackingId).then(unwrap);

/**
 * קביעת מחיר ליחידה לדגם מסוים בכתובת מסוימת — upsert לפי (site_id, model),
 * כדי שאפשר יהיה לקרוא לזה גם בפעם הראשונה (אין עדיין שורה) וגם בעדכון.
 */
export const upsertSiteModelPrice = (siteId, model, unit_price) =>
  supabase
    .from('customer_site_model_prices')
    .upsert({ site_id: siteId, model, unit_price }, { onConflict: 'site_id,model' })
    .then(unwrap);

/**
 * מחיקת מכשיר לגמרי מהמערכת (לא רק "ניתוק" מהלקוח — customer_id הוא
 * NOT NULL בסכימה, אין מצב "מכשיר בלי לקוח"). ה-RLS על devices_delete
 * מגביל את זה למנהלים בלבד; היסטוריית השמן (oil_tracking) וכל בקשות
 * השינוי הממתינות למכשיר הזה נמחקות אוטומטית איתו (on delete cascade
 * ב-DB), וקריאות שירות שהצביעו עליו נשארות אבל מאבדות את השיוך
 * (on delete set null) — לא נעלמות.
 */
export const deleteDevice = (deviceId) =>
  supabase.from('devices').delete().eq('id', deviceId).then(unwrap);

// עריכת מכשיר (דגם/ניחוח/מיקום/סטטוס/כתובת/מחיר-ליחידה): updateDevice
// למטה, ליד createDevice. unit_price = null מחזיר את המכשיר לתמחור לפי
// מחיר-הדגם של הכתובת שלו (ר' phase18).

const createDeviceRemote = (payload) =>
  supabase
    .from('devices')
    // serial מושאר ריק בכוונה — טריגר בבסיס הנתונים מייצר ICN-700-0143
    .insert(payload)
    .select('*, customer:customers(id, name, city, route_name)')
    .single()
    .then(unwrap);

/**
 * גרסה שמודעת לניתוק רשת: אם הטכנאי בלי קליטה, הרישום נכנס לתור
 * offline (ר' offlineQueue.js) במקום להיזרק כשגיאה — ה-UI מקבל בחזרה
 * אובייקט מסומן `__queued`, לא את שורת ה-device האמיתית (זו עוד לא
 * קיימת ב-DB עד שהתור יסתנכרן), אז מסכים שקוראים לזה צריכים להתייחס
 * לזה כ"נשמר, יופיע ברשימה אחרי סנכרון" ולא לצפות לאובייקט מלא בחזרה.
 */
export async function createDevice(payload) {
  if (!navigator.onLine) {
    await enqueue('createDevice', payload);
    return { __queued: true, ...payload };
  }
  try {
    return await createDeviceRemote(payload);
  } catch (error) {
    if (isNetworkError(error)) {
      await enqueue('createDevice', payload);
      return { __queued: true, ...payload };
    }
    throw error;
  }
}

export const updateDevice = (id, patch) =>
  supabase.from('devices').update(patch).eq('id', id).select().single().then(unwrap);

/* =====================================================================
   מעקב שמנים
   ===================================================================== */

/**
 * טווח יממה מקומית (לא UTC) עבור yyyy-mm-dd נתון — ר' todayISO. בלי
 * 'Z'/אזור-זמן במחרוזת, new Date מפרש כשעון מקומי, כך שהטווח תואם
 * ל"יום" כפי שהטכנאי/מנהל תופסים אותו, לא לחצות UTC.
 */
function localDayRange(dateStr) {
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * date (yyyy-mm-dd) — 2026-09-14, בקשה מפורשת: ניהול יומי של מעקב
 * השמנים, "עד היום" כברירת מחדל. כשמוגדר, מסנן בשרת ליממה המקומית
 * הזו ומוריד את התקרה הקבועה (80) — יום עמוס לא אמור "להיחתך" מבחור
 * מלאכותי. technicianId מסנן לפי מי שרשם (recorded_by), גם הוא בשרת
 * ולא בצד הלקוח — כדי שהמונה בכותרת יהיה מספר אמיתי, לא רק מתוך
 * 80/60 השורות שכבר הורדו.
 */
export const listOilEntries = ({ limit = 60, date = null, technicianId = null } = {}) => {
  let query = supabase
    .from('oil_tracking')
    .select(`
      *,
      device:devices(id, serial, model, customer:customers(id, name)),
      recorder:profiles(id, full_name)
    `)
    .order('recorded_at', { ascending: false });

  if (date) {
    const { start, end } = localDayRange(date);
    query = query.gte('recorded_at', start).lt('recorded_at', end);
  } else {
    query = query.limit(limit);
  }

  if (technicianId) query = query.eq('recorded_by', technicianId);

  return query.then(unwrap);
};

/**
 * רישום מילוי. אין כאן עדכון של devices.oil_level_pct —
 * טריגר בבסיס הנתונים עושה את זה, כדי שהיומן והמכשיר לא יוכלו לסתור זה את זה
 * גם אם מישהו יכניס שורה ישירות מה-SQL Editor.
 */
const createOilEntryRemote = (payload) =>
  supabase
    .from('oil_tracking')
    .insert(payload)
    .select(`
      *,
      device:devices(id, serial, model, customer:customers(id, name)),
      recorder:profiles(id, full_name)
    `)
    .single()
    .then(unwrap);

/** גרסה מודעת-לניתוק — ר' ההערה על createDevice למעלה, אותו עיקרון בדיוק. */
export async function createOilEntry(payload) {
  if (!navigator.onLine) {
    await enqueue('createOilEntry', payload);
    return { __queued: true, ...payload };
  }
  try {
    return await createOilEntryRemote(payload);
  } catch (error) {
    if (isNetworkError(error)) {
      await enqueue('createOilEntry', payload);
      return { __queued: true, ...payload };
    }
    throw error;
  }
}

/**
 * "סיום ביקור" — עוטפת את אותו insert שעושה createOilEntry, אבל דרך
 * ה-RPC complete_visit שגם מנכה את הליטרים המדויקים (p_liters_added,
 * לא "יחידה אחת" קבועה) מהמלאי הנייד של הטכנאי המחובר, לפי ניחוח
 * (model is null — אותו מפתח בדיוק כמו allocate_stock_to_technician/
 * return_stock_to_warehouse), אטומית: אם אין מספיק מלאי, כל הפעולה
 * נכשלת ושום דבר לא נרשם. 2026-09-09 (phase19): תוקן באג שבו הפונקציה
 * חיפשה מלאי לפי model+scent יחד וניכתה "1" קבוע — לא תאם את הצורה
 * שבה allocate_stock_to_technician באמת מקצה מלאי-ניחוח (model=null),
 * אז בפועל כל קריאה חיה נכשלה בשקט ונפלה ל-createOilEntry למטה בלי
 * לנכות כלום. ר' iconair_schema_phase19_stock_visit_sync.sql.
 */
const completeVisitRemote = ({
  device_id, event_type, scent_name, liters_added, level_before_pct, level_after_pct, notes, batteries_replaced,
}) =>
  supabase
    .rpc('complete_visit', {
      p_device_id: device_id,
      p_event_type: event_type,
      p_scent_name: scent_name,
      p_liters_added: liters_added,
      p_level_before_pct: level_before_pct,
      p_level_after_pct: level_after_pct,
      p_notes: notes,
      p_batteries_replaced: batteries_replaced ?? null,
    })
    .single()
    .then(unwrap);

/** גרסה מודעת-לניתוק — ר' ההערה על createDevice למעלה, אותו עיקרון בדיוק. */
export async function completeVisit(payload) {
  if (!navigator.onLine) {
    await enqueue('completeVisit', payload);
    return { __queued: true, ...payload };
  }
  try {
    return await completeVisitRemote(payload);
  } catch (error) {
    if (isNetworkError(error)) {
      await enqueue('completeVisit', payload);
      return { __queued: true, ...payload };
    }
    throw error;
  }
}

/**
 * מריץ בזמן סנכרון (offlineSync.js) — לא ב-UI החי. אם עד שהתור הגיע
 * לפה כבר אין מלאי נייד תואם (מישהו אחר צרך אותו בינתיים, או שהטכנאי
 * עצמו כבר השתמש בו בפעולה מסונכרנת קודמת מאותו תור), נופלים לאותה
 * "רשומה בלי ניכוי מלאי" שה-UI החי כבר עושה (ר' NewOilEntryModal /
 * CompleteVisitModal) — כדי שביקור אמיתי שהתבצע בשטח לעולם לא ייעלם
 * רק כי הנהלת המלאי לא הסתדרה, גם כשזה מתגלה מאוחר יותר בסנכרון.
 */
async function completeVisitForSync(payload) {
  try {
    return await completeVisitRemote(payload);
  } catch (error) {
    if (!String(error?.message ?? '').includes('אין מלאי נייד')) throw error;
    return createOilEntryRemote(payload);
  }
}

/** ממופה מ-offlineSync.js לפי type של פריט בתור — לא לקרוא ישירות מ-UI. */
export const OFFLINE_EXECUTORS = {
  createDevice: createDeviceRemote,
  createOilEntry: createOilEntryRemote,
  completeVisit: completeVisitForSync,
};

/* =====================================================================
   מלאי נייד (technician_stock) — "מה יש ברכב עכשיו".
   RLS כבר מגביל טכנאי לשורות שלו; מנהל רואה הכול. אין צורך בסינון
   בצד הלקוח בגלל זה — אותה שאילתה משרתת את שתי התצוגות.
   ===================================================================== */

export const listTechnicianStock = () =>
  supabase
    .from('technician_stock')
    .select('id, technician_id, model, scent_name, quantity, updated_at, technician:profiles(id, full_name)')
    .order('model')
    .then(unwrap);

export const listTechnicianOptions = () =>
  supabase.from('profiles').select('id, full_name').eq('role', 'technician').order('full_name').then(unwrap);

/**
 * קובע כמות מוחלטת (לא דלתא) עבור טכנאי+דגם+ניחוח — "ספרתי X בלונים
 * ברכב, זה מה שיש" ולא "תוסיף N". upsert לפי המפתח הייחודי, כך שטעינה
 * חוזרת של אותו רכב מעדכנת את השורה הקיימת במקום ליצור כפולה.
 */
export const setTechnicianStock = ({ technician_id, model, scent_name, quantity }) =>
  supabase
    .from('technician_stock')
    .upsert(
      { technician_id, model, scent_name: scent_name || '', quantity, updated_at: new Date().toISOString() },
      { onConflict: 'technician_id,model,scent_name' }
    )
    .select('id, technician_id, model, scent_name, quantity, updated_at, technician:profiles(id, full_name)')
    .single()
    .then(unwrap);

/* =====================================================================
   מחסן ראשי (warehouse_stock) — "כמה יש במחסן" לפני שמקצים לטכנאי.
   מנהל בלבד (RLS חוסם select/insert/update לא-מנהל). קליטת סחורה
   והקצאה לטכנאי עוברות דרך RPC אטומי (receive_stock,
   allocate_stock_to_technician) ולא כתיבה ישירה לטבלה — כך שלא ייתכן
   מצב של הקצאה בלי שהמחסן באמת ירד, ר' iconair_schema_phase6_warehouse.sql.
   ===================================================================== */

export const listWarehouseStock = () =>
  supabase.from('warehouse_stock').select('id, model, scent_name, quantity, updated_at').order('model').then(unwrap);

/** קליטת סחורה חדשה למחסן — מוסיף לכמות הקיימת, לא קובע כמות מוחלטת */
export const receiveStock = ({ model, scent_name, quantity }) =>
  supabase.rpc('receive_stock', {
    p_model: model,
    p_scent_name: scent_name || '',
    p_quantity: quantity,
  }).then(unwrap);

/** מעביר יחידות מהמחסן הראשי לטכנאי — אטומי, כולל בדיקת מלאי מספיק */
export const allocateStockToTechnician = ({ technician_id, model, scent_name, quantity }) =>
  supabase.rpc('allocate_stock_to_technician', {
    p_technician_id: technician_id,
    p_model: model,
    p_scent_name: scent_name || '',
    p_quantity: quantity,
  }).then(unwrap);

/**
 * החזרת מלאי שלא נוצל בפועל מהטכנאי בחזרה למחסן — הכיוון ההפוך
 * בדיוק ל-allocateStockToTechnician, אותה אטומיות. זה מה שסוגר את
 * המעגל לדוח העודפים: מה שהוקצה בבוקר, פחות מה שנצרך בפועל
 * (oil_tracking), פחות מה שחזר פיזית למחסן — ר' getRouteConsumptionReport.
 *
 * קריא גם ע"י טכנאי על עצמו (p_technician_id = הטכנאי המחובר), לא רק
 * ע"י מנהל — 2026-09-09 (phase19), ל"החזרה עצמאית בסוף יום" ב-StockScreen.
 * הפונקציה עצמה security definer (חוצה בכוונה ל-warehouse_stock, שנשאר
 * חסום ב-RLS לטכנאי בכל מקום אחר) עם בדיקת בעלות מפורשת בתוכה.
 */
export const returnStockToWarehouse = ({ technician_id, model, scent_name, quantity }) =>
  supabase.rpc('return_stock_to_warehouse', {
    p_technician_id: technician_id,
    p_model: model,
    p_scent_name: scent_name || '',
    p_quantity: quantity,
  }).then(unwrap);

/**
 * מחזיר בבת אחת את כל מלאי הטכנאי (נוזל + יחידות) למחסן — עטיפה נוחה
 * מעל returnStockToWarehouse לכל שורה, ר' iconair_schema_phase25.
 * שורה בודדת שלא תואמת לצורת ה-XOR התקנית (data issue קיים, לא נוצר
 * ע"י הפונקציה הזו) פשוט מדולגת בצד השרת, לא מפילה את שאר ההחזרה.
 */
export const returnAllStockToWarehouse = (technicianId) =>
  supabase.rpc('return_all_stock_to_warehouse', { p_technician_id: technicianId }).then(unwrap);

/**
 * איפוס מלאי-נוזל (לא יחידות-מכשיר) של טכנאי לאפס, עם רישום מלא
 * ב-stock_movements ('reset', לא 'return') — לפעימה ראשונה בלבד, לפני
 * תחילת מחזור עבודה שוטף. מנהל בלבד. לעולם לא נוגע ב-devices.oil_level_pct
 * — זה תמיד נשאר המצב האמיתי בשטח, ר' iconair_schema_phase25.
 */
export const resetTechnicianStock = (technicianId) =>
  supabase.rpc('reset_technician_stock', { p_technician_id: technicianId }).then(unwrap);

/* =====================================================================
   ניחוחות (scents) — רשימה גלובלית קבועה. כל שדה "ניחוח" באפליקציה
   נגזר מכאן, לא מטקסט חופשי — ר' iconair_schema_phase4_scents.sql.
   ===================================================================== */

export const listScents = () =>
  supabase.from('scents').select('id, name, active').eq('active', true).order('name').then(unwrap);

/** למסך הניהול בהגדרות — כולל ניחוחות מושבתים, כדי שאפשר יהיה להפעיל בחזרה */
export const listAllScents = () =>
  supabase.from('scents').select('id, name, active').order('name').then(unwrap);

export const createScent = (name) =>
  supabase.from('scents').insert({ name: name.trim() }).select('id, name, active').single().then(unwrap);

export const setScentActive = (id, active) =>
  supabase.from('scents').update({ active }).eq('id', id).select('id, name, active').single().then(unwrap);

/* =====================================================================
   דגמי מכשירים (device_models) — רשימה גלובלית קבועה, אותו דפוס בדיוק
   כמו scents. ר' iconair_schema_phase5_device_models.sql: devices.model
   ו-technician_stock.model הופכים שם מ-enum לטקסט+FK לטבלה הזו.
   ===================================================================== */

export const listDeviceModels = () =>
  supabase.from('device_models').select('id, name, active, capacity_ml, battery_count').eq('active', true).order('name').then(unwrap);

/** למסך הניהול בהגדרות — כולל דגמים מושבתים */
export const listAllDeviceModels = () =>
  supabase.from('device_models').select('id, name, active, capacity_ml, battery_count').order('name').then(unwrap);

export const createDeviceModel = (name) =>
  supabase.from('device_models').insert({ name: name.trim() }).select('id, name, active').single().then(unwrap);

export const setDeviceModelActive = (id, active) =>
  supabase.from('device_models').update({ active }).eq('id', id).select('id, name, active').single().then(unwrap);

/** קביעת נפח-מכל (מ"ל) לדגם — משמש ב"תיקון מהיר" של מכשירים שנפלו ל"לא נכנסו לחישוב" (ר' StockScreen). */
export const updateDeviceModelCapacity = (id, capacity_ml) =>
  supabase.from('device_models').update({ capacity_ml }).eq('id', id).select('id, name, capacity_ml').single().then(unwrap);

/* =====================================================================
   קריאות שירות
   ===================================================================== */

export function listServiceCalls({ status = 'open_all', search = '' } = {}) {
  let query = supabase
    .from('service_calls')
    .select(`
      *,
      customer:customers(id, name, city),
      device:devices(id, serial, model),
      assignee:profiles(id, full_name)
    `)
    .order('opened_at', { ascending: false })
    .limit(120);

  if (status === 'open_all') query = query.in('status', ['open', 'in_progress']);
  else if (status) query = query.eq('status', status);

  const needle = safeSearch(search);
  if (needle) query = query.or(`code.ilike.%${needle}%,title.ilike.%${needle}%`);

  return query.then(unwrap);
}

export const createServiceCall = (payload) =>
  supabase
    .from('service_calls')
    // code נוצר אוטומטית בבסיס הנתונים (SC-2420, SC-2421 ...)
    .insert(payload)
    .select(`
      *,
      customer:customers(id, name, city),
      device:devices(id, serial, model),
      assignee:profiles(id, full_name)
    `)
    .single()
    .then(unwrap);

/** סגירת קריאה. closed_at חייב להיות מלא — יש על זה CHECK בבסיס הנתונים. */
export const resolveServiceCall = (id, resolution) =>
  supabase
    .from('service_calls')
    .update({ status: 'resolved', closed_at: new Date().toISOString(), resolution })
    .eq('id', id)
    .select()
    .single()
    .then(unwrap);

export const startServiceCall = (id, assignedTo) =>
  supabase
    .from('service_calls')
    .update({ status: 'in_progress', assigned_to: assignedTo ?? null })
    .eq('id', id)
    .select()
    .single()
    .then(unwrap);

/**
 * עריכה כללית של קריאה קיימת (חומרה/סטטוס/הערות/שיוך) — 2026-09-16,
 * בקשה מפורשת. `previousStatus` (הסטטוס *לפני* העריכה) נדרש כדי לנהל
 * את closed_at נכון בלי להפר את ה-CHECK הדו-כיווני הקיים בבסיס הנתונים
 * (service_calls_closed_at_matches_status: open/in_progress→closed_at
 * חייב NULL, resolved/cancelled→closed_at חייב NOT NULL) — ורק
 * במעבר אמיתי בין המצבים, לא בכל שמירה: עריכת חומרה בלבד על קריאה
 * שכבר סגורה לא אמורה "לאפס" את שעת הסגירה המקורית שלה ל-עכשיו.
 */
export const updateServiceCall = (id, patch, previousStatus) => {
  const fullPatch = { ...patch };
  if (patch.status) {
    const isNowClosed = patch.status === 'resolved' || patch.status === 'cancelled';
    const wasClosed = previousStatus === 'resolved' || previousStatus === 'cancelled';
    if (isNowClosed && !wasClosed) fullPatch.closed_at = new Date().toISOString();
    else if (!isNowClosed && wasClosed) fullPatch.closed_at = null;
  }

  return supabase
    .from('service_calls')
    .update(fullPatch)
    .eq('id', id)
    .select(`
      *,
      customer:customers(id, name, city),
      device:devices(id, serial, model),
      assignee:profiles(id, full_name)
    `)
    .single()
    .then(unwrap);
};

/* =====================================================================
   דוחות
   ===================================================================== */

export async function getReportSummary() {
  const [kpis, oil, fleet, scentUsage] = await Promise.all([
    getDashboardKpis(),
    getOilMonthly({ months: 12 }),
    getFleetByModel(),
    getOilByScent({ limit: 10 }),
  ]);

  return { kpis, oil, fleet, scentUsage };
}

/**
 * צריכת ריח אמיתית של קו ספציפי, לפי ניחוח — מבוסס oil_tracking (מה
 * שבאמת נרשם בשטח דרך "סיום ביקור"), לא על מה שהוקצה. זו התשובה
 * המדויקת ל"כמה ליטרים כל קו צרך בפועל החודש/בטווח נתון".
 *
 * הקו נקבע לפי המכשיר (device.city → city_routes), לא לפי הלקוח —
 * אותה סיבה כמו ב-getRouteLoadPlan: לקוח ריבוי-כתובות לא שייך "כולו"
 * לקו אחד, אז הסינון קורה בצד הלקוח אחרי חישוב הקו האמיתי של כל שורה.
 */
export async function getRouteConsumptionReport({ routeName, months = 1 } = {}) {
  const start = monthsAgo(months - 1);

  const [rows, cityRoutes] = await Promise.all([
    supabase
      .from('oil_tracking')
      .select('scent_name, liters_added, recorded_at, device:devices!inner(city, customer:customers!inner(route_name))')
      .gte('recorded_at', start.toISOString())
      .then(unwrap),
    loadCityRoutesMap(),
  ]);

  const byScent = new Map();
  let visitCount = 0;

  for (const row of rows) {
    const route = effectiveDeviceRoute(row.device, cityRoutes);
    if (route !== routeName) continue;
    visitCount += 1;

    const scent = row.scent_name?.trim() || 'ללא ניחוח';
    byScent.set(scent, (byScent.get(scent) ?? 0) + Number(row.liters_added ?? 0));
  }

  const items = [...byScent.entries()]
    .map(([scent_name, liters]) => ({ scent_name, liters: Math.round(liters * 100) / 100 }))
    .sort((a, b) => b.liters - a.liters);

  return { items, totalLiters: items.reduce((sum, r) => sum + r.liters, 0), visitCount };
}

/**
 * סיכום תנועות מלאי לטכנאי בטווח תאריכים — כמה יצא מהמחסן (allocate)
 * מול כמה חזר בפועל (return), לפי ניחוח/דגם. ההפרש בין השניים הוא
 * מה שאמור להיות עדיין ברכב (יתרת technician_stock) או שנצרך בפועל
 * (oil_tracking) — שלושתם יחד סוגרים את מעגל "יצא / נצרך / חזר".
 */
export async function getStockMovementsSummary({ technicianId, months = 1 } = {}) {
  const start = monthsAgo(months - 1);

  let query = supabase
    .from('stock_movements')
    .select('movement_type, model, scent_name, quantity, created_at')
    .gte('created_at', start.toISOString());

  if (technicianId) query = query.eq('technician_id', technicianId);

  const rows = await query.then(unwrap);

  const byKey = new Map();
  for (const row of rows) {
    const key = row.model || row.scent_name || 'לא ידוע';
    const bucket = byKey.get(key) ?? { label: key, allocated: 0, returned: 0 };
    if (row.movement_type === 'allocate') bucket.allocated += Number(row.quantity);
    else bucket.returned += Number(row.quantity);
    byKey.set(key, bucket);
  }

  return [...byKey.values()]
    .map((row) => ({ ...row, net: Math.round((row.allocated - row.returned) * 100) / 100 }))
    .sort((a, b) => b.allocated - a.allocated);
}

/* =====================================================================
   חוזים

   שני מסלולים מזינים את אותה טבלה: (א) העלאת חוזה קיים שכבר נחתם
   בנייר (uploadContract) — גלוי למנהלים בלבד, כמו קודם. (ב) הפקת
   חוזה דיגיטלי מהתבנית הסטנדרטית (createGeneratedContract) ושליחתו
   לחתימה מרחוק דרך קישור ציבורי — customer.jsx לא צריך חשבון כדי
   לחתום, רק את ה-sign_token שבקישור.

   get_contract_for_signing / submit_contract_signature הם RPC-ים
   security definer שכבר מותקנים ב-Supabase (מוענקים גם ל-anon) —
   הם עוקפים את ה-RLS הרגיל של הטבלה בכוונה, כי לקוח שחותם על חוזה
   לא מחובר למערכת בכלל. שני ה-RPC-ים בודקים את התוקן/תפוגה בעצמם.
   ===================================================================== */

const CONTRACT_SIGN_TTL_DAYS = 30;

/**
 * הפקת חוזה מהתבנית הסטנדרטית: מעלה את קובץ ה-HTML שנוצר ל-Storage,
 * ורושם שורה חדשה בסטטוס 'sent' עם sign_token — הלינק הציבורי
 * (../?sign=<token>) הוא מה שהמנהל שולח ללקוח (למשל בוואטסאפ).
 */
export async function createGeneratedContract({ customerId, title, html }) {
  const sign_token = crypto.randomUUID();
  const path = `${customerId}/${sign_token}.html`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const { error: uploadError } = await supabase.storage
    .from('contracts')
    .upload(path, blob, { upsert: false, contentType: 'text/html' });
  if (uploadError) throw uploadError;

  const expires = new Date();
  expires.setDate(expires.getDate() + CONTRACT_SIGN_TTL_DAYS);

  return supabase
    .from('contracts')
    .insert({
      customer_id: customerId,
      title,
      status: 'sent',
      file_path: path,
      sign_token,
      sign_token_expires_at: expires.toISOString(),
    })
    .select()
    .single()
    .then(unwrap);
}

/**
 * כתובת ציבורית קבועה לקובץ ב-bucket "contracts" (הוגדר public) —
 * לא signed URL, לא תלוית session, כדי שעמוד החתימה הציבורי יוכל
 * להציג אותה ב-iframe בלי להיות מחובר. בטוח כי שם הקובץ הוא טוקן
 * אקראי (sign_token או uuid) שאי אפשר לנחש.
 */
export const contractPublicUrl = (filePath) =>
  `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/contracts/${filePath}`;

/** נקרא מעמוד החתימה הציבורי (בלי session) — RPC ציבורי, מסמן 'נצפה' אוטומטית בצד השרת */
export const getContractForSigning = (token) =>
  supabase.rpc('get_contract_for_signing', { p_token: token }).then(unwrap);

/** שולח את החתימה — RPC ציבורי; זורק אם הטוקן לא תקף/פג/כבר נחתם */
export const submitContractSignature = ({ token, signerName, signerIdNumber, signatureData }) =>
  supabase
    .rpc('submit_contract_signature', {
      p_token: token,
      p_signer_name: signerName,
      p_signer_id_number: signerIdNumber,
      p_signature_data: signatureData,
    })
    .then(unwrap);

/** רשימת החוזים של לקוח מסוים, מהחדש לישן */
export const listContracts = (customerId) =>
  supabase
    .from('contracts')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .then(unwrap);

/**
 * מעלה קובץ חוזה קיים (סריקה / תמונה / PDF) ל-Storage, ורושם שורה
 * חדשה בטבלת contracts בסטטוס 'uploaded'. שם הקובץ מקבל קידומת
 * אקראית כדי שלא יתנגש עם קובץ אחר באותה תיקיית לקוח.
 */
export async function uploadContract(customerId, file, title) {
  const cleanName = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${customerId}/${crypto.randomUUID()}-${cleanName}`;

  const { error: uploadError } = await supabase.storage
    .from('contracts')
    .upload(path, file, { upsert: false });
  if (uploadError) throw uploadError;

  return supabase
    .from('contracts')
    .insert({ customer_id: customerId, title: title || file.name, status: 'uploaded', file_path: path })
    .select()
    .single()
    .then(unwrap);
}

/** קישור זמני (שעה) לצפייה / הורדה של קובץ חוזה */
export const getContractUrl = (filePath) =>
  supabase.storage
    .from('contracts')
    .createSignedUrl(filePath, 60 * 60)
    .then(({ data, error }) => {
      if (error) throw error;
      return data.signedUrl;
    });

/** מחיקת חוזה — גם השורה בטבלה וגם הקובץ באחסון */
export async function deleteContract(contract) {
  if (contract.file_path) {
    await supabase.storage.from('contracts').remove([contract.file_path]);
  }
  await supabase.from('contracts').delete().eq('id', contract.id).then(unwrap);
}

/**
 * לוגו המותג: קובץ יחיד בנתיב קבוע ב-bucket הציבורי "branding" —
 * upsert דורס את הקודם, כך שאין צורך בשורת DB שמצביעה לקובץ.
 * upload_at מצורף ל-URL כ-cache-buster (אחרת הדפדפן ימשיך להציג
 * את התמונה הישנה מה-cache גם אחרי דריסה).
 */
const BRAND_LOGO_PATH = 'logo';

export async function uploadBrandLogo(file) {
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const path = `${BRAND_LOGO_PATH}.${ext}`;

  const { error } = await supabase.storage
    .from('branding')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;

  return `${brandLogoUrl(ext)}?v=${Date.now()}`;
}

export const brandLogoUrl = (ext = 'png') =>
  `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/branding/${BRAND_LOGO_PATH}.${ext}`;

/** סדר הסיומות שננסה כשמציגים את הלוגו בלי לדעת מראש איזה פורמט הועלה */
export const BRAND_LOGO_EXT_FALLBACK = ['png', 'jpg', 'jpeg', 'webp', 'svg'];

/* =====================================================================
   בקשות שינוי במכשיר (ניחוח / דגם) — פאנל הטכנאי במסך המסלולים
   מציע שינוי, אבל לא כותב ישירות ל-devices: הכתיבה בפועל קורית רק
   דרך ה-RPC review_device_change_request, ורק למנהל (is_admin),
   כדי שכל שינוי יעבור אישור מפורש. ר' device_change_requests.sql.
   ===================================================================== */

export const requestDeviceChange = ({ deviceId, field, oldValue, newValue, note }) =>
  supabase
    .from('device_change_requests')
    .insert({ device_id: deviceId, field, old_value: oldValue ?? null, new_value: newValue, note: note || null })
    .select()
    .single()
    .then(unwrap);

/** למנהל בלבד — כל הבקשות הממתינות, עם פרטי המכשיר/לקוח כדי לדעת על מה מדובר */
export const listPendingDeviceChangeRequests = () =>
  supabase
    .from('device_change_requests')
    .select(`
      id, field, old_value, new_value, note, requested_at,
      requester:profiles!device_change_requests_requested_by_fkey(full_name),
      device:devices(id, serial, model, scent_name, customer:customers(name))
    `)
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
    .then(unwrap);

/** מנהל בלבד (נאכף ב-RPC עצמו) — מאשר או דוחה, ומעדכן את devices בפועל אם אושר */
export const reviewDeviceChangeRequest = ({ requestId, approve, note }) =>
  supabase
    .rpc('review_device_change_request', { p_request_id: requestId, p_approve: approve, p_review_note: note || null })
    .then(unwrap);

/**
 * ביקורים שהושלמו לאחרונה (route_assignments.status='done'), להתראת
 * הפעמון בראש המסך. updated_at מתעדכן אוטומטית ע"י טריגר (ר'
 * iconair_schema_phase14_visit_sync_and_capacity.sql) — לפני הטריגר
 * הזה השדה פשוט לא זז, אז המיון "לאחרונה" לא היה אמין.
 */
export const listRecentCompletedVisits = (limit = 8) =>
  supabase
    .from('route_assignments')
    .select('id, updated_at, customer:customers(name), site:customer_sites(label), route:routes(name)')
    .eq('status', 'done')
    .order('updated_at', { ascending: false })
    .limit(limit)
    .then(unwrap);

/**
 * דוחות שירות PDF שנוצרו לאחרונה (phase21) — להתראת הפעמון ולטוסט
 * "הטכנאי X סיים ביקור אצל Y". כל השדות המוצגים כבר "תמונת מצב" על
 * השורה עצמה (ר' iconair_schema_phase21_service_reports.sql) — אין
 * כאן joins, כדי שרשימת ההתראות לא תיפול אם מכשיר/לקוח נמחקו בינתיים.
 */
export const listRecentServiceReports = (limit = 8) =>
  supabase
    .from('service_reports')
    .select('id, customer_name, customer_email, device_model, event_type, scent_name, technician_name, file_path, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
    .then(unwrap);

export const serviceReportUrl = (filePath) =>
  supabase.storage.from('service-reports').getPublicUrl(filePath).data.publicUrl;

/**
 * הגדרות שליחת המייל האוטומטית (phase22) — שורה יחידה. מפתח ה-Resend
 * עצמו לעולם לא עובר כאן ולא בשום קוד frontend — הוא נשמר מוצפן ב-
 * Supabase Vault ונקרא רק מתוך הטריגר בצד השרת (ר' iconair_schema_
 * phase22_email_notifications.sql). מה שכן ניהל כאן זה רק "למי לשלוח
 * עותק ניהולי" ו"מאיזו כתובת לשלוח" — לא סודות.
 */
export const getNotificationSettings = () =>
  supabase.from('notification_settings').select('*').eq('id', true).single().then(unwrap);

export const updateNotificationSettings = (patch) =>
  supabase.from('notification_settings').update(patch).eq('id', true).select().single().then(unwrap);

/**
 * שליחה ידנית של דוח שירות ללקוח (phase23) — ביוזמת מנהל בלבד, כשהלקוח
 * מבקש את הדוח במפורש. השליחה האוטומטית (הטריגר ב-DB) שולחת רק לכתובת
 * הניהולית המרכזית, לעולם לא ללקוח — זו הדרך היחידה שהלקוח מקבל מייל.
 */
export const sendServiceReportToCustomer = (reportId) =>
  supabase.rpc('send_service_report_to_customer', { p_report_id: reportId }).then(unwrap);

/** היסטוריית שמן לרשימת מכשירים נתונה (הכרטיסייה המלאה של עצירה במסלול) */
export const listOilHistoryForDevices = (deviceIds, limit = 20) =>
  deviceIds.length === 0
    ? Promise.resolve([])
    : supabase
        .from('oil_tracking')
        .select('id, device_id, event_type, scent_name, liters_added, level_before_pct, level_after_pct, batteries_replaced, recorded_at, notes')
        .in('device_id', deviceIds)
        .order('recorded_at', { ascending: false })
        .limit(limit)
        .then(unwrap);