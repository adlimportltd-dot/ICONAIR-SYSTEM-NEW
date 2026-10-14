import { useMemo } from 'react';
import GlassCard, { CardHead } from './ui/GlassCard';
import { StatusChip } from './ui/DataTable';
import { DropIcon } from './ui/Icons';
import { useQuery } from '../hooks/useQuery';
import { supabase } from '../lib/supabase';

/**
 * תכנון מילוי חכם (phase70) — "לבקר השבוע" בראש טאב המסלולים.
 *
 * רק מכשירים שמחוברים לענן (iot_devices, לקוח שכירות). לכל מכשיר:
 *   1. ימים עד ריק — אותו חישוב כמו בטאב צי חכם: לפי מד המיכל (Icon 400),
 *      או לפי המילוי האחרון במערכת פחות הצריכה היומית מהשעון.
 *   2. הביקור הבא — לפי מחזור הקו החודשי (routes.cycle_end_day, ברירת מחדל 12):
 *      אם המכשיר כבר מולא החודש → עד יום-הסיום של החודש הבא; אחרת → עד יום-הסיום
 *      של החודש הנוכחי (ואם כבר עבר — הביקור באיחור, כלומר "היום").
 *   3. דחוף = יתרוקן לפני הביקור הבא.
 * קריאה בלבד — לא משנה מסלול, סדר או סטטוס. אם אין הרשאה לנתוני הצי (טכנאי) או
 * שאין מכשיר דחוף — הכרטיס פשוט לא מוצג.
 */

const DAY = 86400000;
const unwrap = ({ data, error }) => { if (error) throw error; return data; };

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

/** צריכה ממוצעת ליום (מ"ל) לפי השעון ונתוני היצרן — זהה ל-SmartFleetScreen */
function dailyUsage(row, models) {
  const m = (models ?? []).find((x) => x.supplier_model === row.supplier_model);
  if (!m || !m.ml_per_sec || !Array.isArray(row.schedule) || !row.schedule.length) return null;
  let secs = 0;
  row.schedule.forEach((d) => (d.programs ?? []).forEach((p) => {
    if (!p.enabled || p.start === p.end) return;
    const s = toMinutes(p.start);
    const e = toMinutes(p.end);
    if (s === null || e === null) return;
    const dur = ((e - s + 1440) % 1440) * 60;
    const w = Number(p.work_sec) || 0;
    const pa = Number(p.pause_sec) || 0;
    if (w + pa > 0) secs += (dur * w) / (w + pa);
  }));
  const ml = (secs / row.schedule.length) * Number(m.ml_per_sec);
  return ml > 0 ? { ml, tank: Number(m.tank_ml) || null } : null;
}

async function loadPlan() {
  const [iot, models, caps, cityRoutes, cycles] = await Promise.all([
    supabase
      .from('iot_devices')
      .select(`id, online, owner_type, supplier_model, schedule, has_oil_gauge, remain_oil,
        device:devices(id, serial, model, fill_ml, location_note, city,
          site:customer_sites(label, city),
          customer:customers(name, route_name))`)
      .eq('owner_type', 'rental')
      .then(unwrap),
    supabase.from('iot_model_map').select('supplier_model, iconair_model, ml_per_sec, tank_ml').then(unwrap),
    supabase.from('device_models').select('name, capacity_ml').then(unwrap),
    supabase.from('city_routes').select('city, route_name').then(unwrap).catch(() => []),
    supabase.from('routes').select('name, cycle_end_day').then(unwrap).catch(() => []),
  ]);
  const ids = iot.map((r) => r.device?.id).filter(Boolean);
  const refills = ids.length
    ? await supabase
      .from('oil_tracking')
      .select('device_id, level_after_pct, recorded_at')
      .in('device_id', ids)
      .in('event_type', ['refill', 'replacement'])
      .order('recorded_at', { ascending: false })
      .limit(1000)
      .then(unwrap)
    : [];
  return { iot, models, caps, cityRoutes, cycles, refills };
}

const fmt = (d) => d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });

export default function RefillPlanCard() {
  const q = useQuery(loadPlan, []);

  const plan = useMemo(() => {
    if (!q.data) return [];
    const { iot, models, caps, cityRoutes, cycles, refills } = q.data;
    const capOf = new Map(caps.map((c) => [c.name, Number(c.capacity_ml) || null]));
    const cityMap = new Map(cityRoutes.filter((r) => r.city?.trim()).map((r) => [r.city.trim(), r.route_name]));
    const endDayOf = new Map(cycles.map((c) => [c.name, Number(c.cycle_end_day) || 12]));
    const lastRefill = new Map();
    refills.forEach((r) => { if (!lastRefill.has(r.device_id)) lastRefill.set(r.device_id, r); });

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const out = [];

    iot.forEach((row) => {
      const d = row.device;
      if (!d) return;
      const u = dailyUsage(row, models);
      if (!u) return;
      const model = d.model || (models.find((m) => m.supplier_model === row.supplier_model)?.iconair_model ?? null);
      const fillMl = Number(d.fill_ml) || capOf.get(model) || u.tank;
      const refill = lastRefill.get(d.id);

      // ימים עד ריק
      let days = null;
      let basis = '';
      if (row.has_oil_gauge && row.remain_oil != null && u.tank) {
        days = ((Number(row.remain_oil) / 100) * u.tank) / u.ml;
        basis = `מד מיכל ${Math.round(Number(row.remain_oil))}%`;
      } else if (refill && refill.level_after_pct != null && fillMl) {
        const passed = (now - new Date(refill.recorded_at)) / DAY;
        days = ((Number(refill.level_after_pct) / 100) * fillMl - u.ml * passed) / u.ml;
        basis = `מילוי ${fmt(new Date(refill.recorded_at))}`;
      }
      if (days == null) return;
      days = Math.max(0, Math.floor(days));

      // הקו והביקור הבא לפי מחזור הקו
      const byCity = (c) => (c?.trim() ? cityMap.get(c.trim()) ?? null : null);
      const line = (d.site ? byCity(d.site.city) : (d.city?.trim() ? byCity(d.city) : null)) || d.customer?.route_name?.trim() || 'ללא שיוך לקו';
      const endDay = endDayOf.get(line) ?? 12;
      const refilledThisMonth = refill && new Date(refill.recorded_at).getMonth() === now.getMonth()
        && new Date(refill.recorded_at).getFullYear() === now.getFullYear();
      let visitBy = refilledThisMonth
        ? new Date(now.getFullYear(), now.getMonth() + 1, endDay)
        : new Date(now.getFullYear(), now.getMonth(), endDay);
      const overdue = visitBy < today;
      if (overdue) visitBy = today;
      const daysToVisit = Math.max(0, Math.round((visitBy - today) / DAY));

      if (days >= daysToVisit) return; // מספיק עד הביקור — לא דחוף
      const emptyOn = new Date(today.getTime() + days * DAY);
      out.push({
        id: row.id,
        name: d.customer?.name ?? '—',
        where: [d.site?.label, d.location_note].filter(Boolean).join(' · ') || d.serial,
        line, days, basis, emptyOn, visitBy, overdue, gap: daysToVisit - days,
      });
    });

    out.sort((a, b) => a.days - b.days || b.gap - a.gap);
    return out;
  }, [q.data]);

  if (q.loading || q.error || plan.length === 0) return null;

  const byLine = new Map();
  plan.forEach((p) => { if (!byLine.has(p.line)) byLine.set(p.line, []); byLine.get(p.line).push(p); });

  return (
    <GlassCard className="mb-3.5">
      <CardHead
        icon={DropIcon}
        tone="crit"
        title={`לבקר השבוע · ${plan.length} מכשירים`}
        subtitle="מכשירים מחוברים לענן שיתרוקנו לפני הביקור הבא במחזור הקו"
      />
      <div className="flex flex-col gap-3">
        {[...byLine.entries()].map(([line, items]) => (
          <div key={line}>
            <div className="mb-1.5 text-[13px] font-bold text-text-faint">{line}</div>
            <div className="flex flex-col gap-1.5">
              {items.map((p) => (
                <div key={p.id} className="inner-row flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold">{p.name}</div>
                    <div className="truncate text-[13px] text-text-faint">{p.where} · לפי {p.basis}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <StatusChip tone={p.days <= 3 ? 'crit' : 'warn'}>
                      {p.days === 0 ? 'ריק כבר עכשיו' : `ריק בעוד ${p.days} ימים (${fmt(p.emptyOn)})`}
                    </StatusChip>
                    <span className="text-text-faint">
                      {p.overdue ? 'הביקור במחזור כבר באיחור' : `ביקור מתוכנן עד ${fmt(p.visitBy)}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
