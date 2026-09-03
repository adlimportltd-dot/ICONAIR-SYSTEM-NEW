import { useEffect, useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import { StatusChip, MiniMeter, oilTone } from '../components/ui/DataTable';
import { Async, EmptyState } from '../components/ui/States';
import { PrimaryButton, SecondaryButton, Select } from '../components/ui/Field';
import { RouteIcon, NavigationIcon, ChevronDownIcon } from '../components/ui/Icons';
import { useQuery } from '../hooks/useQuery';
import { useAuth } from '../context/AuthContext';
import {
  listRoutes, listRouteAssignments, saveRouteOrder, setStopStatus, todayISO,
  getRouteLoadPlan, listTechnicianOptions, allocateStockToTechnician,
  listAllDeviceModels, listAllScents,
  requestDeviceChange, listPendingDeviceChangeRequests, reviewDeviceChangeRequest,
} from '../lib/queries';
import { describeError } from '../lib/supabase';
import { wazeLink, googleMapsLink, googleMapsRouteLink } from '../lib/navLinks';

/**
 * מסלולים — עצירות לפי קו הפצה ותאריך, עם ניווט חד-לחיצה לכל תחנה.
 *
 * סדר העצירות וסטטוס "בוצע" נשמרים ב-route_assignments (לקוח + תאריך).
 * חברות בקו עדיין נגזרת מ-customers.route_name — route_assignments הוא
 * רק שכבת עריכה של סדר/סטטוס ליום ספציפי, לא רשימת החברים בקו.
 */
export default function RoutesScreen() {
  const [activeRoute, setActiveRoute] = useState(undefined); // undefined = טרם נבחר

  const routes = useQuery(listRoutes, []);

  useEffect(() => {
    if (activeRoute === undefined && routes.data?.length) {
      setActiveRoute(routes.data[0].name);
    }
  }, [activeRoute, routes.data]);

  return (
    <>
      <PendingChangeRequestsCard />

      <GlassCard className="mb-3.5">
        <Async loading={routes.loading} error={routes.error} onRetry={routes.refetch}
               isEmpty={routes.data?.length === 0}
               empty={<EmptyState title="אין עדיין קווים" hint="שייך לקוח לקו הפצה בכרטיס הלקוח כדי שהוא יופיע כאן." />}>
          <div className="flex flex-wrap gap-2">
            {(routes.data ?? []).map((r) => (
              <button
                key={r.name ?? '__none__'}
                type="button"
                onClick={() => setActiveRoute(r.name)}
                className={`flex items-center gap-2 rounded-pill border px-3.5 py-2 text-[13px] font-medium
                            transition-colors ${
                  r.name === activeRoute
                    ? 'border-gold-500/45 bg-gold-500/[0.14] text-gold-300'
                    : 'border-white/[0.09] text-text-dim hover:border-white/[0.18] hover:text-text'
                }`}
              >
                <RouteIcon className="h-[15px] w-[15px] flex-none" />
                {r.name ?? 'ללא שיוך לקו'}
                <span className="tabular ms-1 font-mono text-[11.5px] text-text-faint">{r.customers}</span>
              </button>
            ))}
          </div>
        </Async>
      </GlassCard>

      {activeRoute !== undefined && (
        <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <RouteStops routeName={activeRoute} />
          <RouteLoadPlanCard routeName={activeRoute} />
        </div>
      )}
    </>
  );
}

/**
 * תכנון העמסה: כמה ליטרים מכל ניחוח הטכנאי צריך לטעון היום כדי למלא
 * את כל המכשירים הפעילים בקו הזה עד הסוף — מחושב מ-capacity_ml של
 * הדגם ומהמצב הנוכחי (oil_level_pct) של כל מכשיר, ר' getRouteLoadPlan.
 * לא תלוי בתאריך שנבחר למעלה (זה תכנון "מהיום", לא תיעוד היסטורי).
 * גלוי למנהלים בלבד — זו פעולת הקצאת מלאי, כמו שאר מסך "מלאי נייד".
 */
function RouteLoadPlanCard({ routeName }) {
  const { isAdmin } = useAuth();
  const plan = useQuery(() => getRouteLoadPlan(routeName), [routeName], { enabled: isAdmin });
  const technicians = useQuery(listTechnicianOptions, [], { enabled: isAdmin });

  const technicianOptions = useMemo(
    () => (technicians.data ?? []).map((t) => ({ value: t.id, label: t.full_name ?? 'ללא שם' })),
    [technicians.data]
  );

  const [technicianId, setTechnicianId] = useState('');
  const [busyScent, setBusyScent] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState({});

  useEffect(() => {
    if (!technicianId && technicianOptions.length) setTechnicianId(technicianOptions[0].value);
  }, [technicianOptions, technicianId]);

  if (!isAdmin) return null;

  async function allocate(scentName, liters) {
    if (!technicianId) {
      setError('בחר טכנאי קודם');
      return;
    }
    setError(null);
    setBusyScent(scentName);
    try {
      await allocateStockToTechnician({ technician_id: technicianId, model: null, scent_name: scentName, quantity: liters });
      setDone((prev) => ({ ...prev, [scentName]: true }));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusyScent(null);
    }
  }

  return (
    <GlassCard>
      <CardHead title="תכנון העמסה להיום" subtitle="לפי נפח המכל של כל דגם ומצב השמן הנוכחי במכשירים" />

      <div className="mb-3.5">
        <Select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} options={technicianOptions}
                placeholder="בחר טכנאי לצורך הקצאה" />
      </div>

      {error && (
        <div className="mb-3.5 rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[12.5px] text-crit-soft">
          {error}
        </div>
      )}

      <Async
        loading={plan.loading}
        error={plan.error}
        onRetry={plan.refetch}
        isEmpty={plan.data?.items.length === 0}
        empty={<EmptyState title="אין מה להעמיס" hint="כל המכשירים בקו מלאים, או שאין מכשירים עם ניחוח משויך." />}
      >
        <div className="flex flex-col gap-2">
          {(plan.data?.items ?? []).map((row) => (
            <div key={row.scent_name} className="inner-row flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{row.scent_name}</div>
              </div>
              <span className="tabular font-mono text-[13px] text-gold-300">{row.liters} ל׳</span>
              {done[row.scent_name] ? (
                <StatusChip tone="ok">הוקצה</StatusChip>
              ) : (
                <SecondaryButton
                  disabled={busyScent === row.scent_name}
                  onClick={() => allocate(row.scent_name, row.liters)}
                >
                  {busyScent === row.scent_name ? 'מקצה…' : 'הקצה לטכנאי'}
                </SecondaryButton>
              )}
            </div>
          ))}
        </div>
      </Async>

      {plan.data?.missing.length > 0 && (
        <div className="mt-3.5 rounded-row border border-warn/25 bg-warn/[0.07] px-3.5 py-2.5 text-[12px] text-warn">
          {plan.data.missing.length} מכשירים לא נכנסו לחישוב — חסר להם ניחוח משויך או נפח מכל לדגם שלהם.
        </div>
      )}
    </GlassCard>
  );
}

function RouteStops({ routeName }) {
  const [visitDate, setVisitDate] = useState(todayISO);
  const stops = useQuery(() => listRouteAssignments(routeName, visitDate), [routeName, visitDate]);
  const deviceModels = useQuery(listAllDeviceModels, []);
  const scents = useQuery(listAllScents, []);

  const [order, setOrder] = useState([]);
  const [statusById, setStatusById] = useState({});
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    setOrder((stops.data ?? []).map((c) => c.id));
    setStatusById(Object.fromEntries((stops.data ?? []).map((c) => [c.id, c.status])));
    setSaveError(null);
  }, [stops.data]);

  const byId = new Map((stops.data ?? []).map((c) => [c.id, c]));
  const ordered = order.map((id) => byId.get(id)).filter(Boolean);

  async function move(id, dir) {
    const prevOrder = order;
    const i = prevOrder.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= prevOrder.length) return;

    const next = [...prevOrder];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next); // אופטימי — המסך מגיב מיד, לפני שהשמירה חוזרת

    try {
      setSaveError(null);
      await saveRouteOrder(next);
    } catch (caught) {
      setOrder(prevOrder); // השמירה נכשלה — חוזרים לסדר הקודם
      setSaveError(describeError(caught));
    }
  }

  async function toggleStatus(id) {
    const prevStatus = statusById[id] ?? 'pending';
    const nextStatus = prevStatus === 'done' ? 'pending' : 'done';
    setStatusById((prev) => ({ ...prev, [id]: nextStatus }));

    try {
      setSaveError(null);
      await setStopStatus(id, nextStatus);
    } catch (caught) {
      setStatusById((prev) => ({ ...prev, [id]: prevStatus }));
      setSaveError(describeError(caught));
    }
  }

  const fullRouteLink = googleMapsRouteLink(ordered.map((c) => c.address));
  const deviceTotal = ordered.reduce((sum, c) => sum + (c.devices?.length ?? 0), 0);
  const doneCount = ordered.filter((c) => statusById[c.id] === 'done').length;

  return (
    <GlassCard>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <div className="font-display text-[17px] font-bold">{routeName ?? 'ללא שיוך לקו'}</div>
          <div className="mt-0.5 text-[12.5px] text-text-faint">
            {ordered.length} תחנות · {doneCount} בוצעו · {deviceTotal} מכשירים
          </div>
        </div>

        <input
          type="date"
          value={visitDate}
          onChange={(e) => setVisitDate(e.target.value)}
          className="rounded-pill border border-white/[0.09] bg-black/30 px-3 py-2 text-[13px]
                     text-text focus:border-gold-500/45 focus:outline-none"
          aria-label="תאריך ביקור"
        />

        <PrimaryButton
          className="ms-auto"
          disabled={!fullRouteLink}
          onClick={() => fullRouteLink && window.open(fullRouteLink, '_blank', 'noopener')}
        >
          פתח מסלול מלא ב-Google Maps
        </PrimaryButton>
      </div>

      {saveError && (
        <div className="mb-3.5 rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[12.5px] text-crit-soft">
          השמירה נכשלה, השינוי בוטל: {saveError}
        </div>
      )}

      <Async
        loading={stops.loading}
        error={stops.error}
        onRetry={stops.refetch}
        isEmpty={ordered.length === 0}
        empty={<EmptyState title="אין לקוחות פעילים על הקו הזה" />}
      >
        <div className="flex flex-col gap-[9px]">
          {ordered.map((customer, index) => (
            <StopRow
              key={customer.id}
              index={index}
              customer={customer}
              done={statusById[customer.id] === 'done'}
              onToggleDone={() => toggleStatus(customer.id)}
              onMoveUp={() => move(customer.id, -1)}
              onMoveDown={() => move(customer.id, 1)}
              disableUp={index === 0}
              disableDown={index === ordered.length - 1}
              deviceModels={deviceModels.data ?? []}
              scents={scents.data ?? []}
            />
          ))}
        </div>
      </Async>
    </GlassCard>
  );
}

function StopRow({ index, customer, done, onToggleDone, onMoveUp, onMoveDown, disableUp, disableDown, deviceModels, scents }) {
  const waze = wazeLink(customer.address);
  const maps = googleMapsLink(customer.address);
  const devices = customer.devices ?? [];
  const [open, setOpen] = useState(false);

  return (
    <div className={`inner-row transition-opacity ${done ? 'opacity-55' : ''}`}>
      <div className="flex items-center gap-3 px-3.5 py-3">
        <div className="flex flex-none flex-col items-center gap-0.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={disableUp}
            aria-label="הזז למעלה"
            className="grid h-6 w-6 place-items-center rounded-full text-text-faint transition-colors
                       hover:text-gold-300 disabled:opacity-25 disabled:hover:text-text-faint"
          >
            ▲
          </button>
          <span className="tabular font-mono text-[11px] text-text-faint">{index + 1}</span>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={disableDown}
            aria-label="הזז למטה"
            className="grid h-6 w-6 place-items-center rounded-full text-text-faint transition-colors
                       hover:text-gold-300 disabled:opacity-25 disabled:hover:text-text-faint"
          >
            ▼
          </button>
        </div>

        <button
          type="button"
          onClick={onToggleDone}
          aria-pressed={done}
          aria-label={done ? 'סמן כלא בוצע' : 'סמן כבוצע'}
          className={`grid h-7 w-7 flex-none place-items-center rounded-full border text-[13px] transition-colors ${
            done
              ? 'border-ok/40 bg-ok/15 text-ok'
              : 'border-white/[0.12] text-text-faint hover:border-gold-500/35 hover:text-gold-300'
          }`}
        >
          ✓
        </button>

        <div className="min-w-0 flex-1">
          <div className={`truncate text-[14px] font-semibold ${done ? 'line-through' : ''}`}>{customer.name}</div>
          <div className="truncate text-[12px] text-text-faint">{customer.address || '—'}</div>
        </div>

        {devices.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex flex-none items-center gap-1.5 rounded-[7px] border border-white/[0.075]
                       px-[9px] py-[3px] text-[11px] font-semibold text-text-dim transition-colors
                       hover:border-gold-500/30 hover:text-gold-300"
          >
            {devices.length} מכשירים
            <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}

        <div className="flex flex-none gap-2">
          <SecondaryButton
            className="!px-3 inline-flex items-center gap-1.5 disabled:pointer-events-none disabled:opacity-40"
            disabled={!waze}
            onClick={() => waze && window.open(waze, '_blank', 'noopener')}
            aria-label={`נווט לוויז אל ${customer.name}`}
          >
            <NavigationIcon className="h-4 w-4" />
            <span className="hidden sm:inline">וייז</span>
          </SecondaryButton>
          <SecondaryButton
            className="!px-3 inline-flex items-center gap-1.5 disabled:pointer-events-none disabled:opacity-40"
            disabled={!maps}
            onClick={() => maps && window.open(maps, '_blank', 'noopener')}
            aria-label={`נווט ב-Google Maps אל ${customer.name}`}
          >
            <NavigationIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Maps</span>
          </SecondaryButton>
        </div>
      </div>

      {open && devices.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-white/[0.06] px-3.5 pb-3.5 pt-3">
          {devices.map((device) => (
            <DeviceDetailRow key={device.id} device={device} deviceModels={deviceModels} scents={scents} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * שורת מכשיר בודד בתוך עצירה: דגם, ניחוח, אחוז שמן וכמות שצריך למלא
 * (לפי capacity_ml של הדגם — אותו חישוב כמו בכרטיס "תכנון העמסה").
 * לטכנאי יש עיפרון ליד ניחוח/דגם — לוחצים, בוחרים ערך חדש, וזה נשלח
 * כבקשת שינוי לאישור מנהל (requestDeviceChange) ולא נכתב ישירות.
 */
function DeviceDetailRow({ device, deviceModels, scents }) {
  const model = deviceModels.find((m) => m.name === device.model);
  const fillMl = model?.capacity_ml
    ? Math.round((model.capacity_ml * (100 - (device.oil_level_pct ?? 0))) / 100)
    : null;

  return (
    <div className="rounded-row border border-white/[0.06] bg-white/[0.015] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
        <EditableField
          label="ניחוח"
          value={device.scent_name}
          options={scents.map((s) => s.name)}
          field="scent_name"
          device={device}
        />
        <EditableField
          label="דגם"
          value={device.model}
          options={deviceModels.map((m) => m.name)}
          field="model"
          device={device}
        />
        <div className="flex min-w-[140px] flex-1 items-center gap-2">
          <span className="flex-none text-text-faint">שמן</span>
          <MiniMeter value={device.oil_level_pct ?? 0} tone={oilTone(device.oil_level_pct ?? 0)} />
        </div>
        {fillMl != null && (
          <span className="flex-none text-text-faint">
            למילוי: <b className="tabular font-semibold text-gold-300">{fillMl} מ״ל</b>
          </span>
        )}
      </div>
    </div>
  );
}

function EditableField({ label, value, options, field, device }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState(null); // null | 'sent' | 'error'

  async function submit() {
    if (!draft || draft === value) { setEditing(false); return; }
    setBusy(true);
    try {
      await requestDeviceChange({ deviceId: device.id, field, oldValue: value, newValue: draft });
      setState('sent');
      setEditing(false);
    } catch {
      setState('error');
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <select
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="rounded-[8px] border border-gold-500/35 bg-black/40 px-2 py-1 text-[12.5px] text-text
                     focus:outline-none"
        >
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button type="button" onClick={submit} disabled={busy}
                className="rounded-[7px] border border-ok/30 bg-ok/10 px-2 py-1 text-[11px] font-semibold text-ok">
          {busy ? '…' : 'שלח'}
        </button>
        <button type="button" onClick={() => setEditing(false)}
                className="text-[11px] text-text-faint hover:text-text-dim">
          ביטול
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-text-faint">{label}</span>
      <b className="font-semibold">{value || '—'}</b>
      {state === 'sent' ? (
        <StatusChip tone="gold">ממתין לאישור</StatusChip>
      ) : (
        <button
          type="button"
          onClick={() => { setDraft(value ?? ''); setEditing(true); setState(null); }}
          aria-label={`שנה ${label}`}
          className="text-text-faint transition-colors hover:text-gold-300"
        >
          ✎
        </button>
      )}
      {state === 'error' && <span className="text-[11px] text-crit-soft">השליחה נכשלה</span>}
    </div>
  );
}

/**
 * בקשות שינוי ממתינות מכל הטכנאים, על פני כל הקווים — מוצג תמיד למעלה
 * (לא רק בתוך קו ספציפי), כי בקשה יכולה להגיע מכל קו/יום. מנהל בלבד.
 */
function PendingChangeRequestsCard() {
  const { isAdmin } = useAuth();
  const requests = useQuery(listPendingDeviceChangeRequests, [], { enabled: isAdmin });
  const [busyId, setBusyId] = useState(null);

  if (!isAdmin) return null;
  if (!requests.loading && (requests.data?.length ?? 0) === 0) return null;

  async function review(id, approve) {
    setBusyId(id);
    try {
      await reviewDeviceChangeRequest({ requestId: id, approve });
      requests.refetch();
    } finally {
      setBusyId(null);
    }
  }

  const fieldLabel = { scent_name: 'ניחוח', model: 'דגם' };

  return (
    <GlassCard className="mb-3.5">
      <CardHead title="בקשות שינוי ממתינות" subtitle="שינויי ניחוח/דגם שטכנאים ביקשו בשטח — דורש אישור" />
      <Async loading={requests.loading} error={requests.error} onRetry={requests.refetch}>
        <div className="flex flex-col gap-2">
          {(requests.data ?? []).map((r) => (
            <div key={r.id} className="inner-row flex flex-wrap items-center gap-3 px-3.5 py-2.5 text-[12.5px]">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {r.device?.customer?.name ?? '—'} · {r.device?.serial ?? ''}
                </div>
                <div className="mt-0.5 text-text-faint">
                  {fieldLabel[r.field] ?? r.field}: <span className="text-text-dim">{r.old_value || '—'}</span>
                  {' ← '}
                  <b className="text-gold-300">{r.new_value}</b>
                  {' · '}
                  {r.requester?.full_name ?? 'טכנאי'}
                </div>
              </div>
              <div className="flex flex-none gap-2">
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => review(r.id, true)}
                  className="rounded-[8px] border border-ok/30 bg-ok/10 px-3 py-1.5 text-[12px] font-semibold text-ok"
                >
                  אשר
                </button>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => review(r.id, false)}
                  className="rounded-[8px] border border-crit/30 bg-crit/10 px-3 py-1.5 text-[12px] font-semibold text-crit-soft"
                >
                  דחה
                </button>
              </div>
            </div>
          ))}
        </div>
      </Async>
    </GlassCard>
  );
}
