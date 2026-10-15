import type { Alerts } from './alerts.ts'
import { describeError, type BotCommand, type BotInfo, type TelegramApi } from './telegram.ts'

/**
 * Настройка BotFather, без которой что-то не работает. Включить её программой нельзя — только
 * руками, поэтому бот говорит, что выключено, зачем оно и где включить.
 * what — что не так, why — что из-за этого не работает, fix — путь в мини-приложении BotFather.
 */
export type BotFatherCheck = {
  key: string
  ok: (me: BotInfo) => boolean
  what: string
  why: string
  fix: string
}

// Пути — через мини-приложение BotFather (живая проверка 2026-10-14): /mybots и «Turn on»
// там больше нет, вместо них Open и переключатели. Business Mode там называется Secretary Mode.
const SECRETARY: BotFatherCheck = {
  key: 'botfather:business',
  ok: (me) => me.canConnectToBusiness,
  what: 'выключен Secretary Mode (раньше назывался Business Mode)',
  why: 'без него бот не видит вашу личку',
  fix: 'Откройте @BotFather → Open → этот бот → Bot Settings и включите переключатель Secretary Mode.',
}

const THREADED: BotFatherCheck = {
  key: 'botfather:topics',
  ok: (me) => me.hasTopicsEnabled,
  what: 'выключен Threaded Mode',
  why: 'без него бот не может завести темы для собеседников',
  fix: 'Откройте @BotFather → Open → этот бот → Bot Settings и включите переключатель Threaded Mode.',
}

const USER_TOPICS: BotFatherCheck = {
  key: 'botfather:user-topics',
  ok: (me) => !me.allowsUsersToCreateTopics,
  what: 'пользователям разрешено создавать темы',
  why: 'так в чате с ботом можно завести тему, которую бот не узнает',
  // На экране BotFather (2026-10-15) это переключатель «Disallow users to create new threads» в разделе
  // Threads Settings — его надо включить, поэтому и название — дословно, как на экране.
  fix: 'Откройте @BotFather → Open → этот бот → Bot Settings и включите переключатель Disallow users to create new threads.',
}

const INLINE: BotFatherCheck = {
  key: 'botfather:inline',
  ok: (me) => me.supportsInlineQueries,
  what: 'выключен Inline Mode',
  why: 'без него не работает кнопка «Отправить через бота»',
  fix: 'Откройте @BotFather → Open → этот бот → Bot Settings → Inline Mode и включите переключатель.',
}

/** Реестр проверок BotFather: новая настройка — новая строка, старт и панель её подхватят. */
export const BOTFATHER_CHECKS: readonly BotFatherCheck[] = [SECRETARY, THREADED, USER_TOPICS, INLINE]

/** Полный текст проблемы: «В BotFather выключен … — без него … . Откройте …». */
export function botfatherText(check: BotFatherCheck): string {
  return `В BotFather ${check.what} — ${check.why}. ${check.fix}`
}

export const BUSINESS_MODE_OFF = botfatherText(SECRETARY)
export const TOPICS_OFF = botfatherText(THREADED)
export const USER_TOPICS_ON = botfatherText(USER_TOPICS)
export const INLINE_OFF = botfatherText(INLINE)

/** Меню команд: одна команда, она же панель. */
export const BOT_COMMANDS: readonly BotCommand[] = [{ command: 'start', description: 'Настройки и статус' }]

/**
 * Меню команд при старте. Без меню бот работает — отказ Telegram только в консоль.
 * Ставим и общую область, и личные чаты: узкая область главнее общей, поэтому старый
 * список для личных чатов (например, «Start bot» из BotFather) перекрыл бы наш.
 */
export async function setupCommands(api: TelegramApi, log: (text: string) => void): Promise<void> {
  for (const scope of ['default', 'all_private_chats'] as const) {
    try {
      await api.setCommands(BOT_COMMANDS, scope)
    } catch (error) {
      log(`меню команд не задано: ${describeError(error)}`)
    }
  }
}

/** Как часто переспрашивать Telegram, пока Inline Mode выключен: владелец мог включить его в BotFather. */
export const INLINE_RECHECK_MS = 60 * 1000

/** Проверка Inline Mode; update — свежий ответ getMe, например из панели. */
export type InlineCheck = (() => Promise<boolean>) & { update(enabled: boolean): void }

/**
 * Включён ли Inline Mode. Включённый не перепроверяем. Выключенный переспрашиваем у Telegram,
 * но не чаще раза в минуту: так включение в BotFather бот замечает без перезапуска, а
 * лишних запросов на каждый перевод нет. Выключение после старта бот узнаёт из update — его
 * зовёт панель, которая спрашивает getMe при каждом показе главного экрана.
 */
export function createInlineCheck(deps: { api: TelegramApi; initial: boolean; now: () => number }): InlineCheck {
  let enabled = deps.initial
  // Стартовый getMe только что был — первый повтор не раньше чем через минуту.
  let checkedAt = deps.now()
  const check = async () => {
    if (enabled) return true
    if (deps.now() - checkedAt < INLINE_RECHECK_MS) return false
    checkedAt = deps.now()
    try {
      enabled = (await deps.api.getMe()).supportsInlineQueries
    } catch {
      // Сеть моргнула — считаем, что по-прежнему выключено, спросим через минуту.
    }
    return enabled
  }
  return Object.assign(check, {
    update(value: boolean) {
      enabled = value
      checkedAt = deps.now()
    },
  })
}

/**
 * Проверки при старте: всё, без чего бот не работает, владелец узнаёт сразу и понятным
 * текстом, а не по молчанию бота. Те же проверки BotFather показывает панель.
 */
export async function startupChecks(input: {
  me: BotInfo
  alerts: Alerts
  languagesProblem: string | null
  modelProblem: string | null
}): Promise<void> {
  const { me, alerts } = input
  for (const check of BOTFATHER_CHECKS) {
    if (!check.ok(me)) await alerts.general(check.key, botfatherText(check))
  }
  if (input.languagesProblem) await alerts.general('languages', input.languagesProblem)
  if (input.modelProblem) await alerts.general('model', input.modelProblem)
}
