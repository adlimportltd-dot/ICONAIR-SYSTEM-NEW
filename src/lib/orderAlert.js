/**
 * התראת "הזמנה חדשה מהאתר" (phase51) — צליל + הבהוב בכותרת הלשונית.
 *
 * הצליל מסונתז ב-Web Audio (שני צלילי פעמון קצרים), בלי קובץ שמע חיצוני.
 * דפדפנים חוסמים שמע עד שהמשתמש לוחץ/מקליד בדף לפחות פעם אחת — לכן
 * unlockOrderSound() נרשם ללחיצה הראשונה ו"מעיר" את ה-AudioContext מראש,
 * כך שהצליל יעבוד גם כשההזמנה נכנסת בזמן שאף אחד לא נוגע במסך.
 *
 * העדפת "צליל פעיל/כבוי" נשמרת בדפדפן הנוכחי בלבד (לכל מכשיר בנפרד).
 */

const SOUND_KEY = 'iconair:web-order-sound';
let ctx = null;

function getContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  return ctx;
}

export function isOrderSoundEnabled() {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setOrderSoundEnabled(enabled) {
  try {
    window.localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off');
  } catch {
    // מצב גלישה פרטית וכו' — פשוט לא נשמר, לא קריטי
  }
}

/** נקרא פעם אחת ב-App: מעיר את מנוע השמע בלחיצה/הקשה הראשונה בדף. */
export function unlockOrderSound() {
  const wake = () => {
    const audio = getContext();
    if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
  };
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
  return () => {
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
  };
}

function bell(audio, frequency, start, duration, peak) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** "דינג-דונג" קצר ועולה — מזוהה, לא מבהיל. */
export function playOrderChime({ force = false } = {}) {
  if (!force && !isOrderSoundEnabled()) return;
  const audio = getContext();
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  const t = audio.currentTime + 0.02;
  bell(audio, 880, t, 0.45, 0.32);
  bell(audio, 1318.5, t + 0.18, 0.7, 0.28);
  bell(audio, 1760, t + 0.36, 0.9, 0.18);
}

let flashTimer = null;
let originalTitle = null;

/** מהבהב בכותרת הלשונית עד שחוזרים אליה — למקרה שהמערכת פתוחה ברקע. */
export function flashTitle(message) {
  if (typeof document === 'undefined') return;
  if (originalTitle === null) originalTitle = document.title;
  if (flashTimer) clearInterval(flashTimer);

  let on = false;
  flashTimer = setInterval(() => {
    on = !on;
    document.title = on ? message : originalTitle;
  }, 1000);

  const stop = () => {
    if (document.visibilityState !== 'visible') return;
    clearInterval(flashTimer);
    flashTimer = null;
    document.title = originalTitle;
    originalTitle = null;
    document.removeEventListener('visibilitychange', stop);
    window.removeEventListener('focus', stop);
  };

  // אם הלשונית כבר מול העיניים — מספיק הבהוב קצר
  if (document.visibilityState === 'visible' && document.hasFocus()) {
    setTimeout(stop, 6000);
  }
  document.addEventListener('visibilitychange', stop);
  window.addEventListener('focus', stop);
}
