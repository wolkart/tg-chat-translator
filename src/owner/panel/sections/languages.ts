import { getProfile, PROFILES } from '../../../lang/profiles.ts'
import { LANGUAGE_DEFAULTS, SETTING } from '../../../store.ts'
import type { InlineButton } from '../../../telegram.ts'
import { BACK, action, backTo, rows, type Outcome, type PanelContext, type Screen, type Section, type SectionEnv } from '../screen.ts'

type Side = 'owner' | 'peer'

const SIDES: Readonly<Record<Side, { key: string; title: string; role: string; taken: string }>> = {
  owner: { key: SETTING.ownerLang, title: 'Ваш язык', role: 'на него переводятся входящие', taken: 'язык собеседника' },
  peer: { key: SETTING.peerLang, title: 'Язык собеседника', role: 'на него уходят ваши ответы', taken: 'ваш язык' },
}

function isSide(value: string): value is Side {
  return value === 'owner' || value === 'peer'
}

/** Код из базы, даже если профиля для него нет: экран должен показать, что сохранено. */
function codeOf(ctx: PanelContext, env: SectionEnv, side: Side): string {
  return env.deps.store.getSetting(ctx.ownerId, SIDES[side].key) ?? LANGUAGE_DEFAULTS[SIDES[side].key]!
}

function nameOf(code: string): string {
  return getProfile(code)?.nameRu ?? code
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Список языков, которые бот различает, — только из профилей: для других не работает проверка языка. */
function pickScreen(ctx: PanelContext, env: SectionEnv, side: Side): Screen {
  const current = codeOf(ctx, env, side)
  const buttons = PROFILES.map(
    (profile): InlineButton => ({
      text: `${profile.code === current ? '✅ ' : ''}${profile.nameRu}`,
      data: action('lang', 'set', side, profile.code),
    }),
  )
  return {
    html: `<b>${SIDES[side].title}</b> — ${SIDES[side].role}`,
    keyboard: [...rows(buttons, 3), [backTo('lang')]],
  }
}

/** Пара языков: язык владельца и язык собеседника, каждый своей кнопкой. */
export const LANGUAGES: Section = {
  id: 'lang',
  button: '🌐 Языки',

  render(ctx, env) {
    const owner = nameOf(codeOf(ctx, env, 'owner'))
    const peer = nameOf(codeOf(ctx, env, 'peer'))
    return {
      html: [
        '<b>🌐 Языки</b>',
        '',
        `Ваш язык: ${owner} — на него переводятся входящие.`,
        `Язык собеседника: ${peer} — на него уходят ваши ответы.`,
        '',
        'Если собеседник пишет на третьем языке, бот всё равно переведёт его вам.',
      ].join('\n'),
      keyboard: [
        [{ text: `Ваш язык: ${owner}`, data: action('lang', 'pick', 'owner') }],
        [{ text: `Язык собеседника: ${peer}`, data: action('lang', 'pick', 'peer') }],
        [BACK],
      ],
    }
  },

  act(ctx, env, act, arg): Outcome {
    const [side = '', code = ''] = arg.split(':')
    if (!isSide(side)) return { show: 'section' }
    if (act === 'pick') return { show: pickScreen(ctx, env, side) }
    if (act !== 'set' || !getProfile(code)) return { show: 'section' }

    // Один язык с обеих сторон — бот не отличил бы собеседника от владельца.
    const other: Side = side === 'owner' ? 'peer' : 'owner'
    if (codeOf(ctx, env, other) === code) {
      return { show: pickScreen(ctx, env, side), toast: `${capitalized(nameOf(code))} уже ${SIDES[side].taken} — выберите другой` }
    }
    env.deps.store.setSetting(ctx.ownerId, SIDES[side].key, code)
    return { show: 'section', toast: `${SIDES[side].title}: ${nameOf(code)}` }
  },
}
