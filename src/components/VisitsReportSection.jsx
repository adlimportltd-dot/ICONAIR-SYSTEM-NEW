import { useEffect, useMemo, useState } from 'react';
import GlassCard, { CardHead } from './ui/GlassCard';
import { StatusChip } from './ui/DataTable';
import { Async, EmptyState } from './ui/States';
import { Field, TextInput, SecondaryButton } from './ui/Field';
import { RouteIcon, SearchIcon, PrinterIcon } from './ui/Icons';
import { useQuery } from '../hooks/useQuery';
import { supabase } from '../lib/supabase';
import { OIL_EVENT_LABEL, formatNumber } from '../lib/mappers';

/**
 * דוח ביקורים לפי לקוח — 2026-10-04, בקשה מפורשת: "בטאב דוחות להוציא
 * דוח ביקורים לפי חיפוש שם לקוח ומה בוצע, רטרו בחודשים קודמים".
 *
 * מקורות (קריאה בלבד, שום טבלה חדשה):
 *  - oil_tracking — כל פעולה שנרשמה בשטח על מכשיר של הלקוח (מילוי /
 *    החלפת מכל / קריאת מד / סוללות). "ביקור" = כל הפעולות באותו יום
 *    באותה כתובת (site), בדיוק כמו המייל המסכם של phase34.
 *  - service_reports — קישור ל-PDF של כל פעולה (אם נוצר).
 *  - route_assignments status='skipped' — "העסק סגור / לא נמצא" (phase35),
 *    עם הערת הטכנאי, ומי סימן ומתי (status_changed_by/at, phase54).
 */

const TZ = 'Asia/Jerusalem';
const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const dayLabel = (key) => {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
};
const timeLabel = (iso) =>
  new Date(iso).toLocaleTimeString('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

const monthInputValue = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

function monthRange(fromMonth, toMonth) {
  const [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  const from = new Date(fy, fm - 1, 1);
  const to = new Date(ty, tm, 1); // תחילת החודש שאחרי "עד חודש" — לא כולל
  return from <= to ? { from, to } : { from: new Date(ty, tm - 1, 1), to: new Date(fy, fm, 1) };
}

const cleanSearch = (value) => value.replace(/[,()%\\]/g, ' ').trim();

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function searchCustomers(text) {
  const needle = cleanSearch(text);
  if (needle.length < 2) return [];
  return supabase
    .from('customers_secure')
    .select('id, name, city')
    .or(`name.ilike.%${needle}%,contact_name.ilike.%${needle}%,city.ilike.%${needle}%`)
    .order('name')
    .limit(12)
    .then(unwrap);
}

async function listClosedVisits(customerId) {
  const withTracking = await supabase
    .from('route_assignments')
    .select('id, site_id, closed_reason, updated_at, status_changed_at, changer:profiles!route_assignments_status_changed_by_fkey(full_name)')
    .eq('customer_id', customerId)
    .eq('status', 'skipped');
  if (!withTracking.error) return withTracking.data ?? [];

  // phase54 עוד לא הורץ ב-Supabase — בלי עמודות "מי/מתי סימן".
  return supabase
    .from('route_assignments')
    .select('id, site_id, closed_reason, updated_at')
    .eq('customer_id', customerId)
    .eq('status', 'skipped')
    .then(unwrap);
}

async function getVisitsReport({ customerId, from, to }) {
  const [sites, devices, closed] = await Promise.all([
    supabase.from('customer_sites').select('id, label, city').eq('customer_id', customerId).then(unwrap),
    supabase.from('devices').select('id, serial, model, site_id, location_note').eq('customer_id', customerId).then(unwrap),
    listClosedVisits(customerId),
  ]);

  const siteById = new Map(sites.map((s) => [s.id, s]));
  const deviceById = new Map(devices.map((d) => [d.id, d]));
  const deviceIds = devices.map((d) => d.id);

  const oilRows = [];
  for (const ids of chunk(deviceIds, 100)) {
    const rows = await supabase
      .from('oil_tracking')
      .select('id, device_id, event_type, scent_name, liters_added, level_before_pct, level_after_pct, batteries_replaced, notes, recorded_at, recorder:profiles(full_name)')
      .in('device_id', ids)
      .gte('recorded_at', from.toISOString())
      .lt('recorded_at', to.toISOString())
      .order('recorded_at')
      .limit(5000)
      .then(unwrap);
    oilRows.push(...rows);
  }

  const pdfByOilId = new Map();
  for (const ids of chunk(oilRows.map((r) => r.id), 100)) {
    const rows = await supabase
      .from('service_reports')
      .select('oil_tracking_id, file_path')
      .in('oil_tracking_id', ids)
      .then(unwrap)
      .catch(() => []);
    for (const r of rows) {
      pdfByOilId.set(r.oil_tracking_id, supabase.storage.from('service-reports').getPublicUrl(r.file_path).data.publicUrl);
    }
  }

  const siteLabel = (siteId) => {
    const site = siteById.get(siteId);
    return site ? [site.label, site.city].filter(Boolean).join(' · ') : 'כתובת ראשית';
  };

  const visits = new Map();
  for (const row of oilRows) {
    const device = deviceById.get(row.device_id) ?? {};
    const date = dayKey(row.recorded_at);
    const key = `${date}|${device.site_id ?? 'main'}`;
    if (!visits.has(key)) {
      visits.set(key, {
        key, date, type: 'done', time: row.recorded_at, site: siteLabel(device.site_id),
        technicians: new Set(), items: [], reason: null,
      });
    }
    const visit = visits.get(key);
    if (row.recorder?.full_name) visit.technicians.add(row.recorder.full_name);
    visit.items.push({
      id: row.id,
      serial: device.serial ?? '—',
      model: device.model ?? '—',
      location: device.location_note ?? '',
      scent: row.scent_name ?? '',
      action: OIL_EVENT_LABEL[row.event_type] ?? row.event_type,
      ml: Math.round(Number(row.liters_added ?? 0) * 1000),
      before: row.level_before_pct,
      after: row.level_after_pct,
      batteries: row.batteries_replaced ?? 0,
      notes: row.notes ?? '',
      pdf: pdfByOilId.get(row.id) ?? null,
    });
  }

  for (const row of closed) {
    const when = row.status_changed_at ?? row.updated_at;
    if (!when) continue;
    const at = new Date(when);
    if (at < from || at >= to) continue;
    const date = dayKey(when);
    visits.set(`closed|${row.id}`, {
      key: `closed|${row.id}`, date, type: 'closed', time: when, site: siteLabel(row.site_id),
      technicians: new Set(row.changer?.full_name ? [row.changer.full_name] : []),
      items: [], reason: row.closed_reason ?? '',
    });
  }

  const list = [...visits.values()]
    .map((v) => ({ ...v, technicians: [...v.technicians] }))
    .sort((a, b) => (a.time < b.time ? 1 : -1));

  const done = list.filter((v) => v.type === 'done');
  return {
    visits: list,
    totals: {
      visits: done.length,
      closed: list.length - done.length,
      liters: oilRows.reduce((sum, r) => sum + Number(r.liters_added ?? 0), 0),
      devices: new Set(oilRows.map((r) => r.device_id)).size,
    },
  };
}

/* ------------------------------ ייצוא ------------------------------ */

function exportRows(visits) {
  const rows = [['תאריך', 'שעה', 'כתובת', 'סטטוס', 'טכנאי', 'מכשיר', 'דגם', 'מיקום', 'ניחוח', 'פעולה', 'כמות (מ״ל)', 'מפלס לפני', 'מפלס אחרי', 'סוללות', 'הערות']];
  for (const v of visits) {
    if (v.type === 'closed') {
      rows.push([dayLabel(v.date), timeLabel(v.time), v.site, 'עסק סגור / לא נמצא', v.technicians.join(', '), '', '', '', '', '', '', '', '', '', v.reason || '']);
      continue;
    }
    for (const it of v.items) {
      rows.push([dayLabel(v.date), timeLabel(v.time), v.site, 'בוצע', v.technicians.join(', '), it.serial, it.model, it.location, it.scent, it.action, it.ml, it.before ?? '', it.after ?? '', it.batteries || '', it.notes]);
    }
  }
  return rows;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function printReport({ customer, rangeLabel, data }) {
  const win = window.open('', '_blank');
  if (!win) return;
  const blocks = data.visits.map((v) => {
    const head = `<div class="vh"><b>${esc(dayLabel(v.date))} ${esc(timeLabel(v.time))}</b> · ${esc(v.site)}
      · <span class="${v.type === 'closed' ? 'bad' : 'ok'}">${v.type === 'closed' ? 'עסק סגור / לא נמצא' : 'בוצע'}</span>
      ${v.technicians.length ? ` · טכנאי: ${esc(v.technicians.join(', '))}` : ''}</div>`;
    if (v.type === 'closed') {
      return `<div class="v">${head}<div class="reason">הערת הטכנאי: ${esc(v.reason || 'לא הוזנה הערה')}</div></div>`;
    }
    const rows = v.items.map((it) => `<tr><td>${esc(it.serial)}</td><td>${esc(it.model)}</td><td>${esc(it.location)}</td>
      <td>${esc(it.scent)}</td><td>${esc(it.action)}</td><td>${it.ml}</td>
      <td>${it.before ?? '—'}% ← ${it.after ?? '—'}%</td><td>${it.batteries || ''}</td><td>${esc(it.notes)}</td></tr>`).join('');
    return `<div class="v">${head}<table><thead><tr><th>מכשיר</th><th>דגם</th><th>מיקום</th><th>ניחוח</th><th>פעולה</th>
      <th>מ״ל</th><th>מפלס</th><th>סוללות</th><th>הערות</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join('');

  win.document.write(`<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">
    <title>דוח ביקורים — ${esc(customer.name)}</title>
    <style>
      body{font-family:Arial,sans-serif;color:#0f172a;margin:28px;font-size:13px}
      h1{font-size:22px;margin:0 0 4px} .sub{color:#64748b;margin-bottom:16px}
      .sum{display:flex;gap:22px;margin:0 0 18px;font-size:14px}
      .v{border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;margin-bottom:10px;page-break-inside:avoid}
      .vh{margin-bottom:6px} .ok{color:#15803D;font-weight:bold} .bad{color:#B91C1C;font-weight:bold}
      table{width:100%;border-collapse:collapse} th,td{text-align:right;padding:4px 6px;border-bottom:1px solid #e2e8f0}
      th{color:#64748b;font-size:12px} .reason{color:#334155}
    </style></head><body>
    <h1>דוח ביקורים — ${esc(customer.name)}</h1>
    <div class="sub">${esc(rangeLabel)} · ICONAIR — אייקון אייר בע״מ</div>
    <div class="sum"><span>ביקורים שבוצעו: <b>${data.totals.visits}</b></span>
      <span>סגור / לא נמצא: <b>${data.totals.closed}</b></span>
      <span>סה״כ ריח: <b>${formatNumber(data.totals.liters, 2)} ל׳</b></span>
      <span>מכשירים שטופלו: <b>${data.totals.devices}</b></span></div>
    ${blocks || '<p>אין ביקורים בטווח הזה.</p>'}
    <script>window.onload=function(){window.print()}</script>
    </body></html>`);
  win.document.close();
}

/* ------------------------------ UI ------------------------------ */

export default function VisitsReportSection() {
  const now = new Date();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [customer, setCustomer] = useState(null);
  const [fromMonth, setFromMonth] = useState(monthInputValue(new Date(now.getFullYear(), now.getMonth() - 2, 1)));
  const [toMonth, setToMonth] = useState(monthInputValue(now));

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const suggestions = useQuery(() => searchCustomers(debounced), [debounced], {
    enabled: !customer && cleanSearch(debounced).length >= 2,
  });

  const range = useMemo(() => monthRange(fromMonth, toMonth), [fromMonth, toMonth]);
  const rangeLabel = `${monthInputValue(range.from).split('-').reverse().join('/')} עד ${monthInputValue(new Date(range.to.getFullYear(), range.to.getMonth() - 1, 1)).split('-').reverse().join('/')}`;

  const report = useQuery(
    () => getVisitsReport({ customerId: customer.id, from: range.from, to: range.to }),
    [customer?.id, range.from.getTime(), range.to.getTime()],
    { enabled: Boolean(customer) }
  );

  const data = report.data;

  return (
    <section className="mt-3.5">
      <GlassCard>
        <CardHead
          icon={RouteIcon}
          tone="slate"
          title="דוח ביקורים ללקוח"
          subtitle="חיפוש לפי שם לקוח · מה בוצע בכל ביקור · גם חודשים קודמים"
        />

        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="relative">
            <Field label="לקוח">
              {customer ? (
                <div className="inner-row flex items-center gap-2 px-4 py-3 text-[15px]">
                  <span className="truncate font-semibold">{customer.name}</span>
                  {customer.city && <span className="text-[13px] text-text-faint">{customer.city}</span>}
                  <button
                    type="button"
                    className="ms-auto text-[13.5px] font-semibold text-gold-600"
                    onClick={() => { setCustomer(null); setQuery(''); setDebounced(''); }}
                  >
                    החלף לקוח
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <TextInput
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="הקלד שם לקוח, איש קשר או עיר…"
                    className="ps-10"
                  />
                  <SearchIcon aria-hidden className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                </div>
              )}
            </Field>

            {!customer && cleanSearch(debounced).length >= 2 && (
              <div className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-[300px] overflow-y-auto rounded-row border border-[#CBD5E1] bg-ink-900 p-1.5 shadow-lift">
                {suggestions.loading && <div className="px-3 py-2.5 text-[14px] text-text-faint">מחפש…</div>}
                {!suggestions.loading && (suggestions.data ?? []).length === 0 && (
                  <div className="px-3 py-2.5 text-[14px] text-text-faint">לא נמצא לקוח בשם הזה</div>
                )}
                {(suggestions.data ?? []).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCustomer(c)}
                    className="flex w-full items-center gap-2 rounded-row px-3 py-2.5 text-start text-[15px] hover:bg-ink-800"
                  >
                    <span className="font-semibold">{c.name}</span>
                    {c.city && <span className="ms-auto text-[13px] text-text-faint">{c.city}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Field label="מחודש">
            <TextInput type="month" value={fromMonth} onChange={(e) => e.target.value && setFromMonth(e.target.value)} />
          </Field>
          <Field label="עד חודש">
            <TextInput type="month" value={toMonth} onChange={(e) => e.target.value && setToMonth(e.target.value)} />
          </Field>
        </div>

        {!customer ? (
          <EmptyState title="בחר לקוח כדי לראות את היסטוריית הביקורים שלו" hint="אפשר לבחור טווח של כמה חודשים אחורה." />
        ) : (
          <Async
            loading={report.loading}
            error={report.error}
            onRetry={report.refetch}
            isEmpty={data?.visits.length === 0}
            empty={<EmptyState title="אין ביקורים בטווח הזה" hint="נסה להרחיב את טווח החודשים." />}
          >
            {data && (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-row border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3.5 text-[14.5px] font-semibold text-text-dim">
                  <span>בוצעו: <b className="tabular font-mono text-text">{data.totals.visits}</b></span>
                  <span>סגור / לא נמצא: <b className="tabular font-mono text-crit-soft">{data.totals.closed}</b></span>
                  <span>סה״כ ריח: <b className="tabular font-mono text-text">{formatNumber(data.totals.liters, 2)} ל׳</b></span>
                  <span>מכשירים שטופלו: <b className="tabular font-mono text-text">{data.totals.devices}</b></span>
                  <div className="ms-auto flex flex-wrap gap-2.5">
                    <SecondaryButton onClick={() => downloadCsv(`visits-${customer.name}.csv`, exportRows(data.visits))}>
                      ייצוא CSV
                    </SecondaryButton>
                    <SecondaryButton onClick={() => printReport({ customer, rangeLabel, data })}>
                      <PrinterIcon className="h-4 w-4" />
                      הדפסה / PDF
                    </SecondaryButton>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  {data.visits.map((v) => <VisitCard key={v.key} visit={v} />)}
                </div>
              </>
            )}
          </Async>
        )}
      </GlassCard>
    </section>
  );
}

function VisitCard({ visit }) {
  const closed = visit.type === 'closed';
  return (
    <div className="rounded-row border border-[#CBD5E1] bg-ink-900 px-4 py-3.5 shadow-nest">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="tabular font-mono text-[15px] font-bold">{dayLabel(visit.date)}</span>
        <span className="text-[13.5px] text-text-faint">{timeLabel(visit.time)}</span>
        <span className="text-[15px] font-semibold">{visit.site}</span>
        <StatusChip tone={closed ? 'crit' : 'ok'}>{closed ? 'עסק סגור / לא נמצא' : 'בוצע'}</StatusChip>
        {visit.technicians.length > 0 && (
          <span className="ms-auto text-[13.5px] text-text-faint">טכנאי: {visit.technicians.join(', ')}</span>
        )}
      </div>

      {closed ? (
        <div className="mt-2 text-[14px] text-text-dim">הערת הטכנאי: {visit.reason || 'לא הוזנה הערה'}</div>
      ) : (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {visit.items.map((it) => (
            <div key={it.id} className="inner-row flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2.5 text-[14px]">
              <span dir="ltr" className="font-mono font-semibold">{it.serial}</span>
              <span className="text-text-dim">{it.model}</span>
              {it.location && <span className="text-text-faint">{it.location}</span>}
              <span className="font-semibold">{it.action}</span>
              {it.scent && <span>{it.scent}</span>}
              <span className="tabular font-mono text-text-dim">{it.ml} מ״ל</span>
              <span className="tabular font-mono text-text-faint">{it.before ?? '—'}% ← {it.after ?? '—'}%</span>
              {it.batteries > 0 && <span className="text-text-dim">סוללות: {it.batteries}</span>}
              {it.notes && <span className="text-text-faint">{it.notes}</span>}
              {it.pdf && (
                <a href={it.pdf} target="_blank" rel="noreferrer" className="ms-auto font-semibold text-gold-600">PDF</a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
