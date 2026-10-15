import type { Deps } from '../../deps.ts'
import { describeError, isNotModified, type BotInfo, type InlineButton } from '../../telegram.ts'
import { SECTIONS } from './sections.ts'
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
}

/**
 * Панель настроек. Состояние в данных кнопок не хранится: кнопки старой панели работают и
 * после перезапуска. В памяти — только снимок счёта на минуту.
 */
export function createPanel(deps: Deps): Panel {
  const env: SectionEnv = { deps }
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
    const cacheKey = `${model.provider.id}:${model.apiKey}`
    const cached = accounts.get(cacheKey)
    if (!fresh && cached && deps.now() - cached.at < ACCOUNT_CACHE_MS) return cached.snapshot
    const [balance, prices] = await Promise.all([account.balance(model.apiKey), account.prices()])
    const snapshot = { balance, prices }
    accounts.set(cacheKey, { at: deps.now(), snapshot })
    return snapshot
  }

  async function context(ownerId: number, fresh = false): Promise<PanelContext> {
    const config = deps.config(ownerId)
    const [me, account] = await Promise.all([botInfo(), accountOf({ config }, fresh)])
    return {
      ownerId,
      config,
      connection: deps.store.ownerConnection(ownerId),
      me,
      account,
      inline: me ? me.supportsInlineQueries : await deps.inlineEnabled(),
      dry: deps.dry,
      now: deps.now(),
    }
  }

  /** Что показать по данным кнопки. null — кнопка не наша или устарела: ничего не меняем. */
  async function outcomeOf(ctx: PanelContext, section: Section | undefined, act: string | undefined, arg: string): Promise<Outcome | null> {
    if (!section) return null
    if (act === undefined) return { show: 'section' }
    return section.act ? section.act(ctx, env, act, arg) : null
  }

  return {
    async open(ownerId, opts = {}) {
      const ctx = await context(ownerId)
      const screen = mainScreen(ctx, opts.notice)
      await deps.api.sendText(ownerId, screen.html, {
        html: true,
        keyboard: screen.keyboard,
        ...(opts.threadId !== undefined && { threadId: opts.threadId }),
      })
    },

    async onCallback(callback, ownerId) {
      const [sectionId = '', act, ...rest] = callback.data.slice(PANEL_PREFIX.length).split(':')
      const refresh = callback.data === REFRESH
      const section = SECTIONS.find((candidate) => candidate.id === sectionId)
      let ctx = await context(ownerId, refresh)

      let outcome: Outcome | null
      if (callback.data === MAIN || refresh) outcome = { show: 'main' }
      else outcome = await outcomeOf(ctx, section, act, rest.join(':'))
      if (!outcome || callback.messageId === undefined) {
        await deps.api.answerCallback(callback.id)
        return
      }

      // Действие могло поменять настройки — экран рисуется по свежим. getMe второй раз не нужен.
      if (act !== undefined) {
        const config = deps.config(ownerId)
        ctx = { ...ctx, config, account: await accountOf({ config }, false) }
      }
      const screen =
        outcome.show === 'main' ? mainScreen(ctx) : outcome.show === 'section' ? section!.render(ctx, env) : outcome.show
      let toast = outcome.toast
      try {
        await deps.api.editText(ownerId, callback.messageId, screen.html, { html: true, keyboard: screen.keyboard })
      } catch (error) {
        if (!isNotModified(error)) throw error
        if (refresh) toast = NOT_CHANGED
      }
      await deps.api.answerCallback(callback.id, toast)
    },
  }
}
