import { useState } from 'react';
import GlassCard, { CardHead } from './ui/GlassCard';
import { StatusChip } from './ui/DataTable';
import { WrenchIcon } from './ui/Icons';
import { Async, EmptyState } from './ui/States';
import { useQuery } from '../hooks/useQuery';
import { useRealtime } from '../hooks/useRealtime';
import { listFieldNotes, resolveFieldNote } from '../lib/queries';
import { describeError } from '../lib/supabase';
import { relativeTime } from '../lib/mappers';

/**
 * מרכז הערות שטח — 2026-09-16, בקשה מפורשת: ריכוז ההערות שהטכנאים
 * מקלידים בזמן ביקור (oil_tracking.notes, קיים) שעדיין לא סומנו כטופלו
 * (field_note_flags, phase38). מנהל בלבד — כמו שאר ווידג'טי הפיקוח
 * בדשבורד (ר' App.jsx: completedVisits/serviceReports גם enabled: isAdmin).
 */
export default function FieldNotesCard({ delay }) {
  const notes = useQuery(() => listFieldNotes({ onlyOpen: true, limit: 20 }), []);
  useRealtime(['oil_tracking', 'field_note_flags'], notes.refetch);

  return (
    <GlassCard delay={delay}>
      <CardHead
        icon={WrenchIcon}
        tone="crit"
        title="הערות שטח פתוחות"
        subtitle={notes.data?.length ? `${notes.data.length} הערות ממתינות לטיפול` : 'מה שהטכנאים דיווחו בזמן ביקור'}
      />

      <Async
        loading={notes.loading}
        error={notes.error}
        onRetry={notes.refetch}
        isEmpty={(notes.data ?? []).length === 0}
        empty={<EmptyState title="אין הערות פתוחות" hint="כל ההערות שנרשמו בזמן ביקור טופלו." />}
      >
        <div className="flex flex-col gap-2.5">
          {(notes.data ?? []).map((note) => (
            <FieldNoteRow key={note.id} note={note} onResolved={notes.refetch} />
          ))}
        </div>
      </Async>
    </GlassCard>
  );
}

function FieldNoteRow({ note, onResolved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function resolve() {
    setError(null);
    setBusy(true);
    try {
      await resolveFieldNote(note.id);
      onResolved();
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <div className="inner-row px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-bold">{note.customerName}</span>
            {note.routeName && <StatusChip tone="gold">{note.routeName}</StatusChip>}
          </div>
          <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-text-dim">{note.notes}</p>
          <div className="mt-1.5 text-[13px] text-text-faint">
            {note.recorderName} · {relativeTime(note.recordedAt)}
          </div>
        </div>

        <button
          type="button"
          onClick={resolve}
          disabled={busy}
          className="ghost-btn flex-none whitespace-nowrap !py-1.5 text-[13.5px] disabled:opacity-50"
        >
          {busy ? 'מסמן…' : 'סמן כטופל'}
        </button>
      </div>

      {error && <div className="mt-1.5 text-[13px] text-crit-soft">{error}</div>}
    </div>
  );
}
