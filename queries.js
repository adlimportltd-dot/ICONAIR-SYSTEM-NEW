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
   לקוחות
   ===================================================================== */

export function listCustomers({ search = '', status = '' } = {}) {
  let query = supabase
    .from('customers')
    .select('*, devices(count)')
    .order('name');

  const needle = safeSearch(search);
  if (needle) {
    query = query.or(`name.ilike.%${needle}%,contact_name.ilike.%${needle}%,city.ilike.%${needle}%`);
  }
  if (status) query = query.eq('status', status);

  return query.then(unwrap);
}

export const createCustomer = (payload) =>
  supabase.from('customers').insert(payload).select('*, devices(count)').single().then(unwrap);

export const updateCustomer = (id, patch) =>
  supabase.from('customers').update(patch).eq('id', id).select().single().then(unwrap);

/* =====================================================================
   מכשירים
   ===================================================================== */

export function listDevices({ search = '', model = '', status = '' } = {}) {
  let query = supabase
    .from('devices')
    .select('*, customer:customers(id, name, city, route_name)')
    .order('serial');

  const needle = safeSearch(search);
  if (needle) query = query.ilike('serial', `%${needle}%`);
  if (model) query = query.eq('model', model);
  if (status) query = query.eq('status', status);

  return query.then(unwrap);
}

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
