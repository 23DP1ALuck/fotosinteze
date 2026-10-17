import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { listCategories } from '@/features/categories/api'
import type { WorkspaceTransaction } from '@/features/workspaces/TransactionsView'
import type { ProjectCatalog } from '@/features/projects/use-project-catalog'
import { workspaceQueryKey } from '@/features/workspaces/workspace-state'
import { listTransactionAccounts, listTransactions, loadTransactionDashboard } from './api'

export function useWorkspaceFinance(workspaceId: number, enabled: boolean, catalog: ProjectCatalog) {
  const client = useQueryClient()
  const transactionKey = workspaceQueryKey('transactions', workspaceId)
  const transactionQuery = useInfiniteQuery({ queryKey: transactionKey, initialPageParam: 0, queryFn: ({ signal, pageParam }) => listTransactions(workspaceId, pageParam, signal), getNextPageParam: page => page.has_more ? page.offset + page.limit : undefined, enabled })
  const dashboardQuery = useQuery({ queryKey: workspaceQueryKey('dashboard', workspaceId), queryFn: ({ signal }) => loadTransactionDashboard(workspaceId, signal), enabled })
  const accountQuery = useQuery({ queryKey: workspaceQueryKey('accounts', workspaceId), queryFn: ({ signal }) => listTransactionAccounts(workspaceId, signal), enabled })
  const categoryQuery = useQuery({ queryKey: workspaceQueryKey('categories', workspaceId), queryFn: ({ signal }) => listCategories(workspaceId, signal), enabled })
  const rows = transactionQuery.data?.pages.flatMap(page => page.items) ?? []
  const accounts = accountQuery.data ?? []
  const categories = categoryQuery.data ?? []
  const transactions: WorkspaceTransaction[] = rows.map(row => {
    const category = categories.find(item => item.id === row.category_id)
    return {
      id: row.transaction_id, name: row.description || (category?.type === 'income' ? 'Income' : 'Expense'),
      category: category?.name ?? (row.category_id === null ? 'Uncategorised' : `Category #${row.category_id}`), type: category?.type ?? 'unknown', currency: row.currency,
      amount: Number(row.amount) * (category?.type === 'expense' ? -1 : 1), source: row.source === 'MANUAL' ? 'Manual' : row.source === 'BANK' ? 'Revolut' : 'Expense',
      date: row.created_at.slice(0, 10), departmentId: row.department_id ?? undefined, projectId: row.project_id ?? undefined,
      department: catalog.departments.find(item => item.id === row.department_id)?.name,
      project: catalog.projects.find(item => item.id === row.project_id)?.name,
    }
  })
  const error = transactionQuery.error || dashboardQuery.error || categoryQuery.error
  function refresh() {
    for (const feature of ['transactions', 'dashboard', 'accounts', 'categories']) void client.invalidateQueries({ queryKey: workspaceQueryKey(feature, workspaceId) })
  }
  return {
    rows, transactions, dashboard: dashboardQuery.data, accounts,
    dashboardLoading: enabled && dashboardQuery.isPending, dashboardRefreshing: dashboardQuery.isFetching, dashboardError: dashboardQuery.error?.message ?? '',
    transactionsLoading: enabled && transactionQuery.isPending, transactionsRefreshing: transactionQuery.isFetching, transactionsError: transactionQuery.error?.message ?? '',
    metadataError: categoryQuery.error?.message || catalog.error,
    retryDashboard: () => { void dashboardQuery.refetch() }, retryTransactions: () => { void transactionQuery.refetch() },
    retryMetadata: () => { void categoryQuery.refetch(); catalog.refresh() }, loading: enabled && (transactionQuery.isPending || dashboardQuery.isPending || categoryQuery.isPending),
    error: error instanceof Error ? error.message : '', refresh,
    hasMore: transactionQuery.hasNextPage, loadingMore: transactionQuery.isFetchingNextPage,
    loadMore: () => { void transactionQuery.fetchNextPage() },
    options: { accounts, categories, loading: accountQuery.isPending || categoryQuery.isPending, error: (accountQuery.error || categoryQuery.error)?.message ?? '', retry: refresh },
  }
}

export type WorkspaceFinance = ReturnType<typeof useWorkspaceFinance>
