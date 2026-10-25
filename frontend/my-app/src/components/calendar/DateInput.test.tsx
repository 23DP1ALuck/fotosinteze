import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { KeyboardForm } from '@/components/forms/KeyboardForm'
import { DateInput } from './DateInput'
import { parseDateValue, dateValue, monthDays } from './date-utils'
afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('validates actual dates including leap years and builds a Monday-first calendar',()=>{
  expect(parseDateValue('2024-02-29','date')).not.toBeNull()
  expect(parseDateValue('2026-02-29','date')).toBeNull()
  expect(parseDateValue('2026-04-31','date')).toBeNull()
  expect(parseDateValue('2026-13','month')).toBeNull()
  expect(parseDateValue('2026-10','month')).not.toBeNull()
  const days=monthDays(new Date(2026,9,1,12))
  expect(days).toHaveLength(42)
  expect(dateValue(days[0],'date')).toBe('2026-09-28')
  expect(dateValue(days[41],'date')).toBe('2026-11-08')
})
it('selects a date through the branded calendar and updates the real input once',async()=>{
  const changed=vi.fn()
  function Form(){const [value,setValue]=useState('2026-10-01');return <label>From date<DateInput calendarLabel="From date" value={value} onChange={e=>{changed(e.target.value);setValue(e.target.value)}}/></label>}
  render(<Form/>);await userEvent.click(screen.getByRole('button',{name:'Open calendar for From date'}))
  await userEvent.click(await screen.findByRole('button',{name:'25 October 2026'}))
  expect(screen.getByLabelText('From date',{exact:true})).toHaveValue('2026-10-25')
  expect(changed).toHaveBeenCalledTimes(1)
  expect(changed).toHaveBeenCalledWith('2026-10-25')
})
it('enforces date boundaries in the calendar',async()=>{
  render(<label>Date<DateInput calendarLabel="Date" defaultValue="2026-10-12" min="2026-10-10" max="2026-10-20"/></label>)
  await userEvent.click(screen.getByRole('button',{name:'Open calendar for Date'}))
  expect(await screen.findByRole('button',{name:'9 October 2026'})).toBeDisabled()
  expect(screen.getByRole('button',{name:'21 October 2026'})).toBeDisabled()
  await userEvent.click(screen.getByRole('button',{name:'Close calendar'}))

})
it('supports month selection and quick year changes without a system month picker',async()=>{
  function Form(){const [value,setValue]=useState('2026-10');return <label>Review month<DateInput type="month" calendarLabel="Review month" value={value} onChange={e=>setValue(e.target.value)}/></label>}
  render(<Form/>);await userEvent.click(screen.getByRole('button',{name:'Open calendar for Review month'}))
  await userEvent.click(await screen.findByRole('button',{name:'Choose year'}))
  await userEvent.click(screen.getByRole('button',{name:'2025'}))
  await userEvent.click(screen.getByRole('button',{name:'February 2025'}))
  expect(screen.getByLabelText('Review month',{exact:true})).toHaveValue('2025-02')
})
it('registers a calendar selection with the existing form validator and save shortcut',async()=>{
  const save=vi.fn()
  function Form(){const {register,trigger,handleSubmit}=useForm<{start:string}>({defaultValues:{start:'2026-10-01'}});return <KeyboardForm validateField={trigger} onSubmit={handleSubmit(save)}><label>Start<DateInput calendarLabel="Start" {...register('start')}/></label><button>Save</button></KeyboardForm>}
  render(<Form/>);await userEvent.click(screen.getByRole('button',{name:'Open calendar for Start'}))
  await userEvent.click(await screen.findByRole('button',{name:'12 October 2026'}))
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Choose date'})).not.toBeInTheDocument())
  screen.getByLabelText('Start',{exact:true}).focus();await userEvent.keyboard('{Control>}{Enter}{/Control}')
  await waitFor(()=>expect(save).toHaveBeenCalled())
  expect(save.mock.calls[0][0]).toEqual({start:'2026-10-12'})
})
it('navigates calendar days with arrow keys without submitting the form',async()=>{
  const save=vi.fn()
  render(<KeyboardForm onSubmit={e=>{e.preventDefault();save()}}><label>Date<DateInput calendarLabel="Date" defaultValue="2026-10-31"/></label><button>Save</button></KeyboardForm>)
  await userEvent.click(screen.getByRole('button',{name:'Open calendar for Date'}))
  const day=await screen.findByRole('button',{name:'31 October 2026'});day.focus()
  await userEvent.keyboard('{ArrowRight}')
  await waitFor(()=>expect(screen.getByRole('button',{name:'1 November 2026'})).toHaveFocus())
  await userEvent.keyboard('{Enter}')
  expect(screen.getByLabelText('Date',{exact:true})).toHaveValue('2026-11-01')
  expect(save).not.toHaveBeenCalled()
})

it('restores enabled day focus after drilling into a partially available month',async()=>{
  render(<DateInput calendarLabel="Date" defaultValue="2026-10-12" min="2026-10-10" max="2026-10-20"/>)
  await userEvent.click(screen.getByRole('button',{name:'Open calendar for Date'}))
  await userEvent.click(await screen.findByRole('button',{name:'Choose month and year'}))
  await userEvent.click(screen.getByRole('button',{name:'October 2026'}))
  await waitFor(()=>expect(screen.getByRole('button',{name:'10 October 2026'})).toHaveFocus())
  expect(screen.getByRole('button',{name:'10 October 2026'})).toHaveAttribute('tabindex','0')
})

it('uses the field as a calendar control and prevents manual typing',async()=>{
  render(<label>Date<DateInput calendarLabel="Date" defaultValue="2026-10-12"/></label>)
  const input=screen.getByLabelText('Date',{exact:true})
  await userEvent.click(input)
  expect(await screen.findByRole('dialog',{name:'Choose date'})).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await userEvent.type(input,'2027-01-01',{skipClick:true})
  expect(input).toHaveValue('2026-10-12')
})
it('hands off a selected first date to the second calendar without submitting',async()=>{
  const save=vi.fn()
  render(<KeyboardForm onSubmit={event=>{event.preventDefault();save()}}><label>From<DateInput calendarLabel="From" defaultValue="2026-10-12" nextCalendarId="range-end"/></label><label>To<DateInput id="range-end" calendarLabel="To" defaultValue="2026-10-20"/></label><button>Save</button></KeyboardForm>)
  await userEvent.click(screen.getByRole('button',{name:'Open calendar for From'}))
  await userEvent.click(await screen.findByRole('button',{name:'15 October 2026'}))
  await waitFor(()=>expect(screen.getByRole('button',{name:'Open calendar for To'})).toHaveAttribute('aria-expanded','true'))
  await waitFor(()=>expect(screen.getByRole('button',{name:'20 October 2026'})).toHaveFocus())
  await userEvent.keyboard('{Enter}')
  await waitFor(()=>expect(screen.getByLabelText('To',{exact:true})).toHaveFocus())
  expect(screen.getByLabelText('From',{exact:true})).toHaveValue('2026-10-15')
  expect(save).not.toHaveBeenCalled()
})

it('keeps field shortcuts working while a calendar-only field is expanded',async()=>{
  render(<KeyboardForm><label>From<DateInput defaultValue="2026-10-12"/></label><label>To<DateInput defaultValue="2026-10-20"/></label><button>Save</button></KeyboardForm>)
  await userEvent.click(screen.getByLabelText('From',{exact:true}))
  await screen.findByRole('dialog',{name:'Choose date'})
  await userEvent.keyboard('{Control>}{ArrowDown}{/Control}')
  await waitFor(()=>expect(screen.getByLabelText('To',{exact:true})).toHaveFocus())
})
