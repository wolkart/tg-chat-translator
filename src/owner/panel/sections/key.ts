import { escapeHtml } from '../../../html.ts'
import { keyEditable, maskKey, pasteScreen } from '../key-input.ts'
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
        `Ключ — это пароль от вашего счёта у ${label}: по нему бот платит за переводы. Берут его здесь: ${escapeHtml(provider.keysUrl)}`,
      ].join('\n'),
      keyboard: [
        ...(keyEditable(ctx.config, provider) ? [[{ text: 'Вставить ключ', data: action('key', 'paste'), style: 'success' as const }]] : []),
        [BACK],
      ],
    }
  },

  act(ctx, env, act) {
    if (act === 'paste') {
      // Старая кнопка: правило то же, что у кнопки на экране.
      if (!keyEditable(ctx.config, ctx.config.provider)) return { show: 'section' }
      env.waits.start(ctx.ownerId, ctx.config.provider.id, { switchProvider: false })
      return { show: pasteScreen(ctx.config.provider) }
    }
    // «Отмена» и любое другое нажатие: ожидание уже снято панелью до разбора кнопки.
    return { show: 'section' }
  },
}
