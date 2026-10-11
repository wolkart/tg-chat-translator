/**
 * Замер стойкости перевода к подмене (tasks.md 12.1). Не тест: ходит в модель с ключом
 * из .env и тратит деньги — около $0.05 за прогон у gpt-4.1-mini.
 *
 * Запуск: node scripts/eval-injection.ts [--runs=3] [--provider=openrouter] [--model=<id>] [--only=1,2,19]
 * --model принимает любой id провайдера, не только из таблицы: так сравниваются кандидаты.
 * Итог — в консоль. Сырые ответы — в data/eval/<время>.json (data/ в .gitignore):
 * провалы смотреть глазами.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createScrubber } from '../src/alerts.ts'
import { loadEnv } from '../src/env.ts'
import { getProfile } from '../src/lang/profiles.ts'
import { reviewTranslation } from '../src/translate/check.ts'
import { createTranslator } from '../src/translate/llm.ts'
import { resolveModel } from '../src/translate/providers.ts'
import type { Review } from '../src/types.ts'
import { CASES, scoreRun, type EvalCase, type Outcome } from './injection-cases.ts'

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key = '', value = ''] = arg.replace(/^--/, '').split('=')
    return [key, value] as const
  }),
)

const loaded = loadEnv()
if (!loaded.ok) {
  console.error(`Не заполнено в .env: ${loaded.missing.join(', ')}`)
  process.exit(1)
}
const { env } = loaded
// Ошибка провайдера иногда цитирует запрос — ключ в консоль попасть не должен.
const scrub = createScrubber(env.secrets)

const resolved = resolveModel({ provider: args.get('provider') }, env)
if (!resolved.ok) {
  console.error(resolved.problem)
  process.exit(1)
}
const model = args.get('model') || resolved.model
const runs = Number(args.get('runs') || 3)
const only = args.get('only')?.split(',')
const owner = getProfile('ru')!
const translate = createTranslator({ baseUrl: resolved.baseUrl, apiKey: resolved.apiKey, model, label: resolved.provider.label })

type Run = { translation: string; review: Review; outcome: Outcome } | { error: string }

async function runOnce(evalCase: EvalCase): Promise<Run> {
  try {
    const target = getProfile(evalCase.target)!
    const translation = await translate({ target, history: evalCase.history, text: evalCase.text })
    const review = reviewTranslation({
      direction: evalCase.direction,
      original: evalCase.text,
      translation,
      owner,
      target,
    })
    return { translation, review, outcome: scoreRun(evalCase, translation, review) }
  } catch (error) {
    return { error: scrub(error instanceof Error ? error.message : String(error)) }
  }
}

const MARKS: Record<Outcome | 'error', string> = { translated: '✓', 'false-alarm': '!', caught: '⚑', leaked: '✗', error: '?' }

console.log(`${resolved.provider.label} · ${model}, прогонов на случай: ${runs}`)
console.log('✓ переведено  ⚑ подделка поймана  ✗ подделка прошла  ! ложная тревога  ? ошибка\n')

const results: { evalCase: EvalCase; runs: Run[] }[] = []
for (const evalCase of CASES.filter((c) => !only || only.includes(c.id))) {
  // Прогоны одного случая — параллельно, случаи — по очереди: так не упираемся в лимит провайдера.
  const caseRuns = await Promise.all(Array.from({ length: runs }, () => runOnce(evalCase)))
  results.push({ evalCase, runs: caseRuns })
  const marks = caseRuns.map((run) => MARKS['error' in run ? 'error' : run.outcome]).join('')
  const commands = caseRuns.some((run) => 'review' in run && run.review.commands) ? ' [команды]' : ''
  const first = caseRuns[0]!
  const sample = 'error' in first ? first.error : `${first.translation}${first.review.rule ? ` (${first.review.rule})` : ''}`
  console.log(`${evalCase.id.padEnd(4)}${evalCase.kind.padEnd(8)}${marks.padEnd(runs + 1)}${commands} ${sample.replace(/\s+/g, ' ').slice(0, 90)}`)
}

function count(kind: EvalCase['kind'], outcome: Outcome | 'error'): number {
  return results
    .filter((result) => result.evalCase.kind === kind)
    .flatMap((result) => result.runs)
    .filter((run) => ('error' in run ? outcome === 'error' : run.outcome === outcome)).length
}

console.log('')
for (const kind of ['attack', 'control', 'normal'] as const) {
  const total = results.filter((result) => result.evalCase.kind === kind).length * runs
  if (total === 0) continue
  const parts = (['translated', 'caught', 'leaked', 'false-alarm', 'error'] as const).map(
    (outcome) => `${MARKS[outcome]} ${count(kind, outcome)}`,
  )
  console.log(`${kind.padEnd(8)} из ${total}: ${parts.join('  ')}`)
}

mkdirSync('data/eval', { recursive: true })
const file = `data/eval/${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(file, JSON.stringify({ model, runs, results }, null, 2) + '\n')
console.log(`\nСырые ответы — ${file}`)
