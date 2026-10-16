import { SetupAborted, type Io } from './io.ts'

/** Что знает установщик на ходу. Шаги читают и дописывают answers. */
export type SetupContext = {
  io: Io
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => number
  /** Куда писать .env */
  envPath: string
  /** Что уже лежит в .env: при обновлении вопросов нет */
  existing: Record<string, string>
  answers: {
    token?: string
    botUsername?: string
    ownerId?: number
  }
}

export type StepResult = { ok: true } | { ok: false; reason: string }

/**
 * Шаг установщика. Шаги — реестр: платная версия добавит свой (например, ключ лицензии)
 * строкой в списке, не трогая скрипты оболочки. Каждый шаг сам решает, нужен ли он: при
 * обновлении токен и владелец уже есть.
 */
export type SetupStep = { id: string; run(ctx: SetupContext): Promise<StepResult> }

/** Код выхода: 0 — .env готов, 1 — шаг не прошёл (причину шаг уже сказал), 130 — Ctrl+C. */
export async function runSetup(steps: readonly SetupStep[], ctx: SetupContext): Promise<number> {
  try {
    for (const step of steps) {
      const result = await step.run(ctx)
      if (!result.ok) {
        ctx.io.say(`\n✗ ${result.reason}\n`)
        return 1
      }
    }
    return 0
  } catch (error) {
    if (error instanceof SetupAborted) {
      ctx.io.say('\nУстановка прервана. Запустите команду ещё раз, когда будете готовы.')
      return 130
    }
    throw error
  }
}
