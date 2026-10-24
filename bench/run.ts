// Classifier benchmark: sends every prompt of prompts.json to Haiku with the mod's own ASK, and reports how it routed them.
// Run from bench/: npm install && npm start (Node 22.18+ runs the .ts as is). Needs ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { ASK, MAX_TOKENS, isCheap, isFollow } from '../hooks/classify.ts'

type Route = 'SIMPLE' | 'COMPLEX' | 'FOLLOW'
type Case = { prompt: string; expect: Route }

const MODEL = 'claude-haiku-5-5'
// Claude Haiku 5.5, $ per million tokens: input, output.
const INPUT = 0.1
const OUTPUT = 0.5

const cases: Case[] = JSON.parse(readFileSync(new URL('./prompts.json', import.meta.url), 'utf8'))
const client = new Anthropic()

// The mod's reading of a reply: anything it does not recognise stays on the strong model.
const route = (reply: string): Route => (isFollow(reply) ? 'FOLLOW' : isCheap(reply) ? 'SIMPLE' : 'COMPLEX')
// Wrong in the direction that costs quality: a hard task, or a go-ahead for one, that can end up on Haiku.
const risky = (expected: Route, got: Route) => (expected === 'COMPLEX' && got !== 'COMPLEX') || (expected === 'FOLLOW' && got === 'SIMPLE')

let right = 0
let tooCheap = 0
let tooStrong = 0
let dollars = 0
const latencies: number[] = []

for (const c of cases) {
  const start = Date.now()
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // The mod asks for one word; thinking would spend the tokens before it.
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: `${ASK}${c.prompt.slice(0, 4000)}\n>>>` }],
  })
  latencies.push(Date.now() - start)
  dollars += (r.usage.input_tokens * INPUT + r.usage.output_tokens * OUTPUT) / 1e6
  const reply = r.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('').trim()
  const got = route(reply)
  if (got === c.expect) right++
  else if (risky(c.expect, got)) {
    tooCheap++
    console.log(`✗ ${got}, expected ${c.expect}: may reach Haiku  (${reply})  ${c.prompt}`)
  } else {
    tooStrong++
    console.log(`✗ ${got}, expected ${c.expect}: may stay strong  (${reply})  ${c.prompt}`)
  }
}

latencies.sort((a, b) => a - b)
const pct = (n: number) => `${Math.round((n / cases.length) * 100)}%`
const count = (r: Route) => cases.filter(c => c.expect === r).length
console.log(`
prompts             ${cases.length} (${count('SIMPLE')} simple, ${count('COMPLEX')} complex, ${count('FOLLOW')} follow-ups)
routed right        ${right} (${pct(right)})
may reach Haiku     ${tooCheap} (${pct(tooCheap)})   quality risk: a hard task, or a go-ahead for one, answered by Haiku
may stay strong     ${tooStrong} (${pct(tooStrong)})   missed savings or an extra switch only
latency p50 / p95   ${latencies[Math.floor(latencies.length * 0.5)]} ms / ${latencies[Math.floor(latencies.length * 0.95)]} ms
classifier cost     $${(dollars / cases.length).toFixed(6)} per prompt, $${dollars.toFixed(4)} total`)
