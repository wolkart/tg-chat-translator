import type { Deps } from '../../deps.ts'
import { dayMonth, money } from '../../format.ts'
import { escapeHtml } from '../../html.ts'
import { keySetting, SETTING } from '../../store.ts'
import type { Balance } from '../../translate/account.ts'
import { getProvider, looksLikeKey, providerBaseUrl, type Provider } from '../../translate/providers.ts'
import type { KeyWait, KeyWaits, Screen } from './screen.ts'
import { action } from './screen.ts'

/** Сколько бот ждёт ключ после «Вставить ключ»: дольше — это уже обычное сообщение. */
export const KEY_WAIT_MS = 10 * 60 * 1000

/**
 * Ожидание ключа — в памяти, не в базе. Перезапуск посреди ожидания его теряет, но ключ по
 * виду всё равно не уйдёт ни модели, ни собеседнику (страховка в onKeyText), а владелец
 * просто нажмёт «Вставить ключ» ещё раз. Таблица в базе ради 10 минут — лишняя чистка.
 */
export function createKeyWaits(now: () => number): KeyWaits {
  const waits = new Map<number, KeyWait>()
  return {
    start(ownerId, providerId, opts) {
      waits.set(ownerId, { providerId, until: now() + KEY_WAIT_MS, switchProvider: opts.switchProvider })
    },
    get(ownerId) {
      const wait = waits.get(ownerId)
      if (wait && now() > wait.until) waits.delete(ownerId)
      return waits.get(ownerId)
    },
    cancel(ownerId) {
      waits.delete(ownerId)
    },
  }
}

/** Ключ огрызком: префикс провайдера и четыре последних знака — «sk-or-v1-…a3f9». */
export function maskKey(key: string): string {
  if (key.length <= 16) return '••••'
  const head = /^[a-z]+[-_](?:or-v1-)?/.exec(key)?.[0] ?? ''
  return `${head}…${key.slice(-4)}`
}

export function pasteScreen(provider: Provider): Screen {
  const label = escapeHtml(provider.label)
  return {
    html: [
      `<b>🔑 Ключ ${label}</b>`,
      '',
      `Пришлите ключ ${label} одним сообщением. Ключ берут здесь: ${provider.keysUrl}.`,
      '',
      'Сообщение с ключом бот сразу удалит из переписки.',
      '',
      'Совет: выпустите ключ с лимитом трат — если утечёт, ущерб ограничен суммой.',
    ].join('\n'),
    keyboard: [[{ text: 'Отмена', data: action('key', 'cancel') }]],
  }
}

export const KEY_NOT_DELETED = 'Не получилось удалить сообщение с ключом — удалите его сами.'
export const KEY_GUARD =
  'Похоже на ключ — бот не переводит его и никому не отправляет, сообщение удалено. ' +
  'Чтобы сохранить ключ: /start → 🔑 Ключ → Вставить ключ.'
export const KEY_GUARD_NOT_DELETED =
  'Похоже на ключ — бот не переводит его и никому не отправляет. Удалите это сообщение сами. ' +
  'Чтобы сохранить ключ: /start → 🔑 Ключ → Вставить ключ.'

export function notAKey(provider: Provider): string {
  return `Это не похоже на ключ ${provider.label} — ${provider.keyHint ?? 'проверьте, что скопировали его целиком'}. Пришлите ключ ещё раз или нажмите «Отмена».`
}

export function keyRejected(provider: Provider): string {
  return `❌ ${provider.label} не принял ключ — проверьте, что скопировали его целиком. Пришлите ключ ещё раз или нажмите «Отмена».`
}

export function keyUnchecked(reason: string): string {
  return `Не удалось проверить ключ: ${reason}. Ключ не сохранён — пришлите его ещё раз.`
}

/** «✅ Ключ сохранён: sk-or-v1-…a3f9. Осталось $6,53, действует до 16 октября.» */
export function keySaved(key: string, balance: Balance | null): string {
  const saved = `✅ Ключ сохранён: ${escapeHtml(maskKey(key))}.`
  if (!balance || balance.remaining === null) return saved
  const term = balance.expiresAt === null ? 'бессрочный' : `действует до ${dayMonth(balance.expiresAt)}`
  return `${saved} Осталось ${money(balance.remaining)}, ${term}.`
}

/** Ключ из сообщения: по шаблону провайдера, у провайдера без шаблона — весь текст. */
function extractKey(provider: Provider, text: string): string | null {
  if (!provider.keyPattern) return text.trim() || null
  return provider.keyPattern.exec(text)?.[0] ?? null
}

type OwnerText = { text: string; messageId: number; threadId?: number }

/**
 * Текст владельца, пока бот ждёт ключ, и страховка от ключа не по запросу. true — сообщение
 * обработано здесь: дальше по маршруту (перевод, «Кому?») оно не идёт.
 * open — прислать новую панель: после сохранения ключа старая осталась далеко вверху.
 */
export async function onKeyText(
  deps: Deps,
  waits: KeyWaits,
  ownerId: number,
  message: OwnerText,
  open: (notice: string) => Promise<void>,
): Promise<boolean> {
  const wait = waits.get(ownerId)
  // Ключом считается только сообщение вне тем: в теме владелец отвечает собеседнику.
  if (wait && message.threadId === undefined) {
    const provider = getProvider(wait.providerId)
    const key = extractKey(provider, message.text)
    if (!key) {
      await deps.api.sendText(ownerId, notAKey(provider), { replyTo: message.messageId })
      return true
    }
    await acceptKey(deps, waits, ownerId, { provider, key, wait, messageId: message.messageId, open })
    return true
  }
  if (looksLikeKey(message.text)) {
    await guard(deps, ownerId, message)
    return true
  }
  return false
}

async function remove(deps: Deps, ownerId: number, messageId: number): Promise<boolean> {
  try {
    await deps.api.deleteMessage(ownerId, messageId)
    return true
  } catch {
    return false
  }
}

/**
 * Путь ключа: в замену секретов → удалить сообщение → проверить у провайдера → сохранить.
 * В замену секретов — до проверки и даже если ключ не примут: ответ провайдера на неверный
 * ключ мог бы процитировать его в консоль. Удаляется первым делом: ключ не должен остаться в
 * переписке, какой бы ни была проверка.
 */
async function acceptKey(
  deps: Deps,
  waits: KeyWaits,
  ownerId: number,
  input: { provider: Provider; key: string; wait: KeyWait; messageId: number; open: (notice: string) => Promise<void> },
): Promise<void> {
  const { provider, key, wait } = input
  deps.addSecret(key)
  if (!(await remove(deps, ownerId, input.messageId))) await deps.api.sendText(ownerId, KEY_NOT_DELETED)

  const config = deps.config(ownerId)
  const check = await deps.accounts.verify(provider, key, providerBaseUrl(provider, config.localBaseUrl))
  if (check.verdict === 'rejected') {
    await deps.api.sendText(ownerId, keyRejected(provider))
    return
  }
  if (check.verdict === 'unknown') {
    await deps.api.sendText(ownerId, keyUnchecked(check.reason))
    return
  }

  deps.store.setSetting(ownerId, keySetting(provider.id), key)
  if (wait.switchProvider) {
    // У каждого провайдера свои модели — после переключения работает первая из его списка.
    deps.store.setSetting(ownerId, SETTING.provider, provider.id)
    deps.store.setSetting(ownerId, SETTING.model, provider.models[0]!.id)
  }
  waits.cancel(ownerId)
  await input.open(keySaved(key, check.balance))
}

/** Ключ не по запросу — в теме или после ожидания: не переводить, удалить, подсказать. */
async function guard(deps: Deps, ownerId: number, message: OwnerText): Promise<void> {
  const deleted = await remove(deps, ownerId, message.messageId)
  await deps.api.sendText(ownerId, deleted ? KEY_GUARD : KEY_GUARD_NOT_DELETED, {
    ...(message.threadId !== undefined && { threadId: message.threadId }),
  })
}
