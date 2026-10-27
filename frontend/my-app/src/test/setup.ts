import '@testing-library/jest-dom/vitest'

import i18n from '@/i18n'
import { beforeEach } from 'vitest'
beforeEach(async () => { localStorage.removeItem('fotosinteze.language'); await i18n.changeLanguage('en') })
