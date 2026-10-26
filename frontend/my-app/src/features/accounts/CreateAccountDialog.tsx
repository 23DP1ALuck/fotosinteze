import { dismissDialogOnBackdropClick } from '@/lib/dialog-backdrop'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { normalizeDecimal } from '@/lib/decimal'
import { useTranslation } from 'react-i18next'
import { financeMessage as f } from '@/i18n/finance-message'
import { KeyboardForm } from '@/components/forms/KeyboardForm'
import { useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { activeWorkspaceId, authAccountId } from '@/features/workspaces/workspace-state'
import { createAccount, type AccountCreate, type ApiAccount } from './api'

export function CreateAccountDialog({ workspaceId, onClose, onCreated }: { workspaceId: number; onClose: () => void; onCreated: () => void }) {
  useTranslation('finance')
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const client = useQueryClient()
  const ownerId = authAccountId()
  const saving = useRef(false)
  const mounted = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { register, trigger, handleSubmit, formState: { errors } } = useForm<AccountCreate>({ defaultValues: { name: '', currency: 'EUR', balance: '' } })
  useEffect(() => {
    const element = dialog.current
    mounted.current = true
    element?.showModal()
    return () => { mounted.current = false; controller.current?.abort(); element?.close() }
  }, [])
  async function save(values: AccountCreate) {
    if (saving.current) return
    if (authAccountId() !== ownerId || activeWorkspaceId() !== workspaceId) { setError('Your workspace or session changed. Close this form and try again.'); return }
    saving.current = true; setBusy(true); setError('')
    controller.current = new AbortController()
    try {
      const account = await createAccount(workspaceId, { name: values.name.trim(), currency: values.currency.trim().toUpperCase(), balance: normalizeDecimal(values.balance) }, controller.current.signal)
      if (authAccountId() !== ownerId) return
      client.setQueryData<ApiAccount[]>(['accounts', ownerId, workspaceId], previous => [...(previous ?? []).filter(row => row.account_id !== account.account_id), account])
      if (mounted.current && activeWorkspaceId() === workspaceId) onCreated()
    } catch (failure) {
      if (mounted.current && !controller.current.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not add this account. Please try again.')
    } finally {
      if (authAccountId() === ownerId) for (const feature of ['accounts', 'dashboard', 'statistics']) void client.invalidateQueries({ queryKey: [feature, ownerId, workspaceId] })
      saving.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const close = () => { if (!saving.current) onClose() }
  return <dialog onClick={dismissDialogOnBackdropClick} ref={dialog} aria-labelledby={titleId} aria-busy={busy} onCancel={event => { event.preventDefault(); close() }} className="m-auto max-h-[calc(100svh-32px)] w-[min(540px,calc(100%_-_32px))] overflow-y-auto rounded-[24px] border-0 bg-white p-7 text-[#193f33] shadow-[0_24px_100px_#102c2330] backdrop:bg-[#102c23]/40 backdrop:backdrop-blur-[4px]">
    <div className="mb-4 flex justify-end"><LanguageSwitcher /></div>
    <div className="flex items-center justify-between gap-3"><h2 id={titleId} className="text-2xl font-semibold!">{f("Add account")}</h2><button type="button" disabled={busy} onClick={close} aria-label={f("Close add account")} className="rounded-lg p-2 hover:bg-[#eaf0e6] disabled:opacity-40"><X size={20} /></button></div>
    <p className="mt-3 text-sm text-[#526259]">{f("Keep each bank account separate, for example Swedbank or Citadele. Enter its current balance to get started.")}</p>
    <p className="mt-3 rounded-xl bg-[#f7f8f2] p-4 text-sm text-[#526259]">{f("This creates a manually tracked account. Balances change when you record transactions or update them yourself.")}</p>
    {error && <p role="alert" className="mt-4 rounded-xl bg-[#fcf0ed] p-4 text-sm text-[#a43b32]">{f(error, true)}</p>}
    <KeyboardForm validateField={trigger} onSubmit={event => { void handleSubmit(save)(event) }} noValidate className="mt-5 space-y-5">
      <fieldset disabled={busy} className="grid gap-5">
        <label className="grid gap-2 text-sm">{f("Account name")}<Input autoFocus aria-label={f("Account name")} placeholder={f("e.g. Swedbank")} maxLength={120} {...register('name', { validate: value => value.trim().length > 0 || 'Account name is required.', maxLength: { value: 120, message: 'Use 120 characters or fewer.' } })} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? `${titleId}-name-error` : undefined} />{errors.name && <span id={`${titleId}-name-error`} role="alert" className="text-xs text-[#a43b32]">{f(errors.name.message, true)}</span>}</label>
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <label className="grid gap-2 text-sm">{f("Currency")}<Input aria-label={f("Currency")} placeholder="EUR" maxLength={3} {...register('currency', { validate: value => /^[A-Z]{3}$/.test(value.trim().toUpperCase()) || 'Enter a three-letter currency code, such as EUR.' })} aria-invalid={Boolean(errors.currency)} aria-describedby={errors.currency ? `${titleId}-currency-error` : undefined} className="uppercase" />{errors.currency && <span id={`${titleId}-currency-error`} role="alert" className="text-xs text-[#a43b32]">{f(errors.currency.message, true)}</span>}</label>
          <label className="grid gap-2 text-sm">{f("Starting balance")}<Input aria-label={f("Starting balance")} inputMode="decimal" placeholder="0.00" className="placeholder:text-[#9aa59c]" {...register('balance', { validate: value => (/^[+-]?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(normalizeDecimal(value)) && Math.abs(Number(normalizeDecimal(value))) <= 99999999.99) || 'Enter a balance between -99,999,999.99 and 99,999,999.99 with up to two decimal places.' })} aria-invalid={Boolean(errors.balance)} aria-describedby={errors.balance ? `${titleId}-balance-error` : undefined} />{errors.balance && <span id={`${titleId}-balance-error`} role="alert" className="text-xs text-[#a43b32]">{f(errors.balance.message, true)}</span>}</label>
        </div>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-3 border-t border-[#e1e5df] pt-5"><button type="button" disabled={busy} onClick={close} className="rounded-xl bg-[#eaf0e6] px-4 py-3 text-sm hover:bg-[#dce6d4] disabled:opacity-40">{f("Cancel")}</button><button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-[#193f33] px-5 py-3 text-sm text-white hover:bg-[#285947] disabled:opacity-40">{busy && <LoaderCircle size={16} className="animate-spin" />}{busy ? f("Adding…") : f("Add account")}</button></div>
    </KeyboardForm>
  </dialog>
}
