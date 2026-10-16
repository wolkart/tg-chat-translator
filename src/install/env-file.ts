import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseDotEnv } from '../env.ts'
import type { SetupStep } from './run.ts'

const HEADER = '# Записал установщик. Ключ модели, языки и остальное настраиваются в боте: /start.'

/** Что уже лежит в .env: файла нет — пусто. */
export function readEnvFile(path: string): { raw: string; values: Record<string, string> } {
  if (!existsSync(path)) return { raw: '', values: {} }
  const raw = readFileSync(path, 'utf8')
  return { raw, values: parseDotEnv(raw) }
}

/**
 * Новый .env — только токен и владелец: всё остальное панель. В уже заполненном файле
 * меняются только эти две строки — чужие строки и комментарии разработчика остаются.
 */
export function renderEnv(raw: string, values: { BOT_TOKEN: string; OWNER_ID: string }): string {
  // Пустой файл — заголовок, дальше тот же путь, что дописывает недостающие ключи.
  let text = !raw.trim() ? `${HEADER}\n` : raw.endsWith('\n') ? raw : raw + '\n'
  for (const [key, value] of Object.entries(values)) {
    // [ \t], а не \s: \s с флагом m захватил бы пустые строки над ключом и склеил блоки файла.
    const line = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, 'm')
    text = line.test(text) ? text.replace(line, `${key}=${value}`) : text + `${key}=${value}\n`
  }
  return text
}

/**
 * Запись .env — только если что-то спросили заново. Права 600: в файле токен, а это пароль
 * от бота. chmod отдельно, потому что writeFileSync не меняет права у файла, который уже
 * есть, — на сервере пустой .env создаётся заранее.
 */
export const writeEnvStep: SetupStep = {
  id: 'write-env',
  async run(ctx) {
    const { token, ownerId } = ctx.answers
    // Что-то спросили заново — значит, ответ отличается от записанного в .env.
    if (token === ctx.existing.BOT_TOKEN && String(ownerId) === ctx.existing.OWNER_ID) return { ok: true }
    const { raw } = readEnvFile(ctx.envPath)
    writeFileSync(ctx.envPath, renderEnv(raw, { BOT_TOKEN: token!, OWNER_ID: String(ownerId!) }), { mode: 0o600 })
    chmodSync(ctx.envPath, 0o600)
    ctx.io.say('✓ Токен и владелец записаны в .env — читать этот файл можете только вы')
    return { ok: true }
  },
}
