import type { Deps } from '../../deps.ts'
import { describeError, isNotModified, type BotInfo, type InlineButton } from '../../telegram.ts'
import { keyState, type KeyState, type ModelPrice } from '../../translate/account.ts'
import type { ResolvedModel } from '../../translate/providers.ts'
import { createKeyWaits, onKeyText, type VerifiedKey } from './key-input.ts'
import { SECTIONS } from './sections/index.ts'
import {
  MAIN,
  PANEL_PREFIX,
  REFRESH,
  action,
  rows,
  type Outcome,
  type PanelContext,
  type Screen,
  type Section,
  type SectionEnv,
} from './screen.ts'
import { statusLines } from './status.ts'

/** Сколько живёт снимок счёта: хождение по экранам не дёргает провайдера на каждое нажатие. */
export const ACCOUNT_CACHE_MS = 60 * 1000

/** Снимок счёта в кэше панели: баланс с вердиктом по ключу и цены, каждое может быть не узнать. */
type AccountSnapshot = KeyState & { prices: ReadonlyMap<string, ModelPrice> | null }

/** Снимок счёта — на пару «провайдер, ключ»: новый ключ не получит остаток старого. */
function snapshotKey(providerId: string, key: string): string {
  return `${providerId}:${key}`
}

/** Что грузить под экран сверх настроек: разделу — его needs, главному экрану — ещё и getMe. */
type Needs = NonNullable<Section['needs']> & { me?: boolean }

/** Главному экрану — всё: на нём строки BotFather, ключа с остатком и цена модели. */
const MAIN_NEEDS: Needs = { me: true, account: true }

/** Кнопки главного экрана: показать его, а «🔄 Обновить» — со свежим снимком счёта. */
const MAIN_OUTCOMES: ReadonlyMap<string, Outcome> = new Map([
  [MAIN, { show: 'main' }],
  [REFRESH, { show: 'main', fresh: true }],
])

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

  async function accountOf(model: ResolvedModel, fresh: boolean): Promise<AccountSnapshot | null> {
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

  /**
   * Только цены, без /key и /credits: экрану модели баланс не нужен. Свой кэш цен у счёта
   * провайдера (у OpenRouter — на час), поэтому снимок панели здесь не участвует.
   */
  async function pricesOf(model: ResolvedModel): Promise<ReadonlyMap<string, ModelPrice> | null> {
    if (!model.ok) return null
    const account = deps.accounts.of(model.provider)
    return account ? account.prices() : null
  }

  /** Настройки читаются всегда; getMe, счёт и цены — только если экрану они нужны. */
  async function context(ownerId: number, needs: Needs = {}, fresh = false): Promise<PanelContext> {
    const config = deps.config(ownerId)
    const [me, snapshot, prices] = await Promise.all([
      needs.me ? botInfo() : null,
      needs.account ? accountOf(config.model, fresh) : null,
      // Счёт целиком цены уже несёт: отдельный запрос — только экрану, которому нужны лишь они.
      needs.prices && !needs.account ? pricesOf(config.model) : null,
    ])
    return {
      ownerId,
      config,
      connection: deps.store.ownerConnection(ownerId),
      me,
      account: snapshot && { balance: snapshot.balance, rejected: snapshot.rejected },
      prices: snapshot ? snapshot.prices : prices,
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
  async function outcomeOf(
    ownerId: number,
    data: string,
    section: Section | undefined,
    act: string | undefined,
    arg: string,
  ): Promise<Outcome | null> {
    // Главному экрану настройки для действия не нужны: всё своё он грузит под показ.
    const main = MAIN_OUTCOMES.get(data)
    if (main) return main
    if (!section) return null
    if (act === undefined) return { show: 'section' }
    if (!section.act) return null
    // Действию хватает настроек: getMe, счёт и цены грузятся после, под экран, который покажут.
    return section.act(await context(ownerId), env, act, arg)
  }

  /**
   * Экран по итогу нажатия. Настройки читаются заново: действие могло их поменять, и экран
   * рисуется по свежим. Готовому экрану грузить нечего.
   */
  async function screenOf(ownerId: number, outcome: Outcome, section: Section | undefined): Promise<Screen> {
    const fresh = outcome.fresh ?? false
    if (outcome.show === 'main') return mainScreen(await context(ownerId, MAIN_NEEDS, fresh))
    // Итог «раздел» бывает только у нажатия внутри раздела — section здесь есть.
    if (outcome.show === 'section') return section!.render(await context(ownerId, section!.needs, fresh), env)
    return outcome.show
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
      const section = SECTIONS.find((candidate) => candidate.id === sectionId)
      const outcome = await outcomeOf(ownerId, callback.data, section, act, rest.join(':'))
      if (!outcome || callback.messageId === undefined) {
        await deps.api.answerCallback(callback.id)
        return
      }

      const screen = await screenOf(ownerId, outcome, section)
      let toast = outcome.toast
      try {
        await deps.api.editText(ownerId, callback.messageId, screen.html, { html: true, keyboard: screen.keyboard })
      } catch (error) {
        if (isNotModified(error)) {
          if (outcome.fresh) toast = NOT_CHANGED
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
