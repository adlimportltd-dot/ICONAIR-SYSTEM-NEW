import { useEffect, useState } from 'react';

/**
 * מצב חיבור לרשת. navigator.onLine בודק רק "יש כרטיס רשת פעיל" —
 * לא בהכרח "יש אינטרנט אמיתי" (רשת סלולרית בלי קליטה, Wi-Fi בלי
 * חיבור-החוצה) — אבל זה עדיין האינדיקציה הכי טובה שקיימת בלי לירות
 * בקשת רשת משלנו כל כמה שניות רק כדי לבדוק. האירועים online/offline
 * תופסים את רוב המקרים האמיתיים בשטח (מנהרה, אזור מת, מצב טיסה).
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}
