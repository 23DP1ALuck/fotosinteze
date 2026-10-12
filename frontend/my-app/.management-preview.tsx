import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from './src/features/auth/use-auth'
import HomePage from './src/pages/HomePage'
import './src/index.css'
createRoot(document.getElementById('root')!).render(<AuthContext.Provider value={{status: 'authenticated', user: {id: 1, displayName: 'Jegors D.', email: 'preview@example.com'}, token: null, login: async () => {}, register: async () => {}, logout: async () => {}}}><MemoryRouter><HomePage /></MemoryRouter></AuthContext.Provider>)
