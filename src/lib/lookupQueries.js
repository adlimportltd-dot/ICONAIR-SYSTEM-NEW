import { supabase } from './supabase';

/**
 * "ביקור אחרון" בחיפוש העליון (2026-10-20, בקשה מפורשת של ליאור אחרי שאוורסט
 * התקשרו לשאול מתי היו בנחל שניר 11). קריאה בלבד — אין כאן שום כתיבה.
 *
 * עצירה = לקוח חד-כתובתי (customers) או כתובת של לקוח ריבוי-כתובות
 * (customer_sites, כמו בנייני אוורסט) — אותו כלל כמו במסך המסלולים.
 */

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/** כל העצירות לחיפוש בצד הלקוח — נטען פעם אחת בפתיחת החיפוש. */
export async function loadLookupIndex() {
  const [customers, sites] = await Promise.all([
    supabase.from('customers').select('id, name, address, city, status').then(unwrap),
    supabase.from('customer_sites').select('id, label, city, customer_id, customer:customers(name)').then(unwrap),
  ]);

  const withSites = new Set(sites.map((s) => s.customer_id));

  const customerStops = customers
    .filter((c) => !withSites.has(c.id))
    .map((c) => ({
      key: `c:${c.id}`,
      customerId: c.id,
      siteId: null,
      title: c.name,
      address: [c.address, c.city].filter(Boolean).join(', '),
      inactive: c.status !== 'active',
    }));

  const siteStops = sites.map((s) => ({
    key: `s:${s.id}`,
    customerId: s.customer_id,
    siteId: s.id,
    title: `${s.customer?.name ?? ''} · ${s.label}`,
    address: [s.label, s.city].filter(Boolean).join(', '),
    inactive: false,
  }));

  return [...siteStops, ...customerStops];
}

const pad = (n) => String(n).padStart(2, '0');
const monthStartISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
};

/**
 * היסטוריית ביקורים לעצירה אחת: המכשירים שלה, הביקורים האחרונים
 * (מקובצים לפי יום — ביקור אחד = כל המכשירים שמולאו באותו יום), וסטטוס
 * החודש מהמסלול.
 */
export async function getStopHistory({ customerId, siteId }) {
  let devQuery = supabase
    .from('devices')
    .select('id, serial, model, location_note, scent_name, created_at, status')
    .neq('status', 'uninstalled');
  devQuery = siteId ? devQuery.eq('site_id', siteId) : devQuery.eq('customer_id', customerId).is('site_id', null);
  const devices = await devQuery.then(unwrap);

  const ids = devices.map((d) => d.id);
  const oil = ids.length
    ? await supabase
      .from('oil_tracking')
      .select('device_id, event_type, liters_added, scent_name, recorded_at, notes, recorder:profiles(full_name)')
      .in('device_id', ids)
      .neq('event_type', 'reading') // איפוסי תחילת מחזור הם לא ביקור
      .order('recorded_at', { ascending: false })
      .limit(60)
      .then(unwrap)
    : [];

  // ביקור = יום. כמה רישומים באותו יום (כמה מכשירים) מתאחדים לשורה אחת.
  const byDay = new Map();
  for (const row of oil) {
    if (row.notes?.startsWith('איפוס תחילת מחזור')) continue;
    const d = new Date(row.recorded_at);
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const v = byDay.get(day) ?? { day, at: row.recorded_at, liters: 0, devices: new Set(), who: new Set(), notes: [], perDevice: new Map() };
    v.liters += Number(row.liters_added ?? 0);
    v.devices.add(row.device_id);
    // פירוט לכל מכשיר בביקור (2026-10-20, בקשה מפורשת): כמה נכנס, באיזה ריח והערות
    const pd = v.perDevice.get(row.device_id) ?? { liters: 0, scents: new Set(), notes: [] };
    pd.liters += Number(row.liters_added ?? 0);
    if (row.scent_name) pd.scents.add(row.scent_name);
    if (row.notes?.trim()) pd.notes.push(row.notes.trim());
    v.perDevice.set(row.device_id, pd);
    if (row.recorder?.full_name) v.who.add(row.recorder.full_name);
    if (row.notes?.trim()) v.notes.push(row.notes.trim());
    byDay.set(day, v);
  }
  const visits = [...byDay.values()]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 5)
    .map((v) => ({
      at: v.at,
      liters: Math.round(v.liters * 100) / 100,
      deviceCount: v.devices.size,
      who: [...v.who].join(', '),
      notes: v.notes,
      perDevice: Object.fromEntries([...v.perDevice].map(([id, pd]) => [id, {
        liters: Math.round(pd.liters * 100) / 100,
        scent: [...pd.scents].join(', '),
        notes: pd.notes,
      }])),
    }));

  let monthQuery = supabase
    .from('route_assignments')
    .select('status, visit_date, updated_at, closed_reason')
    .gte('visit_date', monthStartISO())
    .order('updated_at', { ascending: false })
    .limit(5);
  monthQuery = siteId ? monthQuery.eq('site_id', siteId) : monthQuery.eq('customer_id', customerId).is('site_id', null);
  const monthRows = await monthQuery.then(unwrap).catch(() => []);
  const RANK = { done: 2, skipped: 1, pending: 0 };
  const month = monthRows.reduce((best, r) => (!best || (RANK[r.status] ?? 0) > (RANK[best.status] ?? 0) ? r : best), null);

  const firstAdded = devices.reduce((min, d) => (!min || d.created_at < min ? d.created_at : min), null);

  return { devices, visits, month, firstAdded };
}
