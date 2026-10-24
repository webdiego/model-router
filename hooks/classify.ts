// Shared by the mod and bench/run.ts, so the benchmark measures the exact prompt the mod sends.
export const ASK = `You route prompts for a coding assistant. Reply with one word.
SIMPLE: a factual question, explaining a short snippet, a rename, a typo, a one-line or one-file trivial edit, formatting, a shell one-liner, translating text.
COMPLEX: debugging, architecture or design, multi-file changes, refactors, new features, security, performance, anything ambiguous.
When unsure, reply COMPLEX.

Prompt:
<<<
`

export const isCheap = (reply: string) => /^\s*SIMPLE\b/i.test(reply)
