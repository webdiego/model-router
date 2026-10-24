import { test, expect } from 'claude-code/testing'
import { isCheap } from './classify'
import { cost } from './register'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const band = { plugin: 'model-router', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const

test('the band shows after three switches and Dismiss hides it', async ($, on) => {
  const replies = ['SIMPLE', 'COMPLEX', 'SIMPLE']
  on('model.complete', async () => ({ value: { isAnswered: true, text: replies.shift() ?? 'COMPLEX', usage } }))
  on('session.model', async () => ({ value: 'opus' }))
  on('ui.status', async () => ({ value: undefined }))
  on('turn.start', async ($, e) => ({ turnId: e.turnId }))
  on('ui.render', async () => ({ type: 'Box' }))

  for (let i = 0; i < 2; i++) await $.turn.start({ text: 'q', turnId: `t${i}` })
  expect(await (await $.ui.mount(band)).find({ key: 'dismiss' })).toBeUndefined()

  await $.turn.start({ text: 'q', turnId: 't2' })
  const ui = await $.ui.mount(band)
  expect(await ui.find({ type: 'Text', text: /switched 3 times/ })).toBeDefined()
  await ui.press({ key: 'dismiss' })
  expect(await ui.find({ key: 'dismiss' })).toBeUndefined()
})

test('a Haiku turn shows what it saved against the session model', async ($, on) => {
  const status: (string | undefined)[] = []
  on('model.complete', async () => ({ value: { isAnswered: true, text: 'SIMPLE', usage } }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('ui.status', async ($, e) => (status.push(e.text), { value: undefined }))
  on('turn.start', async ($, e) => ({ turnId: e.turnId }))
  const models: string[] = []
  on('turn.step', async function* ($, e) {
    models.push(e.model)
    const stop = { stopReason: 'end_turn', usage: { ...usage, cache_creation_input_tokens: 10_000, output_tokens: 1000, model: 'claude-haiku-5-5' } } as const
    yield { kind: 'stop', ...stop }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], ...stop }
  })

  await $.turn.start({ text: 'what does ls -la do?', turnId: 't0' })
  const stream = $.turn.step({ turnId: 't0', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of stream);
  await stream.result

  expect(models).toEqual(['haiku'])
  // Haiku: 10k cache writes + 1k output = $0.00175. Opus with a warm cache: 10k reads + 1k output = $0.022.
  expect(status.at(-1)).toBe('⚡ haiku · saved $0.02 (92%)')
})

test('prices tokens per model, cache writes as reads when warm', () => {
  expect(cost({ ...usage, input_tokens: 1e6 }, 'claude-opus-5-5')).toBe(4)
  expect(cost({ ...usage, output_tokens: 1e6 }, 'claude-haiku-5-5')).toBe(0.5)
  expect(cost({ ...usage, cache_creation_input_tokens: 1e6 }, 'claude-opus-5-5')).toBe(5)
  expect(cost({ ...usage, cache_creation_input_tokens: 1e6 }, 'claude-opus-5-5', true)).toBe(0.2)
  expect(cost({ ...usage, input_tokens: 1e6 }, 'some-other-model')).toBe(0)
})

test('parses the router reply, defaulting to the strong model', () => {
  expect(isCheap('SIMPLE')).toBe(true)
  expect(isCheap(' simple.')).toBe(true)
  expect(isCheap('COMPLEX')).toBe(false)
  expect(isCheap('I think SIMPLE')).toBe(false)
  expect(isCheap('')).toBe(false)
})
