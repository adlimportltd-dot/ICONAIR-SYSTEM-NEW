import { useCallback, useEffect, useMemo, useState } from 'react';
import { MegaphoneIcon, ChartIcon, FunnelIcon, SettingsIcon, GridIcon, PlusIcon, SparkleIcon } from '../components/ui/Icons';
import { LoadingRows } from '../components/ui/States';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import { describeError } from '../lib/supabase';
import { SubTabs, Toast } from '../components/social/SocialUI';
import OverviewPanel from '../components/social/OverviewPanel';
import ContentPanel from '../components/social/ContentPanel';
import CampaignsPanel, { BoostModal } from '../components/social/CampaignsPanel';
import LeadsPanel from '../components/social/LeadsPanel';
import ConnectPanel, { SetupDatabase } from '../components/social/ConnectPanel';
import PostComposer from '../components/social/PostComposer';
import CreativeStudio from '../components/social/CreativeStudio';
import ReelStudioPanel from '../components/social/reels/ReelStudioPanel';
import {
  listSocialPosts, deleteSocialPost, publishSocialPost, getSocialSettings, getMetaLive, listRecentLeads,
  isSetupMissing, postState,
} from '../lib/social';

/**
 * ניהול סושיאל וקמפיינים (phase45) — מרכז אחד לתוכן, קריאייטיב, תזמון,
 * ביצועים, קמפיינים ולידים, מחובר ל-Meta Graph API.
 *
 * ארכיטקטורה (ר' גם api/social.js ו-iconair_schema_phase45_social.sql):
 *   social_posts ← הטאב כותב; Autopilot (pg_cron ← /api/social) מפרסם בזמן
 *   ואוסף ביצועים; Realtime מחזיר את השינויים למסך בלי רענון.
 */

const META_RETURN = {
  connected: { tone: 'ok', message: 'Meta מחובר — העמוד, האינסטגרם וחשבון המודעות נבחרו אוטומטית' },
  no_pages: { tone: 'crit', message: 'ההתחברות הצליחה, אבל לא אושרה גישה לאף עמוד — לחץ “חיבור מחדש” וסמן את העמוד' },
  cancelled: { tone: 'gold', message: 'ההתחברות ל-Meta בוטלה' },
};

export default function SocialScreen({ onNavigate }) {
  const [tab, setTab] = useState(null);
  const [composer, setComposer] = useState(null);
  const [studio, setStudio] = useState(null); // null | 'composer' | 'standalone'
  const [studioResult, setStudioResult] = useState(null);
  const [boost, setBoost] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  const settings = useQuery(getSocialSettings, []);
  const setupMissing = settings.error && isSetupMissing(settings.error);
  const connected = Boolean(settings.data?.connected);

  const live = useQuery(getMetaLive, [connected], { enabled: connected });
  const posts = useQuery(listSocialPosts, [], { enabled: !setupMissing });
  useRealtime(['social_posts'], posts.refetch, { enabled: !setupMissing });
  const leads = useQuery(listRecentLeads, []);
  useRealtime(['leads'], leads.refetch);

  const notify = useCallback((t) => setToast(t), []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 5500);
    return () => clearTimeout(timer);
  }, [toast]);

  // חזרה מ-Meta אחרי OAuth: ?tab=social&meta=connected|error|...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('reels')) {
      setTab('reels');
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }
    const meta = params.get('meta');
    if (!meta) return;
    notify(META_RETURN[meta] ?? { tone: 'crit', message: `החיבור ל-Meta לא הושלם: ${params.get('reason') || 'נסה שוב'}` });
    setTab('connect');
    window.history.replaceState(null, '', window.location.pathname);
    settings.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // לשונית ברירת מחדל: לא מחובר → חיבור, אחרת סקירה.
  const activeTab = tab ?? (settings.loading ? null : connected ? 'overview' : 'connect');

  const failedCount = useMemo(() => (posts.data ?? []).filter((p) => postState(p) === 'failed').length, [posts.data]);
  const newLeads = useMemo(() => (leads.data ?? []).filter((l) => l.status === 'new').length, [leads.data]);

  const openNew = useCallback((preset) => setComposer({ preset: preset ? { scheduled_at: preset.scheduled_at } : undefined }), []);

  async function publish(p) {
    setBusyId(p.id);
    try {
      const saved = await publishSocialPost(p.id);
      const problems = [saved.fb_error, saved.ig_error].filter(Boolean);
      notify(problems.length ? { tone: 'crit', message: problems.join(' · ') } : { message: 'פורסם בהצלחה' });
      posts.refetch();
    } catch (e) {
      notify({ tone: 'crit', message: describeError(e) });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(p) {
    const live2 = p.fb_status === 'published' || p.ig_status === 'published';
    if (!window.confirm(`למחוק את הפוסט מהמערכת?${live2 ? '\nמה שכבר עלה לפייסבוק/אינסטגרם יישאר שם.' : ''}`)) return;
    setBusyId(p.id);
    try {
      await deleteSocialPost(p.id);
      notify({ message: 'נמחק' });
      posts.refetch();
    } catch (e) {
      notify({ tone: 'crit', message: describeError(e) });
    } finally {
      setBusyId(null);
    }
  }

  if (setupMissing) {
    return (
      <>
        <Hero settings={null} />
        <SetupDatabase onRetry={() => { settings.refetch(); posts.refetch(); }} />
      </>
    );
  }

  const tabs = [
    { id: 'overview', label: 'סקירה', icon: GridIcon },
    { id: 'reels', label: 'סטודיו רילז', icon: SparkleIcon },
    { id: 'content', label: 'תוכן', icon: MegaphoneIcon, badge: failedCount },
    { id: 'campaigns', label: 'קמפיינים', icon: ChartIcon },
    { id: 'leads', label: 'לידים', icon: FunnelIcon, badge: newLeads },
    { id: 'connect', label: connected ? 'חיבור' : 'חיבור Meta', icon: SettingsIcon },
  ];

  return (
    <>
      <Toast message={toast?.message} tone={toast?.tone} />

      <Hero
        settings={settings.data}
        live={live.data}
        onNew={() => openNew()}
        onStudio={() => { setStudioResult(null); setStudio('standalone'); }}
      />

      {activeTab == null ? <LoadingRows rows={4} height="h-[90px]" /> : (
        <>
          <SubTabs tabs={tabs} active={activeTab} onChange={setTab} />

          {activeTab === 'overview' && (
            <OverviewPanel posts={posts.data} settings={settings.data} live={live.data} leads={leads.data}
              onOpen={setComposer} onNew={openNew} onGo={setTab} />
          )}
          {activeTab === 'reels' && (
            <ReelStudioPanel settings={settings.data} onToast={notify} onPublished={posts.refetch} onGoConnect={() => setTab('connect')} />
          )}
          {activeTab === 'content' && (
            <ContentPanel posts={posts} onOpen={setComposer} onNew={openNew} onPublish={publish} onDelete={remove} busyId={busyId} />
          )}
          {activeTab === 'campaigns' && (
            <CampaignsPanel settings={settings.data} crmLeads={leads.data ?? []} onGoConnect={() => setTab('connect')} onToast={notify} />
          )}
          {activeTab === 'leads' && <LeadsPanel leads={leads} onGoLeads={() => onNavigate?.('leads')} />}
          {activeTab === 'connect' && (
            settings.error ? (
              <div className="glass-card p-6 text-[15px] text-crit-soft">{settings.error}</div>
            ) : (
              <ConnectPanel settings={settings.data} live={live.data} onToast={notify}
                onChanged={() => { settings.refetch(); live.refetch(); }} />
            )
          )}
        </>
      )}

      <PostComposer
        post={composer}
        settings={settings.data}
        studioResult={studio === null ? studioResult : null}
        onClose={() => { setComposer(null); setStudioResult(null); }}
        onSaved={(t) => { setComposer(null); setStudioResult(null); posts.refetch(); if (t) notify(t); }}
        onOpenStudio={() => { setStudioResult(null); setStudio('composer'); }}
        onBoost={(p) => { setComposer(null); setBoost(p); }}
      />

      <CreativeStudio
        open={studio != null}
        onClose={() => setStudio(null)}
        onDone={(url) => {
          const origin = studio;
          setStudio(null);
          setStudioResult({ url, at: Date.now() });
          if (origin === 'standalone') setComposer({ preset: { form: { media_urls: [url] } } });
          notify({ message: 'הקריאייטיב נשמר ונוסף לפוסט' });
        }}
      />

      <BoostModal
        post={boost}
        settings={settings.data}
        onClose={() => setBoost(null)}
        onDone={() => { setBoost(null); posts.refetch(); setTab('campaigns'); notify({ tone: 'gold', message: 'הקמפיין הוקם ונשלח לאישור Meta' }); }}
      />
    </>
  );
}

function Hero({ settings, live, onNew, onStudio }) {
  const connected = settings?.connected;
  return (
    <div className="glass-card mb-5 flex flex-wrap items-center gap-4 p-5 sm:p-6">
      <div className="grid h-12 w-12 flex-none place-items-center rounded-xl border border-gold-300/[0.35] bg-gold-500/[0.14] text-gold-600 shadow-icon-glow">
        <MegaphoneIcon className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-[22px] font-extrabold leading-tight">מרכז סושיאל וקמפיינים</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[14px] text-text-faint">
          {settings == null ? 'הקמה ראשונית' : connected ? (
            <>
              <span className="inline-flex items-center gap-1.5 font-semibold text-ok">
                <span className={`h-2 w-2 rounded-full ${live?.health === 'error' ? 'bg-crit' : 'animate-pulse-dot bg-ok'}`} />
                {live?.health === 'error' ? 'דורש חיבור מחדש' : 'Autopilot פעיל'}
              </span>
              <span>· {settings.page_name}{settings.ig_username ? ` · @${settings.ig_username}` : ''}</span>
            </>
          ) : 'Meta עוד לא מחובר — אפשר כבר לכתוב, לעצב ולשמור טיוטות'}
        </div>
      </div>
      {onNew && (
        <div className="flex w-full gap-2.5 sm:w-auto">
          <button type="button" onClick={onStudio} className="ghost-btn flex-1 justify-center sm:flex-none">סטודיו קריאייטיב</button>
          <button type="button" onClick={onNew}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-pill bg-gold-500 px-4 py-2.5 text-[15px] font-extrabold text-slate-950 shadow-lift transition-colors hover:bg-amber-600 sm:flex-none">
            <PlusIcon className="h-4 w-4" />
            פוסט חדש
          </button>
        </div>
      )}
    </div>
  );
}
