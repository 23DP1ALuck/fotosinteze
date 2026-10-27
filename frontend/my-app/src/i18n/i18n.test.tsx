import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n, { detectLanguage, getLocale, resources, setLanguage } from './index'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

afterEach(async () => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); await i18n.changeLanguage('en') })
describe('language preferences', () => {
  it('normalizes supported regional variants and prefers explicit choices', () => {
    expect(detectLanguage('ru', ['lv-LV'])).toBe('ru')
    expect(detectLanguage('invalid', ['de-DE', 'lv-LV'])).toBe('lv')
    expect(detectLanguage(null, ['ru-RU'])).toBe('ru')
    expect(detectLanguage(null, ['de-DE'])).toBe('en')
  })
  it('persists language and updates document metadata and locale', async () => {
    await setLanguage('lv')
    expect(localStorage.getItem('fotosinteze.language')).toBe('lv')
    expect(document.documentElement.lang).toBe('lv')
    expect(getLocale()).toBe('lv-LV')
  })
  it('works when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    await setLanguage('ru')
    expect(i18n.language).toBe('ru')
  })
  it('switches accessibly without remounting existing form input', async () => {
    const user = userEvent.setup()
    render(<><LanguageSwitcher /><input aria-label="Draft" defaultValue="unchanged" /></>)
    await user.type(screen.getByRole('textbox'), ' draft')
    await user.click(screen.getByRole('button', { name: 'Latviešu' }))
    expect(screen.getByRole('button', { name: 'Latviešu' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('textbox')).toHaveValue('unchanged draft')
  })
  it('falls back to English and supports Latvian and Russian plural forms', async () => {
    await act(() => i18n.changeLanguage('ru'))
    expect(i18n.t('language', { ns: 'common' })).toBe('Язык')
    expect(i18n.t('items', { ns: 'common', count: 2 })).toBe('2 записи')
    expect(i18n.t('items', { ns: 'common', count: 5 })).toBe('5 записей')
    await i18n.changeLanguage('lv')
    expect(i18n.t('items', { ns: 'common', count: 0 })).toBe('0 ierakstu')
    expect(i18n.t('items', { ns: 'common', count: 1 })).toBe('1 ieraksts')
    expect(i18n.t('items', { ns: 'common', count: 2 })).toBe('2 ieraksti')
    await i18n.changeLanguage('de')
    expect(i18n.t('language', { ns: 'common' })).toBe('Language')
  })
  it('has matching nonempty translation resources', () => {
    function keys(value: object, prefix = ''): string[] { return Object.entries(value).flatMap(([key, child]) => typeof child === 'object' ? keys(child, `${prefix}${key}.`) : (expect(String(child).trim()).not.toBe(''), [`${prefix}${key}`])) }
    // Plural suffixes follow the grammar of each language; compare their base keys.
    const normalized = (value: object) => [...new Set(keys(value).map(key => key.replace(/_(zero|one|two|few|many|other)$/, '')))].sort()
    expect(normalized(resources.lv)).toEqual(normalized(resources.en))
    expect(normalized(resources.ru)).toEqual(normalized(resources.en))
  })
})
