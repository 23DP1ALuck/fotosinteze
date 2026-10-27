import { useTranslation } from 'react-i18next'
import { setLanguage, type Language } from '@/i18n'

const languages: { code: Language; name: string }[] = [
  { code: 'en', name: 'English' }, { code: 'lv', name: 'Latviešu' }, { code: 'ru', name: 'Русский' },
]
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common')
  return <div role="group" aria-label={t('language')} className="inline-flex shrink-0 flex-wrap gap-1 rounded-xl border border-[#82965b]/40 bg-[#f7f8f2] p-1 text-[#193f33]">
    {languages.map(({ code, name }) => <button key={code} type="button" aria-label={name} title={name} aria-pressed={i18n.resolvedLanguage === code} onClick={() => { void setLanguage(code) }} className="min-h-10 min-w-10 rounded-lg px-2 text-xs font-semibold transition-colors hover:bg-[#e1e8d9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#193f33] aria-pressed:bg-[#193f33] aria-pressed:text-white">{code.toUpperCase()}</button>)}
  </div>
}
