import { afterEach, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import { financeMessage } from './finance-message'
import { finance } from './finance'

afterEach(async () => { await i18n.changeLanguage('en') })
describe('finance localization', () => {
  it('retranslates a stored validation message without altering its value', async () => {
    const stored = 'Account name is required.'
    await i18n.changeLanguage('lv')
    expect(financeMessage(stored)).toBe('Norādiet konta nosaukumu.')
    await i18n.changeLanguage('ru')
    expect(financeMessage(stored)).toBe('Укажите название счёта.')
    expect(stored).toBe('Account name is required.')
  })
  it('uses a safe translated fallback for an unknown server error', async () => {
    await i18n.changeLanguage('ru')
    expect(financeMessage('SQL secret failure', true)).toBe('Не удалось выполнить действие. Повторите попытку.')
  })
  it('keeps an HTTP status useful without exposing server details', async () => {
    await i18n.changeLanguage('lv')
    expect(financeMessage('The server returned an error (HTTP 503). Please check the backend logs.', true)).toBe('Servera kļūda (HTTP 503). Mēģiniet vēlreiz.')
  })
  it('uses Latvian and Russian account count forms', async () => {
    await i18n.changeLanguage('lv')
    expect(i18n.t('loadedAccounts', { ns: 'finance', count: 0 })).toBe('Ielādēti 0 Revolut kontu.')
    expect(i18n.t('loadedAccounts', { ns: 'finance', count: 1 })).toBe('Ielādēts 1 Revolut konts.')
    expect(i18n.t('loadedAccounts', { ns: 'finance', count: 2 })).toBe('Ielādēti 2 Revolut konti.')
    await i18n.changeLanguage('ru')
    expect(i18n.t('loadedAccounts', { ns: 'finance', count: 1 })).toBe('Загружен 1 счёт Revolut.')
    expect(i18n.t('loadedAccounts', { ns: 'finance', count: 2 })).toBe('Загружено 2 счёта Revolut.')
    expect(i18n.t('loadedAccounts', { ns: 'finance', count: 5 })).toBe('Загружено 5 счетов Revolut.')
  })
  it('has matching translation keys in all languages', () => {
    const keys = (resource: Record<string, string>) => [...new Set(Object.keys(resource).map(key => key.replace(/_(zero|one|few|many|other)$/, '')))].sort()
    expect(keys(finance.lv)).toEqual(keys(finance.en))
    expect(keys(finance.ru)).toEqual(keys(finance.en))
  })
})
