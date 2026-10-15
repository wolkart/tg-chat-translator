import { money } from '../../../format.ts'
import { escapeHtml } from '../../../html.ts'
import { switchProvider } from '../../../settings.ts'
import { SETTING } from '../../../store.ts'
import type { InlineButton } from '../../../telegram.ts'
import { translationCost } from '../../../translate/cost.ts'
import { PROVIDERS, type Provider } from '../../../translate/providers.ts'
import { pasteScreen } from '../key-input.ts'
import { BACK, action, backTo, type PanelContext, type Screen, type Section } from '../screen.ts'
import { modelLeaving } from '../status.ts'

/** Провайдер, который переводит сейчас: выбранный, а если у него нет ключа — тот, у кого есть. */
function activeProvider(ctx: PanelContext): Provider {
  return ctx.config.model.ok ? ctx.config.model.provider : ctx.config.provider
}

function currentModel(ctx: PanelContext, provider: Provider): string {
  return ctx.config.model.ok ? ctx.config.model.model : provider.models[0]!.id
}

/** Кнопка модели устарела: провайдера сменили, или данные кнопки чужие. */
const MODELS_CHANGED = 'Список моделей обновился — выберите ещё раз'

/**
 * Провайдеры: у кого ключа нет — «🔑». Выбор провайдера без ключа не переключает сразу: бот
 * сначала попросит ключ, иначе переводы встали бы до того, как ключ появится.
 */
function providersScreen(ctx: PanelContext): Screen {
  const current = activeProvider(ctx)
  const buttons = PROVIDERS.map(
    (provider): InlineButton[] => [
      {
        text: `${provider.id === current.id ? '✅ ' : ''}${provider.label}${ctx.config.keys[provider.id] ? '' : ' 🔑'}`,
        data: action('model', 'use', provider.id),
      },
    ],
  )
  return {
    html: [
      '<b>Провайдер моделей</b>',
      '',
      `Сейчас: ${escapeHtml(current.label)}`,
      '',
      '🔑 — ключа ещё нет: после выбора бот попросит его прислать.',
    ].join('\n'),
    keyboard: [...buttons, [backTo('model')]],
  }
}

/** Модели провайдера кнопками; у OpenRouter — цена за 1000 переводов и уходящие модели. */
export const MODEL: Section = {
  id: 'model',
  button: '🤖 Модель',
  needs: { account: true },

  render(ctx) {
    const provider = activeProvider(ctx)
    const current = currentModel(ctx, provider)
    const prices = ctx.account?.prices ?? null
    const lines = [
      `<b>🤖 Модель</b> · ${escapeHtml(provider.label)}`,
      '',
      `Сейчас: ${escapeHtml(provider.models.find((model) => model.id === current)?.title ?? current)}`,
    ]
    const leaving = prices?.get(current)?.expiresAt
    if (leaving) lines.push(modelLeaving(provider.label, leaving))
    const notes = provider.models.filter((model) => model.note)
    if (notes.length > 0) lines.push('', ...notes.map((model) => `• ${escapeHtml(model.title)} — ${escapeHtml(model.note!)}`))
    if (prices) lines.push('', `Цена — за 1000 переводов, по нынешним ценам ${escapeHtml(provider.label)}.`)

    const buttons = provider.models.map((model, index): InlineButton[] => {
      const price = prices?.get(model.id)
      const cost = price ? ` · ${money(translationCost(price) * 1000)}` : ''
      return [
        {
          text: `${model.id === current ? '✅ ' : ''}${model.title}${cost}${price?.expiresAt ? ' ⚠️' : ''}`,
          data: action('model', 'set', provider.id, String(index)),
        },
      ]
    })
    return {
      html: lines.join('\n'),
      keyboard: [...buttons, [{ text: 'Сменить провайдера', data: action('model', 'prov') }], [BACK]],
    }
  },

  act(ctx, env, act, arg) {
    const { store } = env.deps
    if (act === 'prov') return { show: providersScreen(ctx) }

    if (act === 'set') {
      // Номер, а не id: в id моделей бывают «:» и «/», а данные кнопки ограничены 64 байтами.
      // Рядом — id провайдера: старая кнопка с экрана другого провайдера иначе выбрала бы
      // модель с тем же номером у нынешнего. Number('') — это 0, поэтому номер — только цифры.
      const provider = activeProvider(ctx)
      const [, providerId, index] = /^([^:]+):(\d+)$/.exec(arg) ?? []
      const model = providerId === provider.id ? provider.models[Number(index)] : undefined
      if (!model) return { show: 'section', toast: MODELS_CHANGED }
      store.setSetting(ctx.ownerId, SETTING.provider, provider.id)
      store.setSetting(ctx.ownerId, SETTING.model, model.id)
      return { show: 'section', toast: `Модель: ${model.title}` }
    }

    if (act === 'use') {
      const provider = PROVIDERS.find((candidate) => candidate.id === arg)
      if (!provider) return { show: 'section' }
      if (!ctx.config.keys[provider.id]) {
        env.waits.start(ctx.ownerId, provider.id, { switchProvider: true })
        // «Отмена» — обратно к провайдерам: владелец пришёл выбирать провайдера, а не ключ.
        return { show: pasteScreen(provider, action('model', 'prov')) }
      }
      // Уже включён: переключение сбросило бы выбранную модель на первую из списка.
      if (provider.id === activeProvider(ctx).id) return { show: 'section', toast: `Уже ${provider.label}` }
      switchProvider(store, ctx.ownerId, provider)
      return { show: 'section', toast: `Теперь ${provider.label}` }
    }
    return { show: 'section' }
  },
}
