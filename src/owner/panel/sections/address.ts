import { SETTING } from '../../../store.ts'
import type { Address } from '../../../types.ts'
import { BACK, action, type Section } from '../screen.ts'

const OPTIONS: readonly { value: Address; title: string }[] = [
  { value: 'as-is', title: 'Как в разговоре' },
  { value: 'formal', title: 'Деловое, на вы' },
]

/** Обращение в ответах владельца: держать «ты/вы» разговора или всегда на «вы». */
export const ADDRESS: Section = {
  id: 'addr',
  button: '🗣 Обращение',

  render(ctx) {
    return {
      html: [
        '<b>🗣 Обращение</b> — как звучат ваши ответы собеседнику',
        '',
        '• Как в разговоре — бот держит «ты» или «вы», как пишете вы сами.',
        '• Деловое, на вы — всегда вежливо и на «вы» (Sie, vous, usted), даже если вы пишете на «ты».',
        '',
        'Входящие переводятся как есть.',
      ].join('\n'),
      keyboard: [
        OPTIONS.map((option) => ({
          text: `${option.value === ctx.config.address ? '✅ ' : ''}${option.title}`,
          data: action('addr', 'set', option.value),
        })),
        [BACK],
      ],
    }
  },

  act(ctx, env, act, arg) {
    const option = OPTIONS.find((candidate) => candidate.value === arg)
    if (act !== 'set' || !option) return { show: 'section' }
    env.deps.store.setSetting(ctx.ownerId, SETTING.address, option.value)
    return { show: 'section', toast: `Обращение: ${option.title.toLowerCase()}` }
  },
}
