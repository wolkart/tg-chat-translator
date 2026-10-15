import type { Deps } from '../../deps.ts'
import { dayMonth, money } from '../../format.ts'
import { escapeHtml } from '../../html.ts'
import { switchProvider, type Config } from '../../settings.ts'
import { keySetting } from '../../store.ts'
import type { Balance } from '../../translate/account.ts'
import { findKeys, getProvider, looksLikeKey, PROVIDERS, providerBaseUrl, type Provider } from '../../translate/providers.ts'
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

/**
 * Префиксы ключей из таблицы провайдеров, длинные первыми: иначе ключ OpenRouter показался бы
 * как «sk-…». Новый провайдер со своим префиксом — строка в таблице, а не правка здесь.
 */
const KEY_PREFIXES = [...new Set(PROVIDERS.flatMap((provider) => provider.keyPrefix ?? []))].sort((a, b) => b.length - a.length)

/** Ключ огрызком: префикс провайдера и четыре последних знака — «sk-or-v1-…a3f9». */
export function maskKey(key: string): string {
  if (key.length <= 16) return '••••'
  // Только известные префиксы провайдеров: у чужого формата «слово_» в начале может быть частью секрета.
  const head = KEY_PREFIXES.find((prefix) => key.startsWith(prefix)) ?? ''
  return `${head}…${key.slice(-4)}`
}

/** back — куда ведёт «Отмена»: туда, откуда владельца попросили ключ. */
export function pasteScreen(provider: Provider, back: string = action('key', 'cancel')): Screen {
  const label = escapeHtml(provider.label)
  return {
    html: [
      `<b>🔑 Ключ ${label}</b>`,
      '',
      `Пришлите ключ ${label} одним сообщением. Ключ берут здесь: ${escapeHtml(provider.keysUrl)}.`,
      '',
      'Сообщение с ключом бот сразу удалит из переписки.',
      '',
      'Совет: выпустите ключ с лимитом трат — если утечёт, ущерб ограничен суммой.',
    ].join('\n'),
    keyboard: [[{ text: 'Отмена', data: back }]],
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
  const hint = provider.keyPrefix ? `он начинается с ${provider.keyPrefix}` : 'проверьте, что скопировали его целиком'
  return `Это не похоже на ключ ${provider.label} — ${hint}. Пришлите ключ ещё раз или нажмите «Отмена».`
}

export function otherProviderKey(provider: Provider): string {
  return `Это ключ другого провайдера — сообщение удалено, ключ не сохранён. Пришлите ключ ${provider.label} или смените провайдера: 🤖 Модель → Сменить провайдера.`
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
  const term = balance.expiresAt === null ? 'ключ бессрочный' : `действует до ${dayMonth(balance.expiresAt)}`
  return `${saved} Осталось ${money(balance.remaining)}, ${term}.`
}

/**
 * Можно ли вставить ключ провайдера кнопкой. Ключ из .env главнее панели: кнопка сохранила бы
 * ключ, который всё равно не заработает. Одно правило и для кнопки на экране, и для нажатия
 * старой кнопки — ключ мог переехать в .env уже после того, как экран нарисовали.
 */
export function keyEditable(config: Config, provider: Provider): boolean {
  return config.keys[provider.id]?.source !== 'env'
}

/** Ключ из сообщения: по шаблону провайдера, у провайдера без шаблона — весь текст. */
function extractKey(provider: Provider, text: string): string | null {
  if (!provider.keyPattern) return text.trim() || null
  return provider.keyPattern.exec(text)?.[0] ?? null
}

type OwnerText = { text: string; messageId: number; threadId?: number }

/** Ключ, который провайдер только что принял, и баланс из той же проверки. */
export type VerifiedKey = { provider: Provider; key: string; balance: Balance | null }

type Open = (notice: string, verified: VerifiedKey) => Promise<void>

/**
 * Текст владельца, пока бот ждёт ключ, и страховка от ключа не по запросу. true — сообщение
 * обработано здесь: дальше по маршруту (перевод, «Кому?») оно не идёт.
 * open — прислать новую панель: после сохранения ключа старая осталась далеко вверху.
 * verified — чтобы панель не спрашивала у провайдера баланс, который проверка уже принесла.
 */
export async function onKeyText(
  deps: Deps,
  waits: KeyWaits,
  ownerId: number,
  message: OwnerText,
  open: Open,
): Promise<boolean> {
  const wait = waits.get(ownerId)
  // Ключом считается только сообщение вне тем: в теме владелец отвечает собеседнику.
  if (wait && message.threadId === undefined) {
    const provider = getProvider(wait.providerId)
    const key = extractKey(provider, message.text)
    if (!key) {
      const others = findKeys(message.text)
      if (others.length > 0) {
        // Ключ другого провайдера: сохранять нельзя, но и в переписке оставлять нельзя.
        for (const secret of others) deps.addSecret(secret)
        if (!(await remove(deps, ownerId, message.messageId))) await deps.api.sendText(ownerId, KEY_NOT_DELETED)
        await deps.api.sendText(ownerId, otherProviderKey(provider), { replyTo: message.messageId })
        return true
      }
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
  input: { provider: Provider; key: string; wait: KeyWait; messageId: number; open: Open },
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
  if (wait.switchProvider) switchProvider(deps.store, ownerId, provider)
  waits.cancel(ownerId)
  await input.open(keySaved(key, check.balance), { provider, key, balance: check.balance })
}

/** Ключ не по запросу — в теме или после ожидания: не переводить, удалить, подсказать. */
async function guard(deps: Deps, ownerId: number, message: OwnerText): Promise<void> {
  const deleted = await remove(deps, ownerId, message.messageId)
  await deps.api.sendText(ownerId, deleted ? KEY_GUARD : KEY_GUARD_NOT_DELETED, {
    ...(message.threadId !== undefined && { threadId: message.threadId }),
  })
}
