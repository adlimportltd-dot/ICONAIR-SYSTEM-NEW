import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured, describeError } from '../lib/supabase';

const AuthContext = createContext(null);

/**
 * מחזיק את ה-session של Supabase ואת הפרופיל שנלווה אליו.
 * התפקיד (admin / technician) נקרא מטבלת profiles ולא מה-JWT,
 * כדי ששינוי הרשאה ייכנס לתוקף בלי שהמשתמש יתחבר מחדש.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    // בלי catch כאן, כשל רשת (למשל 403 באימות מחדש של הטוקן) משאיר
    // את ה-then שמכבה את הטעינה תלוי באוויר לנצח — המסך נשאר "טוען"
    // עד קץ הימים. בכשל אמיתי עדיף להיפתח למסך התחברות מאשר להיתקע.
    supabase.auth.getSession()
      .then(({ data }) => {
        setSession(data.session ?? null);
        if (!data.session) setLoading(false);
      })
      .catch((error) => {
        console.error('בדיקת session נכשלה:', error);
        setSession(null);
        setLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? null);
      if (!next) {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId) return undefined;

    // settled ולא רק cancelled: מונע גם קריאה כפולה אם ה-timeout למטה
    // וה-then "האמיתי" שני-שניהם מגיעים (למשל תשובה שמגיעה ממש אחרי
    // שפג הזמן הקצוב), וגם setState אחרי unmount.
    let settled = false;
    setLoading(true);

    const finish = (nextProfile) => {
      if (settled) return;
      settled = true;
      setProfile(nextProfile);
      setLoading(false);
    };

    supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => finish(data ?? null))
      .catch((error) => {
        console.error('טעינת פרופיל נכשלה:', error);
        finish(null);
      });

    // רשת תקועה בלי כשל/הצלחה ברורים (לא רק המקרה שכבר טופל ב-catch
    // למעלה) — אחרי 12 שניות מפסיקים לחכות בכל מקרה.
    const timeoutId = setTimeout(() => finish(null), 12000);

    return () => {
      settled = true;
      clearTimeout(timeoutId);
    };
  }, [userId]);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(describeError(error));
  }, []);

  const signUp = useCallback(async (email, password, fullName) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw new Error(describeError(error));
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      isAdmin: profile?.role === 'admin',
      signIn,
      signUp,
      signOut,
    }),
    [session, profile, loading, signIn, signUp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth חייב לרוץ בתוך AuthProvider');
  return context;
}
