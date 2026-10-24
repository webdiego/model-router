// Shared by the mod and bench/run.ts, so the benchmark measures the exact prompt the mod sends.
export const ASK = `You route prompts for a coding assistant. Reply with one word.
SIMPLE: a factual question, explaining a short snippet, a rename, a typo, a one-line or one-file trivial edit, formatting, a shell one-liner, translating text.
COMPLEX: debugging, architecture or design, multi-file changes, refactors, new features, security, performance, anything ambiguous.
FOLLOW: a reply that only makes sense with the previous message and asks for nothing new: yes, no, ok, go on, do it, the second one.
When unsure, reply COMPLEX.

Prompt:
<<<
`

// At 5 tokens Haiku's reply came back cut to "SIMPL", so every simple prompt stayed on the strong model.
export const MAX_TOKENS = 16

export const isCheap = (reply: string) => /^\s*SIMPLE\b/i.test(reply)

export const isFollow = (reply: string) => /^\s*FOLLOW\b/i.test(reply)
