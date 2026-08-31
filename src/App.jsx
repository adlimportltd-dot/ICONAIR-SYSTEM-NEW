import { useCallback, useEffect, useState } from 'react';

import { AuthProvider, useAuth } from './context/AuthContext';
import { isSupabaseConfigured } from './lib/supabase';
import { getDashboard } from './lib/queries';
import { useQuery } from './hooks/useQuery';
import { useRealtime } from './hooks/useRealtime';
import { allNavItems, screenMeta } from './config/navigation';

import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import BottomNav from './components/BottomNav';
import LoginScreen from './components/auth/LoginScreen';
import SetupScreen from './components/auth/SetupScreen';
import { Skeleton } from './components/ui/States';

import DashboardScreen from './screens/DashboardScreen';
import CustomersScreen from './screens/CustomersScreen';
import DevicesScreen from './screens/DevicesScreen';
import OilScreen from './screens/OilScreen';
import ServiceCallsScreen from './screens/ServiceCallsScreen';
import ReportsScreen from './screens/ReportsScreen';
import SettingsScreen from './screens/SettingsScreen';

export default function App() {
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
            <p className="mt-2 text-[13px] leading-relaxed text-text-dim">
              המשתמש קיים ב-Authentication אבל אין לו שורה בטבלת
              <span className="font-mono text-gold-300"> profiles</span>.
              ודא שהרצת את <span className="font-mono text-gold-300">iconair_schema.sql</span> —
              הוא יוצר את הטריגר (<span className="font-mono text-gold-300">on_auth_user_created</span>)
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

  // דוחות = לשונית ניהולית, מוסתרת מהתפריט לטכנאי. הגנה נוספת כאן: אם
  // activeId בכל זאת מצביע על 'reports' (למשל תפקיד שהשתנה תוך כדי session),
  // מחזירים אוטומטית לדשבורד — לא רק שהלשונית מוסתרת מהתפריט.
  useEffect(() => {
    if (activeId === 'reports' && !isAdmin) setActiveId('dashboard');
  }, [activeId, isAdmin]);

  // המספרים בכותרת ובתגי הניווט מתעדכנים גם כשלא נמצאים בדשבורד
  useRealtime(['service_calls', 'devices'], dashboard.refetch);

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

      <div className="relative z-[1] min-h-screen">
        <Sidebar activeId={activeId} onSelect={navigate} criticalCalls={kpis?.calls_critical ?? 0} />

        <main className="max-w-[1560px] px-[18px] pb-[108px] pt-[18px] lg:ms-[288px] lg:px-[22px] lg:pb-10">
          <TopBar
            title={active.label}
            meta={screenMeta(activeId, kpis)}
            online={kpis?.devices_online ?? 0}
            total={kpis?.devices_total ?? 0}
            alerts={kpis?.calls_critical ?? 0}
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
          {activeId === 'reports' && isAdmin && <ReportsScreen />}
          {activeId === 'settings' && <SettingsScreen />}
        </main>

        <BottomNav activeId={activeId} onSelect={navigate} criticalCalls={kpis?.calls_critical ?? 0} />
      </div>
    </>
  );
}
