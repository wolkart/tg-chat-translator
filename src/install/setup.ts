import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { connectivityStep } from './connectivity.ts'
import { readEnvFile, writeEnvStep } from './env-file.ts'
import { createConsoleIo, type Io } from './io.ts'
import { ownerStep } from './owner.ts'
import { runSetup, type SetupStep } from './run.ts'
import { tokenStep } from './token.ts'

/**
 * Вопросы установщика — одни на все пути (Mac, Windows, сервер): скрипты оболочки ставят Node
 * и код, а спрашивает и проверяет этот файл. Новый шаг — новая строка здесь.
 */
export const STEPS: readonly SetupStep[] = [connectivityStep, tokenStep, ownerStep, writeEnvStep]

/** node src/install/setup.ts --env <путь к .env> → код выхода (см. runSetup). */
export async function main(
  argv: string[],
  deps: { io: Io; fetch: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => number },
): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { env: { type: 'string', default: '.env' } } })
  const envPath = resolve(values.env)
  return runSetup(STEPS, { ...deps, envPath, existing: readEnvFile(envPath).values, answers: {} })
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2), {
    io: createConsoleIo(),
    fetch,
    sleep: (ms) => sleep(ms),
    now: Date.now,
  })
  // exit, а не exitCode: открытый ввод терминала иначе держал бы процесс.
  process.exit(code)
}
