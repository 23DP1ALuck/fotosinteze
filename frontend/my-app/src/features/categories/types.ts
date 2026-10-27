export type WorkspaceKind = 'personal' | 'business'
export type CategoryType = 'income' | 'expense'
export type Category = { id: number; name: string; type: CategoryType; workspaceId: number | null }
export type CategoryInput = Pick<Category, 'name' | 'type'>
