export type WorkspaceKind = 'personal' | 'business'
export type CategoryType = 'income' | 'expense'

export type Category = {
  id: string
  name: string
  type: CategoryType
  parentId: string | null
  workspace: WorkspaceKind
}

// Match the existing dashboard's sample categories until the backend exposes CRUD.
export const initialCategories: Category[] = [
  ...['Groceries', 'Transport', 'Subscriptions', 'Shopping', 'Other'].map((name) => ({
    id: `personal-${name.toLowerCase()}`,
    name,
    type: 'expense' as const,
    parentId: null,
    workspace: 'personal' as const,
  })),
  ...['Salary', 'Other income'].map((name) => ({
    id: `personal-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    type: 'income' as const,
    parentId: null,
    workspace: 'personal' as const,
  })),
]
