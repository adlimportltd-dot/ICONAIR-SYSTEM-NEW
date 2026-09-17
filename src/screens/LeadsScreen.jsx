import { useEffect, useMemo, useState } from 'react';
import GlassCard, { CardHead } from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
import ScreenToolbar from '../components/ui/ScreenToolbar';
import Modal from '../components/ui/Modal';
import { FunnelIcon, PhoneIcon } from '../components/ui/Icons';
import { Field, TextInput, TextArea, Select, PrimaryButton, SecondaryButton } from '../components/ui/Field';
import { Async, EmptyState } from '../components/ui/States';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import { listLeads, createLead, updateLeadStatus, convertLeadToCustomer, listRoutes } from '../lib/queries';
import { describeError } from '../lib/supabase';
import { formatDateTime } from '../lib/mappers';

export const LEAD_STATUS_LABEL = {
  new: 'חדש',
  contacted: 'נוצר קשר',
  converted: 'הומר ללקוח',
  archived: 'בארכיון',
};

const LEAD_STATUS_TONE = { new: 'gold', contacted: 'teal', converted: 'ok', archived: 'slate' };
const STATUS_OPTIONS = Object.entries(LEAD_STATUS_LABEL).map(([value, label]) => ({ value, label }));

const emptyForm = () => ({ full_name: '', phone: '', city: '', notes: '' });

export default function LeadsScreen() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [date, setDate] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [convertLead, setConvertLead] = useState(null);

  const leads = useQuery(() => listLeads({ status, date }), [status, date]);
  useRealtime(['leads'], leads.refetch);

  const filtered = useMemo(() => {
    const rows = leads.data ?? [];
    if (!search.trim()) return rows;
    const needle = search.trim().toLowerCase();
    return rows.filter((row) =>
      [row.full_name, row.phone, row.city].filter(Boolean).some((value) => value.toLowerCase().includes(needle))
    );
  }, [leads.data, search]);

  async function changeStatus(row, nextStatus) {
    try {
      await updateLeadStatus(row.id, nextStatus);
      leads.refetch();
    } catch (caught) {
      window.alert(describeError(caught));
    }
  }

  const columns = [
    {
      key: 'lead',
      label: 'ליד',
      width: 'minmax(0,1.3fr)',
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{row.full_name}</div>
          {row.city && <div className="truncate text-[13px] text-text-faint">{row.city}</div>}
        </div>
      ),
    },
    {
      key: 'phone',
      label: 'טלפון',
      width: '150px',
      // 2026-09-16 (בקשה מפורשת: "מספר הטלפון לחיוג מהיר") — קישור tel:
      // אמיתי, לא רק טקסט — אותו דפוס בדיוק כמו כפתור החיוג בכרטיס
      // הלקוח במסלולים (RoutesScreen). stopPropagation כדי שלחיצה על
      // הטלפון לא תפעיל שום click-handler אחר של השורה בעתיד.
      render: (row) => (row.phone ? (
        <a
          href={`tel:${String(row.phone).replace(/[^\d+]/g, '')}`}
          onClick={(event) => event.stopPropagation()}
          dir="ltr"
          className="tabular inline-flex items-center gap-1.5 font-mono text-[14px] text-gold-600 hover:underline"
        >
          <PhoneIcon className="h-3.5 w-3.5 flex-none" />
          {row.phone}
        </a>
      ) : '—'),
    },
    {
      key: 'status',
      label: 'סטטוס',
      width: '150px',
      render: (row) =>
        row.status === 'converted' ? (
          <StatusChip tone="ok">{LEAD_STATUS_LABEL.converted}</StatusChip>
        ) : (
          <Select
            value={row.status}
            onChange={(event) => changeStatus(row, event.target.value)}
            options={STATUS_OPTIONS.filter((o) => o.value !== 'converted')}
            className="!w-auto min-w-[118px] !py-1.5 text-[13.5px]"
            onClick={(event) => event.stopPropagation()}
          />
        ),
    },
    { key: 'notes', label: 'הערות', render: (row) => row.notes || '—' },
    // 2026-09-17 (בקשה מפורשת: שתי שאלות ההסמכה מטופס הפייסבוק, כבר
    // נשמרות ע"י Make.com בעמודות business_size/installation_time —
    // כאן רק תצוגה, שום שינוי בשליפה עצמה (listLeads כבר select('*')).
    { key: 'business_size', label: 'גודל העסק', width: '130px', render: (row) => row.business_size || '—' },
    { key: 'installation_time', label: 'זמן התקנה', width: '130px', render: (row) => row.installation_time || '—' },
    {
      key: 'at',
      label: 'התקבל',
      width: '124px',
      render: (row) => <span className="tabular text-[13.5px] text-text-faint">{formatDateTime(row.created_at)}</span>,
    },
  ];

  return (
    <>
      <ScreenToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="חיפוש לפי שם, טלפון או עיר…"
        count={filtered.length}
        countLabel="לידים"
        actionLabel="ליד חדש"
        onAction={() => setFormOpen(true)}
        filters={[
          { key: 'status', value: status, onChange: setStatus, placeholder: 'כל הסטטוסים', options: STATUS_OPTIONS },
        ]}
        extra={
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-pill border border-black/[0.09] bg-ink-800 px-3 py-2.5 text-[14px]
                         text-text focus:border-gold-500/45 focus:outline-none"
              aria-label="סינון לפי תאריך קליטה"
            />
            {date && (
              <button
                type="button"
                onClick={() => setDate('')}
                className="rounded-pill border border-black/[0.09] px-2.5 py-2 text-[13px]
                           text-text-faint transition-colors hover:border-gold-500/35 hover:text-gold-600"
                title="הצג לידים מכל התאריכים"
              >
                הכל
              </button>
            )}
          </div>
        }
      />

      <GlassCard>
        <CardHead
          icon={FunnelIcon}
          tone="gold"
          title="לידים מקמפיין"
          subtitle="פניות מקמפיין הפייסבוק — קליטה ומעקב עד הפיכה ללקוח פעיל"
        />
        <Async
          loading={leads.loading}
          error={leads.error}
          onRetry={leads.refetch}
          isEmpty={filtered.length === 0}
          empty={
            <EmptyState
              title={search || status || date ? 'אין ליד שתואם את הסינון' : 'עוד לא נקלטו לידים'}
              hint='כל ליד חדש שמגיע מהקמפיין נרשם כאן, ומשם אפשר להפוך אותו ללקוח פעיל במסלול.'
            />
          }
        >
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.id}
            actions={(row) =>
              row.status === 'converted' ? (
                <span className="text-[13.5px] text-text-faint">
                  {row.converted_customer ? `→ ${row.converted_customer.name}` : 'הומר ללקוח'}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConvertLead(row)}
                  className="ghost-btn whitespace-nowrap px-3 py-2 text-[13.5px]"
                >
                  הפוך ללקוח במסלול
                </button>
              )
            }
          />
        </Async>
      </GlassCard>

      <NewLeadModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={() => { setFormOpen(false); leads.refetch(); }} />

      <ConvertLeadModal
        lead={convertLead}
        onClose={() => setConvertLead(null)}
        onConverted={() => { setConvertLead(null); leads.refetch(); }}
      />
    </>
  );
}

function NewLeadModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(emptyForm());
      setError(null);
    }
  }, [open]);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createLead({
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        city: form.city.trim() || null,
        notes: form.notes.trim() || null,
      });
      onCreated();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="ליד חדש" subtitle="קליטה ידנית של פנייה — לדוגמה מקמפיין הפייסבוק" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="שם מלא" required>
          <TextInput value={form.full_name} onChange={set('full_name')} required />
        </Field>
        <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
          <Field label="טלפון">
            <TextInput dir="ltr" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="עיר">
            <TextInput value={form.city} onChange={set('city')} />
          </Field>
        </div>
        <Field label="הערות">
          <TextArea value={form.notes} onChange={set('notes')} rows={2} />
        </Field>

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
            {error}
          </div>
        )}

        <div className="mt-1 flex gap-2.5">
          <PrimaryButton type="submit" loading={busy}>שמירת ליד</PrimaryButton>
          <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ConvertLeadModal({ lead, onClose, onConverted }) {
  const routes = useQuery(listRoutes, []);
  const [routeName, setRouteName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (lead) {
      setRouteName('');
      setError(null);
    }
  }, [lead]);

  const routeOptions = useMemo(
    () => (routes.data ?? []).filter((r) => r.name).map((r) => ({ value: r.name, label: r.name })),
    [routes.data]
  );

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await convertLeadToCustomer(lead.id, routeName);
      onConverted();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!lead}
      title="הפוך ללקוח במסלול"
      subtitle={lead ? `${lead.full_name}${lead.city ? ` · ${lead.city}` : ''} — הפרטים יועברו ללקוח חדש` : ''}
      onClose={onClose}
    >
      {lead && (
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <div className="rounded-row border border-black/[0.075] bg-black/[0.022] px-3.5 py-3 text-[14px]">
            <div><b className="font-semibold">שם:</b> {lead.full_name}</div>
            <div><b className="font-semibold">טלפון:</b> {lead.phone || '—'}</div>
            <div><b className="font-semibold">עיר:</b> {lead.city || '—'}</div>
          </div>

          <Field
            label="שיוך לקו קיים"
            hint="אפשר גם להשאיר ריק ולשייך את הלקוח לקו מאוחר יותר, מכרטיס הלקוח"
          >
            <Select
              value={routeName}
              onChange={(e) => setRouteName(e.target.value)}
              options={routeOptions}
              placeholder="ללא שיוך לקו כרגע"
            />
          </Field>

          {error && (
            <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
              {error}
            </div>
          )}

          <div className="mt-1 flex gap-2.5">
            <PrimaryButton type="submit" loading={busy}>יצירת לקוח</PrimaryButton>
            <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
          </div>
        </form>
      )}
    </Modal>
  );
}
