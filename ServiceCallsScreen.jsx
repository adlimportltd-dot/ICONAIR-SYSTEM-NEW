import { useEffect, useMemo, useState } from 'react';
import GlassCard from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
import ScreenToolbar from '../components/ui/ScreenToolbar';
import Modal from '../components/ui/Modal';
import { Field, TextInput, TextArea, Select, PrimaryButton, SecondaryButton } from '../components/ui/Field';
import { Async, EmptyState } from '../components/ui/States';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import { useAuth } from '../context/AuthContext';
import {
  listServiceCalls, createServiceCall, resolveServiceCall, startServiceCall,
  listCustomerOptions, listDeviceOptions, listProfiles,
} from '../lib/queries';
import { describeError } from '../lib/supabase';
import {
  CALL_SEVERITY_LABEL, CALL_STATUS_LABEL, MODEL_TONE, relativeTime, formatDateTime,
} from '../lib/mappers';

const SEVERITY_TONE = { crit: 'crit', warn: 'warn', norm: 'slate', sched: 'gold' };
// החומרה כבר נושאת את הדחיפות. הסטטוס נושא רק את המצב — אחרת כל שורה
// פתוחה נצבעת אדום ו"דחוף" מפסיק להיקרא כדחוף.
const STATUS_TONE = { open: 'neutral', in_progress: 'teal', resolved: 'ok', cancelled: 'slate' };

const STATUS_FILTERS = [
  { value: 'open_all', label: 'פתוחות ובטיפול' },
  { value: 'open', label: 'פתוחות בלבד' },
  { value: 'in_progress', label: 'בטיפול' },
  { value: 'resolved', label: 'טופלו' },
  { value: 'cancelled', label: 'בוטלו' },
];

const EMPTY_FORM = {
  customer_id: '', device_id: '', title: '', description: '',
  severity: 'norm', assigned_to: '',
};

export default function ServiceCallsScreen({ openFormSignal }) {
  const { profile } = useAuth();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('open_all');
  const [formOpen, setFormOpen] = useState(false);
  const [resolving, setResolving] = useState(null);
  const [rowBusy, setRowBusy] = useState(null);

  const calls = useQuery(() => listServiceCalls({ status, search }), [status, search]);
  const customers = useQuery(listCustomerOptions, []);
  const devices = useQuery(listDeviceOptions, []);
  const technicians = useQuery(listProfiles, []);

  // קריאה שנפתחת מהשטח מופיעה כאן מיד, בלי שהמנהל ירענן
  useRealtime(['service_calls'], calls.refetch);

  // כפתור ה-+ בשורה העליונה פותח את אותו טופס.
  // useEffect ולא useMemo — setState בזמן רינדור הוא באג שמחכה לקרות.
  useEffect(() => {
    if (openFormSignal) setFormOpen(true);
  }, [openFormSignal]);

  const customerOptions = useMemo(
    () => (customers.data ?? []).map((c) => ({ value: c.id, label: c.city ? `${c.name} · ${c.city}` : c.name })),
    [customers.data]
  );
  const technicianOptions = useMemo(
    () => (technicians.data ?? []).map((p) => ({ value: p.id, label: p.full_name })),
    [technicians.data]
  );

  async function withRowBusy(id, action) {
    setRowBusy(id);
    try {
      await action();
      calls.refetch();
    } catch (caught) {
      // eslint-disable-next-line no-alert
      alert(describeError(caught));
    } finally {
      setRowBusy(null);
    }
  }

  const columns = [
    {
      key: 'code',
      label: 'קוד',
      width: '96px',
      render: (row) => <span className="font-mono text-[12.5px] text-gold-300">{row.code}</span>,
    },
    {
      key: 'customer',
      label: 'לקוח ותקלה',
      width: 'minmax(0,1.8fr)',
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{row.customer?.name ?? '—'}</div>
          <div className="truncate text-[11.5px] text-text-faint">{row.title}</div>
        </div>
      ),
    },
    {
      key: 'device',
      label: 'מכשיר',
      width: '150px',
      render: (row) => (row.device
        ? (
          <div className="flex items-center gap-2">
            <StatusChip tone={MODEL_TONE[row.device.model]}>{row.device.model}</StatusChip>
          </div>
        )
        : <span className="text-text-faint">—</span>),
    },
    {
      key: 'severity',
      label: 'חומרה',
      width: '90px',
      render: (row) => (
        <StatusChip tone={SEVERITY_TONE[row.severity]}>{CALL_SEVERITY_LABEL[row.severity]}</StatusChip>
      ),
    },
    {
      key: 'status',
      label: 'סטטוס',
      width: '96px',
      render: (row) => <StatusChip tone={STATUS_TONE[row.status]}>{CALL_STATUS_LABEL[row.status]}</StatusChip>,
    },
    { key: 'assignee', label: 'משויך ל', width: '110px', render: (row) => row.assignee?.full_name ?? 'לא שובץ' },
    {
      key: 'opened',
      label: 'נפתח',
      width: '104px',
      render: (row) => (
        <span className="tabular text-[12px] text-text-faint" title={formatDateTime(row.opened_at)}>
          {relativeTime(row.opened_at)}
        </span>
      ),
    },
  ];

  const actions = (row) => {
    if (row.status === 'resolved' || row.status === 'cancelled') return null;

    return (
      <>
        {row.status === 'open' && (
          <button
            type="button"
            disabled={rowBusy === row.id}
            onClick={(event) => {
              event.stopPropagation();
              withRowBusy(row.id, () => startServiceCall(row.id, profile?.id));
            }}
            className="ghost-btn disabled:opacity-50"
          >
            קח לטיפול
          </button>
        )}
        <button
          type="button"
          disabled={rowBusy === row.id}
          onClick={(event) => {
            event.stopPropagation();
            setResolving(row);
          }}
          className="ghost-btn disabled:opacity-50"
        >
          סגור
        </button>
      </>
    );
  };

  return (
    <>
      <ScreenToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="חיפוש לפי קוד קריאה או כותרת…"
        count={calls.data?.length}
        countLabel="קריאות"
        actionLabel="קריאה חדשה"
        onAction={() => setFormOpen(true)}
        filters={[{
          key: 'status',
          value: status,
          onChange: setStatus,
          placeholder: 'כל הסטטוסים',
          options: STATUS_FILTERS,
        }]}
      />

      <GlassCard>
        <Async
          loading={calls.loading}
          error={calls.error}
          onRetry={calls.refetch}
          isEmpty={calls.data?.length === 0}
          empty={
            <EmptyState
              title={status === 'open_all' ? 'אין קריאות פתוחות' : 'אין קריאות שתואמות את הסינון'}
              hint={status === 'open_all' ? 'הכול תקין בשטח כרגע.' : 'נסה סטטוס אחר.'}
            />
          }
        >
          <DataTable
            columns={columns}
            rows={calls.data ?? []}
            rowKey={(row) => row.id}
            actions={actions}
          />
        </Async>
      </GlassCard>

      <NewCallModal
        open={formOpen}
        customerOptions={customerOptions}
        technicianOptions={technicianOptions}
        devices={devices.data ?? []}
        onClose={() => setFormOpen(false)}
        onCreated={() => {
          setFormOpen(false);
          calls.refetch();
        }}
      />

      <ResolveModal
        call={resolving}
        onClose={() => setResolving(null)}
        onResolved={() => {
          setResolving(null);
          calls.refetch();
        }}
      />
    </>
  );
}

function NewCallModal({ open, customerOptions, technicianOptions, devices, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  // רשימת המכשירים מצטמצמת ללקוח שנבחר — אחרת בוחרים מכשיר של לקוח אחר
  const deviceOptions = useMemo(
    () => devices
      .filter((d) => !form.customer_id || d.customer?.id === form.customer_id)
      .map((d) => ({ value: d.id, label: `${d.serial} · ${d.model}` })),
    [devices, form.customer_id]
  );

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await createServiceCall({
        customer_id: form.customer_id,
        device_id: form.device_id || null,
        title: form.title,
        description: form.description || null,
        severity: form.severity,
        assigned_to: form.assigned_to || null,
        status: 'open',
      });
      setForm(EMPTY_FORM);
      onCreated();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="קריאת שירות חדשה" subtitle="קוד הקריאה נוצר אוטומטית" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="לקוח" required>
          <Select
            value={form.customer_id}
            onChange={(event) => setForm((prev) => ({ ...prev, customer_id: event.target.value, device_id: '' }))}
            options={customerOptions}
            placeholder="בחר לקוח"
            required
          />
        </Field>

        <Field label="מכשיר" hint={form.customer_id ? undefined : 'בחר לקוח כדי לראות את המכשירים שלו'}>
          <Select value={form.device_id} onChange={set('device_id')} options={deviceOptions}
                  placeholder="ללא מכשיר מסוים" disabled={!form.customer_id} />
        </Field>

        <Field label="כותרת התקלה" required>
          <TextInput value={form.title} onChange={set('title')} placeholder="תקלת משאבה, אין הזרמה" required />
        </Field>

        <Field label="תיאור">
          <TextArea value={form.description} onChange={set('description')} rows={3}
                    placeholder="מה בדיוק קורה, ומה כבר נוסה בשטח" />
        </Field>

        <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
          <Field label="חומרה">
            <Select
              value={form.severity}
              onChange={set('severity')}
              options={Object.entries(CALL_SEVERITY_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="שיוך לטכנאי">
            <Select value={form.assigned_to} onChange={set('assigned_to')} options={technicianOptions}
                    placeholder="לא שובץ" />
          </Field>
        </div>

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[12.5px] text-crit-soft">
            {error}
          </div>
        )}

        <div className="mt-1 flex gap-2.5">
          <PrimaryButton type="submit" loading={busy}>פתח קריאה</PrimaryButton>
          <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ResolveModal({ call, onClose, onResolved }) {
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await resolveServiceCall(call.id, resolution || 'טופל בשטח.');
      setResolution('');
      onResolved();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(call)}
      title={`סגירת קריאה ${call?.code ?? ''}`}
      subtitle={call?.title}
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="מה בוצע" hint="נשמר בהיסטוריית הקריאה ומשמש לחישוב זמן הסגירה הממוצע">
          <TextArea value={resolution} onChange={(event) => setResolution(event.target.value)} rows={3}
                    placeholder="הוחלף ראש משאבה, נבדקה הזרמה תקינה." />
        </Field>

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[12.5px] text-crit-soft">
            {error}
          </div>
        )}

        <div className="mt-1 flex gap-2.5">
          <PrimaryButton type="submit" loading={busy}>סגור קריאה</PrimaryButton>
          <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
        </div>
      </form>
    </Modal>
  );
}
