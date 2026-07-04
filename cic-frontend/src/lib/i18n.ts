import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// TODO: swap Backend plugin for production (loads from /locales instead of bundled)
// For now translations are fetched from /public/locales at runtime.
i18n.use(initReactI18next).init({
  lng: localStorage.getItem('locale') ?? 'en',
  fallbackLng: 'en',
  supportedLngs: ['en', 'sw'],
  interpolation: { escapeValue: false },
  resources: {},
  // Load translation JSON files from /public/locales
  // This is a minimal inline approach; install i18next-http-backend for lazy loading.
});

// Dynamically load locale JSON so we don't bloat the bundle
async function loadLocale(lang: string) {
  try {
    const res = await fetch(`/locales/${lang}/translation.json`);
    const json = await res.json();
    i18n.addResourceBundle(lang, 'translation', json, true, true);
    await i18n.changeLanguage(lang);
  } catch {
    // Fall back silently to English if locale file is missing
  }
}

// Load initial locale
loadLocale(i18n.language);

export function setLocale(lang: string) {
  localStorage.setItem('locale', lang);
  loadLocale(lang);
}

export default i18n;
