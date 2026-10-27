import i18n from 'i18next'
const rows = {
  language: ['Language', 'Valoda', 'Язык'],
  title: ['Fotosinteze — Personal and business finances', 'Fotosinteze — Personīgās un uzņēmuma finanses', 'Fotosinteze — Личные финансы и финансы бизнеса'],
  chooseMonth: ['Choose month', 'Izvēlēties mēnesi', 'Выбрать месяц'],
  chooseDate: ['Choose date', 'Izvēlēties datumu', 'Выбрать дату'],
  month: ['month', 'mēnesis', 'месяц'],
  date: ['date', 'datums', 'дата'],
  closeCalendar: ['Close calendar', 'Aizvērt kalendāru', 'Закрыть календарь'],
  openCalendar: ['Open calendar for {{label}}', 'Atvērt kalendāru: {{label}}', 'Открыть календарь: {{label}}'],
  previousMonth: ['Previous month', 'Iepriekšējais mēnesis', 'Предыдущий месяц'],
  previousYear: ['Previous year', 'Iepriekšējais gads', 'Предыдущий год'],
  previousYears: ['Previous years', 'Iepriekšējie gadi', 'Предыдущие годы'],
  nextMonth: ['Next month', 'Nākamais mēnesis', 'Следующий месяц'],
  nextYear: ['Next year', 'Nākamais gads', 'Следующий год'],
  nextYears: ['Next years', 'Nākamie gadi', 'Следующие годы'],
  chooseMonthYear: ['Choose month and year', 'Izvēlēties mēnesi un gadu', 'Выбрать месяц и год'],
  chooseYear: ['Choose year', 'Izvēlēties gadu', 'Выбрать год'],
  thisMonth: ['This month', 'Šis mēnesis', 'Этот месяц'],
  today: ['Today', 'Šodien', 'Сегодня'],
  clear: ['Clear', 'Notīrīt', 'Очистить'],
  calendarHelp: ['Arrow keys to explore · Enter to choose · ', 'Bulttaustiņi pārvieto · Enter izvēlas · ', 'Стрелки для навигации · Enter для выбора · '],
  closeHelp: ['Esc to close', 'Esc aizver', 'Esc для закрытия'],
  invalidMonth: ['Use a valid month in YYYY-MM format.', 'Ievadiet derīgu mēnesi formātā GGGG-MM.', 'Введите корректный месяц в формате ГГГГ-ММ.'],
  invalidDate: ['Use a valid date in YYYY-MM-DD format.', 'Ievadiet derīgu datumu formātā GGGG-MM-DD.', 'Введите корректную дату в формате ГГГГ-ММ-ДД.'],
  dateMinimum: ['Choose {{date}} or later.', 'Izvēlieties {{date}} vai vēlāku datumu.', 'Выберите {{date}} или более позднюю дату.'],
  dateMaximum: ['Choose {{date}} or earlier.', 'Izvēlieties {{date}} vai agrāku datumu.', 'Выберите {{date}} или более раннюю дату.'],
  switchFields: ['Ctrl/⌘+↑/↓ to switch fields', 'Ctrl/⌘+↑/↓ pārvieto starp laukiem', 'Ctrl/⌘+↑/↓ для перехода между полями'],
  saveShortcut: ['Ctrl/⌘+Enter to save', 'Ctrl/⌘+Enter saglabā', 'Ctrl/⌘+Enter для сохранения'],
  shortcuts: ['Ctrl/⌘+↑/↓ to switch fields · Ctrl/⌘+Enter to save', 'Ctrl/⌘+↑/↓ pārvieto starp laukiem · Ctrl/⌘+Enter saglabā', 'Ctrl/⌘+↑/↓ для перехода между полями · Ctrl/⌘+Enter для сохранения'],
  continue: ['Enter to continue', 'Enter turpina', 'Enter для продолжения'],
  openCalendarHint: ['Enter to open calendar', 'Enter atver kalendāru', 'Enter для открытия календаря'],
  newLine: ['Enter for a new line', 'Enter sāk jaunu rindu', 'Enter для новой строки'],
  chooseFile: ['Enter to choose a file', 'Enter izvēlas failu', 'Enter для выбора файла'],
  selectOption: ['Type or use ↑/↓ to choose · Enter to continue', 'Rakstiet vai izmantojiet ↑/↓ izvēlei · Enter turpina', 'Введите текст или выберите с помощью ↑/↓ · Enter для продолжения'],
  select: ['Space to select · Enter to continue', 'Atstarpe izvēlas · Enter turpina', 'Пробел для выбора · Enter для продолжения'],
  reviewed: ['Fields reviewed', 'Lauki pārbaudīti', 'Поля проверены'],
  checkField: ['Check this field before continuing.', 'Pārbaudiet šo lauku pirms turpināšanas.', 'Проверьте это поле перед продолжением.'],
  retryField: ['Please check this field and try again.', 'Lūdzu, pārbaudiet šo lauku un mēģiniet vēlreiz.', 'Проверьте это поле и попробуйте снова.'],
  saveHint: ['Ctrl/⌘+Enter to save, or click the save button.', 'Ctrl/⌘+Enter saglabā; varat arī nospiest saglabāšanas pogu.', 'Для сохранения нажмите Ctrl/⌘+Enter или кнопку сохранения.'],
} satisfies Record<string, [string, string, string]>
const resource = (index: number) => Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[index]]))
export const common = {
  en: { ...resource(0), items_one: '{{count}} item', items_other: '{{count}} items' },
  lv: { ...resource(1), items_zero: '{{count}} ierakstu', items_one: '{{count}} ieraksts', items_other: '{{count}} ieraksti' },
  ru: { ...resource(2), items_one: '{{count}} запись', items_few: '{{count}} записи', items_many: '{{count}} записей', items_other: '{{count}} записи' },
}
const messageKeys = new Map(Object.entries(rows).map(([key, values]) => [values[0], key]))
export function commonMessage(message: string): string {
  if (!message) return message
  const dateLimit = /^Choose (\d{4}-\d{2}(?:-\d{2})?) or (later|earlier)\.$/.exec(message)
  if (dateLimit) return i18n.t(dateLimit[2] === 'later' ? 'dateMinimum' : 'dateMaximum', { ns: 'common', date: dateLimit[1] })
  const key = messageKeys.get(message)
  if (key) return i18n.t(key, { ns: 'common' })
  if (message.includes(' · ')) return message.split(' · ').map(commonMessage).join(' · ')
  return message
}
