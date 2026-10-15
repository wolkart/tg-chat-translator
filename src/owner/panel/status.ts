import { SETTINGS_PATH } from '../../channels/private-chat/connection.ts'
import { dayMonth, money } from '../../format.ts'
import { escapeHtml } from '../../html.ts'
import { BOTFATHER_CHECKS, botfatherText } from '../../startup.ts'
import { translationCost } from '../../translate/cost.ts'
import type { PanelContext } from './screen.ts'

/** Строка главного экрана. fix — раздел, чья кнопка чинит проблему: она станет зелёной. */
export type StatusLine = { text: string; fix?: string }

type LineSource = (ctx: PanelContext) => StatusLine | StatusLine[] | null

function connectionLine({ connection }: PanelContext): StatusLine {
  if (!connection) {
    return {
      text: `⚠️ Подключение к аккаунту: бот его ещё не видел. Если уже подключили — появится с первым сообщением в личке; если нет — ${SETTINGS_PATH}`,
    }
  }
  if (!connection.isEnabled) return { text: `⚠️ Бот отключён от вашего аккаунта. Подключите: ${SETTINGS_PATH}` }
  if (!connection.canReply) {
    return {
      text: `⚠️ Бот подключён, но не может отвечать от вашего имени. Включите «Ответы на сообщения» (раздел «Сообщения»): ${SETTINGS_PATH}`,
    }
  }
  return { text: '✅ Подключён к вашему аккаунту и может отвечать от вашего имени' }
}

/** Все в порядке — одна строка; иначе по строке на каждую проблему, с тем, что включить. */
function botfatherLines({ me }: PanelContext): StatusLine[] {
  if (!me) return [{ text: 'BotFather: не проверить — Telegram не ответил' }]
  const failed = BOTFATHER_CHECKS.filter((check) => !check.ok(me))
  if (failed.length === 0) return [{ text: '✅ BotFather: всё включено' }]
  return failed.map((check) => ({ text: `⚠️ ${botfatherText(check).replace(/^В BotFather /, 'BotFather: ')}` }))
}

function keyLine({ config, account }: PanelContext): StatusLine {
  const { model } = config
  if (!model.ok) return { text: '⚠️ Ключа модели нет — переводить нечем. Нажмите «🔑 Ключ».', fix: 'key' }
  const label = escapeHtml(model.provider.label)
  if (!account) return { text: `✅ Ключ ${label}: есть` }
  const balance = account.balance
  if (!balance || balance.remaining === null) return { text: `Ключ ${label}: есть, остаток сейчас не узнать` }
  const term = balance.expiresAt === null ? 'бессрочный' : `действует до ${dayMonth(balance.expiresAt)}`
  return { text: `✅ Ключ ${label}: осталось ${money(balance.remaining)}, ${term}` }
}

function languagesLine({ config }: PanelContext): StatusLine {
  if (!config.languages) return { text: `⚠️ ${escapeHtml(config.languagesProblem ?? 'языки не настроены')}`, fix: 'lang' }
  return { text: `Языки: ${config.languages.owner.nameRu} ↔ ${config.languages.peer.nameRu}` }
}

function addressLine({ config }: PanelContext): StatusLine {
  return { text: `Обращение: ${config.address === 'formal' ? 'деловое, на вы' : 'как в разговоре'}` }
}

/** Модель, цена за 1000 переводов и «⚠️», если провайдер её скоро уберёт. */
function modelLines({ config, account }: PanelContext): StatusLine[] {
  const { model } = config
  if (!model.ok) return []
  const price = account?.prices?.get(model.model)
  const cost = price ? ` · ≈ ${money(translationCost(price) * 1000)} за 1000 переводов` : ''
  const lines: StatusLine[] = [{ text: `Модель: ${escapeHtml(model.title)}${cost}` }]
  if (price?.expiresAt) lines.push({ text: modelLeaving(model.provider.label, price.expiresAt), fix: 'model' })
  return lines
}

/** «⚠️ OpenRouter уберёт эту модель 20 октября — выберите другую»: и на главном, и на экране модели. */
export function modelLeaving(providerLabel: string, expiresAt: number): string {
  return `⚠️ ${escapeHtml(providerLabel)} уберёт эту модель ${dayMonth(expiresAt)} — выберите другую`
}

/** Подсказка обещает ту кнопку, которая на деле будет под переводом. */
function writeFirstLine({ inline }: PanelContext): StatusLine {
  const button = inline ? 'Отправить через бота' : 'Скопировать'
  return { text: `Написать первым: отправьте текст сюда вне тем — бот переведёт и даст кнопку «${button}»` }
}

function dryLine({ dry }: PanelContext): StatusLine | null {
  return dry ? { text: 'Холостой прогон: собеседникам ничего не уходит' } : null
}

/** Реестр строк главного экрана, по группам: состояние, настройки, подсказки. */
export const STATUS_GROUPS: readonly (readonly LineSource[])[] = [
  [connectionLine, botfatherLines, keyLine],
  [languagesLine, addressLine, modelLines],
  [writeFirstLine, dryLine],
]

export function statusLines(ctx: PanelContext): StatusLine[][] {
  return STATUS_GROUPS.map((group) => group.flatMap((source) => source(ctx) ?? []))
}
