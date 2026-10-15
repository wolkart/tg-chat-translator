import { dayMonth, money, plural, roughly, spaced } from '../../../format.ts'
import { escapeHtml } from '../../../html.ts'
import type { Balance } from '../../../translate/account.ts'
import { translationCost } from '../../../translate/cost.ts'
import { BACK, action, type Section } from '../screen.ts'
import { modelLeaving } from '../status.ts'

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

/** Баланс провайдера, который сейчас переводит. Видит бот его только у провайдеров со счётом. */
export const BALANCE: Section = {
  id: 'bal',
  button: '💰 Баланс',

  render(ctx) {
    const { model } = ctx.config
    if (!model.ok) return { html: '<b>💰 Баланс</b>\n\nКлюча модели нет — нажмите «🔑 Ключ».', keyboard: [[BACK]] }
    const label = escapeHtml(model.provider.label)
    if (!ctx.account) {
      return {
        html: `<b>💰 Баланс</b>\n\nБаланс ${label} бот не видит — смотрите в кабинете провайдера: ${model.provider.keysUrl}`,
        keyboard: [[BACK]],
      }
    }
    const { balance, prices } = ctx.account
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
      const cost = translationCost(price)
      const left =
        balance.remaining !== null && cost > 0
          ? ` — на остаток хватит примерно на ${spaced(roughly(balance.remaining / cost))} ${plural(roughly(balance.remaining / cost), ['перевод', 'перевода', 'переводов'])}`
          : ''
      lines.push(`Один перевод ≈ ${money(cost)}${left}`)
    }
    lines.push(balance.expiresAt === null ? 'Ключ бессрочный' : `Ключ действует до ${dayMonth(balance.expiresAt)}`)
    if (price?.expiresAt) lines.push(modelLeaving(model.provider.label, price.expiresAt))
    return { html: lines.join('\n'), keyboard: [[REFRESH_BALANCE], [BACK]] }
  },

  // «🔄 Обновить» — свежий снимок счёта: панель узнаёт его по действию refresh.
  act: () => ({ show: 'section' }),
}
