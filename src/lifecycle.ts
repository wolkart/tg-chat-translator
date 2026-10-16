import { hostname } from 'node:os'
import type { Alerts } from './alerts.ts'
import { isNetworkFailure, isTokenRejected, telegramFailure, type BotInfo } from './telegram.ts'

/**
 * Что делать процессу после ошибки Telegram:
 * - sleep-conflict — тот же бот работает в другом месте; перезапуск снова выбьет ту копию;
 * - sleep-token — токен отвергнут; перезапуск с тем же токеном ничего не даст;
 * - retry — нет сети или Telegram прилёг: подождать и повторить;
 * - crash — незнакомое: процесс падает, надзиратель (launchd, run.ps1, Docker) поднимет.
 */
export type StopKind = 'sleep-conflict' | 'sleep-token' | 'retry' | 'crash'

/** Паузы между попытками достучаться до Telegram при старте; дальше — последняя. */
export const RETRY_DELAYS_MS = [5_000, 10_000, 30_000, 60_000] as const

export const TOKEN_REJECTED =
  'Telegram не принял токен бота — его отозвали или заменили в @BotFather. ' +
  'Запустите команду установки ещё раз: она спросит новый токен.'

export function classifyStop(error: unknown): StopKind {
  const failure = telegramFailure(error)
  if (failure) {
    if (isTokenRejected(failure.code)) return 'sleep-token'
    // 409 бывает и из-за вебхука — его grammY снимает сам при следующем старте, поэтому
    // спать надо только на конфликт двух опросов.
    if (failure.code === 409 && /terminated by other getUpdates/i.test(failure.description)) return 'sleep-conflict'
    if (failure.code === 429 || failure.code >= 500) return 'retry'
    return 'crash'
  }
  if (isNetworkFailure(error)) return 'retry'
  return 'crash'
}

/**
 * Где запущен бот — словами для владельца. В контейнере имя хоста — случайный id, поэтому
 * для Linux имени нет: на Linux бот ставится только на сервер.
 */
export function placeName(platform: NodeJS.Platform = process.platform, host: string = hostname()): string {
  const name = host.replace(/\.local$/, '')
  if (platform === 'darwin') return `Mac (${name})`
  if (platform === 'win32') return `Windows (${name})`
  return 'сервере'
}

export function conflictText(place: string): string {
  return (
    `Бот остановился на ${place}: этот же бот запущен ещё в одном месте. ` +
    'Работать должна одна копия. Нужна эта — удалите другую командой из README и запустите здесь ' +
    'команду установки ещё раз: бот проснётся. Нужна другая — удалите эту.'
  )
}

/**
 * getMe при старте. Нет сети — ждём и повторяем: компьютер мог проснуться раньше Wi-Fi или
 * VPN. Токен отвергнут — null, повторять бессмысленно. Незнакомое — наружу.
 */
export async function connectTelegram(deps: {
  getMe: () => Promise<BotInfo>
  sleep: (ms: number) => Promise<void>
  log: (text: string) => void
}): Promise<BotInfo | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const me = await deps.getMe()
      if (attempt > 0) deps.log('Связь с Telegram есть')
      return me
    } catch (error) {
      const kind = classifyStop(error)
      if (kind === 'sleep-token') {
        deps.log(TOKEN_REJECTED)
        return null
      }
      if (kind !== 'retry') throw error
      // Одна строка на всё ожидание: журнал на компьютере не должен пухнуть за ночь без сети.
      if (attempt === 0) deps.log('Нет связи с Telegram — пробую снова, пока не появится')
      await deps.sleep(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!)
    }
  }
}

/**
 * Опрос Telegram. stopped — остановили сигналом, sleep — перезапуск не поможет, процесс
 * должен остаться жить без работы. Остальные ошибки — наружу.
 */
export async function runPolling(deps: {
  start: () => Promise<void>
  alerts: Pick<Alerts, 'notify' | 'log'>
  place: string
}): Promise<'stopped' | 'sleep'> {
  try {
    await deps.start()
    return 'stopped'
  } catch (error) {
    const kind = classifyStop(error)
    if (kind === 'sleep-conflict') {
      // Отправка сообщений работает и при конфликте: Telegram отказывает только в опросе.
      await deps.alerts.notify(conflictText(deps.place))
      return 'sleep'
    }
    if (kind === 'sleep-token') {
      // С отвергнутым токеном написать владельцу нечем — остаётся журнал.
      deps.alerts.log(TOKEN_REJECTED)
      return 'sleep'
    }
    throw error
  }
}

/**
 * Фоновые таймеры процесса в одном месте: уснувшая копия гасит всё фоновое одним вызовом —
 * новый таймер не забудется. unref, чтобы таймеры не держали процесс при обычной остановке.
 */
export function createBackground(): { every(fn: () => void, ms: number): void; stopAll(): void } {
  const timers: NodeJS.Timeout[] = []
  return {
    every(fn, ms) {
      timers.push(setInterval(fn, ms).unref())
    },
    stopAll() {
      for (const timer of timers) clearInterval(timer)
      timers.length = 0
    },
  }
}

/**
 * Процесс жив, но ничего не делает. Надзиратель (launchd, run.ps1, Docker) поднимает только
 * завершившийся процесс, поэтому «остановиться насовсем» — значит не завершаться. Таймер
 * держит процесс: без него Node вышел бы, не дождавшись промиса. Сигнал остановки
 * завершает сразу — иначе docker stop ждал бы 10 секунд до SIGKILL.
 */
export function sleepForever(): Promise<never> {
  setInterval(() => {}, 2 ** 31 - 1)
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => process.exit(0))
  return new Promise<never>(() => {})
}
