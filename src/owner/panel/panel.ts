import type { Deps } from '../../deps.ts'
import { describeError, isNotModified, type BotInfo, type InlineButton } from '../../telegram.ts'
import { keyState } from '../../translate/account.ts'
import { createKeyWaits, onKeyText, type VerifiedKey } from './key-input.ts'
import { SECTIONS } from './sections/index.ts'
import {
  MAIN,
  PANEL_PREFIX,
  REFRESH,
  action,
  rows,
  type AccountSnapshot,
  type Outcome,
  type PanelContext,
  type Screen,
  type Section,
  type SectionEnv,
} from './screen.ts'
import { statusLines } from './status.ts'

/** Сколько живёт снимок счёта: хождение по экранам не дёргает провайдера на каждое нажатие. */
export const ACCOUNT_CACHE_MS = 60 * 1000

/** Снимок счёта — на пару «провайдер, ключ»: новый ключ не получит остаток старого. */
function snapshotKey(providerId: string, key: string): string {
  return `${providerId}:${key}`
}

/** Что грузить под экран сверх настроек. */
type Needs = { me?: boolean; account?: boolean }

/** Главному экрану — всё: на нём строки BotFather, ключа с остатком и цена модели. */
const MAIN_NEEDS: Needs = { me: true, account: true }

/** Что грузить под итог нажатия; null — экран уже готов, грузить нечего. */
function needsOf(outcome: Outcome, section: Section | undefined): Needs | null {
  if (outcome.show === 'main') return MAIN_NEEDS
  if (outcome.show === 'section') return { account: section?.needs?.account ?? false }
  return null
}

export const NOT_CHANGED = 'Без изменений'

/** Главный экран: notice — что только что произошло, без неё экран до и после действия одинаков. */
export function mainScreen(ctx: PanelContext, notice?: string): Screen {
  const groups = statusLines(ctx)
  const fix = groups.flat().find((line) => line.fix)?.fix
  const html = [...(notice ? [notice] : []), '<b>⚙️ Переводчик</b>', ...groups.map((lines) => lines.map((line) => line.text).join('\n'))]
    .filter(Boolean)
    .join('\n\n')
  const buttons: InlineButton[] = [
    ...SECTIONS.map((section): InlineButton => ({
      text: section.button,
      data: action(section.id),
      ...(section.id === fix && { style: 'success' as const }),
    })),
    { text: '🔄 Обновить', data: REFRESH },
  ]
  return { html, keyboard: rows(buttons, 2) }
}

export type Panel = {
  /** Новое сообщение-панель: по /start и после сохранения ключа */
  open(ownerId: number, opts?: { threadId?: number; notice?: string }): Promise<void>
  /** Нажатие кнопки панели: экран правится на месте */
  onCallback(callback: { id: string; data: string; messageId: number | undefined }, ownerId: number): Promise<void>
  /** Текст владельца: ключ, которого ждёт панель, или ключ не по запросу. true — обработан здесь */
  onText(ownerId: number, message: { text: string; messageId: number; threadId?: number }): Promise<boolean>
}

/**
 * Панель настроек. Состояние в данных кнопок не хранится: кнопки старой панели работают и
 * после перезапуска. В памяти — снимок счёта на минуту и ожидание ключа на 10 минут.
 */
export function createPanel(deps: Deps): Panel {
  const env: SectionEnv = { deps, waits: createKeyWaits(deps.now) }
  const accounts = new Map<string, { at: number; snapshot: AccountSnapshot }>()

  async function botInfo(): Promise<BotInfo | null> {
    try {
      const me = await deps.api.getMe()
      // Свежий getMe — заодно сигнал проверке Inline Mode: так бот замечает и выключение.
      deps.onBotInfo(me)
      return me
    } catch (error) {
      deps.alerts.log(`панель: getMe не ответил — ${describeError(error)}`)
      return null
    }
  }

  async function accountOf(ctx: Pick<PanelContext, 'config'>, fresh: boolean): Promise<AccountSnapshot | null> {
    const { model } = ctx.config
    if (!model.ok) return null
    const account = deps.accounts.of(model.provider)
    if (!account) return null
    const cacheKey = snapshotKey(model.provider.id, model.apiKey)
    const cached = accounts.get(cacheKey)
    if (!fresh && cached && deps.now() - cached.at < ACCOUNT_CACHE_MS) return cached.snapshot
    const [state, prices] = await Promise.all([keyState(account, model.apiKey), account.prices()])
    const snapshot = { ...state, prices }
    accounts.set(cacheKey, { at: deps.now(), snapshot })
    return snapshot
  }

  /**
   * Проверка ключа уже сходила к провайдеру за балансом: он ложится в снимок, и новая панель
   * не спрашивает /key и /credits второй раз. Цены — из счёта, у него свой кэш на час.
   * Баланса проверка не принесла — снимок не подделываем, панель спросит сама.
   */
  async function remember({ provider, key, balance }: VerifiedKey): Promise<void> {
    const account = deps.accounts.of(provider)
    if (!account || !balance) return
    const prices = await account.prices()
    accounts.set(snapshotKey(provider.id, key), { at: deps.now(), snapshot: { balance, rejected: false, prices } })
  }

  /** Настройки читаются всегда; getMe и счёт — только если экрану они нужны. */
  async function context(ownerId: number, needs: Needs = {}, fresh = false): Promise<PanelContext> {
    const config = deps.config(ownerId)
    const [me, account] = await Promise.all([needs.me ? botInfo() : null, needs.account ? accountOf({ config }, fresh) : null])
    return {
      ownerId,
      config,
      connection: deps.store.ownerConnection(ownerId),
      me,
      account,
      inline: needs.me ? (me ? me.supportsInlineQueries : await deps.inlineEnabled()) : false,
      dry: deps.dry,
      now: deps.now(),
    }
  }

  /**
   * Сообщение панели не правится («message to edit not found», «message can't be edited» —
   * удалили или оно старое): тот же экран приходит новым сообщением. Иначе нажатие осталось бы
   * без ответа, а владелец получил бы общее «Не удалось обработать ваше сообщение». И это не
   * вышло — строка в консоль: на нажатие всё равно надо ответить.
   */
  async function resend(ownerId: number, screen: Screen): Promise<void> {
    try {
      await deps.api.sendText(ownerId, screen.html, { html: true, keyboard: screen.keyboard })
    } catch (error) {
      deps.alerts.log(`панель: экран не обновился и не пришёл новым сообщением — ${describeError(error)}`)
    }
  }

  /** Что показать по данным кнопки. null — кнопка не наша или устарела: ничего не меняем. */
  async function outcomeOf(ctx: PanelContext, section: Section | undefined, act: string | undefined, arg: string): Promise<Outcome | null> {
    if (!section) return null
    if (act === undefined) return { show: 'section' }
    return section.act ? section.act(ctx, env, act, arg) : null
  }

  const panel: Panel = {
    async open(ownerId, opts = {}) {
      // /start — новое действие: ключ после него уже не ждём.
      env.waits.cancel(ownerId)
      const ctx = await context(ownerId, MAIN_NEEDS)
      const screen = mainScreen(ctx, opts.notice)
      await deps.api.sendText(ownerId, screen.html, {
        html: true,
        keyboard: screen.keyboard,
        ...(opts.threadId !== undefined && { threadId: opts.threadId }),
      })
    },

    async onCallback(callback, ownerId) {
      // Любое нажатие панели снимает ожидание ключа: «Вставить ключ» начнёт его заново.
      env.waits.cancel(ownerId)
      const [sectionId = '', act, ...rest] = callback.data.slice(PANEL_PREFIX.length).split(':')
      // «🔄 Обновить» на главном и на экране баланса: снимок счёта — свежий.
      const refresh = callback.data === REFRESH || act === 'refresh'
      const section = SECTIONS.find((candidate) => candidate.id === sectionId)
      // Действию хватает настроек: getMe и счёт грузятся ниже, под экран, который покажут.
      const base = await context(ownerId)

      let outcome: Outcome | null
      if (callback.data === MAIN || callback.data === REFRESH) outcome = { show: 'main' }
      else outcome = await outcomeOf(base, section, act, rest.join(':'))
      if (!outcome || callback.messageId === undefined) {
        await deps.api.answerCallback(callback.id)
        return
      }

      // Настройки читаются заново: действие могло их поменять, и экран рисуется по свежим.
      const needs = needsOf(outcome, section)
      const ctx = needs ? await context(ownerId, needs, refresh) : base
      const screen =
        outcome.show === 'main' ? mainScreen(ctx) : outcome.show === 'section' ? section!.render(ctx, env) : outcome.show
      let toast = outcome.toast
      try {
        await deps.api.editText(ownerId, callback.messageId, screen.html, { html: true, keyboard: screen.keyboard })
      } catch (error) {
        if (isNotModified(error)) {
          if (refresh) toast = NOT_CHANGED
        } else {
          await resend(ownerId, screen)
        }
      }
      await deps.api.answerCallback(callback.id, toast)
    },

    onText(ownerId, message) {
      return onKeyText(deps, env.waits, ownerId, message, async (notice, verified) => {
        await remember(verified)
        await panel.open(ownerId, { notice })
      })
    },
  }
  return panel
}
