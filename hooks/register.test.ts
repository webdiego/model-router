import { test, expect } from 'claude-code/testing'
import { isCheap } from './register'

test('the band shows after three switches and Dismiss hides it', async ($, on) => {
  const replies = ['SIMPLE', 'COMPLEX', 'SIMPLE']
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('model.complete', async () => ({ value: { isAnswered: true, text: replies.shift() ?? 'COMPLEX', usage } }))
  on('session.model', async () => ({ value: 'opus' }))
  on('ui.status', async () => ({ value: undefined }))
  on('turn.start', async ($, e) => ({ turnId: e.turnId }))
  on('ui.render', async () => ({ type: 'Box' }))

  const band = { plugin: 'model-router', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5 } } as const
  for (let i = 0; i < 2; i++) await $.turn.start({ text: 'q', turnId: `t${i}` })
  expect(await (await $.ui.mount(band)).find({ key: 'dismiss' })).toBeUndefined()

  await $.turn.start({ text: 'q', turnId: 't2' })
  const ui = await $.ui.mount(band)
  expect(await ui.find({ type: 'Text', text: /switched 3 times/ })).toBeDefined()
  await ui.press({ key: 'dismiss' })
  expect(await ui.find({ key: 'dismiss' })).toBeUndefined()
})

test('parses the router reply, defaulting to the strong model', () => {
  expect(isCheap('SIMPLE')).toBe(true)
  expect(isCheap(' simple.')).toBe(true)
  expect(isCheap('COMPLEX')).toBe(false)
  expect(isCheap('I think SIMPLE')).toBe(false)
  expect(isCheap('')).toBe(false)
})
