import GlassCard, { CardHead } from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
import { SecondaryButton } from '../components/ui/Field';
import { Async } from '../components/ui/States';
import { useQuery } from '../hooks/useQuery';
import { useAuth } from '../context/AuthContext';
import { listProfiles, getRouteBreakdown } from '../lib/queries';

export default function SettingsScreen() {
  const { profile, session, isAdmin, signOut } = useAuth();

  const team = useQuery(listProfiles, []);
  const routes = useQuery(getRouteBreakdown, []);

  const teamColumns = [
    { key: 'name', label: 'שם', width: 'minmax(0,1fr)', render: (row) => <b className="font-semibold">{row.full_name}</b> },
    {
      key: 'role',
      label: 'תפקיד',
      width: '120px',
      render: (row) => (
        <StatusChip tone={row.role === 'admin' ? 'gold' : 'slate'}>
          {row.role === 'admin' ? 'מנהל' : 'טכנאי'}
        </StatusChip>
      ),
    },
  ];

  const routeColumns = [
    { key: 'name', label: 'קו', width: 'minmax(0,1fr)', render: (row) => <b className="font-semibold">{row.name}</b> },
    { key: 'total', label: 'מכשירים', width: '96px', render: (row) => <span className="tabular font-mono">{row.total}</span> },
    { key: 'active', label: 'פעילים', width: '96px', render: (row) => <span className="tabular font-mono">{row.active}</span> },
  ];

  return (
    <section className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <GlassCard>
        <CardHead title="החשבון שלי" />

        <dl className="flex flex-col gap-3 text-[13.5px]">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-faint">שם</dt>
            <dd className="font-semibold">{profile?.full_name ?? '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-faint">אימייל</dt>
            <dd dir="ltr" className="font-mono text-[12.5px]">{session?.user?.email ?? '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-faint">הרשאה</dt>
            <dd>
              <StatusChip tone={isAdmin ? 'gold' : 'slate'}>
                {isAdmin ? 'מנהל — כולל מחיקה' : 'טכנאי — צפייה, הוספה ועדכון'}
              </StatusChip>
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-[11.5px] leading-relaxed text-text-faint">
          שינוי הרשאה נעשה בטבלת <span className="font-mono text-text-dim">profiles</span> ב-Supabase
          ונכנס לתוקף מיד, בלי שתצטרך להתחבר מחדש.
        </p>

        <SecondaryButton className="mt-5 w-full" onClick={signOut}>
          התנתקות
        </SecondaryButton>
      </GlassCard>

      <div className="flex flex-col gap-3.5">
        <GlassCard>
          <CardHead title="צוות" subtitle="משתמשים פעילים במערכת" />
          <Async loading={team.loading} error={team.error} onRetry={team.refetch}
                 isEmpty={team.data?.length === 0}>
            <DataTable columns={teamColumns} rows={team.data ?? []} rowKey={(row) => row.id} />
          </Async>
        </GlassCard>

        <GlassCard>
          <CardHead title="קווי הפצה" subtitle="לפי שדה 'קו הפצה' בכרטיס הלקוח" />
          <Async loading={routes.loading} error={routes.error} onRetry={routes.refetch}
                 isEmpty={routes.data?.length === 0}>
            <DataTable columns={routeColumns} rows={routes.data ?? []} rowKey={(row) => row.name} />
          </Async>
        </GlassCard>
      </div>
    </section>
  );
}
