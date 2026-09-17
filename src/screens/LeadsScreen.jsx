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
import {
  listLeads, createLead, deleteLead, updateLeadStatus, updateLead, convertLeadToCustomer, listRoutes,
  listLeadStatuses, createLeadStatus, setLeadStatusActive,
} from '../lib/queries';
import { describeError } from '../lib/supabase';
import { formatDateTime, formatFacebookAnswer, dedupeRepeatedText } from '../lib/mappers';

// "הומר ללקוח" הוא מצב-סיום אוטומטי קבוע (נקבע רק ע"י convert_lead_to_customer,
// phase37) — לא מנוהל בטבלת lead_statuses ולא נבחר ידנית מהתפריט. כל שאר
// הסטטוסים (2026-09-17, בקשה מפורשת: "תאפשר להוסיף סטטוסים נוספים") מגיעים
// עכשיו מ-lead_statuses בבסיס הנתונים, לא קבועים בקוד — ר' phase42.
const CONVERTED_LABEL = 'הומר ללקוח';

const emptyForm = () => ({ full_name: '', phone: '', city: '', notes: '' });

export default function LeadsScreen() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [date, setDate] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [convertLead, setConvertLead] = useState(null);
  const [editingLead, setEditingLead] = useState(null);
  const [managingStatuses, setManagingStatuses] = useState(false);

  const leads = useQuery(() => listLeads({ status, date }), [status, date]);
  useRealtime(['leads'], leads.refetch);

  const leadStatuses = useQuery(listLeadStatuses, []);
  useRealtime(['lead_statuses'], leadStatuses.refetch);

  // אפשרויות "לבחור סטטוס חדש" — רק פעילות, ובלי 'converted' (זה לא
  // נבחר ידנית). אפשרויות "לסנן לפי" — כל הסטטוסים (גם מושבתים, כדי
  // שאפשר יהיה עדיין לסנן לפי סטטוס ישן) + 'converted'.
  const assignableStatusOptions = useMemo(
    () => (leadStatuses.data ?? []).filter((s) => s.active).map((s) => ({ value: s.name, label: s.label })),
    [leadStatuses.data]
  );
  const filterStatusOptions = useMemo(
    () => [...(leadStatuses.data ?? []).map((s) => ({ value: s.name, label: s.label })), { value: 'converted', label: CONVERTED_LABEL }],
    [leadStatuses.data]
  );
  const statusLabelByName = useMemo(() => {
    const map = { converted: CONVERTED_LABEL };
    for (const s of leadStatuses.data ?? []) map[s.name] = s.label;
    return map;
  }, [leadStatuses.data]);

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

  // 2026-09-17 (בקשה מפורשת: "העמודות לא יושבות מיושרות תחת הכותרות") —
  // הבאג האמיתי: minmax(0, Nfr) על lead/notes נתן להן רצפה של 0px, וכש-
  // סכום העמודות הקבועות + כפתורי הפעולה חרג מרוחב הכרטיס בפועל (קורה
  // כבר במסך דסקטופ רגיל, לא רק צר) — ה-grid כיווץ בדיוק את שתי העמודות
  // הגמישות האלה ל-0 כדי להישאר בגבולות, בלי לגלוש ובלי שגיאה — כל
  // התוכן פשוט "נעלם" ושאר העמודות נראו זזות שורה שלמה שמאלה. עכשיו לכל
  // עמודה גמישה יש רצפה אמיתית (minmax(Npx, ...)) שלעולם לא מתאפסת,
  // והעמודות הקבועות צומצמו לרוחב שבאמת דרוש (התוכן ממילא נחתך ב-truncate
  // הקיים ב-DataTable אם צריך).
  const columns = [
    {
      key: 'lead',
      label: 'ליד',
      width: 'minmax(110px,1.2fr)',
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{row.full_name}</div>
          {row.city && <div className="truncate text-[13px] text-text-faint">{dedupeRepeatedText(row.city)}</div>}
        </div>
      ),
    },
    {
      key: 'phone',
      label: 'טלפון',
      width: '132px',
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
      width: '140px',
      render: (row) => {
        if (row.status === 'converted') return <StatusChip tone="ok">{CONVERTED_LABEL}</StatusChip>;
        // אם הסטטוס הנוכחי של הליד הושבת בינתיים (ר' "ניהול סטטוסים") —
        // עדיין מציגים אותו כאפשרות נבחרת, אחרת ה-<select> הרגיל של
        // הדפדפן "יבחר" בשקט אפשרות אחרת והתצוגה תשקר לגבי המצב האמיתי.
        const options = assignableStatusOptions.some((o) => o.value === row.status)
          ? assignableStatusOptions
          : [{ value: row.status, label: statusLabelByName[row.status] ?? row.status }, ...assignableStatusOptions];
        return (
          <Select
            value={row.status}
            onChange={(event) => changeStatus(row, event.target.value)}
            options={options}
            className="!w-auto min-w-[118px] !py-1.5 text-[13.5px]"
            onClick={(event) => event.stopPropagation()}
          />
        );
      },
    },
    { key: 'notes', label: 'הערות', width: 'minmax(90px,1fr)', render: (row) => row.notes || '—' },
    // 2026-09-17 (בקשה מפורשת: שתי שאלות ההסמכה מטופס הפייסבוק, כבר
    // נשמרות ע"י Make.com בעמודות business_size/installation_time —
    // כאן רק תצוגה, שום שינוי בשליפה עצמה (listLeads כבר select('*')).
    { key: 'business_size', label: 'גודל העסק', width: '104px', render: (row) => formatFacebookAnswer(row.business_size) || '—' },
    { key: 'installation_time', label: 'זמן התקנה', width: '104px', render: (row) => formatFacebookAnswer(row.installation_time) || '—' },
    {
      key: 'at',
      label: 'התקבל',
      width: '96px',
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
          { key: 'status', value: status, onChange: setStatus, placeholder: 'כל הסטטוסים', options: filterStatusOptions },
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
            {/* 2026-09-17 (בקשה מפורשת: "תאפשר להוסיף סטטוסים נוספים") */}
            <button
              type="button"
              onClick={() => setManagingStatuses(true)}
              className="rounded-pill border border-black/[0.09] px-2.5 py-2 text-[13px]
                         text-text-faint transition-colors hover:border-gold-500/35 hover:text-gold-600"
            >
              ניהול סטטוסים
            </button>
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
          {/* 2026-09-17: רשת רחבה (7 עמודות + פעולות) — רשת עמודות שלמה
              עדיין העדיפות (ר' ההערה מעל columns), אבל overflow-x-auto
              הוא רשת-ביטחון: על חלון דסקטופ צר במיוחד עדיף גלילה אופקית
              מקומית על פני חיתוך תוכן. */}
          <div className="overflow-x-auto">
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.id}
            onRowClick={(row) => setEditingLead(row)}
            actions={(row) => (
              <>
                {row.status === 'converted' ? (
                  <span className="text-[13.5px] text-text-faint">
                    {row.converted_customer ? `→ ${row.converted_customer.name}` : 'הומר ללקוח'}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); setConvertLead(row); }}
                    className="ghost-btn whitespace-nowrap px-2.5 py-2 text-[13.5px]"
                    title="הפוך ללקוח במסלול"
                  >
                    הפוך ללקוח
                  </button>
                )}
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); setEditingLead(row); }}
                  className="ghost-btn whitespace-nowrap px-2.5 py-2 text-[13.5px]"
                >
                  עריכה
                </button>
              </>
            )}
          />
          </div>
        </Async>
      </GlassCard>

      <NewLeadModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={() => { setFormOpen(false); leads.refetch(); }} />

      <ConvertLeadModal
        lead={convertLead}
        onClose={() => setConvertLead(null)}
        onConverted={() => { setConvertLead(null); leads.refetch(); }}
      />

      <EditLeadModal
        lead={editingLead}
        statusOptions={assignableStatusOptions}
        statusLabelByName={statusLabelByName}
        onClose={() => setEditingLead(null)}
        onSaved={() => { setEditingLead(null); leads.refetch(); }}
        onDeleted={() => { setEditingLead(null); leads.refetch(); }}
      />

      <ManageStatusesModal
        open={managingStatuses}
        statuses={leadStatuses.data ?? []}
        onClose={() => setManagingStatuses(false)}
        onChanged={leadStatuses.refetch}
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
      subtitle={lead ? `${lead.full_name}${lead.city ? ` · ${dedupeRepeatedText(lead.city)}` : ''} — הפרטים יועברו ללקוח חדש` : ''}
      onClose={onClose}
    >
      {lead && (
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <div className="rounded-row border border-black/[0.075] bg-black/[0.022] px-3.5 py-3 text-[14px]">
            <div><b className="font-semibold">שם:</b> {lead.full_name}</div>
            <div><b className="font-semibold">טלפון:</b> {lead.phone || '—'}</div>
            <div><b className="font-semibold">עיר:</b> {lead.city ? dedupeRepeatedText(lead.city) : '—'}</div>
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

/**
 * עריכת ליד — 2026-09-17, בקשה מפורשת: "מערכת CRM ניהולית" עם הערות
 * מעקב אישיות וניהול סטטוס נוח לכל ליד. מעדכן בדיוק את אותו ליד
 * (updateLead(lead.id, ...)), לא יוצר שורה חדשה. ליד שכבר "הומר ללקוח"
 * מנעול-סטטוס (רק ר' ConvertLeadModal יכול לקבוע converted) — עדיין
 * אפשר לערוך לו הערות, רק לא "לבטל" את ההמרה מכאן.
 */
function EditLeadModal({ lead, statusOptions, statusLabelByName, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (lead) {
      setForm({ status: lead.status, notes: lead.notes ?? '' });
      setError(null);
      setConfirmingDelete(false);
    } else {
      // תיקון-באג ידוע (ר' ServiceCallsScreen/EditCallModal, 2026-09-16):
      // בלי זה form נשאר truthy אחרי סגירה, ו-{form && ...} עדיין קורא
      // לשדות lead.* על lead שהוא null (ה-JSX מוערך ע"י React בקומפוננטה
      // הזו לפני ש-Modal בפנים מחליט לא לרנדר).
      setForm(null);
    }
  }, [lead]);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const patch = { notes: form.notes.trim() || null };
      if (lead.status !== 'converted') patch.status = form.status;
      await updateLead(lead.id, patch);
      onSaved();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setError(null);
    setDeleteBusy(true);
    try {
      await deleteLead(lead.id);
      onDeleted();
    } catch (caught) {
      setError(describeError(caught));
      setDeleteBusy(false);
    }
  }

  // אם הסטטוס הנוכחי הושבת בינתיים — עדיין מציגים אותו כאפשרות נבחרת (ר' אותה הגנה בטבלה למעלה).
  const currentStatusOptions = lead && !statusOptions.some((o) => o.value === lead.status)
    ? [{ value: lead.status, label: statusLabelByName[lead.status] ?? lead.status }, ...statusOptions]
    : statusOptions;

  return (
    <Modal
      open={Boolean(lead)}
      title={lead ? `עריכת ליד — ${lead.full_name}` : 'עריכת ליד'}
      subtitle={lead?.city ? dedupeRepeatedText(lead.city) : undefined}
      onClose={onClose}
    >
      {form && lead && (
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <div className="rounded-row border border-black/[0.075] bg-black/[0.022] px-3.5 py-3 text-[14px] leading-relaxed">
            <div><b className="font-semibold text-text">טלפון:</b> {lead.phone || '—'}</div>
            {lead.business_size && (
              <div><b className="font-semibold text-text">גודל העסק:</b> {formatFacebookAnswer(lead.business_size)}</div>
            )}
            {lead.installation_time && (
              <div><b className="font-semibold text-text">זמן התקנה מבוקש:</b> {formatFacebookAnswer(lead.installation_time)}</div>
            )}
          </div>

          <Field label="סטטוס">
            {lead.status === 'converted' ? (
              <div className="chip text-ok border-ok/25 bg-ok/10 !inline-flex !py-3 !text-[15px]">
                {statusLabelByName.converted}{lead.converted_customer ? ` — ${lead.converted_customer.name}` : ''}
              </div>
            ) : (
              <Select value={form.status} onChange={set('status')} options={currentStatusOptions} />
            )}
          </Field>

          <Field label="הערות מעקב" hint='עדכונים אישיים על הליד — למשל "דיברתי איתו, רוצה התקנה בשבוע הבא"'>
            <TextArea value={form.notes} onChange={set('notes')} rows={4} />
          </Field>

          {error && (
            <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
              {error}
            </div>
          )}

          {/* 2026-09-17 (בקשה מפורשת: "כפתור מחיקת ליד... עם הודעת אישור
              קטנה כדי לא למחוק בטעות") — אישור דו-שלבי מוטבע, לא native
              confirm(), עקבי עם שאר המערכת. */}
          {confirmingDelete ? (
            <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-3">
              <div className="mb-2.5 text-[14px] font-semibold text-crit-soft">
                למחוק את הליד לצמיתות? אי אפשר לבטל את זה.
              </div>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={deleteBusy}
                  className="rounded-pill border border-crit/40 bg-crit/10 px-4 py-2 text-[14px]
                             font-bold text-crit-soft transition-colors hover:border-crit/60 disabled:opacity-40"
                >
                  {deleteBusy ? 'מוחק…' : 'כן, מחק לצמיתות'}
                </button>
                <SecondaryButton onClick={() => setConfirmingDelete(false)} disabled={deleteBusy}>ביטול</SecondaryButton>
              </div>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2.5">
              <PrimaryButton type="submit" loading={busy}>שמור שינויים</PrimaryButton>
              <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="ghost-btn ms-auto !border-crit/30 !text-crit-soft"
              >
                מחק ליד
              </button>
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}

/**
 * ניהול סטטוסים — 2026-09-17, בקשה מפורשת: "תאפשר להוסיף סטטוסים
 * נוספים לרשימה הנפתחת". הוספה/השבתה בלבד — לא מחיקה, כדי שלידים
 * ישנים עם סטטוס שהושבת ימשיכו להציג תווית עברית תקינה (ר' ההגנה
 * בטבלה/במודל העריכה למעלה) במקום המפתח הפנימי הגולמי.
 */
function ManageStatusesModal({ open, statuses, onClose, onChanged }) {
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setNewLabel('');
      setError(null);
    }
  }, [open]);

  async function addStatus(event) {
    event.preventDefault();
    if (!newLabel.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await createLeadStatus(newLabel);
      setNewLabel('');
      onChanged();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(s) {
    setError(null);
    try {
      await setLeadStatusActive(s.id, !s.active);
      onChanged();
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return (
    <Modal
      open={open}
      title="ניהול סטטוסים"
      subtitle="הוסף סטטוס מותאם אישית לרשימה, או השבת סטטוס קיים"
      onClose={onClose}
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-2">
          {statuses.length === 0 && <div className="text-[14px] text-text-faint">טוען…</div>}
          {statuses.map((s) => (
            <div key={s.id} className="inner-row flex items-center justify-between gap-3 px-3.5 py-2.5">
              <span className={`text-[14.5px] ${s.active ? 'font-semibold' : 'text-text-faint line-through'}`}>
                {s.label}
              </span>
              <button type="button" onClick={() => toggle(s)} className="ghost-btn px-3 py-1.5 text-[13px]">
                {s.active ? 'השבת' : 'הפעל'}
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={addStatus} className="flex gap-2">
          <TextInput
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder='סטטוס חדש, למשל "לחזור בעוד שבוע"'
          />
          <PrimaryButton type="submit" loading={busy} className="!px-4">הוסף</PrimaryButton>
        </form>

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">
            {error}
          </div>
        )}

        <SecondaryButton onClick={onClose}>סגור</SecondaryButton>
      </div>
    </Modal>
  );
}
