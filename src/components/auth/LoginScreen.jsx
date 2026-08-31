import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Brand } from '../Sidebar';
import { Field, TextInput, PrimaryButton } from '../ui/Field';

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
        <form onSubmit={submit} className="glass-card w-full max-w-[420px] p-6">
          <div className="mb-6 flex justify-center">
            <Brand compact />
          </div>

          <h1 className="text-center font-display text-[22px] font-bold">
            {mode === 'signin' ? 'כניסה למערכת' : 'יצירת חשבון'}
          </h1>
          <p className="mt-1.5 text-center text-[12.5px] text-text-faint">
            {mode === 'signin'
              ? 'מערכת ניהול השטח של ICON AIR'
              : 'המשתמש הראשון שנרשם מקבל הרשאת מנהל'}
          </p>

          <div className="mt-6 flex flex-col gap-3.5">
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

          <PrimaryButton type="submit" loading={busy} className="mt-5 w-full">
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
    </>
  );
}
