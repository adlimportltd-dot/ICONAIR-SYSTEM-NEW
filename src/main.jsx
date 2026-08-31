import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const container = document.getElementById('root');

// HMR עלול להריץ את הקובץ הזה שוב — בלי השמירה הזו createRoot היה יוצר
// root שני על אותו אלמנט, והאפליקציה הייתה מוצגת פעמיים זו לצד זו
const root = (container._reactRoot ??= ReactDOM.createRoot(container));

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
