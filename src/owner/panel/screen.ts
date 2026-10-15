import type { Deps } from '../../deps.ts'
import type { Config } from '../../settings.ts'
import type { BotInfo, InlineButton } from '../../telegram.ts'
import type { KeyState, ModelPrice } from '../../translate/account.ts'
import type { Connection } from '../../types.ts'

/** Экран панели: HTML (всё подставленное уже прошло escapeHtml) и кнопки. */
export type Screen = { html: string; keyboard: InlineButton[][] }

/**
 * Всё, что нужно экранам, собирается один раз на показ. getMe, счёт и цены — запросы наружу,
 * и грузятся они только под экран, которому нужны (см. Section.needs).
 */
export type PanelContext = {
  ownerId: number
  config: Config
  connection: Connection | undefined
  /** Свежий getMe — только для главного экрана; null — не спрашивали или Telegram не ответил */
  me: BotInfo | null
  /**
   * Счёт провайдера, который сейчас переводит: баланс (может быть не узнать) и rejected —
   * провайдер не принял ключ: остаток тоже не узнать, но чинить надо ключ, а не ждать связи.
   * Для главного экрана и разделов с needs.account; null — не спрашивали, бот его не видит
   * или ключа нет
   */
  account: KeyState | null
  /**
   * Цены моделей того же провайдера — для главного экрана и разделов с needs.account или
   * needs.prices; null — не спрашивали, бот их не видит, ключа нет или цены не узнать
   */
  prices: ReadonlyMap<string, ModelPrice> | null
  /** Будет ли под переводом кнопка «Отправить через бота» — только для главного экрана */
  inline: boolean
  dry: boolean
  now: number
}

/**
 * Что показать после нажатия: главный экран, экран раздела заново или готовый экран.
 * fresh — «🔄 Обновить»: снимок счёта свежий, мимо минутного кэша, а если экран не
 * изменился, всплывает «Без изменений» — иначе нажатие выглядело бы несработавшим.
 */
export type Outcome = { show: 'main' | 'section' | Screen; toast?: string; fresh?: boolean }

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
  /**
   * Что нужно экрану раздела от провайдера: account — счёт целиком (баланс, проверка ключа
   * и цены), prices — только цены. Это запросы до 10 секунд, а апдейты Telegram бот разбирает
   * по одному: медленный провайдер на любом нажатии задержал бы и переводы. Поэтому их
   * получают только разделы, которые попросили, и ровно то, что попросили.
   */
  needs?: { account?: boolean; prices?: boolean }
  render(ctx: PanelContext, env: SectionEnv): Screen
  /**
   * Нажатие внутри раздела: «p:<id>:<action>[:<arg>]». В ctx — только настройки: getMe, счёт
   * и цены грузятся после, под экран, который покажут.
   */
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

/** «Назад» внутри раздела — к его первому экрану. */
export function backTo(sectionId: string): InlineButton {
  return { text: '← Назад', data: action(sectionId) }
}

/** «Назад» из раздела — к главному экрану. */
export const BACK: InlineButton = backTo('main')

/** Кнопки по n в ряд. */
export function rows<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}
