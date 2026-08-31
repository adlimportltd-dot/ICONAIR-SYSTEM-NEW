import { useState } from 'react';
import GlassCard from '../components/ui/GlassCard';
import DataTable, { StatusChip } from '../components/ui/DataTable';
import ScreenToolbar from '../components/ui/ScreenToolbar';
import Modal from '../components/ui/Modal';
import { Field, TextInput, TextArea, Select, PrimaryButton, SecondaryButton } from '../components/ui/Field';
import { Async, EmptyState } from '../components/ui/States';
import { useQuery } from '../hooks/useQuery';
import { listCustomers, createCustomer } from '../lib/queries';
import { describeError } from '../lib/supabase';
import { CUSTOMER_STATUS_LABEL } from '../lib/mappers';

const STATUS_TONE = { active: 'ok', onboarding: 'gold', paused: 'warn', churned: 'crit' };

const EMPTY_FORM = {
  name: '', contact_name: '', phone: '', email: '',
  city: '', address: '', route_name: '', status: 'active', notes: '',
};

export default function CustomersScreen() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  const customers = useQuery(() => listCustomers({ search, status }), [search, status]);

  const columns = [
    {
      key: 'name',
      label: 'לקוח',
      width: 'minmax(0,1.6fr)',
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{row.name}</div>
          <div className="truncate text-[11.5px] text-text-faint">{row.address}</div>
        </div>
      ),
    },
    { key: 'contact', label: 'איש קשר', render: (row) => row.contact_name || '—' },
    {
      key: 'phone',
      label: 'טלפון',
      render: (row) => (
        <a href={`tel:${row.phone}`} dir="ltr" className="tabular font-mono text-[12.5px] text-text-dim hover:text-gold-300">
          {row.phone || '—'}
        </a>
      ),
    },
    { key: 'city', label: 'עיר', width: '100px', render: (row) => row.city || '—' },
    { key: 'route', label: 'קו הפצה', width: '110px', render: (row) => row.route_name || 'לא משויך' },
    {
      key: 'devices',
      label: 'מכשירים',
      width: '90px',
      render: (row) => (
        <span className="tabular font-mono text-[13px]">{row.devices?.[0]?.count ?? 0}</span>
      ),
    },
    {
      key: 'status',
      label: 'סטטוס',
      width: '96px',
      render: (row) => (
        <StatusChip tone={STATUS_TONE[row.status]}>{CUSTOMER_STATUS_LABEL[row.status]}</StatusChip>
      ),
    },
  ];

  return (
    <>
      <ScreenToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="חיפוש לפי שם לקוח, איש קשר או עיר…"
        count={customers.data?.length}
        countLabel="לקוחות"
        actionLabel="לקוח חדש"
        onAction={() => setFormOpen(true)}
        filters={[{
          key: 'status',
          value: status,
          onChange: setStatus,
          placeholder: 'כל הסטטוסים',
          options: Object.entries(CUSTOMER_STATUS_LABEL).map(([value, label]) => ({ value, label })),
        }]}
      />

      <GlassCard>
        <Async
          loading={customers.loading}
          error={customers.error}
          onRetry={customers.refetch}
          isEmpty={customers.data?.length === 0}
          empty={
            <EmptyState
              title={search || status ? 'אין לקוח שתואם את החיפוש' : 'עוד לא הוזנו לקוחות'}
              hint={search || status ? 'נסה מונח אחר או נקה את המסנן.' : 'התחל בהוספת הלקוח הראשון — אחר כך אפשר לשייך לו מכשירים.'}
            />
          }
        >
          <DataTable columns={columns} rows={customers.data ?? []} rowKey={(row) => row.id} />
        </Async>
      </GlassCard>

      <NewCustomerModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={() => {
          setFormOpen(false);
          customers.refetch();
        }}
      />
    </>
  );
}

function NewCustomerModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await createCustomer({
        ...form,
        route_name: form.route_name || null,
        email: form.email || null,
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
    <Modal
      open={open}
      title="לקוח חדש"
      subtitle="הלקוח ייווצר מיד ויופיע ברשימה"
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="שם הלקוח" required>
          <TextInput value={form.name} onChange={set('name')} placeholder="מלון דן · תל אביב" required />
        </Field>

        <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
          <Field label="איש קשר">
            <TextInput value={form.contact_name} onChange={set('contact_name')} />
          </Field>
          <Field label="טלפון">
            <TextInput dir="ltr" className="text-start" value={form.phone} onChange={set('phone')} placeholder="03-5202525" />
          </Field>
          <Field label="עיר">
            <TextInput value={form.city} onChange={set('city')} />
          </Field>
          <Field label="כתובת">
            <TextInput value={form.address} onChange={set('address')} />
          </Field>
          <Field label="קו הפצה">
            <TextInput value={form.route_name} onChange={set('route_name')} placeholder="קו מרכז, קו צפון…" />
          </Field>
          <Field label="סטטוס">
            <Select
              value={form.status}
              onChange={set('status')}
              options={Object.entries(CUSTOMER_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Field>
        </div>

        <Field label="הערות">
          <TextArea value={form.notes} onChange={set('notes')} rows={2} />
        </Field>

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[12.5px] text-crit-soft">
            {error}
          </div>
        )}

        <div className="mt-1 flex gap-2.5">
          <PrimaryButton type="submit" loading={busy}>שמור לקוח</PrimaryButton>
          <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
        </div>
      </form>
    </Modal>
  );
}
