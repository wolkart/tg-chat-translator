import { escapeHtml } from '../../../html.ts'
import { maskKey, pasteScreen } from '../key-input.ts'
import { BACK, action, type Section } from '../screen.ts'

/** Ключ выбранного провайдера: какой задан и откуда, и «Вставить ключ», если он не из .env. */
export const KEY: Section = {
  id: 'key',
  button: '🔑 Ключ',

  render(ctx) {
    const { provider, keys } = ctx.config
    const key = keys[provider.id]
    const label = escapeHtml(provider.label)
    const state = !key
      ? 'не задан'
      : key.source === 'env'
        ? '🔒 задан в .env — кнопкой не меняется'
        : `${escapeHtml(maskKey(key.value))} · вставлен в панели`
    return {
      html: [
        '<b>🔑 Ключ</b>',
        '',
        `Ключ ${label}: ${state}`,
        '',
        `Ключ — это пароль от вашего счёта у ${label}: по нему бот платит за переводы. Берут его здесь: ${provider.keysUrl}`,
      ].join('\n'),
      // Ключ из .env главнее панели: кнопка сохранила бы ключ, который всё равно не заработает.
      keyboard: [
        ...(key?.source === 'env' ? [] : [[{ text: 'Вставить ключ', data: action('key', 'paste'), style: 'success' as const }]]),
        [BACK],
      ],
    }
  },

  act(ctx, env, act) {
    if (act === 'paste') {
      env.waits.start(ctx.ownerId, ctx.config.provider.id, { switchProvider: false })
      return { show: pasteScreen(ctx.config.provider) }
    }
    // «Отмена» и любое другое нажатие: ожидание уже снято панелью до разбора кнопки.
    return { show: 'section' }
  },
}
