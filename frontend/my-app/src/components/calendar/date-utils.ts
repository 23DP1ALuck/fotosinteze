export type DatePrecision = 'date' | 'month'
export function localDate(year: number, month: number, day = 1) {
  const date = new Date(0)
  date.setFullYear(year, month, day)
  date.setHours(12, 0, 0, 0)
  return date
}
export function dateValue(date: Date, precision: DatePrecision) {
  const month = `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`
  return precision === 'month' ? month : `${month}-${String(date.getDate()).padStart(2, '0')}`
}
export function parseDateValue(value: string, precision: DatePrecision): Date | null {
  if (!(precision === 'month' ? /^\d{4}-(0[1-9]|1[0-2])$/ : /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/).test(value)) return null
  const [year, month, day = 1] = value.split('-').map(Number)
  if (year < 1 || year > 9999 || day < 1 || day > 31) return null
  const date = localDate(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}
export function monthDays(date: Date) {
  const first = localDate(date.getFullYear(), date.getMonth())
  const offset = (first.getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, index) => localDate(date.getFullYear(), date.getMonth(), index - offset + 1))
}
export function shiftMonth(date: Date, amount: number) {
  const first = localDate(date.getFullYear(), date.getMonth() + amount)
  const last = localDate(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return localDate(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), last))
}
export function dateError(value: string, precision: DatePrecision, min?: string, max?: string) {
  if (!value) return ''
  if (!parseDateValue(value, precision)) return precision === 'month' ? 'Use a valid month in YYYY-MM format.' : 'Use a valid date in YYYY-MM-DD format.'
  if (min && parseDateValue(min, precision) && value < min) return `Choose ${min} or later.`
  if (max && parseDateValue(max, precision) && value > max) return `Choose ${max} or earlier.`
  return ''
}
