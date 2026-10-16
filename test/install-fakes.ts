import type { Io } from '../src/install/io.ts'
import type { SetupContext } from '../src/install/run.ts'

/**
 * Подделка консоли установщика: ответы — по очереди из списков, всё напечатанное и все
 * заданные вопросы — в output. Кончились ответы — тест написан неверно, падаем сразу.
 */
export function fakeIo(script: { answers?: string[]; masked?: string[] } = {}) {
  const answers = [...(script.answers ?? [])]
  const masked = [...(script.masked ?? [])]
  const output: string[] = []
  const io: Io = {
    say(text) {
      output.push(text)
    },
    async ask(question) {
      output.push(question)
      const answer = answers.shift()
      if (answer === undefined) throw new Error(`нет ответа на вопрос: ${question}`)
      return answer
    },
    async askMasked(question) {
      output.push(question)
      const answer = masked.shift()
      if (answer === undefined) throw new Error(`нет ответа на вопрос: ${question}`)
      return answer
    },
  }
  return { io, output, text: () => output.join('\n') }
}

type Handler = (url: string, init: RequestInit | undefined) => Response | Error | Promise<Response | Error>

/** Подделка fetch: каждый вызов записывается, ответ даёт обработчик; Error — сеть не дошла. */
export function fakeFetch(handler: Handler) {
  const calls: { url: string; body: unknown }[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ url, body })
    const answer = await handler(url, init)
    if (answer instanceof Error) throw answer
    return answer
  }) as typeof fetch
  return { fetchImpl, calls }
}

export { jsonResponse as json } from './helpers.ts'

/** Часы, которые двигает только sleep: ожидание в 3 минуты проходит мгновенно. */
export function fakeClock(start = 1_760_000_000_000) {
  let now = start
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms
    },
  }
}

export const TOKEN = '8123456789:AAF-test-token-0123456789abcdefghijkl'

export function setupContext(
  overrides: Partial<SetupContext> & { io: Io; fetch: typeof fetch },
): SetupContext {
  const clock = fakeClock()
  return {
    envPath: '/nonexistent/.env',
    existing: {},
    answers: {},
    now: clock.now,
    sleep: clock.sleep,
    ...overrides,
  }
}
