import type { Deps } from '../../deps.ts'
import type { Config } from '../../settings.ts'
import type { BotInfo, InlineButton } from '../../telegram.ts'
import type { Balance, ModelPrice } from '../../translate/account.ts'
import type { Connection } from '../../types.ts'

/** Экран панели: HTML (всё подставленное уже прошло escapeHtml) и кнопки. */
export type Screen = { html: string; keyboard: InlineButton[][] }

/** Счёт провайдера в момент показа: баланс и цены, каждое может быть не узнать. */
export type AccountSnapshot = { balance: Balance | null; prices: ReadonlyMap<string, ModelPrice> | null }

/** Всё, что нужно экранам, собирается один раз на показ. */
export type PanelContext = {
  ownerId: number
  config: Config
  connection: Connection | undefined
  /** Свежий getMe; null — Telegram не ответил */
  me: BotInfo | null
  /** Счёт провайдера, который сейчас переводит; null — бот его не видит или ключа нет */
  account: AccountSnapshot | null
  /** Будет ли под переводом кнопка «Отправить через бота» */
  inline: boolean
  dry: boolean
  now: number
}

/** Что показать после нажатия: главный экран, экран раздела заново или готовый экран. */
export type Outcome = { show: 'main' | 'section' | Screen; toast?: string }

/** Бот ждёт ключ этого провайдера. switchProvider — после сохранения переключиться на него. */
export type KeyWait = { providerId: string; until: number; switchProvider: boolean }

export type KeyWaits = {
  start(ownerId: number, providerId: string, opts: { switchProvider: boolean }): void
  /** Ожидание, если оно ещё не истекло */
  get(ownerId: number): KeyWait | undefined
  cancel(ownerId: number): void
}

/** Что разделу доступно, кроме контекста: зависимости и ожидание ключа. */
export type SectionEnv = { deps: Deps; waits: KeyWaits }

/**
 * Раздел панели — строка реестра (sections.ts). Платный раздел встаёт сюда же новой строкой,
 * не трогая ни главный экран, ни разбор нажатий.
 */
export type Section = {
  id: string
  /** Кнопка на главном экране */
  button: string
  render(ctx: PanelContext, env: SectionEnv): Screen
  /** Нажатие внутри раздела: «p:<id>:<action>[:<arg>]» */
  act?(ctx: PanelContext, env: SectionEnv, action: string, arg: string): Outcome | Promise<Outcome>
}

/** Префикс данных кнопок панели: по нему нажатие уходит панели, а не «Кому?». */
export const PANEL_PREFIX = 'p:'

/** Данные кнопки панели. Telegram принимает не больше 64 байт — проверяет тест. */
export function action(...parts: string[]): string {
  return PANEL_PREFIX + parts.join(':')
}

export const MAIN = action('main')
export const REFRESH = action('refresh')

export const BACK: InlineButton = { text: '← Назад', data: MAIN }

/** «Назад» внутри раздела — к его первому экрану. */
export function backTo(sectionId: string): InlineButton {
  return { text: '← Назад', data: action(sectionId) }
}

/** Кнопки по n в ряд. */
export function rows<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}
