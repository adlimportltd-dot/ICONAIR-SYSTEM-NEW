import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Brand } from '../Sidebar';
import { Field, TextInput, PrimaryButton } from '../ui/Field';
import { AirMarkIcon, iconMap } from '../ui/Icons';

const PITCH_POINTS = [
  { icon: 'route', text: 'מסלולי שטח מדויקים לפי אזור ולפי כתובת בפועל' },
  { icon: 'drop', text: 'מעקב מלאי ריחות בזמן אמת — מה נטען ומה חזר' },
  { icon: 'wrench', text: 'קריאות שירות וסטטוס מכשירים, מסונכרן לכל הצוות' },
];

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ email: '', password: '', fullName: '' });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      if (mode === 'signin') {
        await signIn(form.email.trim(), form.password);
      } else {
        await signUp(form.email.trim(), form.password, form.fullName.trim());
        setNotice('החשבון נוצר. אם Supabase מוגדר לאמת אימייל — אשר את המייל ואז התחבר.');
        setMode('signin');
      }
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="ambient-field" aria-hidden />

      <div className="relative z-[1] flex min-h-screen items-center justify-center p-5">
        <div
          className="grid w-full max-w-[880px] overflow-hidden rounded-card border border-white/[0.09]
                     shadow-lift lg:grid-cols-[1.05fr_1fr]"
          style={{ background: '#ffffff' }}
        >
          {/* --- פאנל מותג: רק במסכים רחבים --- */}
          <div
            className="relative hidden flex-col justify-between overflow-hidden border-e
                       border-white/[0.07] p-9 lg:flex"
            style={{
              background:
                'radial-gradient(120% 140% at 0% 0%, rgba(216,179,106,.14), transparent 60%),' +
                'radial-gradient(120% 140% at 100% 100%, rgba(30,148,138,.07), transparent 55%),' +
                '#fdfbf6',
            }}
          >
            <div>
              <Brand />
              <h2 className="mt-10 font-display text-[26px] font-bold leading-tight">
                ניהול שטח מדויק,
                <br />
                מהמחסן עד הלקוח.
              </h2>
              <p className="mt-3 max-w-[300px] text-[13.5px] leading-relaxed text-text-dim">
                מערכת אחת לכל המסלולים, המכשירים, המלאי והקריאות של ICON AIR — בזמן אמת, בשטח.
              </p>
            </div>

            <div className="flex flex-col gap-4">
              {PITCH_POINTS.map((point) => {
                const Icon = iconMap[point.icon];
                return (
                  <div key={point.text} className="flex items-center gap-3">
                    <div
                      className="grid h-9 w-9 flex-none place-items-center rounded-xl border
                                 border-gold-500/25 bg-gold-500/[0.09] text-gold-300"
                    >
                      {Icon ? <Icon className="h-4 w-4" /> : <AirMarkIcon className="h-4 w-4" />}
                    </div>
                    <span className="text-[12.5px] leading-snug text-text-dim">{point.text}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* --- טופס ההתחברות --- */}
          <form onSubmit={submit} className="p-6 sm:p-9">
            <div className="mb-7 flex justify-center lg:hidden">
              <Brand compact />
            </div>

            <h1 className="font-display text-[22px] font-bold">
              {mode === 'signin' ? 'ברוכים השבים' : 'יצירת חשבון'}
            </h1>
            <p className="mt-1.5 text-[12.5px] text-text-faint">
              {mode === 'signin'
                ? 'התחברו כדי להמשיך למערכת ניהול השטח'
                : 'המשתמש הראשון שנרשם מקבל הרשאת מנהל'}
            </p>

            <div className="mt-7 flex flex-col gap-3.5">
              {mode === 'signup' && (
                <Field label="שם מלא" required>
                  <TextInput
                    value={form.fullName}
                    onChange={set('fullName')}
                    placeholder="אבי כהן"
                    autoComplete="name"
                    required
                  />
                </Field>
              )}

              <Field label="אימייל" required>
                <TextInput
                  type="email"
                  dir="ltr"
                  className="text-start"
                  value={form.email}
                  onChange={set('email')}
                  placeholder="you@iconair.co.il"
                  autoComplete="email"
                  required
                />
              </Field>

              <Field label="סיסמה" required hint={mode === 'signup' ? 'לפחות 6 תווים' : undefined}>
                <TextInput
                  type="password"
                  dir="ltr"
                  className="text-start"
                  value={form.password}
                  onChange={set('password')}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  minLength={6}
                  required
                />
              </Field>
            </div>

            {error && (
              <div className="mt-4 rounded-row border border-crit/25 bg-crit/[0.07] px-3.5 py-2.5
                              text-[12.5px] text-crit-soft">
                {error}
              </div>
            )}

            {notice && (
              <div className="mt-4 rounded-row border border-ok/25 bg-ok/[0.07] px-3.5 py-2.5
                              text-[12.5px] text-ok">
                {notice}
              </div>
            )}

            <PrimaryButton type="submit" loading={busy} className="mt-6 w-full">
              {mode === 'signin' ? 'התחבר' : 'צור חשבון'}
            </PrimaryButton>

            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError(null);
                setNotice(null);
              }}
              className="mt-4 w-full text-center text-[12.5px] text-text-dim transition-colors hover:text-gold-300"
            >
              {mode === 'signin' ? 'אין לך חשבון? הירשם' : 'יש לך כבר חשבון? התחבר'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
