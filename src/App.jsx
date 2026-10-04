import { useCallback, useEffect, useRef, useState } from 'react';

import { AuthProvider, useAuth } from './context/AuthContext';
import { isSupabaseConfigured } from './lib/supabase';
import { getDashboard, listRecentCompletedVisits, listRecentServiceReports, countNewLeads, countOpenInstallations, countNewWebOrders, listRecentWebOrderAlerts, listRecentUnpaidAlerts } from './lib/queries';
import { playOrderChime, flashTitle, unlockOrderSound } from './lib/orderAlert';
import { useQuery } from './hooks/useQuery';
import { useRealtime } from './hooks/useRealtime';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { startAutoSync } from './lib/offlineSync';
import { listQueue } from './lib/offlineQueue';
import { allNavItems, screenMeta } from './config/navigation';

import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import BottomNav from './components/BottomNav';
import LoginScreen from './components/auth/LoginScreen';
import SetupScreen from './components/auth/SetupScreen';
import { Skeleton } from './components/ui/States';

import SignContractScreen from './screens/SignContractScreen';
import DashboardScreen from './screens/DashboardScreen';
import CustomersScreen from './screens/CustomersScreen';
import DevicesScreen from './screens/DevicesScreen';
import OilScreen from './screens/OilScreen';
import ServiceCallsScreen from './screens/ServiceCallsScreen';
import RoutesScreen from './screens/RoutesScreen';
import StockScreen from './screens/StockScreen';
import ReportsScreen from './screens/ReportsScreen';
import SettingsScreen from './screens/SettingsScreen';
import CatalogScreen from './screens/CatalogScreen';
import LeadsScreen from './screens/LeadsScreen';
import SocialScreen from './screens/SocialScreen';
import WebOrdersScreen from './screens/WebOrdersScreen';

/** קישור חתימה ציבורי (?sign=<token>) — נבדק לפני SetupScreen/AuthProvider במכוון: הלקוח שחותם לא מחובר ולא צריך להיות. */
function useSignToken() {
  return new URLSearchParams(window.location.search).get('sign');
}

export default function App() {
  const signToken = useSignToken();
  if (signToken) return <SignContractScreen token={signToken} />;

  // בלי מפתחות אין טעם להרים את שאר האפליקציה — מסך ההגדרה מסביר מה חסר
  if (!isSupabaseConfigured) return <SetupScreen />;

  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

/** מחליט מה להציג: טעינה, מסך התחברות, או המערכת עצמה */
function Gate() {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <>
        <div className="ambient-field" aria-hidden />
        <div className="relative z-[1] flex min-h-screen items-center justify-center p-5">
          <Skeleton className="h-[220px] w-full max-w-[420px] rounded-card" />
        </div>
      </>
    );
  }

  if (!session) return <LoginScreen />;

  // יש session אבל אין profile — הטריגר ב-Supabase לא רץ
  if (!profile) {
    return (
      <>
        <div className="ambient-field" aria-hidden />
        <div className="relative z-[1] flex min-h-screen items-center justify-center p-5">
          <div className="glass-card max-w-[460px] p-6 text-center">
            <h1 className="font-display text-[19px] font-bold">לא נמצא פרופיל למשתמש</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-text-dim">
              המשתמש קיים ב-Authentication אבל אין לו שורה בטבלת
              <span className="font-mono text-gold-600"> profiles</span>.
              ודא שהרצת את <span className="font-mono text-gold-600">iconair_schema.sql</span> —
              הוא יוצר את הטריגר (<span className="font-mono text-gold-600">on_auth_user_created</span>)
              שמשלים פרופיל לכל משתמש חדש.
            </p>
          </div>
        </div>
      </>
    );
  }

  return <Shell />;
}

function Shell() {
  const { isAdmin } = useAuth();
  // ?tab=<id> פותח לשונית ישירות — למשל חזרה מ-Meta אחרי חיבור (טאב סושיאל).
  const [activeId, setActiveId] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    return allNavItems.some((item) => item.id === fromUrl) ? fromUrl : 'dashboard';
  });
  const [newCallSignal, setNewCallSignal] = useState(0);

  const dashboard = useQuery(getDashboard, []);
  const kpis = dashboard.data?.kpis;

  // "בוצע" בשטח → מגיע לפעמון של המנהל בזמן אמת (route_assignments
  // status='done'). רק מנהל צריך את זה — לטכנאי כבר יש את הסטטוס
  // מול העיניים במסך המסלולים שלו עצמו.
  const completedVisits = useQuery(listRecentCompletedVisits, [], { enabled: isAdmin });

  // 2026-09-17 (בקשה מפורשת: "מונה לידים חדשים בצבע אדום בולט, בדיוק
  // כמו במערכות האחרות") — אותו דפוס בדיוק כמו criticalCalls (kpis.calls_critical)
  // שכבר מזין את התג האדום על "קריאות שירות". מנהל בלבד — הלשונית עצמה
  // adminOnly ממילא.
  const newLeadsCount = useQuery(countNewLeads, [], { enabled: isAdmin });
  useRealtime(['leads'], newLeadsCount.refetch, { enabled: isAdmin });
  // התקנות חדשות פתוחות (phase50) נספרות בתג של "קריאות שירות" — כמו משימה.
  const openInstalls = useQuery(() => countOpenInstallations().catch(() => 0), []);
  useRealtime(['service_calls'], openInstalls.refetch);

  // הזמנות אתר (phase51, 2026-10-02 — בקשה מפורשת: "התראה חזותית/קולית
  // ברגע שהזמנה נכנסת, בדיוק כמו ליד חדש"). phase52 (אותו יום, בקשה
  // מפורשת): מנהלים בלבד — לא טכנאים. גם ה-RLS ב-DB חוסם אותם. תג אדום בתפריט + טוסט + צליל + הבהוב בכותרת הלשונית.
  // ה-Push לטלפון נשלח בנפרד מה-DB (notify_new_web_order).
  const newOrdersCount = useQuery(() => countNewWebOrders().catch(() => 0), [], { enabled: isAdmin });
  const orderAlerts = useQuery(() => listRecentWebOrderAlerts().catch(() => []), [], { enabled: isAdmin });
  useRealtime(['web_orders'], () => {
    newOrdersCount.refetch();
    orderAlerts.refetch();
  }, { enabled: isAdmin });

  useEffect(() => unlockOrderSound(), []);

  const seenOrderIds = useRef(null);
  const [orderToast, setOrderToast] = useState(null);

  useEffect(() => {
    if (!isAdmin || !orderAlerts.data) return;

    if (seenOrderIds.current === null) {
      seenOrderIds.current = new Set(orderAlerts.data.map((o) => o.id));
      return;
    }

    const fresh = orderAlerts.data.find((o) => !seenOrderIds.current.has(o.id));
    if (fresh) {
      seenOrderIds.current = new Set(orderAlerts.data.map((o) => o.id));
      const total = Number(fresh.total ?? 0).toLocaleString('he-IL', { maximumFractionDigits: 2 });
      setOrderToast({
        title: `הזמנה חדשה מהאתר #${fresh.order_number}`,
        body: `${fresh.customer_name ?? 'לקוח'}${fresh.city ? ` · ${fresh.city}` : ''} · ₪${total}`,
      });
      playOrderChime();
      flashTitle(`● הזמנה חדשה #${fresh.order_number}`);
    }
  }, [isAdmin, orderAlerts.data]);

  useEffect(() => {
    if (!orderToast) return undefined;
    const timer = setTimeout(() => setOrderToast(null), 15000);
    return () => clearTimeout(timer);
  }, [orderToast]);

  // phase53 (בקשה מפורשת ודחופה — הזמנות שלא שולמו מתבטלות): pg_cron מסמן
  // unpaid_alerted_at אחרי 10 דקות בלי תשלום → כאן טוסט אדום + צליל, עם
  // מעבר לפאנל "להתקשר עכשיו". נשאר על המסך עד שסוגרים — לא נעלם לבד.
  const unpaidAlerts = useQuery(() => listRecentUnpaidAlerts().catch(() => []), [], { enabled: isAdmin });
  useRealtime(['web_orders'], unpaidAlerts.refetch, { enabled: isAdmin });
  const seenUnpaidIds = useRef(null);
  const [unpaidToast, setUnpaidToast] = useState(null);

  useEffect(() => {
    if (!isAdmin || !unpaidAlerts.data) return;
    if (seenUnpaidIds.current === null) {
      seenUnpaidIds.current = new Set(unpaidAlerts.data.map((o) => o.id));
      return;
    }
    const fresh = unpaidAlerts.data.find((o) => !seenUnpaidIds.current.has(o.id));
    if (fresh) {
      seenUnpaidIds.current = new Set(unpaidAlerts.data.map((o) => o.id));
      const total = Number(fresh.total ?? 0).toLocaleString('he-IL', { maximumFractionDigits: 2 });
      setUnpaidToast({
        title: `הזמנה #${fresh.order_number} לא שולמה — להתקשר עכשיו`,
        body: `${fresh.customer_name ?? 'לקוח'}${fresh.phone ? ` · ${fresh.phone}` : ''} · ₪${total}`,
      });
      playOrderChime();
      flashTitle(`● לא שולמה #${fresh.order_number}`);
    }
  }, [isAdmin, unpaidAlerts.data]);

  // דוחות = לשונית ניהולית, מוסתרת מהתפריט לטכנאי. הגנה נוספת כאן: אם
  // activeId בכל זאת מצביע על 'reports' (למשל תפקיד שהשתנה תוך כדי session),
  // מחזירים אוטומטית לדשבורד — לא רק שהלשונית מוסתרת מהתפריט.
  useEffect(() => {
    if ((activeId === 'reports' || activeId === 'web_orders') && !isAdmin) setActiveId('dashboard');
  }, [activeId, isAdmin]);

  // המספרים בכותרת ובתגי הניווט מתעדכנים גם כשלא נמצאים בדשבורד.
  // isLive עוקב אחרי מצב ה-WebSocket עצמו (לא רק "יש נתונים") — מוצג
  // ב-TopBar כתג "חי" אמיתי, לא קישוט: אם החיבור נופל, התג נעלם.
  const [isLive, setIsLive] = useState(false);
  useRealtime(['service_calls', 'devices', 'route_assignments'], dashboard.refetch, {
    onStatusChange: (status) => setIsLive(status === 'SUBSCRIBED'),
  });
  useRealtime(['route_assignments'], completedVisits.refetch, { enabled: isAdmin });

  // Toast "בוצע" חי: ברגע שרשימת הביקורים-שהושלמו מקבלת שורה שלא
  // ראינו קודם, מציגים הודעה חולפת — לא רק תג פסיבי על הפעמון.
  // ה-ref של ה-id-ים "שכבר ראינו" מתחיל ריק, ומתמלא בטעינה הראשונה
  // בלי טוסט (אחרת כל login היה מציג טוסט על ההיסטוריה הקיימת).
  const seenVisitIds = useRef(null);
  const [visitToast, setVisitToast] = useState(null);

  useEffect(() => {
    if (!isAdmin || !completedVisits.data) return;

    if (seenVisitIds.current === null) {
      seenVisitIds.current = new Set(completedVisits.data.map((v) => v.id));
      return;
    }

    const fresh = completedVisits.data.find((v) => !seenVisitIds.current.has(v.id));
    if (fresh) {
      seenVisitIds.current = new Set(completedVisits.data.map((v) => v.id));
      const name = fresh.customer?.name ?? fresh.site?.label ?? 'לקוח';
      const stop = fresh.site?.label && fresh.customer?.name ? `${name} — ${fresh.site.label}` : name;
      const prefix = fresh.status === 'skipped' ? 'עסק סגור / לא נמצא' : 'בוצע';
      setVisitToast(`${prefix}: ${stop}${fresh.route?.name ? ` (${fresh.route.name})` : ''}`);
    }
  }, [isAdmin, completedVisits.data]);

  useEffect(() => {
    if (!visitToast) return undefined;
    const timer = setTimeout(() => setVisitToast(null), 5000);
    return () => clearTimeout(timer);
  }, [visitToast]);

  // דוחות שירות PDF (phase21): נוצרים אוטומטית ברגע ש"עדכון שמן / סיום
  // ביקור" מצליח (ר' generateReportSafely ב-serviceReport.js), ומופיעים
  // כאן חי דרך אותו דפוס בדיוק כמו completedVisits למעלה — הבדל יחיד:
  // המקור הוא oil_tracking (פעולת שירות אמיתית עם פרטים), לא רק
  // route_assignments.status='done' (שיכול להיות סימון ידני בלי שירות
  // בפועל). שני הזרמים רצים זה לצד זה, לא מחליפים אחד את השני.
  const serviceReports = useQuery(listRecentServiceReports, [], { enabled: isAdmin });
  useRealtime(['service_reports'], serviceReports.refetch, { enabled: isAdmin });

  const seenReportIds = useRef(null);
  const [reportToast, setReportToast] = useState(null);

  useEffect(() => {
    if (!isAdmin || !serviceReports.data) return;

    if (seenReportIds.current === null) {
      seenReportIds.current = new Set(serviceReports.data.map((r) => r.id));
      return;
    }

    const fresh = serviceReports.data.find((r) => !seenReportIds.current.has(r.id));
    if (fresh) {
      seenReportIds.current = new Set(serviceReports.data.map((r) => r.id));
      const tech = fresh.technician_name ?? 'טכנאי';
      setReportToast(`הטכנאי ${tech} סיים ביקור אצל ${fresh.customer_name} — דוח PDF מוכן`);
    }
  }, [isAdmin, serviceReports.data]);

  useEffect(() => {
    if (!reportToast) return undefined;
    const timer = setTimeout(() => setReportToast(null), 6000);
    return () => clearTimeout(timer);
  }, [reportToast]);

  // Offline-first: פעולות שדה קריטיות (עדכון שמן/סיום ביקור/רישום מכשיר,
  // ר' queries.js) נכתבות לתור מקומי כשאין רשת, במקום להיזרק כשגיאה.
  // pendingCount נבדק בכל טעינה + בכל שינוי במסך, לא רק פעם אחת — כדי
  // שהמונה בפס העליון יהיה נכון גם רגע אחרי שטכנאי שומר עוד פעולה
  // בזמן שהוא עדיין לא מקוון.
  const isOnline = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncToast, setSyncToast] = useState(null);

  const refreshPendingCount = useCallback(() => {
    listQueue().then((items) => setPendingCount(items.filter((i) => i.status === 'pending').length));
  }, []);

  useEffect(() => {
    refreshPendingCount();
    const stop = startAutoSync({
      onSynced: (result) => {
        refreshPendingCount();
        setSyncToast(`סונכרנו ${result.synced} פעולות שנשמרו בזמן שהיית לא מקוון`);
      },
    });
    const interval = setInterval(refreshPendingCount, 5000);
    return () => {
      stop();
      clearInterval(interval);
    };
  }, [refreshPendingCount]);

  useEffect(() => {
    if (!syncToast) return undefined;
    const timer = setTimeout(() => setSyncToast(null), 6000);
    return () => clearTimeout(timer);
  }, [syncToast]);

  const navigate = useCallback((id) => {
    setActiveId(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const active = allNavItems.find((item) => item.id === activeId) ?? allNavItems[0];

  function openNewCall() {
    setActiveId('service');
    setNewCallSignal((n) => n + 1);
  }

  return (
    <>
      <div className="ambient-field" aria-hidden />

      {/*
        2026-09-09: הפס אדום (crit) במקום ענבר — עקבי עם המחוון הקבוע
        ב-TopBar ("ירוק=מחובר, אדום=לא מחובר"), במקום צבע שלישי משלו.
      */}
      {!isOnline && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2
                     bg-crit px-3 py-2 text-center text-[14px] font-semibold text-white"
        >
          <span className="h-2 w-2 flex-none animate-pulse-dot rounded-full bg-white" />
          מצב לא מקוון — הנתונים יישמרו ויסתנכרנו אוטומטית ברגע שהחיבור יחזור
          {pendingCount > 0 && ` (${pendingCount} פעולות ממתינות)`}
        </div>
      )}

      {syncToast && (
        <div
          role="status"
          className="glass fixed inset-x-0 top-4 z-50 mx-auto flex w-fit max-w-[92vw] items-center
                     gap-2.5 rounded-pill px-4 py-2.5 text-[14px] font-medium shadow-lift
                     animate-rise"
        >
          <span className="h-2 w-2 flex-none rounded-full bg-ok" />
          {syncToast}
        </div>
      )}

      {visitToast && (
        <div
          role="status"
          className="glass fixed inset-x-0 top-4 z-50 mx-auto flex w-fit max-w-[92vw] items-center
                     gap-2.5 rounded-pill px-4 py-2.5 text-[14px] font-medium shadow-lift
                     animate-rise"
        >
          <span className="h-2 w-2 flex-none rounded-full bg-ok" />
          {visitToast}
        </div>
      )}

      {reportToast && (
        <div
          role="status"
          className="glass fixed inset-x-0 top-4 z-50 mx-auto flex w-fit max-w-[92vw] items-center
                     gap-2.5 rounded-pill px-4 py-2.5 text-[14px] font-medium shadow-lift
                     animate-rise"
        >
          <span className="h-2 w-2 flex-none rounded-full bg-gold-500" />
          {reportToast}
        </div>
      )}

      {unpaidToast && (
        <div
          role="alert"
          className="glass fixed inset-x-0 bottom-[96px] z-[55] mx-auto flex w-fit max-w-[94vw] items-center
                     gap-3 rounded-panel border-crit/40 px-4 py-3 shadow-lift animate-rise lg:bottom-6"
        >
          <span className="relative flex h-3 w-3 flex-none">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-crit opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-crit" />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-extrabold text-crit">{unpaidToast.title}</div>
            <div className="truncate text-[14px] text-text-dim">{unpaidToast.body}</div>
          </div>
          <button
            type="button"
            onClick={() => { setUnpaidToast(null); navigate('web_orders'); }}
            className="flex-none rounded-pill bg-gold-500 px-3.5 py-2 text-[14px] font-extrabold text-slate-950 hover:bg-amber-600"
          >
            לטיפול
          </button>
          <button
            type="button"
            onClick={() => setUnpaidToast(null)}
            aria-label="סגור"
            className="flex-none rounded-pill px-2 py-2 text-[14px] text-text-faint hover:text-text"
          >
            ✕
          </button>
        </div>
      )}

      {orderToast && (
        <div
          role="alert"
          className="glass fixed inset-x-0 top-4 z-[55] mx-auto flex w-fit max-w-[94vw] items-center
                     gap-3 rounded-panel border-gold-300/[0.5] px-4 py-3 shadow-lift animate-rise"
        >
          <span className="relative flex h-3 w-3 flex-none">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-500 opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-gold-500" />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-extrabold text-text">{orderToast.title}</div>
            <div className="truncate text-[14px] text-text-dim">{orderToast.body}</div>
          </div>
          <button
            type="button"
            onClick={() => { setOrderToast(null); navigate('web_orders'); }}
            className="flex-none rounded-pill bg-gold-500 px-3.5 py-2 text-[14px] font-extrabold text-slate-950 hover:bg-amber-600"
          >
            לצפייה
          </button>
          <button
            type="button"
            onClick={() => setOrderToast(null)}
            aria-label="סגור"
            className="flex-none rounded-pill px-2 py-2 text-[14px] text-text-faint hover:text-text"
          >
            ✕
          </button>
        </div>
      )}

      <div className="relative z-[1] min-h-screen">
        <Sidebar
          activeId={activeId}
          onSelect={navigate}
          criticalCalls={(kpis?.calls_critical ?? 0) + (openInstalls.data ?? 0)}
          newLeadsCount={newLeadsCount.data ?? 0}
          newOrdersCount={newOrdersCount.data ?? 0}
        />

        <main className="max-w-[1560px] px-[18px] pb-[108px] pt-[18px] lg:ms-[300px] lg:px-[22px] lg:pb-10">
          <TopBar
            title={active.label}
            meta={screenMeta(activeId, kpis)}
            online={kpis?.devices_online ?? 0}
            total={kpis?.devices_total ?? 0}
            alerts={kpis?.calls_critical ?? 0}
            activeId={activeId}
            onNavigate={navigate}
            isLive={isLive}
            completedVisits={completedVisits.data ?? []}
            completedVisitsLoading={completedVisits.loading}
            serviceReports={serviceReports.data ?? []}
            serviceReportsLoading={serviceReports.loading}
            onNewCall={openNewCall}
            onSearch={() => navigate('devices')}
            onLogoClick={() => navigate('dashboard')}
            isConnected={isOnline}
          />

          {activeId === 'dashboard' && (
            <DashboardScreen
              data={dashboard.data}
              loading={dashboard.loading}
              error={dashboard.error}
              onRetry={dashboard.refetch}
              onNavigate={navigate}
            />
          )}

          {activeId === 'devices' && <DevicesScreen />}
          {activeId === 'customers' && <CustomersScreen />}
          {activeId === 'oils' && <OilScreen />}
          {activeId === 'service' && <ServiceCallsScreen openFormSignal={newCallSignal} />}
          {activeId === 'routes' && <RoutesScreen />}
          {activeId === 'stock' && <StockScreen />}
          {activeId === 'reports' && isAdmin && <ReportsScreen />}
          {activeId === 'catalog' && isAdmin && <CatalogScreen />}
          {activeId === 'web_orders' && isAdmin && <WebOrdersScreen />}
          {activeId === 'leads' && isAdmin && <LeadsScreen />}
          {activeId === 'social' && isAdmin && <SocialScreen onNavigate={navigate} />}
          {activeId === 'settings' && <SettingsScreen />}
        </main>

        <BottomNav activeId={activeId} onSelect={navigate} criticalCalls={(kpis?.calls_critical ?? 0) + (openInstalls.data ?? 0)} />
      </div>
    </>
  );
}
