// Classifier benchmark: sends every prompt of prompts.json to Haiku with the mod's own ASK, and reports how it routed them.
// Run from bench/: npm install && npm start (Node 22.18+ runs the .ts as is). Needs ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { ASK, MAX_TOKENS, isCheap } from '../hooks/classify.ts'

type Case = { prompt: string; simple: boolean }

const MODEL = 'claude-haiku-5-5'
// Claude Haiku 5.5, $ per million tokens: input, output.
const INPUT = 0.1
const OUTPUT = 0.5

const cases: Case[] = JSON.parse(readFileSync(new URL('./prompts.json', import.meta.url), 'utf8'))
const client = new Anthropic()

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
  const reply = r.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('')
  const cheap = isCheap(reply)
  if (cheap === c.simple) right++
  else if (cheap) {
    tooCheap++
    console.log(`✗ Haiku, needed the strong model  (${reply.trim()})  ${c.prompt}`)
  } else {
    tooStrong++
    console.log(`✗ strong model, Haiku could do it  (${reply.trim()})  ${c.prompt}`)
  }
}

latencies.sort((a, b) => a - b)
const pct = (n: number) => `${Math.round((n / cases.length) * 100)}%`
console.log(`
prompts             ${cases.length}
routed right        ${right} (${pct(right)})
sent to Haiku wrong ${tooCheap} (${pct(tooCheap)})   quality risk: a hard task answered by Haiku
kept strong wrong   ${tooStrong} (${pct(tooStrong)})   missed savings only
latency p50 / p95   ${latencies[Math.floor(latencies.length * 0.5)]} ms / ${latencies[Math.floor(latencies.length * 0.95)]} ms
classifier cost     $${(dollars / cases.length).toFixed(6)} per prompt, $${dollars.toFixed(4)} total`)
