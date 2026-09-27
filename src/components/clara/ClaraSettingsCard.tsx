import { useEffect, useState } from 'react';
import GlassCard, { CardHead } from '../ui/GlassCard';
import { SettingsIcon } from '../ui/Icons';
import { Field, TextInput, TextArea, PrimaryButton } from '../ui/Field';
import { saveClaraSettings, CLARA_MODELS, type ClaraSettings } from '../../lib/clara';

interface Props {
  settings: ClaraSettings | null;
  onSaved: () => void;
  onToast: (t: { message: string; tone?: 'ok' | 'crit' | 'gold' }) => void;
}

/** הגדרות קלרה: מפתח Anthropic (נשמר בשרת בלבד), מודל, קול המותג וקצב פרסום */
export default function ClaraSettingsCard({ settings, onSaved, onToast }: Props) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState('claude-sonnet-5');
  const [notes, setNotes] = useState('');
  const [perDay, setPerDay] = useState(2);
  const [gap, setGap] = useState(4);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setModel(settings.model);
    setNotes(settings.brand_notes);
    setPerDay(settings.max_posts_per_day);
    setGap(settings.min_gap_hours);
  }, [settings]);

  async function save() {
    if (!settings?.ai_configured && !key.trim()) { onToast({ tone: 'crit', message: 'הדבק מפתח API של Anthropic' }); return; }
    if (key.trim() && !/^sk-ant-/.test(key.trim())) { onToast({ tone: 'crit', message: 'מפתח של Anthropic מתחיל ב-sk-ant-' }); return; }
    setBusy(true);
    try {
      await saveClaraSettings({ key: key.trim() || undefined, model, brandNotes: notes, maxPerDay: perDay, minGap: gap });
      setKey('');
      onToast({ message: 'ההגדרות של קלרה נשמרו' });
      onSaved();
    } catch (e) {
      onToast({ tone: 'crit', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard>
      <CardHead icon={SettingsIcon} tone={settings?.ai_configured ? 'slate' : 'gold'} title="הגדרות קלרה"
        subtitle={settings?.ai_configured ? `מחוברת ל-Claude (מפתח ${settings.key_hint})` : 'שלב אחרון: לחבר את קלרה ל-AI'} />
      <div className="flex flex-col gap-3.5">
        <Field label="מפתח API של Anthropic"
          hint={<>יוצרים ב-<a className="font-semibold text-gold-600 hover:underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>. נשמר בשרת בלבד ולא נחשף בדפדפן.</>}>
          <TextInput dir="ltr" type="password" autoComplete="off" value={key}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKey(e.target.value)}
            placeholder={settings?.ai_configured ? `שמור (${settings.key_hint}) — ריק = ללא שינוי` : 'sk-ant-…'} />
        </Field>
        <Field label="מודל">
          <select value={model} onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-pill border border-[#E2E8F0] bg-ink-800 px-4 py-3 text-[15px] font-medium text-text">
            {CLARA_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            {!CLARA_MODELS.some((m) => m.value === model) && <option value={model}>{model}</option>}
          </select>
        </Field>
        <Field label="קול המותג — הנחיות קבועות לקלרה" hint="למשל: לפנות בלשון רבים, לא להשתמש במילה 'יוקרתי', להזכיר תמיד שירות בצפון">
          <TextArea rows={3} value={notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="מקסימום פוסטים ביום">
            <TextInput type="number" min={1} max={6} value={perDay} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPerDay(Math.max(1, Math.min(6, Number(e.target.value))))} />
          </Field>
          <Field label="מרווח מינימלי (שעות)">
            <TextInput type="number" min={1} max={24} value={gap} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGap(Math.max(1, Math.min(24, Number(e.target.value))))} />
          </Field>
        </div>
        <div><PrimaryButton onClick={save} loading={busy}>שמירה</PrimaryButton></div>
      </div>
    </GlassCard>
  );
}
