import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { KeyboardForm } from './KeyboardForm'
afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('starts at the second field, wraps to the first and waits for the save shortcut',async()=>{
  const save=vi.fn();const user=userEvent.setup()
  render(<KeyboardForm onSubmit={e=>{e.preventDefault();save()}}><input aria-label="First" required/><input aria-label="Second" required/><input aria-label="Third" required/><button>Save</button></KeyboardForm>)
  await user.click(screen.getByLabelText('Second'));await user.type(screen.getByLabelText('Second'),'Two{Enter}')
  expect(screen.getByLabelText('Third')).toHaveFocus();expect(save).not.toHaveBeenCalled()
  await user.type(screen.getByLabelText('Third'),'Three{Enter}')
  expect(screen.getByLabelText('First')).toHaveFocus();expect(save).not.toHaveBeenCalled()
  await user.type(screen.getByLabelText('First'),'One{Enter}')
  expect(save).not.toHaveBeenCalled()
  await user.keyboard('{Control>}{Enter}{/Control}')
  expect(save).toHaveBeenCalledTimes(1)
})
it('validates the current field with the existing form validator before advancing',async()=>{
  function Form(){const {register,trigger,handleSubmit,formState:{errors}}=useForm<{amount:string;name:string}>();return <KeyboardForm validateField={trigger} onSubmit={handleSubmit(()=>{})} noValidate><input aria-label="Amount" {...register('amount',{validate:value=>Number(value)>0||'Use a positive amount'})} aria-invalid={Boolean(errors.amount)}/>{errors.amount&&<p role="alert">{errors.amount.message}</p>}<input aria-label="Name" {...register('name')}/><button>Save</button></KeyboardForm>}
  render(<Form/>);await userEvent.type(screen.getByLabelText('Amount'),'0{Enter}')
  expect(await screen.findByRole('alert')).toHaveTextContent('positive amount')
  expect(screen.getByLabelText('Amount')).toHaveFocus()
  await userEvent.clear(screen.getByLabelText('Amount'));await userEvent.type(screen.getByLabelText('Amount'),'12{Enter}')
  expect(screen.getByLabelText('Name')).toHaveFocus()
})
it('preserves note newlines, wraps with Ctrl+Down and supports Ctrl+Enter submission',async()=>{
  const save=vi.fn();render(<KeyboardForm onSubmit={e=>{e.preventDefault();save()}}><input aria-label="First"/><textarea aria-label="Note"/><button>Save</button></KeyboardForm>)
  await userEvent.type(screen.getByLabelText('Note'),'Line one{Enter}Line two')
  expect(screen.getByLabelText('Note')).toHaveValue('Line one\nLine two');expect(save).not.toHaveBeenCalled()
  await userEvent.keyboard('{Control>}{ArrowDown}{/Control}');expect(screen.getByLabelText('First')).toHaveFocus()
  await userEvent.keyboard('{Control>}{Enter}{/Control}');expect(save).toHaveBeenCalledTimes(1)
})
it('skips hidden, disabled and readonly controls without including cancel buttons',async()=>{
  const save=vi.fn();render(<KeyboardForm onSubmit={e=>{e.preventDefault();save()}}><input aria-label="First"/><input aria-label="Hidden" hidden/><fieldset disabled><input aria-label="Disabled"/></fieldset><input aria-label="Readonly" readOnly/><div style={{display:'none'}}><input aria-label="Invisible"/></div><input aria-label="Last"/><button type="button">Cancel</button><button>Save</button></KeyboardForm>)
  await userEvent.type(screen.getByLabelText('First'),'One{Enter}');expect(screen.getByLabelText('Last')).toHaveFocus()
  await userEvent.type(screen.getByLabelText('Last'),'Last{Enter}');expect(save).not.toHaveBeenCalled();await userEvent.keyboard('{Control>}{Enter}{/Control}');expect(save).toHaveBeenCalledTimes(1)
})
it('includes newly revealed fields before submitting',async()=>{
  const save=vi.fn()
  function Form(){const [extra,setExtra]=useState(false);return <KeyboardForm onSubmit={e=>{e.preventDefault();save()}}><input aria-label="First"/><select aria-label="Mode" onChange={()=>setExtra(true)}><option value="basic">Basic</option><option value="custom">Custom</option></select>{extra&&<input aria-label="Extra"/>}<button>Save</button></KeyboardForm>}
  render(<Form/>);await userEvent.type(screen.getByLabelText('First'),'One{Enter}');await userEvent.selectOptions(screen.getByLabelText('Mode'),'custom');await userEvent.keyboard('{Enter}')
  expect(screen.getByLabelText('Extra')).toHaveFocus();expect(save).not.toHaveBeenCalled()
  await userEvent.type(screen.getByLabelText('Extra'),'Extra{Enter}');expect(save).not.toHaveBeenCalled();await userEvent.keyboard('{Meta>}{Enter}{/Meta}');expect(save).toHaveBeenCalledTimes(1)
})
it('does not advance during composition, repeated keypresses, or submit while disabled',async()=>{
  const save=vi.fn();render(<KeyboardForm onSubmit={e=>{e.preventDefault();save()}}><input aria-label="First"/><input aria-label="Last"/><button disabled>Save</button></KeyboardForm>)
  const first=screen.getByLabelText('First');first.focus()
  fireEvent.keyDown(first,{key:'Enter',isComposing:true});expect(first).toHaveFocus()
  fireEvent.keyDown(first,{key:'Enter',repeat:true});expect(first).toHaveFocus()
  await userEvent.keyboard('{Control>}{Enter}{/Control}');expect(save).not.toHaveBeenCalled()
})
it('blocks native invalid fields and preserves Shift+Tab',async()=>{
  render(<KeyboardForm><input aria-label="Email" type="email" required/><input aria-label="Second"/><button>Save</button></KeyboardForm>)
  await userEvent.type(screen.getByLabelText('Email'),'invalid{Enter}');expect(screen.getByLabelText('Email')).toHaveFocus()
  await userEvent.click(screen.getByLabelText('Second'));await userEvent.tab({shift:true});expect(screen.getByLabelText('Email')).toHaveFocus()
})
it('does not advance twice while asynchronous field validation is pending',async()=>{
  let finish:(valid:boolean)=>void=()=>{}
  function Form(){const {register,trigger}=useForm<{first:string;second:string;third:string}>();return <KeyboardForm validateField={trigger}><input aria-label="First" {...register('first',{validate:()=>new Promise<boolean>(resolve=>{finish=resolve})})}/><input aria-label="Second" {...register('second')}/><input aria-label="Third" {...register('third')}/><button>Save</button></KeyboardForm>}
  render(<Form/>);const first=screen.getByLabelText('First');first.focus();fireEvent.keyDown(first,{key:'Enter'});fireEvent.keyDown(first,{key:'Enter'});finish(true)
  await waitFor(()=>expect(screen.getByLabelText('Second')).toHaveFocus())
})
it('does not submit accidentally when Enter is pressed on a read-only field',async()=>{
  const save=vi.fn()
  render(<KeyboardForm onSubmit={e=>{e.preventDefault();save()}}><input aria-label="Name"/><input aria-label="Currency" value="EUR" readOnly/><input aria-label="Balance"/><button>Save</button></KeyboardForm>)
  await userEvent.click(screen.getByLabelText('Currency'));await userEvent.keyboard('{Enter}')
  expect(save).not.toHaveBeenCalled();expect(screen.getByLabelText('Balance')).toHaveFocus()
})
it('does not steal focus when a pending validator finishes after the user moves elsewhere',async()=>{
  let finish:(valid:boolean)=>void=()=>{}
  function Form(){const {register,trigger}=useForm<{first:string;second:string;third:string}>();return <KeyboardForm validateField={trigger}><input aria-label="First" {...register('first',{validate:()=>new Promise<boolean>(resolve=>{finish=resolve})})}/><input aria-label="Second" {...register('second')}/><input aria-label="Third" {...register('third')}/><button>Save</button></KeyboardForm>}
  render(<Form/>);const first=screen.getByLabelText('First');first.focus();fireEvent.keyDown(first,{key:'Enter'});await userEvent.click(screen.getByLabelText('Third'));finish(true)
  await waitFor(()=>expect(screen.getByLabelText('Third')).toHaveFocus())
})
it('keeps Space for checkboxes and advances with Enter through a radio group',async()=>{
  const save=vi.fn();render(<KeyboardForm onSubmit={e=>{e.preventDefault();save()}}><input aria-label="Name"/><input type="checkbox" aria-label="Notify"/><input type="radio" name="kind" aria-label="Personal" defaultChecked/><input type="radio" name="kind" aria-label="Business"/><button>Save</button></KeyboardForm>)
  await userEvent.type(screen.getByLabelText('Name'),'Name{Enter}');expect(screen.getByLabelText('Notify')).toHaveFocus()
  await userEvent.keyboard(' {Enter}');expect(screen.getByLabelText('Notify')).toBeChecked();expect(screen.getByLabelText('Personal')).toHaveFocus()
  await userEvent.keyboard('{Enter}');expect(save).not.toHaveBeenCalled();await userEvent.keyboard('{Control>}{Enter}{/Control}');expect(save).toHaveBeenCalledTimes(1)
})

it('switches fields in both directions with Ctrl or Meta arrows, wrapping and skipping unavailable controls',async()=>{
  render(<KeyboardForm><input aria-label="First"/><input aria-label="Readonly" readOnly/><input aria-label="Disabled" disabled/><textarea aria-label="Last"/><button>Save</button></KeyboardForm>)
  screen.getByLabelText('First').focus()
  await userEvent.keyboard('{Control>}{ArrowUp}{/Control}');expect(screen.getByLabelText('Last')).toHaveFocus()
  await userEvent.keyboard('{Meta>}{ArrowDown}{/Meta}');expect(screen.getByLabelText('First')).toHaveFocus()
  await userEvent.keyboard('{Control>}{ArrowDown}{/Control}');expect(screen.getByLabelText('Last')).toHaveFocus()
  await userEvent.keyboard('{Meta>}{ArrowUp}{/Meta}');expect(screen.getByLabelText('First')).toHaveFocus()
})
it('blocks plain Enter on the save button while keeping mouse submission available',async()=>{
  const save=vi.fn();render(<KeyboardForm onSubmit={e=>{e.preventDefault();save()}}><input aria-label="Name"/><button>Save</button></KeyboardForm>)
  screen.getByRole('button',{name:'Save'}).focus();await userEvent.keyboard('{Enter}');expect(save).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button',{name:'Save'}));expect(save).toHaveBeenCalledTimes(1)
  screen.getByRole('button',{name:'Save'}).focus();await userEvent.keyboard('{Meta>}{Enter}{/Meta}');expect(save).toHaveBeenCalledTimes(2)
})
