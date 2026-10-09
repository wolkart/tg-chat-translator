/** Шаг конвейера: дополняет реплику и решает, идти ли дальше. */
export type StepResult = 'next' | 'stop'

export type Step<T> = {
  name: string
  run: (item: T) => StepResult | Promise<StepResult>
}

/**
 * Прогоняет реплику по шагам по порядку. Шаг может остановить цепочку —
 * например, «чат на языке владельца, разговор не заводим».
 *
 * Шаги — список, а не ветки в одной функции: платный перевод голосовых или
 * новый режим встают в список, не трогая остальные шаги.
 */
export async function runPipeline<T>(item: T, steps: readonly Step<T>[]): Promise<'done' | 'stopped'> {
  for (const step of steps) {
    if ((await step.run(item)) === 'stop') return 'stopped'
  }
  return 'done'
}
