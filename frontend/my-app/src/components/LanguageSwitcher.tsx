import { useTranslation } from 'react-i18next'
import { setLanguage, type Language } from '@/i18n'

const languages: { code: Language; name: string }[] = [
  { code: 'en', name: 'English' }, { code: 'lv', name: 'Latviešu' }, { code: 'ru', name: 'Русский' },
]
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common')
  const selectedIndex = Math.max(0, languages.findIndex(({ code }) => code === i18n.resolvedLanguage))
  return <div role="group" aria-label={t('language')} className="relative inline-grid shrink-0 grid-cols-3 gap-1 rounded-xl border border-[#82965b]/40 bg-[#f7f8f2] p-1 text-[#193f33]">
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-1 left-1 w-[calc((100%_-_1rem)/3)] rounded-lg bg-[#193f33] transition-transform duration-[420ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none" style={{ transform: `translateX(calc(${selectedIndex} * (100% + 0.25rem)))` }} />
    {languages.map(({ code, name }) => <button key={code} type="button" aria-label={name} title={name} aria-pressed={i18n.resolvedLanguage === code} onClick={() => { void setLanguage(code) }} className="relative z-10 min-h-10 min-w-10 rounded-lg px-2 text-xs font-semibold transition-colors duration-[420ms] motion-reduce:transition-none hover:bg-[#e1e8d9] aria-pressed:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#193f33] aria-pressed:text-white">{code.toUpperCase()}</button>)}
  </div>
}
