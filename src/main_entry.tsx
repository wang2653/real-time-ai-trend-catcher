import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './trends_dashboard';
import { I18nProvider } from './i18n_provider';
import './global_styles.css';

// main frontend src
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
