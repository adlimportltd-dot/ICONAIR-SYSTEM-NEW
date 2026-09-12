import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorFallback from './components/ErrorFallback';
import { initSentry, Sentry } from './lib/sentry';
import './index.css';

initSentry();

const container = document.getElementById('root');

// HMR עלול להריץ את הקובץ הזה שוב — בלי השמירה הזו createRoot היה יוצר
// root שני על אותו אלמנט, והאפליקציה הייתה מוצגת פעמיים זו לצד זו
const root = (container._reactRoot ??= ReactDOM.createRoot(container));

root.render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={ErrorFallback}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
