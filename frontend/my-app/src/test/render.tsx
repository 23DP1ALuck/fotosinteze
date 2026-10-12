import { render as testingRender, type RenderOptions } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryProvider } from '@/lib/QueryProvider'
export function render(ui: ReactNode, options?: RenderOptions) { return testingRender(ui, { wrapper: QueryProvider, ...options }) }
