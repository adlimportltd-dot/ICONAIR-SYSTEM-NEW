import { useEffect, useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import { StatusChip, MiniMeter, oilTone } from '../components/ui/DataTable';
import { Async, EmptyState } from '../components/ui/States';
import { PrimaryButton, SecondaryButton, Select, Field, TextInput, TextArea } from '../components/ui/Field';
import { RouteIcon, NavigationIcon, PhoneIcon } from '../components/ui/Icons';
import Modal from '../components/ui/Modal';
import MlSlider from '../components/ui/MlSlider';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import { useAuth } from '../context/AuthContext';
import {
  listRoutes, listRouteAssignments, saveRouteOrder, setStopStatus, todayISO,
  getRouteLoadPlan, listTechnicianOptions, allocateStockToTechnician,
  listAllDeviceModels, listAllScents,
  requestDeviceChange, listPendingDeviceChangeRequests, reviewDeviceChangeRequest,
  completeVisit, createOilEntry, listOilHistoryForDevices,
} from '../lib/queries';
import { describeError } from '../lib/supabase';
import { OIL_EVENT_LABEL, formatDateTime } from '../lib/mappers';
import { wazeLink, googleMapsLink, googleMapsRouteLink } from '../lib/navLinks';
import { generateReportSafely } from '../lib/serviceReport';

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

  // סנכרון רוחבי מכרטיס הלקוח: כתובת חדשה/עיר שהשתנתה/מכשיר שנוסף —
  // הספירה של כל קו מתעדכנת כאן חי, בלי לצאת ולחזור למסך.
  useRealtime(['customers', 'customer_sites', 'devices'], routes.refetch);

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
                className={`flex items-center gap-2 rounded-pill border px-3.5 py-2 text-[14px] font-medium
                            transition-colors ${
                  r.name === activeRoute
                    ? 'border-gold-500/45 bg-gold-500/[0.14] text-gold-600'
                    : 'border-black/[0.09] text-text-dim hover:border-black/[0.18] hover:text-text'
                }`}
              >
                <RouteIcon className="h-[15px] w-[15px] flex-none" />
                {r.name ?? 'ללא שיוך לקו'}
                <span className="tabular ms-1 font-mono text-[13px] text-text-faint">{r.customers}</span>
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
      <CardHead icon={RouteIcon} tone="ok" title="תכנון העמסה להיום" subtitle="לפי נפח המכל של כל דגם ומצב השמן הנוכחי במכשירים" />

      <div className="mb-3.5">
        <Select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} options={technicianOptions}
                placeholder="בחר טכנאי לצורך הקצאה" />
      </div>

      {error && (
        <div className="mb-3.5 rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
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
                <div className="truncate text-[15px] font-medium">{row.scent_name}</div>
              </div>
              <span className="tabular font-mono text-[14px] text-gold-600">{row.liters} ל׳</span>
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
        <div className="mt-3.5 rounded-row border border-warn/25 bg-warn/[0.07] px-3.5 py-2.5 text-[13.5px] text-warn">
          {plan.data.missing.length} מכשירים לא נכנסו לחישוב — חסר להם ניחוח משויך או נפח מכל לדגם שלהם.
        </div>
      )}
    </GlassCard>
  );
}

function RouteStops({ routeName }) {
  const [visitDate, setVisitDate] = useState(todayISO);
  const stops = useQuery(() => listRouteAssignments(routeName, visitDate), [routeName, visitDate]);

  // אם עוד מישהו (מנהל אחר, או אותו טכנאי ממכשיר שני) מסמן עצירה
  // כבוצעה על הקו הזה, המסך הזה מתעדכן חי בלי רענון ידני.
  // גם שינויים שמקורם בכרטיס הלקוח (כתובת/עיר/מכשיר/פרטי קשר) מרעננים
  // את העצירות של הקו — הכתובת תופיע/תזוז לקו הנכון בלי רענון ידני.
  useRealtime(['route_assignments', 'customers', 'customer_sites', 'devices'], stops.refetch);
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
          <div className="mt-0.5 text-[14px] text-text-faint">
            {ordered.length} תחנות · {doneCount} בוצעו · {deviceTotal} מכשירים
          </div>
        </div>

        <input
          type="date"
          value={visitDate}
          onChange={(e) => setVisitDate(e.target.value)}
          className="rounded-pill border border-black/[0.09] bg-ink-800 px-3 py-2 text-[14px]
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
        <div className="mb-3.5 rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
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
              onVisitCompleted={stops.refetch}
            />
          ))}
        </div>
      </Async>
    </GlassCard>
  );
}

/**
 * כרטיסיית עצירה — פריסה אחת (לא שתי גרסאות נפרדות למובייל/דסקטופ):
 * נערמת אנכית (מספר סדר+בוצע+שם+כתובת למעלה, תגית מכשירים+3 כפתורי
 * פעולה למטה) כדי שלעולם לא יהיה מרוץ-רוחב בין שם הלקוח לכפתורים.
 * 2026-09-10 (תיקון עיצוב אחרי משוב "כפתורים זולגים החוצה"): הגרסה
 * הקודמת דחסה הכל לשורה אחת (חצי סידור + בוצע + שם flex-1 + תגית +
 * 3 כפתורים) — ברוחב מובייל צר סכום ה-flex-none לבדו כבר חרג מרוחב
 * הכרטיס, ובלי overflow-hidden זה גלש שמאלה (ב-RTL, "שמאלה" = כיוון
 * הגלישה) ודחק את השם לרוחב 0 עד שנעלם לגמרי. פריסה נערמת עם
 * overflow-hidden על הכרטיס עצמו פותרת את זה מבנית, לא בטלאי-רוחב.
 */
function StopRow({ index, customer, done, onToggleDone, onMoveUp, onMoveDown, disableUp, disableDown, deviceModels, scents, onVisitCompleted }) {
  const waze = wazeLink(customer.address);
  const maps = googleMapsLink(customer.address);
  const call = customer.phone ? `tel:${String(customer.phone).replace(/[^\d+]/g, '')}` : null;
  const devices = customer.devices ?? [];
  const [cardOpen, setCardOpen] = useState(false);

  return (
    <div className={`inner-row overflow-hidden transition-opacity ${done ? 'opacity-55' : ''}`}>
      <div className="flex flex-col gap-3 p-3.5">
        <div className="flex items-center gap-2.5">
          <span className="tabular grid h-7 w-7 flex-none place-items-center rounded-full border border-black/[0.09] bg-white font-mono text-[13px] font-bold text-text-dim">
            {index + 1}
          </span>

          <button
            type="button"
            onClick={onToggleDone}
            aria-pressed={done}
            aria-label={done ? 'סמן כלא בוצע' : 'סמן כבוצע'}
            className={`grid h-8 w-8 flex-none place-items-center rounded-full border text-[15px] transition-colors ${
              done
                ? 'border-ok/40 bg-ok/15 text-ok'
                : 'border-black/[0.12] text-text-faint hover:border-gold-500/35 hover:text-gold-600'
            }`}
          >
            ✓
          </button>

          <button
            type="button"
            onClick={() => setCardOpen(true)}
            className="min-w-0 flex-1 text-start"
            aria-label={`פתח כרטיסייה מלאה של ${customer.name}`}
          >
            <div className={`truncate text-[16px] font-bold leading-tight transition-colors hover:text-gold-600 ${done ? 'line-through' : ''}`}>
              {customer.name}
            </div>
            <div className="truncate text-[13px] text-text-faint">{customer.address || '—'}</div>
          </button>

          <div className="flex flex-none flex-col items-center gap-0.5">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={disableUp}
              aria-label="הזז למעלה"
              className="grid h-6 w-6 place-items-center rounded-full text-text-faint transition-colors
                         hover:text-gold-600 disabled:opacity-25 disabled:hover:text-text-faint"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={disableDown}
              aria-label="הזז למטה"
              className="grid h-6 w-6 place-items-center rounded-full text-text-faint transition-colors
                         hover:text-gold-600 disabled:opacity-25 disabled:hover:text-text-faint"
            >
              ▼
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {devices.length > 0 && (
            <button
              type="button"
              onClick={() => setCardOpen(true)}
              className="flex flex-none items-center gap-1.5 rounded-[7px] border border-black/[0.075]
                         bg-white px-[9px] py-[6px] text-[13px] font-semibold text-text-dim transition-colors
                         hover:border-gold-500/30 hover:text-gold-600"
            >
              {devices.length} מכשירים
            </button>
          )}

          <div className="flex min-w-0 flex-1 gap-2">
            <SecondaryButton
              className="!flex-1 !px-2 min-w-0 justify-center gap-1.5 disabled:pointer-events-none disabled:opacity-40"
              disabled={!call}
              onClick={() => call && (window.location.href = call)}
              aria-label={`התקשר אל ${customer.name}`}
            >
              <PhoneIcon className="h-4 w-4 flex-none" />
              <span className="truncate">התקשר</span>
            </SecondaryButton>
            <SecondaryButton
              className="!flex-1 !px-2 min-w-0 justify-center gap-1.5 disabled:pointer-events-none disabled:opacity-40"
              disabled={!waze}
              onClick={() => waze && window.open(waze, '_blank', 'noopener')}
              aria-label={`נווט לוויז אל ${customer.name}`}
            >
              <NavigationIcon className="h-4 w-4 flex-none" />
              <span className="truncate">וייז</span>
            </SecondaryButton>
            <SecondaryButton
              className="!flex-1 !px-2 min-w-0 justify-center gap-1.5 disabled:pointer-events-none disabled:opacity-40"
              disabled={!maps}
              onClick={() => maps && window.open(maps, '_blank', 'noopener')}
              aria-label={`נווט ב-Google Maps אל ${customer.name}`}
            >
              <NavigationIcon className="h-4 w-4 flex-none" />
              <span className="truncate">Maps</span>
            </SecondaryButton>
          </div>
        </div>
      </div>

      <CustomerCardModal
        open={cardOpen}
        onClose={() => setCardOpen(false)}
        stop={customer}
        callHref={call}
        wazeHref={waze}
        mapsHref={maps}
        deviceModels={deviceModels}
        scents={scents}
        onVisitCompleted={onVisitCompleted}
      />
    </div>
  );
}

/**
 * כרטיסייה מלאה של עצירה — נפתחת בלחיצה על שם הלקוח/האתר בשורה.
 * מרכזת פרטי קשר, את כל המכשירים (עם עריכה/עדכון שמן כמו קודם), ואת
 * היסטוריית השמן האחרונה שלהם — כדי שהטכנאי לא יצטרך לנחש מה קרה
 * בביקורים הקודמים. אין כאן שום נתון כספי בכוונה (ר' דרישת המשתמש).
 */
function CustomerCardModal({ open, onClose, stop, callHref, wazeHref, mapsHref, deviceModels, scents, onVisitCompleted }) {
  const devices = stop.devices ?? [];
  const deviceIds = useMemo(() => devices.map((d) => d.id), [devices]);
  const history = useQuery(() => listOilHistoryForDevices(deviceIds, 20), [deviceIds.join(',')], { enabled: open });

  const deviceById = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={stop.name}
      subtitle={stop.address || undefined}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <SecondaryButton
            className="!px-3 inline-flex items-center gap-1.5 disabled:pointer-events-none disabled:opacity-40"
            disabled={!callHref}
            onClick={() => callHref && (window.location.href = callHref)}
          >
            <PhoneIcon className="h-4 w-4" />
            {stop.phone || 'אין טלפון'}
          </SecondaryButton>
          <SecondaryButton
            className="!px-3 inline-flex items-center gap-1.5 disabled:pointer-events-none disabled:opacity-40"
            disabled={!wazeHref}
            onClick={() => wazeHref && window.open(wazeHref, '_blank', 'noopener')}
          >
            <NavigationIcon className="h-4 w-4" />
            וייז
          </SecondaryButton>
          <SecondaryButton
            className="!px-3 inline-flex items-center gap-1.5 disabled:pointer-events-none disabled:opacity-40"
            disabled={!mapsHref}
            onClick={() => mapsHref && window.open(mapsHref, '_blank', 'noopener')}
          >
            <NavigationIcon className="h-4 w-4" />
            Maps
          </SecondaryButton>
        </div>

        {stop.notes && (
          <div className="rounded-row border border-black/[0.06] bg-black/[0.015] px-3.5 py-2.5 text-[14px] text-text-dim">
            {stop.notes}
          </div>
        )}

        <div>
          <div className="mb-2 text-[13px] font-semibold tracking-wide text-text-faint">
            מכשירים ({devices.length})
          </div>
          <div className="flex flex-col gap-2">
            {devices.length === 0 && (
              <div className="text-[14px] text-text-faint">אין מכשירים רשומים בעצירה זו.</div>
            )}
            {devices.map((device) => (
              <DeviceDetailRow
                key={device.id}
                device={device}
                customer={stop}
                deviceModels={deviceModels}
                scents={scents}
                onVisitCompleted={() => { onVisitCompleted?.(); history.refetch(); }}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-[13px] font-semibold tracking-wide text-text-faint">
            היסטוריית שמן אחרונה
          </div>
          <Async loading={history.loading} error={history.error} onRetry={history.refetch}
                 isEmpty={(history.data?.length ?? 0) === 0}
                 empty={<div className="text-[14px] text-text-faint">אין עדיין היסטוריה למכשירים האלה.</div>}>
            <div className="flex flex-col gap-1.5">
              {(history.data ?? []).map((entry) => (
                <div key={entry.id} className="inner-row flex items-center gap-3 px-3 py-2 text-[13.5px]">
                  <span className="tabular flex-none text-text-faint">{formatDateTime(entry.recorded_at)}</span>
                  <span className="flex-none text-text-dim">{OIL_EVENT_LABEL[entry.event_type] ?? entry.event_type}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {deviceById.get(entry.device_id)?.model ?? ''} · {entry.scent_name || 'ללא ניחוח'}
                  </span>
                  <span className="tabular flex-none text-text-faint">
                    {entry.level_before_pct ?? '—'}% ← {entry.level_after_pct}%
                  </span>
                </div>
              ))}
            </div>
          </Async>
        </div>
      </div>
    </Modal>
  );
}

/**
 * שורת מכשיר בודד בתוך עצירה: דגם, ניחוח, אחוז שמן וכמות שצריך למלא
 * (לפי capacity_ml של הדגם — אותו חישוב כמו בכרטיס "תכנון העמסה").
 * לטכנאי יש עיפרון ליד ניחוח/דגם — לוחצים, בוחרים ערך חדש, וזה נשלח
 * כבקשת שינוי לאישור מנהל (requestDeviceChange) ולא נכתב ישירות.
 * "עדכון שמן" פותח את אותו סיום-ביקור שיש במסך "מעקב שמנים" — כאן
 * בלי בחירת מכשיר (כבר ידוע מההקשר), כדי שהטכנאי יעדכן מהמסלול עצמו.
 */
function DeviceDetailRow({ device, customer, deviceModels, scents, onVisitCompleted }) {
  const [oilModalOpen, setOilModalOpen] = useState(false);
  const model = deviceModels.find((m) => m.name === device.model);
  const fillMl = model?.capacity_ml
    ? Math.round((model.capacity_ml * (100 - (device.oil_level_pct ?? 0))) / 100)
    : null;

  return (
    <div className="rounded-row border border-black/[0.06] bg-black/[0.015] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px]">
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
            למילוי: <b className="tabular font-semibold text-gold-600">{fillMl} מ״ל</b>
          </span>
        )}

        <button
          type="button"
          onClick={() => setOilModalOpen(true)}
          className="ms-auto flex-none rounded-[8px] border border-gold-500/30 bg-gold-500/[0.1]
                     px-2.5 py-1 text-[13px] font-semibold text-gold-600 transition-colors
                     hover:border-gold-500/50"
        >
          עדכון שמן / סיום ביקור
        </button>
      </div>

      <CompleteVisitModal
        open={oilModalOpen}
        device={device}
        customer={customer}
        scents={scents}
        capacityMl={model?.capacity_ml ?? null}
        onClose={() => setOilModalOpen(false)}
        onSaved={() => { setOilModalOpen(false); onVisitCompleted?.(); }}
      />
    </div>
  );
}

// נפילה בטוחה כשלדגם אין capacity_ml מוגדר (ר' הערה ב-getRouteLoadPlan
// ב-queries.js על דגם "Icon 600" שסומן "?" ע"י המשתמש) — הסליידר עדיין
// צריך מקסימום סביר במקום לקרוס או להיתקע על 0.
const DEFAULT_SLIDER_MAX_ML = 1000;
const ML_STEP = 10;

/**
 * טופס "סיום ביקור" מוקטן, ישירות מתוך שורת המכשיר במסלול — אותה
 * לוגיקה בדיוק כמו NewOilEntryModal במסך "מעקב שמנים" (completeVisit
 * מנכה מהמלאי הנייד אטומית; אם אין מלאי תואם נופלים ל-createOilEntry
 * שרק רושם בלי לנסות לנכות), רק בלי שדה בחירת מכשיר — הוא כבר ידוע.
 *
 * "כמות שנוספה" (2026-09-10, בקשה מפורשת): לא שדה טקסט חופשי יותר —
 * סליידר MlSlider בקפיצות של 10 מ"ל, שהמקסימום שלו הוא capacity_ml של
 * הדגם הספציפי הזה (לא ערך גלובלי קבוע). הערך עדיין נשמר ב-form כליטרים
 * (form.liters_added) בדיוק כמו קודם — completeVisit/createOilEntry
 * מצפים לליטרים — הסליידר רק ממיר מ"ל↔ליטר בצד התצוגה, כך שהשמירה
 * בפועל (submit) לא השתנתה כלל.
 *
 * ברירת מחדל = 0 (2026-09-10, תיקון בעקבות משוב): התחלה מ"מוצע-מלא"
 * גרמה לסליידר להיראות "מתחיל מהכמות הגדולה" (התחיל עם המחוון כבר
 * בקצה הימני/מקסימום) — הטכנאי רוצה לגרור בעצמו מנמוך לגבוה, לא לקבל
 * ערך מוכן-מראש. הקיבולת עדיין מוצגת כרמז (hint מתחת לכותרת השדה),
 * רק לא כערך פתיחה של הסליידר.
 */
function CompleteVisitModal({ open, device, customer, scents, capacityMl, onClose, onSaved }) {
  const { session, profile } = useAuth();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [noStockNotice, setNoStockNotice] = useState(false);

  const sliderMaxMl = capacityMl && capacityMl > 0 ? Math.round(capacityMl / ML_STEP) * ML_STEP : DEFAULT_SLIDER_MAX_ML;

  useEffect(() => {
    if (open) {
      setForm({
        event_type: 'refill',
        scent_name: device.scent_name ?? '',
        liters_added: '0',
        level_before_pct: String(device.oil_level_pct ?? ''),
        level_after_pct: '100',
        notes: '',
      });
      setError(null);
      setNoStockNotice(false);
    }
  }, [open, device]);

  if (!open || !form) return null;

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const after = Number(form.level_after_pct || 0);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const payload = {
      device_id: device.id,
      scent_name: form.scent_name || null,
      event_type: form.event_type,
      liters_added: Number(form.liters_added || 0),
      level_before_pct: form.level_before_pct === '' ? null : Number(form.level_before_pct),
      level_after_pct: after,
      notes: form.notes || null,
    };

    try {
      let usedFallback = false;
      let saved;
      try {
        saved = await completeVisit(payload);
      } catch (stockError) {
        if (!String(stockError?.message ?? '').includes('אין מלאי נייד')) throw stockError;
        saved = await createOilEntry(payload);
        usedFallback = true;
      }

      generateReportSafely({
        saved, device, customer,
        technicianId: session?.user?.id,
        technicianName: profile?.full_name,
      });

      if (usedFallback) {
        setNoStockNotice(true);
      } else {
        onSaved();
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="עדכון שמן / סיום ביקור"
      subtitle={`${device.model ?? 'מכשיר'} · ${device.scent_name || 'ללא ניחוח משויך'}`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
          <Field label="סוג רישום">
            <Select
              value={form.event_type}
              onChange={set('event_type')}
              options={Object.entries(OIL_EVENT_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="ניחוח" hint="אם תואם למלאי הנייד שלך — ינוכה ממנו אוטומטית">
            <Select
              value={form.scent_name}
              onChange={set('scent_name')}
              options={scents.map((s) => ({ value: s.name, label: s.name }))}
              placeholder="ללא ניחוח ספציפי"
            />
          </Field>
        </div>

        <Field label="מפלס לפני (%)">
          <TextInput type="number" min={0} max={100} value={form.level_before_pct} onChange={set('level_before_pct')} />
        </Field>

        <Field
          label="כמות שנוספה"
          hint={capacityMl ? `קיבולת ${device.model ?? 'המכשיר'}: ${sliderMaxMl} מ״ל` : 'לא הוגדרה קיבולת לדגם הזה — טווח כללי'}
        >
          <MlSlider
            valueMl={Math.round(Number(form.liters_added || 0) * 1000)}
            maxMl={sliderMaxMl}
            step={ML_STEP}
            onChange={(ml) => setForm((prev) => ({ ...prev, liters_added: String(ml / 1000) }))}
          />
        </Field>

        <Field label="מפלס אחרי (%)" required>
          <TextInput type="number" min={0} max={100} value={form.level_after_pct} onChange={set('level_after_pct')} required />
        </Field>

        <div className="rounded-row border border-black/[0.075] bg-black/[0.022] px-3.5 py-3">
          <div className="mb-1.5 text-[13px] text-text-faint">המפלס שיישמר במכשיר</div>
          <MiniMeter value={Math.min(Math.max(after, 0), 100)} tone={oilTone(after)} />
        </div>

        <Field label="הערות">
          <TextArea value={form.notes} onChange={set('notes')} rows={2} />
        </Field>

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
            {error}
          </div>
        )}

        {noStockNotice && (
          <div className="rounded-row border border-warn/25 bg-warn/[0.07] px-3.5 py-2.5 text-[14px] text-warn">
            הביקור נרשם בהצלחה — אבל לא ניכינו כלום מהמלאי הנייד שלך, כי לא היה מלאי רשום שתואם. עדכן "מלאי נייד" כשתוכל.
          </div>
        )}

        <div className="mt-1 flex gap-2.5">
          {noStockNotice ? (
            <PrimaryButton type="button" onClick={onSaved}>הבנתי, סגירה</PrimaryButton>
          ) : (
            <>
              <PrimaryButton type="submit" loading={busy}>סיום ביקור / בוצע</PrimaryButton>
              <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
            </>
          )}
        </div>
      </form>
    </Modal>
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
          className="rounded-[8px] border border-gold-500/35 bg-ink-700 px-2 py-1 text-[14px] text-text
                     focus:outline-none"
        >
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button type="button" onClick={submit} disabled={busy}
                className="rounded-[7px] border border-ok/30 bg-ok/10 px-2 py-1 text-[13px] font-semibold text-ok">
          {busy ? '…' : 'שלח'}
        </button>
        <button type="button" onClick={() => setEditing(false)}
                className="text-[13px] text-text-faint hover:text-text-dim">
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
          className="text-text-faint transition-colors hover:text-gold-600"
        >
          ✎
        </button>
      )}
      {state === 'error' && <span className="text-[13px] text-crit-soft">השליחה נכשלה</span>}
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
      <CardHead icon={NavigationIcon} tone="slate" title="בקשות שינוי ממתינות" subtitle="שינויי ניחוח/דגם שטכנאים ביקשו בשטח — דורש אישור" />
      <Async loading={requests.loading} error={requests.error} onRetry={requests.refetch}>
        <div className="flex flex-col gap-2">
          {(requests.data ?? []).map((r) => (
            <div key={r.id} className="inner-row flex flex-wrap items-center gap-3 px-3.5 py-2.5 text-[14px]">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {r.device?.customer?.name ?? '—'} · {r.device?.serial ?? ''}
                </div>
                <div className="mt-0.5 text-text-faint">
                  {fieldLabel[r.field] ?? r.field}: <span className="text-text-dim">{r.old_value || '—'}</span>
                  {' ← '}
                  <b className="text-gold-600">{r.new_value}</b>
                  {' · '}
                  {r.requester?.full_name ?? 'טכנאי'}
                </div>
              </div>
              <div className="flex flex-none gap-2">
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => review(r.id, true)}
                  className="rounded-[8px] border border-ok/30 bg-ok/10 px-3 py-1.5 text-[13.5px] font-semibold text-ok"
                >
                  אשר
                </button>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => review(r.id, false)}
                  className="rounded-[8px] border border-crit/30 bg-crit/10 px-3 py-1.5 text-[13.5px] font-semibold text-crit-soft"
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
