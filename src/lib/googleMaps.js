/**
 * אינטגרציית Google Maps (Directions API + Maps JavaScript API) לאופטימיזציית
 * סדר עצירות במסלול — 2026-09-11, בקשה מפורשת. VITE_GOOGLE_MAPS_API_KEY
 * חייב להיות מוגדר גם ב-.env.local (מקומי) וגם במשתני הסביבה של Vercel
 * (production) — הוא נחשף לצד הלקוח בכוונה (כך עובד Maps JavaScript API
 * תמיד; האבטחה מגיעה מהגבלות HTTP-referrer + API-restrictions על המפתח
 * עצמו ב-Google Cloud Console, לא מהסתרתו).
 *
 * ⚠ קריאת ה-REST הישירה ל-Directions API (`fetch` לכתובת
 * maps.googleapis.com/maps/api/directions/json) **חסומה ע"י CORS מדפדפן**
 * — נבדק ישירות, גוגל לא מחזיר Access-Control-Allow-Origin לשימוש כזה
 * (ה-REST API מיועד לשרת בלבד). לכן חובה לטעון את ה-JS SDK המלא
 * (Maps JavaScript API) ולהשתמש ב-google.maps.DirectionsService, לא
 * ב-fetch ישיר — זו הסיבה שהמפתח צריך את *שני* ה-APIs מופעלים, לא רק
 * Directions.
 */

let loaderPromise = null;

/** טעינה עצלה — רק כשבאמת לוחצים על אופטימיזציה, לא בכל טעינת מסך המסלולים. */
function loadGoogleMaps() {
  if (typeof window !== 'undefined' && window.google?.maps?.DirectionsService) {
    return Promise.resolve();
  }
  if (loaderPromise) return loaderPromise;

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) {
    return Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY לא מוגדר במערכת — אין מפתח Google Maps פעיל'));
  }

  loaderPromise = new Promise((resolve, reject) => {
    const callbackName = '__iconairGmapsReady';
    window[callbackName] = () => {
      delete window[callbackName];
      resolve();
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      loaderPromise = null;
      reject(new Error('טעינת Google Maps נכשלה — בדוק חיבור לרשת ונסה שוב'));
    };
    document.head.appendChild(script);
  });
  return loaderPromise;
}

const MAX_GOOGLE_WAYPOINTS = 25; // מגבלת Google Directions API (שכבה רגילה, לא Premium)

const STATUS_LABEL = {
  ZERO_RESULTS: 'גוגל לא מצא מסלול נהיגה בין הכתובות — ודא שהן תקינות',
  OVER_QUERY_LIMIT: 'חריגה ממכסת הבקשות של Google Maps לחשבון הזה',
  REQUEST_DENIED: 'הבקשה נדחתה ע"י גוגל — בדוק שה-API key מאושר ל-Directions API וש-Maps JavaScript API מופעל',
  INVALID_REQUEST: 'בקשה לא תקינה לגוגל (חסרה כתובת מוצא/יעד?)',
  NOT_FOUND: 'אחת הכתובות לא נמצאה ע"י גוגל',
};

function describeDirectionsStatus(status) {
  return STATUS_LABEL[status] ?? `שגיאת Google Maps: ${status}`;
}

/**
 * מחשבת את סדר הביקור היעיל ביותר בין תחנות, לפי Google Directions
 * (optimizeWaypoints). מוצא/יעד = התחנה הראשונה/אחרונה בסדר הנוכחי —
 * אין "מחסן" קבוע במערכת הזו, אז גוגל ממטב רק את מה שביניהן; אלה
 * נשארות קבועות. מחזירה מערך ids מסודר מחדש (לא נוגעת ב-Supabase בעצמה
 * — הקורא ב-RoutesScreen.jsx שומר דרך saveRouteOrder, אותה שיטה בדיוק
 * כמו גרירה/קפיצה-מהירה/מיון-עירוני).
 *
 * `stops`: מערך {id, address}, בסדר הנוכחי על המסך.
 */
export async function optimizeStopOrder(stops) {
  if (stops.length > MAX_GOOGLE_WAYPOINTS) {
    throw new Error(
      `המסלול ארוך מדי לאופטימיזציה חד-פעמית של Google (${stops.length} תחנות, מקסימום ${MAX_GOOGLE_WAYPOINTS}). ` +
      'נסה "מיון לפי עיר/רחוב" למסלולים ארוכים, או פצל לתת-קבוצות.'
    );
  }
  if (stops.length < 3) return stops.map((s) => s.id);

  const missingAddress = stops.find((s) => !s.address);
  if (missingAddress) {
    throw new Error('יש תחנה בלי כתובת — אי אפשר לחשב מסלול איתה. עדכן כתובת בכרטיס הלקוח ונסה שוב.');
  }

  await loadGoogleMaps();

  const origin = stops[0];
  const destination = stops[stops.length - 1];
  const middle = stops.slice(1, -1);

  // ⚠ נבדק ישירות: כשה-API key חסר הרשאה ל-Maps JavaScript API
  // (ApiNotActivatedMapError, נרשם רק ל-console ע"י גוגל), ה-callback של
  // route() לא נקרא בכלל — לא הצלחה, לא שגיאה, שקט מוחלט. בלי timeout
  // מפורש כאן, הכפתור היה נתקע על "מחשב מסלול…" לנצח בלי שום הסבר.
  const ROUTE_TIMEOUT_MS = 15000;
  const service = new google.maps.DirectionsService();
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(
        'Google לא הגיב תוך 15 שניות. בדוק שה-Maps JavaScript API מופעל עבור המפתח הזה ' +
        'ב-Google Cloud Console (נפרד מ-Directions API) — זו הסיבה השכיחה ביותר לתקיעה שקטה כזו.'
      ));
    }, ROUTE_TIMEOUT_MS);

    service.route(
      {
        origin: origin.address,
        destination: destination.address,
        waypoints: middle.map((s) => ({ location: s.address, stopover: true })),
        optimizeWaypoints: true,
        travelMode: google.maps.TravelMode.DRIVING,
        region: 'il',
      },
      (res, status) => {
        clearTimeout(timer);
        if (status === 'OK') resolve(res);
        else reject(new Error(describeDirectionsStatus(status)));
      }
    );
  });

  const optimizedOrder = result.routes[0].waypoint_order; // אינדקסים לתוך `middle`, כבר בסדר היעיל
  return [origin.id, ...optimizedOrder.map((i) => middle[i].id), destination.id];
}
