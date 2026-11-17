import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorFallback from './components/ErrorFallback';
import { initSentry, Sentry } from './lib/sentry';
import './index.css';

initSentry();

// פורטל לקוח (phase61): קישור אישי ?portal=TOKEN פותח מסך לקוח נפרד, בלי התחברות
// ובלי לטעון את מסכי המערכת. כל שאר הכתובות ממשיכות לאפליקציה הרגילה כמו קודם.
const isPortal = new URLSearchParams(window.location.search).has('portal');
const PortalApp = lazy(() => import('./portal/PortalApp'));

const container = document.getElementById('root');

// HMR עלול להריץ את הקובץ הזה שוב — בלי השמירה הזו createRoot היה יוצר
// root שני על אותו אלמנט, והאפליקציה הייתה מוצגת פעמיים זו לצד זו
const root = (container._reactRoot ??= ReactDOM.createRoot(container));

root.render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={ErrorFallback}>
      {isPortal ? (
        <Suspense fallback={null}>
          <PortalApp />
        </Suspense>
      ) : (
        <App />
      )}
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
