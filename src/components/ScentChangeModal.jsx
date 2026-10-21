import { useEffect, useState } from 'react';
import Modal from './ui/Modal';
import { Field, TextInput, Select, PrimaryButton, SecondaryButton } from './ui/Field';
import { changeDeviceScent } from '../lib/queries';
import { describeError } from '../lib/supabase';

/**
 * "🔄 שינוי ריח" מתוך טאב מסלולים — 2026-10-21, בקשה מפורשת של ליאור: לקוח
 * מבקש להחליף ריח במעמד המילוי. אותו טופס כמו "שונה ריח" בקריאת שירות:
 * ריח חדש, מילוי (יורד מהרכב), ושמן ישן שהוצא (חזר לבקבוק / נשפך).
 * השינוי נכנס מיד — בלי בקשת שינוי לאישור מנהל.
 */
export default function ScentChangeModal({ open, device, scents = [], capacityMl, onClose, onDone }) {
  const [scent, setScent] = useState('');
  const [liters, setLiters] = useState('');
  const [oldLiters, setOldLiters] = useState('');
  const [oldReturned, setOldReturned] = useState('returned');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setScent('');
    setLiters(capacityMl ? String(Math.round(capacityMl / 10) / 100) : '');
    setOldLiters('');
    setOldReturned('returned');
    setError(null);
  }, [open, device?.id, capacityMl]);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    if (!scent) { setError('יש לבחור את הריח החדש'); return; }
    setBusy(true);
    try {
      await changeDeviceScent(device.id, scent, Number(liters) || 0, {
        oldLiters: Number(oldLiters) || 0,
        oldReturned: oldReturned === 'returned',
      });
      onDone?.();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const options = scents
    .map((s) => (typeof s === 'string' ? s : s.name))
    .filter((name) => name && name !== device?.scent_name)
    .map((name) => ({ value: name, label: name }));

  return (
    <Modal
      open={open}
      title="🔄 שינוי ריח"
      subtitle={device ? `${device.model}${device.location_note ? ` · ${device.location_note}` : ''} · היום: ${device.scent_name ?? '—'}` : ''}
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
          <Field label="ריח חדש" required>
            <Select value={scent} onChange={(e) => setScent(e.target.value)} placeholder="בחר ריח" options={options} />
          </Field>
          <Field label="מילוי (ליטר)" hint="יורד מהמלאי הנייד שלך ונרשם ביומן השמן">
            <TextInput type="number" min={0} step={0.01} inputMode="decimal" value={liters}
              onChange={(e) => setLiters(e.target.value)} className="tabular" />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3.5 xs:grid-cols-2">
          <Field label={`שמן ישן שהוצא (ליטר)${device?.scent_name ? ` · ${device.scent_name}` : ''}`}
            hint="רשות — כמה שמן מהריח הישן הוצא מהמכשיר">
            <TextInput type="number" min={0} step={0.01} inputMode="decimal" value={oldLiters}
              onChange={(e) => setOldLiters(e.target.value)} className="tabular" placeholder="0" />
          </Field>
          {Number(oldLiters) > 0 && (
            <Field label="מה נעשה בשמן הישן?">
              <Select value={oldReturned} onChange={(e) => setOldReturned(e.target.value)}
                options={[
                  { value: 'returned', label: 'חזר לבקבוק (נכנס למלאי הנייד)' },
                  { value: 'spilled', label: 'נשפך (שאריות)' },
                ]} />
            </Field>
          )}
        </div>

        {error && (
          <div className="rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5 text-[14px] text-crit-soft">{error}</div>
        )}

        <div className="mt-1 flex gap-2.5">
          <PrimaryButton type="submit" loading={busy}>שמור שינוי ריח</PrimaryButton>
          <SecondaryButton onClick={onClose}>ביטול</SecondaryButton>
        </div>
      </form>
    </Modal>
  );
}
