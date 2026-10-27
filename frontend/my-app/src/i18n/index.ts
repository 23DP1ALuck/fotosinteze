import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { admin } from './admin'
import { finance } from './finance'
import { pages } from './pages'
import { insights } from './insights'
import { common } from './common'

export type Language = 'en' | 'lv' | 'ru'
const storageKey = 'fotosinteze.language'
const supported = ['en', 'lv', 'ru'] as const
function normalize(value: string | null | undefined): Language | undefined {
  const base = value?.toLowerCase().split('-')[0]
  return supported.find(language => language === base)
}
export function detectLanguage(saved: string | null, browserLanguages: readonly string[]): Language {
  return normalize(saved) ?? browserLanguages.map(normalize).find(Boolean) ?? 'en'
}
function initialLanguage(): Language {
  let saved: string | null = null
  try { saved = localStorage.getItem(storageKey) } catch { /* Storage can be denied in private browsing. */ }
  return detectLanguage(saved, typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language])
}
export const resources = Object.fromEntries(supported.map(language => [language, {
  common: common[language], pages: pages[language], finance: finance[language], admin: admin[language], insights: insights[language],
}])) as Record<Language, { common: typeof common.en; pages: typeof pages.en; finance: typeof finance.en; admin: typeof admin.en; insights: typeof insights.en }>

function updateDocument(language: string) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = normalize(language) ?? 'en'
  document.documentElement.dir = 'ltr'
  document.title = i18n.t('title', { ns: 'common' })
}
i18n.on('languageChanged', updateDocument)
void i18n.use(initReactI18next).init({
  resources, lng: initialLanguage(), fallbackLng: 'en', supportedLngs: [...supported],
  defaultNS: 'common', initAsync: false, interpolation: { escapeValue: false },
  react: { useSuspense: false },
})
export async function setLanguage(language: Language) {
  try { localStorage.setItem(storageKey, language) } catch { /* The current session can still switch languages. */ }
  await i18n.changeLanguage(language)
}
export function getLocale(): string {
  return ({ en: 'en-GB', lv: 'lv-LV', ru: 'ru-RU' })[normalize(i18n.resolvedLanguage ?? i18n.language) ?? 'en']
}
export default i18n
