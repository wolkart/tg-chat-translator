import { expiryTerm, money } from '../../../format.ts'
import { escapeHtml } from '../../../html.ts'
import type { Balance, ModelPrice } from '../../../translate/account.ts'
import { translationCost, translationsPhrase } from '../../../translate/cost.ts'
import { warningInput, warningTexts } from '../../warnings.ts'
import { BACK, action, type Section } from '../screen.ts'

const REFRESH_BALANCE = { text: '🔄 Обновить', data: action('bal', 'refresh') }

/** Остаток и откуда он: у ключа свой лимит, у счёта свой баланс, работает меньшее. */
function remainingLine(balance: Balance): string {
  const { account, keyLeft, accountHidden } = balance
  const accountUnknown = accountHidden ? 'баланс счёта этим ключом не виден' : 'баланс счёта сейчас не узнать'
  if (account !== null && keyLeft !== null) {
    return `Осталось: ${money(balance.remaining!)} — меньшее из баланса счёта (${money(account)}) и лимита ключа (${money(keyLeft)})`
  }
  if (account !== null) return `Осталось: ${money(account)} — баланс счёта, лимита у ключа нет`
  if (keyLeft !== null) return `Осталось: ${money(keyLeft)} — до лимита ключа; ${accountUnknown}`
  return `Остаток не узнать: ${accountUnknown}`
}

/**
 * «— на остаток хватит примерно на 46 000 переводов». Остатка не узнать, модель бесплатная или
 * цена битая — без этой части: деление на ноль дало бы «NaN переводов».
 */
function enoughPart(remaining: number | null, price: ModelPrice): string {
  const phrase = remaining === null ? null : translationsPhrase(remaining, price)
  return phrase ? ` — на остаток хватит примерно на ${phrase}` : ''
}

/** Баланс провайдера, который сейчас переводит. Видит бот его только у провайдеров со счётом. */
export const BALANCE: Section = {
  id: 'bal',
  button: '💰 Баланс',
  needs: { account: true },

  render(ctx) {
    const { model } = ctx.config
    if (!model.ok) return { html: '<b>💰 Баланс</b>\n\nКлюча модели нет — нажмите «🔑 Ключ».', keyboard: [[BACK]] }
    const label = escapeHtml(model.provider.label)
    if (!ctx.account) {
      return {
        html: `<b>💰 Баланс</b>\n\nБаланс ${label} бот не видит — смотрите в кабинете провайдера: ${escapeHtml(model.provider.keysUrl)}`,
        keyboard: [[BACK]],
      }
    }
    const { balance, rejected } = ctx.account
    const { prices } = ctx
    if (rejected) {
      // Не «нет связи»: обновлять бесполезно, пока ключ не заменят. Ключ из .env панель не заменит.
      const how = model.keySource === 'env' ? `Проверьте ${escapeHtml(model.provider.envKey)} в .env.` : 'Вставьте новый ключ: «🔑 Ключ».'
      return {
        html: `<b>💰 Баланс ${label}</b>\n\n${label} не принял ключ — остаток не узнать. ${how}`,
        keyboard: [[REFRESH_BALANCE], [BACK]],
      }
    }
    if (!balance) {
      return {
        html: `<b>💰 Баланс ${label}</b>\n\nОстаток сейчас не узнать: нет связи с ${label}`,
        keyboard: [[REFRESH_BALANCE], [BACK]],
      }
    }

    const lines = [`<b>💰 Баланс ${label}</b>`, '', remainingLine(balance)]
    if (balance.spentToday !== null && balance.spentMonth !== null) {
      lines.push(`Потрачено ключом: сегодня ${money(balance.spentToday)}, в этом месяце ${money(balance.spentMonth)}`)
    }
    const price = prices?.get(model.model)
    if (price) {
      const title = escapeHtml(model.title)
      lines.push(`Модель ${title}: ${money(price.input * 1e6)} за 1 млн токенов на вход, ${money(price.output * 1e6)} на выход`)
      lines.push(`Один перевод ≈ ${money(translationCost(price))}${enoughPart(balance.remaining, price)}`)
    }
    lines.push(`Ключ ${expiryTerm(balance.expiresAt)}`)
    // Те же предупреждения, что приходят в личку: ключ истекает, деньги кончаются, модель уходит.
    const warnings = warningTexts(warningInput(model, balance, prices, ctx.now))
    if (warnings.length > 0) lines.push('', ...warnings.map((text) => `⚠️ ${escapeHtml(text)}`))
    return { html: lines.join('\n'), keyboard: [[REFRESH_BALANCE], [BACK]] }
  },

  // «🔄 Обновить» — экран заново со свежим снимком счёта, мимо минутного кэша.
  act: (_ctx, _env, act) => (act === 'refresh' ? { show: 'section', fresh: true } : { show: 'section' }),
}
