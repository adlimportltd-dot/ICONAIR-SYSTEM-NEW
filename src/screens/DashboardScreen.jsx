import KpiCard from '../components/KpiCard';
import OilConsumptionChart from '../components/OilConsumptionChart';
import FleetBreakdown from '../components/FleetBreakdown';
import ServiceCallsCard from '../components/ServiceCallsCard';
import OilAlertsCard from '../components/OilAlertsCard';
import RoutesCard from '../components/RoutesCard';
import StockCard from '../components/StockCard';
import GlassCard from '../components/ui/GlassCard';
import { Skeleton, ErrorState } from '../components/ui/States';
import { useAuth } from '../context/AuthContext';
import {
  mapKpis, mapFleet, mapOilConsumption, mapServiceCalls,
  mapOilAlerts, mapRoutes, mapOilByScent, formatNumber,
} from '../lib/mappers';

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[132px] rounded-card" />)}
      </div>
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Skeleton className="h-[400px] rounded-card" />
        <Skeleton className="h-[400px] rounded-card" />
      </div>
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Skeleton className="h-[340px] rounded-card" />
        <Skeleton className="h-[340px] rounded-card" />
      </div>
    </div>
  );
}

export default function DashboardScreen({ data, loading, error, onRetry, onNavigate }) {
  const { profile, isAdmin } = useAuth();

  // חסימה מפורשת ומוחלטת: כרטיסי הסיכום מוצגים רק אם profile.role === 'admin'.
  const canSeeFinancialSummary = profile?.role === 'admin' && isAdmin;

  if (loading && !data) return <DashboardSkeleton />;

  if (error) {
    return (
      <GlassCard>
        <ErrorState message={error} onRetry={onRetry} />
      </GlassCard>
    );
  }

  if (!data) return null;

  const kpis = mapKpis(data.kpis);
  const callsSubtitle = `${formatNumber(data.kpis?.calls_open)} קריאות · `
    + `${formatNumber(data.kpis?.calls_critical)} דחופות · `
    + (data.kpis?.avg_close_hours
      ? `ממוצע סגירה ${formatNumber(data.kpis.avg_close_hours, 1)} שעות`
      : 'אין עדיין קריאות סגורות');

  return (
    <>
      {canSeeFinancialSummary && (
        <section aria-label="מדדים ראשיים" className="mb-3.5 grid grid-cols-1 gap-3.5 xs:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi, i) => (
            <KpiCard key={kpi.id} kpi={kpi} delay={0.02 + i * 0.06} />
          ))}
        </section>
      )}

      <section className="mb-3.5 grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <OilConsumptionChart delay={0.26} data={mapOilConsumption(data.oil)} />
        <FleetBreakdown delay={0.32} data={mapFleet(data.fleet)} />
      </section>

      <section className="mb-3.5 grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ServiceCallsCard
          delay={0.36}
          calls={mapServiceCalls(data.calls)}
          subtitle={callsSubtitle}
          onOpenAll={() => onNavigate('service')}
          onSelect={() => onNavigate('service')}
        />
        <OilAlertsCard
          delay={0.4}
          alerts={mapOilAlerts(data.alerts)}
          onAssignAll={() => onNavigate('oils')}
        />
      </section>

      <section className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RoutesCard delay={0.44} routes={mapRoutes(data.routes)} onOpenMap={() => onNavigate('routes')} />
        <StockCard
          delay={0.48}
          stock={mapOilByScent(data.scentUsage)}
          monthTotal={`${formatNumber(data.kpis?.oil_liters_this_month, 1)} ליטר`}
        />
      </section>
    </>
  );
}
