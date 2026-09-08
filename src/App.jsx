import { useCallback, useEffect, useRef, useState } from 'react';

import { AuthProvider, useAuth } from './context/AuthContext';
import { isSupabaseConfigured } from './lib/supabase';
import { getDashboard, listRecentCompletedVisits } from './lib/queries';
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
  const [activeId, setActiveId] = useState('dashboard');
  const [newCallSignal, setNewCallSignal] = useState(0);

  const dashboard = useQuery(getDashboard, []);
  const kpis = dashboard.data?.kpis;

  // "בוצע" בשטח → מגיע לפעמון של המנהל בזמן אמת (route_assignments
  // status='done'). רק מנהל צריך את זה — לטכנאי כבר יש את הסטטוס
  // מול העיניים במסך המסלולים שלו עצמו.
  const completedVisits = useQuery(listRecentCompletedVisits, [], { enabled: isAdmin });

  // דוחות = לשונית ניהולית, מוסתרת מהתפריט לטכנאי. הגנה נוספת כאן: אם
  // activeId בכל זאת מצביע על 'reports' (למשל תפקיד שהשתנה תוך כדי session),
  // מחזירים אוטומטית לדשבורד — לא רק שהלשונית מוסתרת מהתפריט.
  useEffect(() => {
    if (activeId === 'reports' && !isAdmin) setActiveId('dashboard');
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
      setVisitToast(`בוצע: ${stop}${fresh.route?.name ? ` (${fresh.route.name})` : ''}`);
    }
  }, [isAdmin, completedVisits.data]);

  useEffect(() => {
    if (!visitToast) return undefined;
    const timer = setTimeout(() => setVisitToast(null), 5000);
    return () => clearTimeout(timer);
  }, [visitToast]);

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

      {!isOnline && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2
                     bg-warn px-3 py-2 text-center text-[14px] font-semibold text-[#221B0C]"
        >
          <span className="h-2 w-2 flex-none animate-pulse-dot rounded-full bg-[#221B0C]" />
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

      <div className="relative z-[1] min-h-screen">
        <Sidebar activeId={activeId} onSelect={navigate} criticalCalls={kpis?.calls_critical ?? 0} />

        <main className="max-w-[1560px] px-[18px] pb-[108px] pt-[18px] lg:ms-[288px] lg:px-[22px] lg:pb-10">
          <TopBar
            title={active.label}
            meta={screenMeta(activeId, kpis)}
            online={kpis?.devices_online ?? 0}
            total={kpis?.devices_total ?? 0}
            alerts={kpis?.calls_critical ?? 0}
            isLive={isLive}
            completedVisits={completedVisits.data ?? []}
            completedVisitsLoading={completedVisits.loading}
            onNewCall={openNewCall}
            onSearch={() => navigate('devices')}
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
          {activeId === 'catalog' && <CatalogScreen />}
          {activeId === 'settings' && <SettingsScreen />}
        </main>

        <BottomNav activeId={activeId} onSelect={navigate} criticalCalls={kpis?.calls_critical ?? 0} />
      </div>
    </>
  );
}