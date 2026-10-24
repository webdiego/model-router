import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const CHEAP = 'haiku'
// Each model has its own prompt cache, so every switch re-writes the context into the other cache.
const SWITCH_WARN_AT = 3

const ASK = `You route prompts for a coding assistant. Reply with one word.
SIMPLE: a factual question, explaining a short snippet, a rename, a typo, a one-line or one-file trivial edit, formatting, a shell one-liner, translating text.
COMPLEX: debugging, architecture or design, multi-file changes, refactors, new features, security, performance, anything ambiguous.
When unsure, reply COMPLEX.

Prompt:
<<<
`

const showSwitchWarning = atom({ plugin: 'model-router', key: 'showSwitchWarning' } as const, false)

export const isCheap = (reply: string) => /^\s*SIMPLE\b/i.test(reply)

export const register: Register = on => {
  const cheapTurns = new Set<string>()
  let lastWasCheap = false
  let switches = 0

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && e.text.trim() !== '') {
      const r = await $.model.complete({ model: CHEAP, prompt: `${ASK}${e.text.slice(0, 4000)}\n>>>`, maxTokens: 5, effort: 'low', timeoutMs: 4000 })
      // Any failure keeps the session's model: never downgrade by accident.
      const cheap = r.isAnswered && isCheap(r.text)
      if (cheap !== lastWasCheap && ++switches === SWITCH_WARN_AT)
        await update($, showSwitchWarning, () => true)
      lastWasCheap = cheap
      if (lastWasCheap) cheapTurns.add(e.turnId)
      $.ui.status(lastWasCheap ? `⚡ ${CHEAP}` : `🧠 ${await $.session.model()}`)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    return yield* next(e.agentId === undefined && cheapTurns.has(e.turnId) ? { ...e, model: CHEAP } : e)
  })

  // /clear ends the session without reloading the mod, so the count starts over here.
  on('session.end', async ($, e, next) => {
    switches = 0
    lastWasCheap = false
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

  on('turn.complete', ($, e, next) => (cheapTurns.delete(e.turnId), next(e)))
}
