import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { isCheap } from './classify'
import { cheaper, cost } from './register'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const band = { plugin: 'model-router', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const
const MIN = 60_000

// Stands in for the engine: Haiku answers the scripted replies, every step reports `tokens` on the model it ran on.
const engine = (on: On, replies: string[], tokens: Partial<typeof usage> = {}) => {
  const status: (string | undefined)[] = []
  const models: string[] = []
  on('model.complete', async () => ({ value: { isAnswered: true, text: replies.shift() ?? 'COMPLEX', usage } }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('ui.status', async ($, e) => (status.push(e.text), { value: undefined }))
  on('turn.start', async ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    models.push(e.model)
    const stop = { stopReason: 'end_turn', usage: { ...usage, ...tokens, model: e.model === 'haiku' ? 'claude-haiku-5-5' : e.model } } as const
    yield { kind: 'stop', ...stop }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], ...stop }
  })
  return { status, models }
}

const turn = async ($: Engine, turnId: string, text: string) => {
  await $.turn.start({ text, turnId })
  const stream = $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of stream);
  await stream.result
}

test('the band shows after three switches and Dismiss hides it', async ($, on) => {
  mock.clock(on)
  engine(on, ['SIMPLE', 'COMPLEX', 'SIMPLE'])
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
  mock.clock(on)
  const { status, models } = engine(on, ['SIMPLE'], { cache_creation_input_tokens: 10_000, output_tokens: 1000 })

  await turn($, 't0', 'what does ls -la do?')

  expect(models).toEqual(['haiku'])
  // Haiku: 10k cache writes + 1k output = $0.00175. Opus with a warm cache: 10k reads + 1k output = $0.022.
  expect(status.at(-1)).toBe('⚡ haiku · saved $0.02 (92%)')
})

test('a simple prompt stays on Opus when its cache would expire before the next turn', async ($, on) => {
  const clock = mock.clock(on)
  const { status, models } = engine(on, ['COMPLEX', 'SIMPLE'], { cache_creation_input_tokens: 50_000, output_tokens: 500 })

  await turn($, 't0', 'refactor the auth module')
  // 4.5 minutes later, the next turn most likely comes after the 5-minute cache would have expired.
  await clock.advance(4.5 * MIN)
  await turn($, 't1', 'what does ls -la do?')

  expect(models).toEqual(['claude-opus-5-5', 'claude-opus-5-5'])
  expect(status.at(-1)).toMatch(/^🧠 claude-opus-5-5 \(keeps its cache\)/)
})

test('weighs both caches before sending a simple turn to Haiku', () => {
  const now = 100 * MIN
  const at = (context: number, strongAgo: number, cheapAgo = Infinity) =>
    cheaper({ context, output: 500, gapMs: MIN, strongAt: now - strongAgo, cheapAt: now - cheapAgo, now }, 'claude-opus-5-5')

  // Opus warm and the next turn well within its 5 minutes: Haiku costs less even writing its cache cold.
  expect(at(50_000, 1 * MIN)).toBe(true)
  // Opus cache about to expire on a big context: refreshing it on Opus beats re-writing it later.
  expect(at(50_000, 4.5 * MIN, 0.5 * MIN)).toBe(false)
  // The same moment on a small context: the re-write is cheap, Haiku still wins.
  expect(at(1_000, 4.5 * MIN)).toBe(true)
  // Opus cache already cold: it has nothing left to keep.
  expect(at(50_000, 10 * MIN)).toBe(true)
  // An unpriced session model: no basis to refuse.
  expect(cheaper({ context: 50_000, output: 500, gapMs: MIN, strongAt: now, cheapAt: now, now }, 'some-other-model')).toBe(true)
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
