import { useState } from 'react';
import GlassCard, { CardHead, Swatch } from '../components/ui/GlassCard';
import DataTable from '../components/ui/DataTable';
import { Async, EmptyState } from '../components/ui/States';
import { SecondaryButton, Select } from '../components/ui/Field';
import { useQuery } from '../hooks/useQuery';
import { getReportSummary, listRoutes, getRouteConsumptionReport, getStockMovementsSummary } from '../lib/queries';
import { HEBREW_MONTHS, modelTone, formatNumber } from '../lib/mappers';

const TONE_HEX = { slate: '#6E86A8', teal: '#4CC9C0', gold: '#C5A059' };

/** ייצוא CSV עם BOM — בלעדיו Excel בעברית פותח ג'יבריש */
function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

export default function ReportsScreen() {
  const report = useQuery(getReportSummary, []);

  return (
    <>
      <Async loading={report.loading} error={report.error} onRetry={report.refetch}>
        {report.data && <Report data={report.data} />}
      </Async>

      <RouteConsumptionSection />
    </>
  );
}

/**
 * "כמה ריח קו X צרך בפועל, וכמה חזר מהטכנאי" — שני דוחות שסוגרים
 * את המעגל שביקשת: getRouteConsumptionReport (מ-oil_tracking — מה
 * שבאמת נרשם בשטח) ו-getStockMovementsSummary (מ-stock_movements —
 * מה יצא מהמחסן מול מה חזר). לא תלוי ב-getReportSummary כי לזה יש
 * מסגרת זמן/סינון קו נפרד משלו.
 */
function RouteConsumptionSection() {
  const [routeName, setRouteName] = useState('');
  const [months, setMonths] = useState(1);

  const routes = useQuery(listRoutes, []);
  const consumption = useQuery(
    () => getRouteConsumptionReport({ routeName: routeName || undefined, months }),
    [routeName, months],
    { enabled: Boolean(routeName) }
  );
  const movements = useQuery(() => getStockMovementsSummary({ months }), [months]);

  const routeOptions = (routes.data ?? [])
    .filter((r) => r.name)
    .map((r) => ({ value: r.name, label: `${r.name} (${r.customers} לקוחות)` }));

  return (
    <section className="mt-3.5 grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <GlassCard>
        <CardHead title="צריכת ריח לפי קו" subtitle="מבוסס רישומי 'סיום ביקור' בפועל בשטח" />

        <div className="mb-3.5 flex flex-wrap gap-2.5">
          <Select value={routeName} onChange={(e) => setRouteName(e.target.value)} options={routeOptions}
                  placeholder="בחר קו" className="max-w-[220px]" />
          <Select
            value={String(months)}
            onChange={(e) => setMonths(Number(e.target.value))}
            options={[{ value: '1', label: 'החודש' }, { value: '3', label: '3 חודשים' }, { value: '12', label: 'שנה אחרונה' }]}
            className="max-w-[150px]"
          />
        </div>

        {!routeName ? (
          <EmptyState title="בחר קו כדי לראות את הצריכה שלו" />
        ) : (
          <Async
            loading={consumption.loading}
            error={consumption.error}
            onRetry={consumption.refetch}
            isEmpty={consumption.data?.items.length === 0}
            empty={
              <EmptyState
                title="אין עדיין נתוני צריכה לקו הזה"
                hint="הדוח מבוסס על רישומי 'סיום ביקור' דרך מסך מעקב השמנים — אם הטכנאים עוד לא השתמשו בפיצ'ר הזה בשטח, אין כאן מה להציג."
              />
            }
          >
            <div className="mb-3 text-[12.5px] text-text-faint">
              סה״כ {formatNumber(consumption.data?.totalLiters, 1)} ליטר · {formatNumber(consumption.data?.visitCount)} ביקורים
            </div>
            <div className="flex flex-col gap-2">
              {(consumption.data?.items ?? []).map((row) => (
                <div key={row.scent_name} className="flex items-baseline gap-2 text-[13.5px]">
                  <span className="font-semibold">{row.scent_name}</span>
                  <span className="tabular ms-auto font-mono text-[12.5px] text-text-dim">{row.liters} ל׳</span>
                </div>
              ))}
            </div>
          </Async>
        )}
      </GlassCard>

      <GlassCard>
        <CardHead title="יצא מול חזר — מלאי טכנאים" subtitle="מ-stock_movements: הקצאות מול החזרות למחסן" />
        <Async
          loading={movements.loading}
          error={movements.error}
          onRetry={movements.refetch}
          isEmpty={movements.data?.length === 0}
          empty={<EmptyState title="אין עדיין תנועות מלאי בטווח הזה" />}
        >
          <div className="flex flex-col gap-2">
            {(movements.data ?? []).map((row) => (
              <div key={row.label} className="rounded-row border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5">
                <div className="mb-1 flex items-center gap-2 text-[13.5px] font-semibold">{row.label}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                  <span className="text-text-faint">יצא: <span className="tabular font-mono text-text-dim">{row.allocated}</span></span>
                  <span className="text-text-faint">חזר: <span className="tabular font-mono text-text-dim">{row.returned}</span></span>
                  <span className="text-text-faint">
                    יתרה בשטח:{' '}
                    <span className={`tabular font-mono ${row.net > 0 ? 'text-gold-300' : 'text-text-dim'}`}>{row.net}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Async>
      </GlassCard>
    </section>
  );
}

function Report({ data }) {
  const { kpis, oil, fleet, scentUsage } = data;

  const monthRows = oil.map((row) => {
    const date = new Date(row.month);
    const actual = Number(row.actual_liters);
    const target = Number(row.target_liters);

    return {
      key: row.month,
      label: `${HEBREW_MONTHS[date.getMonth()]} ${date.getFullYear()}`,
      actual,
      target,
      delta: target > 0 ? ((actual - target) / target) * 100 : 0,
    };
  });

  const totalActual = monthRows.reduce((sum, row) => sum + row.actual, 0);
  const totalTarget = monthRows.reduce((sum, row) => sum + row.target, 0);

  const summaryTiles = [
    { label: 'מכשירים בשטח', value: formatNumber(kpis.devices_total) },
    { label: 'מכשירים מקוונים', value: formatNumber(kpis.devices_online) },
    { label: 'לקוחות פעילים', value: formatNumber(kpis.customers_active) },
    { label: 'קריאות פתוחות', value: formatNumber(kpis.calls_open) },
    { label: 'שמן החודש (ל׳)', value: formatNumber(kpis.oil_liters_this_month, 1) },
    {
      label: 'ממוצע סגירת קריאה',
      value: kpis.avg_close_hours ? `${formatNumber(kpis.avg_close_hours, 1)} שע׳` : '—',
    },
  ];

  const columns = [
    { key: 'month', label: 'חודש', width: 'minmax(0,1fr)', render: (row) => <b className="font-semibold">{row.label}</b> },
    {
      key: 'actual',
      label: 'בפועל (ל׳)',
      width: '110px',
      render: (row) => <span className="tabular font-mono text-[13px]">{formatNumber(row.actual, 1)}</span>,
    },
    {
      key: 'target',
      label: 'ממוצע נגרר (ל׳)',
      width: '110px',
      render: (row) => <span className="tabular font-mono text-[13px] text-text-dim">{formatNumber(row.target, 1)}</span>,
    },
    {
      key: 'delta',
      label: 'סטייה',
      width: '96px',
      render: (row) => (
        <span className={`tabular font-mono text-[13px] ${row.delta >= 0 ? 'text-ok' : 'text-crit-soft'}`}>
          {row.delta >= 0 ? '+' : '−'}{formatNumber(Math.abs(row.delta), 1)}%
        </span>
      ),
    },
  ];

  return (
    <>
      <section className="mb-3.5 grid grid-cols-2 gap-3.5 xs:grid-cols-3 xl:grid-cols-6">
        {summaryTiles.map((tile) => (
          <GlassCard key={tile.label} className="!p-4">
            <div className="text-[11.5px] leading-snug text-text-faint">{tile.label}</div>
            <div className="tabular mt-2 font-display text-[26px] font-bold leading-none">{tile.value}</div>
          </GlassCard>
        ))}
      </section>

      <section className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <GlassCard>
          <CardHead
            title="צריכת שמן חודשית"
            subtitle={`סה״כ ${formatNumber(totalActual, 1)} ליטר מול ממוצע נגרר ${formatNumber(totalTarget, 1)} ליטר`}
            action="ייצוא CSV"
            onAction={() => downloadCsv('icon-air-oil.csv', [
              ['חודש', 'בפועל (ליטר)', 'ממוצע נגרר (ליטר)', 'סטייה (%)'],
              ...monthRows.map((row) => [row.label, row.actual.toFixed(2), row.target.toFixed(2), row.delta.toFixed(1)]),
            ])}
          />
          <DataTable columns={columns} rows={monthRows} rowKey={(row) => row.key} />
        </GlassCard>

        <div className="flex flex-col gap-3.5">
          <GlassCard>
            <CardHead title="פילוח הצי" subtitle="מכשירים לפי דגם" />
            <div className="flex flex-col gap-3">
              {fleet.map((row) => (
                <div key={row.model} className="flex items-center gap-2.5 text-[13.5px]">
                  <Swatch style={{ background: TONE_HEX[modelTone(row.model)] }} />
                  <span className="font-semibold">{row.model}</span>
                  <span className="tabular ms-auto font-mono text-[13px] text-text-dim">{row.device_count}</span>
                  <span className="tabular w-[74px] text-start font-mono text-[11.5px] text-text-faint">
                    {formatNumber(row.avg_oil_pct, 1)}% שמן
                  </span>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard>
            <CardHead title="תצרוכת שמן לפי ניחוח" subtitle="ליטרים שהוזרמו החודש" />
            <div className="flex flex-col gap-2.5">
              {scentUsage.map((row) => (
                <div key={row.name} className="flex items-baseline gap-2 text-[13.5px]">
                  <span className="font-semibold">{row.name}</span>
                  <span className="tabular ms-auto font-mono text-[12.5px] text-text-dim">
                    {formatNumber(row.liters, 1)} ל׳
                  </span>
                </div>
              ))}
            </div>
            <SecondaryButton
              className="mt-4 w-full"
              onClick={() => downloadCsv('icon-air-scent-usage.csv', [
                ['ניחוח', 'אחוז מהצריכה', 'ליטרים'],
                ...scentUsage.map((row) => [row.name, row.pct.toFixed(1), row.liters.toFixed(2)]),
              ])}
            >
              ייצוא תצרוכת ל-CSV
            </SecondaryButton>
          </GlassCard>
        </div>
      </section>
    </>
  );
}
