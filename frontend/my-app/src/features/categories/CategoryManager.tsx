import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CornerDownRight, Pencil, Plus, Trash2, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import type { Category, WorkspaceKind } from './types'

const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-[10px] bg-[#193f33] px-4 py-3 text-sm text-white hover:bg-[#285947] disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-[10px] bg-[#eaf0e6] px-4 py-3 text-sm text-[#193f33] hover:bg-[#dce6d4]'
const iconButton = 'rounded-lg p-2 text-[#7d877f] hover:bg-[#edf0e8] hover:text-[#193f33]'
const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Use 100 characters or fewer'),
  type: z.enum(['income', 'expense']),
})
type CategoryForm = z.infer<typeof schema>
type Action =
  | { kind: 'create'; parent?: Category }
  | { kind: 'edit'; category: Category }
  | { kind: 'delete'; category: Category }
type Props = { categories: Category[]; onChange: (categories: Category[]) => void }

function CategoryDialog({ action, workspace, categories, onChange, onClose, onSuccess }: Props & {
  action: Action
  workspace: WorkspaceKind
  onClose: () => void
  onSuccess: (message: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const category = action.kind === 'create' ? undefined : action.category
  const parent = action.kind === 'create' ? action.parent : categories.find((item) => item.id === category?.parentId)
  const isSubcategory = Boolean(parent)
  const noun = isSubcategory ? 'subcategory' : 'category'
  const children = categories.filter((item) => item.parentId === category?.id)
  const title = `${action.kind === 'create' ? 'Create' : action.kind === 'edit' ? 'Edit' : 'Delete'} ${noun}`
  const { register, handleSubmit, setError, formState: { errors } } = useForm<CategoryForm>({
    resolver: zodResolver(schema),
    defaultValues: { name: category?.name ?? '', type: parent?.type ?? category?.type ?? 'expense' },
  })

  useEffect(() => { dialog.current?.showModal() }, [])

  const save = handleSubmit((values) => {
    const parentId = parent?.id ?? null
    const duplicate = categories.some((item) =>
      item.workspace === workspace && item.parentId === parentId && item.id !== category?.id &&
      item.name.toLocaleLowerCase() === values.name.toLocaleLowerCase(),
    )
    if (duplicate) {
      setError('name', { message: `A ${noun} with this name already exists here.` }, { shouldFocus: true })
      return
    }
    const type = parent?.type ?? values.type
    if (action.kind === 'create') {
      onChange([...categories, { id: crypto.randomUUID(), name: values.name, type, parentId, workspace }])
    } else {
      onChange(categories.map((item) => item.id === category?.id
        ? { ...item, name: values.name, type }
        : item.parentId === category?.id ? { ...item, type } : item))
    }
    onSuccess(`${isSubcategory ? 'Subcategory' : 'Category'} ${action.kind === 'create' ? 'created' : 'updated'}.`)
    onClose()
  })

  function remove() {
    if (!category || children.length) return
    onChange(categories.filter((item) => item.id !== category.id))
    onSuccess(`${isSubcategory ? 'Subcategory' : 'Category'} deleted.`)
    onClose()
  }

  return (
    <dialog ref={dialog} aria-labelledby="category-dialog-title" onCancel={onClose}
      className="m-auto max-h-[calc(100svh-40px)] w-[min(460px,calc(100%_-_32px))] overflow-y-auto rounded-[18px] border-0 bg-white p-7 text-[#193f33] shadow-[0_20px_80px_#193f3326] backdrop:bg-[#102c23]/35 backdrop:backdrop-blur-[3px]">
      <div className="flex items-center justify-between gap-4">
        <h2 id="category-dialog-title" className="m-0 font-sans! text-[23px] font-semibold!">{title}</h2>
        <button type="button" aria-label="Close category dialog" onClick={onClose} className={iconButton}><X size={20} /></button>
      </div>
      {action.kind === 'delete' ? (
        <div className="mt-5 space-y-5">
          <p className="text-sm">Delete <strong>{category?.name}</strong> from this workspace?</p>
          {children.length > 0 && <p role="alert" className="rounded-lg bg-[#f3f6ed] p-3 text-sm">This category has {children.length} {children.length === 1 ? 'subcategory' : 'subcategories'}. Delete the subcategories first.</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
            <button type="button" onClick={remove} disabled={children.length > 0} className="rounded-[10px] bg-[#a43b32] px-4 py-3 text-sm text-white hover:bg-[#862e27] disabled:cursor-not-allowed disabled:opacity-50">Delete {noun}</button>
          </div>
        </div>
      ) : (
        <form onSubmit={save} noValidate className="mt-5 grid gap-5">
          {parent && <p className="rounded-lg bg-[#f3f6ed] px-3 py-2 text-sm text-[#68796e]">Category: <strong className="text-[#193f33]">{parent.name}</strong></p>}
          <label className="grid gap-2 text-sm">Name
            <Input autoFocus maxLength={100} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'category-name-error' : undefined} {...register('name')} />
            {errors.name && <span id="category-name-error" role="alert" className="text-xs text-[#a43b32]">{errors.name.message}</span>}
          </label>
          {parent ? <p className="text-xs text-[#7d877f]">Type: {parent.type === 'income' ? 'Income' : 'Expense'} · inherited from {parent.name}</p> : (
            <label className="grid gap-2 text-sm">Type
              <select {...register('type')} className="h-11 rounded-lg border border-[#d8d8d0] bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-[#193f33]">
                <option value="expense">Expense</option><option value="income">Income</option>
              </select>
            </label>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
            <button type="submit" className={primaryButton}>{action.kind === 'create' ? `Create ${noun}` : 'Save changes'}</button>
          </div>
        </form>
      )}
    </dialog>
  )
}

export function CategoryManager({ categories, onChange }: Props) {
  const [workspace, setWorkspace] = useState<WorkspaceKind>('personal')
  const [action, setAction] = useState<Action | null>(null)
  const [notice, setNotice] = useState('')
  const workspaceLabel = workspace === 'personal' ? 'Personal' : 'Business'
  const roots = categories.filter((item) => item.workspace === workspace && item.parentId === null)

  function actions(item: Category, subcategory = false) {
    return <div className="flex shrink-0 items-center gap-1">
      {!subcategory && <button type="button" className={iconButton} aria-label={`Add subcategory to ${item.name}`} onClick={() => setAction({ kind: 'create', parent: item })}><Plus size={17} /></button>}
      <button type="button" className={iconButton} aria-label={`Edit ${item.name}`} onClick={() => setAction({ kind: 'edit', category: item })}><Pencil size={16} /></button>
      <button type="button" className={`${iconButton} hover:text-[#a43b32]`} aria-label={`Delete ${item.name}`} onClick={() => setAction({ kind: 'delete', category: item })}><Trash2 size={16} /></button>
    </div>
  }

  return (
    <section className="rounded-2xl bg-white p-6 max-sm:p-[18px]" aria-label="Category management">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="m-0 text-[22px] font-semibold!">Your categories</h2><p className="mt-2 text-xs text-[#7d877f]">Organise income and expenses with categories and subcategories.</p></div>
        <button type="button" onClick={() => setAction({ kind: 'create' })} className={primaryButton}><Plus size={17} />Create category</button>
      </div>
      <div role="group" aria-label="Category workspace" className="mt-6 inline-flex gap-1 rounded-xl bg-[#f3f6ed] p-1">
        {(['personal', 'business'] as const).map((kind) => <button type="button" key={kind} aria-pressed={workspace === kind} onClick={() => { setWorkspace(kind); setNotice('') }} className={`rounded-lg px-4 py-2 text-sm ${workspace === kind ? 'bg-[#193f33] text-white' : 'text-[#7d877f] hover:bg-[#eaf0e6]'}`}>{kind === 'personal' ? 'Personal' : 'Business'}</button>)}
      </div>
      <p className="mt-3 text-xs text-[#7d877f]">{workspaceLabel} workspace · Sample data, changes last for this session</p>
      {notice && <p role="status" className="mt-4 rounded-lg bg-[#eaf0e5] px-4 py-3 text-sm">{notice}</p>}
      {roots.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-[#dce4d8] px-5 py-10 text-center">
          <p className="font-medium">No categories yet</p><p className="mt-2 text-sm text-[#7d877f]">Create the first category for your {workspaceLabel.toLowerCase()} workspace.</p>
        </div>
      ) : (
        <ul aria-label={`${workspaceLabel} categories`} className="mt-5 space-y-3">
          {roots.map((category) => {
            const children = categories.filter((item) => item.workspace === workspace && item.parentId === category.id)
            return <li key={category.id} className="overflow-hidden rounded-xl border border-[#e1e5df]">
              <div role="group" aria-label={`Category ${category.name}`} className="flex items-center justify-between gap-3 bg-[#f7f8f2] px-4 py-3 max-sm:px-3">
                <div className="min-w-0"><strong className="block wrap-anywhere text-sm font-semibold">{category.name}</strong><span className="text-xs text-[#7d877f]">{category.type === 'income' ? 'Income' : 'Expense'} · {children.length} {children.length === 1 ? 'subcategory' : 'subcategories'}</span></div>
                {actions(category)}
              </div>
              {children.length > 0 && <ul aria-label={`Subcategories of ${category.name}`} className="divide-y divide-[#e1e5df]">
                {children.map((child) => <li key={child.id} className="flex items-center justify-between gap-3 py-3 pr-4 pl-7 max-sm:pr-3 max-sm:pl-4">
                  <div className="flex min-w-0 items-center gap-3"><CornerDownRight size={16} className="shrink-0 text-[#98a56c]" aria-hidden /><span className="wrap-anywhere text-sm">{child.name}</span></div>
                  {actions(child, true)}
                </li>)}
              </ul>}
            </li>
          })}
        </ul>
      )}
      {action && <CategoryDialog action={action} workspace={workspace} categories={categories} onChange={onChange} onClose={() => setAction(null)} onSuccess={setNotice} />}
    </section>
  )
}
