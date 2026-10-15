import { createPanel } from '../src/owner/panel/panel.ts'
import type { InlineButton } from '../src/telegram.ts'
import { OWNER_ID } from './helpers.ts'
import type { setupDeps } from './setup.ts'

type Setup = ReturnType<typeof setupDeps>

/**
 * Панель, открытая по /start, и нажатия её кнопок — как их пришлёт Telegram: данные кнопки и
 * номер сообщения панели. Каждое нажатие возвращает экран после правки и всплывающий текст.
 */
export async function openPanel(ctx: Setup) {
  const panel = createPanel(ctx.deps)
  await panel.open(OWNER_ID)
  const message = ctx.tg.callsOf('sendText').at(-1)!
  let pressed = 0
  let screen = { html: message.text, keyboard: message.opts.keyboard ?? [] }

  async function press(data: string) {
    const id = `cb${++pressed}`
    await panel.onCallback({ id, data, messageId: message.id }, OWNER_ID)
    const edit = ctx.tg.callsOf('editText').at(-1)
    if (edit && edit.messageId === message.id) screen = { html: edit.text, keyboard: edit.opts?.keyboard ?? [] }
    const answer = ctx.tg.callsOf('answerCallback').find((call) => call.callbackId === id)
    return { ...screen, toast: answer?.text }
  }

  return {
    panel,
    messageId: message.id,
    get screen() {
      return screen
    },
    press,
    /** Нажать кнопку текущего экрана по её тексту. */
    async tap(text: string | RegExp) {
      const button = findButton(screen.keyboard, text)
      if (!button?.data) throw new Error(`нет кнопки ${String(text)} на экране:\n${screen.html}`)
      return press(button.data)
    },
  }
}

export function findButton(keyboard: readonly (readonly InlineButton[])[], text: string | RegExp): InlineButton | undefined {
  return keyboard.flat().find((button) => (typeof text === 'string' ? button.text === text : text.test(button.text)))
}
