import { atom, read, update } from 'claude-code'
import type { ModelUsage, Register } from 'claude-code'
import { ASK, MAX_TOKENS, isCheap } from './classify'

const CHEAP = 'haiku'
// Each model has its own prompt cache, so every switch re-writes the context into the other cache.
const SWITCH_WARN_AT = 3

// $ per million tokens (input, output, cache read) of the 5.5 generation; a cache write costs 1.25× input.
// shortcut: matched by family, so older versions (Opus 4.x at $5/$25) are priced as 5.5; match exact ids if that matters.
const PRICES: [RegExp, number, number, number][] = [
  [/fable|mythos/i, 10, 50, 0.25],
  [/opus/i, 4, 20, 0.2],
  [/sonnet/i, 2, 10, 0.2],
  [/haiku/i, 0.1, 0.5, 0.01],
]

const showSwitchWarning = atom({ plugin: 'model-router', key: 'showSwitchWarning' } as const, false)

// warm: price cache writes as reads, as for a model whose cache no switch ever cooled. Unknown models cost 0.
export const cost = (u: ModelUsage, model: string, warm = false) => {
  const p = PRICES.find(([re]) => re.test(model))
  if (!p) return 0
  const [, input, output, read] = p
  const write = warm ? read : input * 1.25
  return (u.input_tokens * input + u.output_tokens * output + u.cache_read_input_tokens * read + u.cache_creation_input_tokens * write) / 1e6
}

export const register: Register = on => {
  const cheapTurns = new Set<string>()
  const switchedTurns = new Set<string>()
  let lastWasCheap = false
  let switches = 0
  // What the session cost with the router (classifier included), and what the same steps would have cost on the session's model.
  let spent = 0
  let baseline = 0
  let label = ''

  const saved = () => baseline > 0 ? ` · saved $${(baseline - spent).toFixed(2)} (${Math.round((1 - spent / baseline) * 100)}%)` : ''

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && e.text.trim() !== '') {
      const r = await $.model.complete({ model: CHEAP, prompt: `${ASK}${e.text.slice(0, 4000)}\n>>>`, maxTokens: MAX_TOKENS, effort: 'low', timeoutMs: 4000 })
      if (r.isAnswered) spent += cost(r.usage, CHEAP)
      // Any failure keeps the session's model: never downgrade by accident.
      const cheap = r.isAnswered && isCheap(r.text)
      if (cheap !== lastWasCheap) {
        switchedTurns.add(e.turnId)
        if (++switches === SWITCH_WARN_AT) await update($, showSwitchWarning, () => true)
      }
      lastWasCheap = cheap
      if (lastWasCheap) cheapTurns.add(e.turnId)
      label = lastWasCheap ? `⚡ ${CHEAP}` : `🧠 ${await $.session.model()}`
      $.ui.status(label + saved())
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const stream = next(cheapTurns.has(e.turnId) ? { ...e, model: CHEAP } : e)
    for await (const chunk of stream) {
      if (chunk.kind === 'stop' && chunk.usage) {
        spent += cost(chunk.usage, chunk.usage.model)
        // e.model is the session's model; without the router its cache would have stayed warm through a switch.
        baseline += cost(chunk.usage, e.model, switchedTurns.has(e.turnId) && e.index === 0)
        $.ui.status(label + saved())
      }
      yield chunk
    }
    return stream.result
  })

  // /clear ends the session without reloading the mod, so the count starts over here.
  on('session.end', async ($, e, next) => {
    switches = 0
    lastWasCheap = false
    spent = 0
    baseline = 0
    await update($, showSwitchWarning, () => false)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, showSwitchWarning))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text color="yellow">Model switched {SWITCH_WARN_AT} times: each switch rebuilds the prompt cache. </Text>
        <Button key="clear" label="New session" onPress={() => $.command.run({ command: 'clear' })} />
        <Text> </Text>
        <Button key="dismiss" label="Dismiss" onPress={() => update($, showSwitchWarning, () => false)} />
      </Box>
    )
  })

  on('turn.complete', ($, e, next) => (cheapTurns.delete(e.turnId), switchedTurns.delete(e.turnId), next(e)))
}
