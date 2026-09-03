import { supabase } from './supabase';

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
  supabase.from('customers').select('id, name, city').order('name').then(unwrap);

export const listDeviceOptions = () =>
  supabase
    .from('devices')
    .select('id, serial, model, oil_level_pct, customer:customers(id, name)')
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
  const [customers, sites, cityRoutes] = await Promise.all([
    supabase.from('customers').select('id, route_name, devices(count)').eq('status', 'active').then(unwrap),
    supabase.from('customer_sites').select('customer_id, city, devices(count)').then(unwrap),
    loadCityRoutesMap(),
  ]);

  const customersWithSites = new Set(sites.map((s) => s.customer_id));
  const groups = new Map();

  const bump = (name, stopDelta, deviceDelta) => {
    const key = name ?? '__none__';
    const g = groups.get(key) ?? { name, customers: 0, devices: 0 };
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
 * עצירות פעילות על קו נתון — לקוחות חד-כתובתיים (route_name תואם,
 * ואין להם שום אתר) + אתרים שהעיר שלהם ממופה לקו הזה. שתי הצורות
 * מוחזרות באותה צורה בדיוק (kind מבדיל ביניהן רק לצורך תצוגה),
 * כדי ש-RouteStops לא יצטרך לדעת איזה סוג עצירה זה.
 */
export async function listStopsByRoute(routeName) {
  const [customers, sites, cityRoutes] = await Promise.all([
    supabase.from('customers')
      .select('id, name, address, city, phone, notes, route_name, devices(id, model, scent_name, oil_level_pct)')
      .eq('status', 'active').then(unwrap),
    supabase.from('customer_sites')
      .select('id, customer_id, label, city, customer:customers(name, phone, notes), devices(id, model, scent_name, oil_level_pct)')
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
      notes: c.notes,
      devices: c.devices,
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
      notes: s.customer?.notes,
      devices: s.devices,
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
 */
export async function getRouteLoadPlan(routeName) {
  const [devicesRows, models, cityRoutes] = await Promise.all([
    supabase
      .from('devices')
      .select('model, oil_level_pct, scent_name, serial, city, customer:customers(route_name)')
      .neq('status', 'uninstalled')
      .then(unwrap),
    listAllDeviceModels(),
    loadCityRoutesMap(),
  ]);

  const capacityByModel = new Map(models.map((m) => [m.name, m.capacity_ml]));

  const byScent = new Map();
  const missing = [];
  let deviceCount = 0;

  for (const device of devicesRows) {
    const route = effectiveDeviceRoute(device, cityRoutes);
    if (route !== routeName) continue;
    deviceCount += 1;

    const capacity = capacityByModel.get(device.model);
    const scent = device.scent_name?.trim();

    if (!scent || !capacity) {
      missing.push({ serial: device.serial, model: device.model, scent_name: device.scent_name, reason: !scent ? 'no_scent' : 'no_capacity' });
      continue;
    }

    const neededMl = capacity * (100 - Number(device.oil_level_pct ?? 0)) / 100;
    byScent.set(scent, (byScent.get(scent) ?? 0) + neededMl);
  }

  const items = [...byScent.entries()]
    .map(([scent_name, ml]) => ({ scent_name, liters: Math.round((ml / 1000) * 100) / 100 }))
    .filter((row) => row.liters > 0)
    .sort((a, b) => b.liters - a.liters);

  return { items, missing, deviceCount };
}

/** yyyy-mm-dd מקומי (לא UTC) — ברירת המחדל של מסך המסלולים היא "היום". */
export const todayISO = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

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
 * עצירות הקו ליום נתון: כל העצירות הפעילות על הקו (מ-listStopsByRoute —
 * לקוחות חד-כתובתיים + אתרים), עם סדר וסטטוס מ-route_assignments אם
 * כבר נשמרו, או ברירת מחדל לחדשות. עצירה חדשה נזרעת דרך ה-RPC
 * upsert_route_stop (לא upsert רגיל — יש שני אינדקסים ייחודיים
 * חלקיים שונים לעצירת-לקוח מול עצירת-אתר, ו-upsert גנרי לא יודע
 * לבחור נכון ביניהם, ר' customer_sites.sql).
 */
export async function listRouteAssignments(routeName, visitDate) {
  const stops = await listStopsByRoute(routeName);
  if (stops.length === 0) return [];

  const siteIds = stops.filter((s) => s.site_id).map((s) => s.site_id);
  const customerIds = stops.filter((s) => !s.site_id).map((s) => s.customer_id);

  const existing = await supabase
    .from('route_assignments')
    .select('id, customer_id, site_id, stop_order, status')
    .eq('visit_date', visitDate)
    .or([
      customerIds.length ? `and(site_id.is.null,customer_id.in.(${customerIds.join(',')}))` : null,
      siteIds.length ? `site_id.in.(${siteIds.join(',')})` : null,
    ].filter(Boolean).join(','))
    .then(unwrap);

  const byKey = new Map(existing.map((a) => [a.site_id ?? a.customer_id, a]));
  const missing = stops.filter((s) => !byKey.has(stopKey(s)));

  if (missing.length) {
    const routeId = await ensureRouteId(routeName);
    const maxOrder = existing.reduce((max, a) => Math.max(max, a.stop_order), 0);

    const created = await Promise.all(missing.map((s, i) =>
      supabase.rpc('upsert_route_stop', {
        p_customer_id: s.customer_id,
        p_site_id: s.site_id,
        p_route_id: routeId,
        p_visit_date: visitDate,
        p_stop_order: maxOrder + i + 1,
      }).then(unwrap)
    ));

    for (const row of created) byKey.set(row.site_id ?? row.customer_id, row);
  }

  return stops
    .map((s) => {
      const a = byKey.get(stopKey(s));
      return { ...s, id: a.id, stopOrder: a.stop_order, status: a.status };
    })
    .sort((a, b) => a.stopOrder - b.stopOrder);
}

/**
 * שומר סדר עצירות חדש (אחרי גרירה/חצים) — כל העצירות כבר קיימות
 * כשורות route_assignments (ר' listRouteAssignments), אז זה עדכון
 * רגיל לפי id, לא upsert.
 */
export async function saveRouteOrder(orderedRowIds) {
  await Promise.all(
    orderedRowIds.map((id, i) =>
      supabase.from('route_assignments').update({ stop_order: i + 1 }).eq('id', id).then(unwrap)
    )
  );
}

/** מסמן עצירה כבוצעה/לא-בוצעה, לפי מזהה שורת route_assignments. מניח שהשורה כבר קיימת (ר' listRouteAssignments). */
export const setStopStatus = (rowId, status) =>
  supabase.from('route_assignments').update({ status }).eq('id', rowId).then(unwrap);

/* =====================================================================
   לקוחות
   ===================================================================== */

export function listCustomers({ search = '', status = '', paymentStatus = '', paymentType = '' } = {}) {
  let query = supabase
    .from('customers_secure')
    .select('*, devices(model, status)')
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

export const createCustomer = (payload) =>
  supabase.from('customers').insert(payload).select('*, devices(model, status)').single().then(unwrap);

export const updateCustomer = (id, patch) =>
  supabase.from('customers').update(patch).eq('id', id).then(unwrap);

/** טוגל מהיר לסטטוס גבייה — ישירות משורת הטבלה, בלי לפתוח טופס עריכה. לא מחזיר נתונים בכוונה — אין צורך, וכך אין סיכון שמידע כספי יחזור בתשובה למי שלא אמור לראות אותו. */
export const setCustomerPaid = (id, is_paid) =>
  supabase.from('customers').update({ is_paid }).eq('id', id).then(unwrap);

/* =====================================================================
   מכשירים
   ===================================================================== */

export function listDevices({ search = '', model = '', status = '', customerId = '' } = {}) {
  let query = supabase
    .from('devices')
    .select('*, customer:customers(id, name, city, route_name)')
    .order('serial');

  const needle = safeSearch(search);
  if (needle) query = query.ilike('serial', `%${needle}%`);
  if (model) query = query.eq('model', model);
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

export const createDevice = (payload) =>
  supabase
    .from('devices')
    // serial מושאר ריק בכוונה — טריגר בבסיס הנתונים מייצר ICN-700-0143
    .insert(payload)
    .select('*, customer:customers(id, name, city, route_name)')
    .single()
    .then(unwrap);

export const updateDevice = (id, patch) =>
  supabase.from('devices').update(patch).eq('id', id).select().single().then(unwrap);

/* =====================================================================
   מעקב שמנים
   ===================================================================== */

export const listOilEntries = ({ limit = 60 } = {}) =>
  supabase
    .from('oil_tracking')
    .select(`
      *,
      device:devices(id, serial, model, customer:customers(id, name)),
      recorder:profiles(id, full_name)
    `)
    .order('recorded_at', { ascending: false })
    .limit(limit)
    .then(unwrap);

/**
 * רישום מילוי. אין כאן עדכון של devices.oil_level_pct —
 * טריגר בבסיס הנתונים עושה את זה, כדי שהיומן והמכשיר לא יוכלו לסתור זה את זה
 * גם אם מישהו יכניס שורה ישירות מה-SQL Editor.
 */
export const createOilEntry = (payload) =>
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

/**
 * "סיום ביקור" — עוטפת את אותו insert שעושה createOilEntry, אבל דרך
 * ה-RPC complete_visit (ר' iconair_schema_phase3_visits.sql) שגם מוריד
 * יחידה אחת מהמלאי הנייד של הטכנאי המחובר, אטומית: אם אין מלאי, כל
 * הפעולה נכשלת ושום דבר לא נרשם. עד שה-SQL ההוא ירוץ, הקריאה הזו
 * תיכשל עם "function public.complete_visit does not exist".
 */
export const completeVisit = ({
  device_id, event_type, scent_name, liters_added, level_before_pct, level_after_pct, notes,
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
    })
    .single()
    .then(unwrap);

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
 */
export const returnStockToWarehouse = ({ technician_id, model, scent_name, quantity }) =>
  supabase.rpc('return_stock_to_warehouse', {
    p_technician_id: technician_id,
    p_model: model,
    p_scent_name: scent_name || '',
    p_quantity: quantity,
  }).then(unwrap);

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
  supabase.from('device_models').select('id, name, active, capacity_ml').eq('active', true).order('name').then(unwrap);

/** למסך הניהול בהגדרות — כולל דגמים מושבתים */
export const listAllDeviceModels = () =>
  supabase.from('device_models').select('id, name, active, capacity_ml').order('name').then(unwrap);

export const createDeviceModel = (name) =>
  supabase.from('device_models').insert({ name: name.trim() }).select('id, name, active').single().then(unwrap);

export const setDeviceModelActive = (id, active) =>
  supabase.from('device_models').update({ active }).eq('id', id).select('id, name, active').single().then(unwrap);

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

/** היסטוריית שמן לרשימת מכשירים נתונה (הכרטיסייה המלאה של עצירה במסלול) */
export const listOilHistoryForDevices = (deviceIds, limit = 20) =>
  deviceIds.length === 0
    ? Promise.resolve([])
    : supabase
        .from('oil_tracking')
        .select('id, device_id, event_type, scent_name, liters_added, level_before_pct, level_after_pct, recorded_at, notes')
        .in('device_id', deviceIds)
        .order('recorded_at', { ascending: false })
        .limit(limit)
        .then(unwrap);