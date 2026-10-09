import { readFileSync } from 'node:fs'

/**
 * Разбор .env без зависимостей: KEY=значение, комментарии, кавычки.
 * Портировано из news-reposter.
 */
export function parseDotEnv(raw: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()

    // Комментарий в конце строки: KEY=значение  # пояснение.
    // Отрезаем, только если перед # есть пробел или значение целиком
    // начинается с # — иначе испортим ключ, где # является символом.
    if (!/^["']/.test(value)) {
      value = value.startsWith('#') ? '' : value.replace(/\s+#.*$/, '').trim()
    }

    values[key] = value.replace(/^["']|["']$/g, '')
  }
  return values
}

export type Env = {
  botToken: string
  ownerId: number
  /** Ключи провайдеров моделей по имени переменной: OPENROUTER_API_KEY → значение */
  providerKeys: Record<string, string>
  localBaseUrl: string | undefined
  dbPath: string
  /** Всё, что нельзя показывать ни владельцу, ни в консоли */
  secrets: string[]
}

export type EnvResult = { ok: true; env: Env } | { ok: false; missing: string[] }

/**
 * Собирает настройки из переменных окружения.
 * fileValues — то, что прочитано из .env: эти значения тоже секреты,
 * даже если переменная программе не нужна (TEST_* и прочее).
 */
export function readEnv(
  vars: Record<string, string | undefined>,
  fileValues: Record<string, string> = {},
): EnvResult {
  const get = (name: string) => vars[name]?.trim() || undefined
  const missing: string[] = []

  const botToken = get('BOT_TOKEN')
  if (!botToken) missing.push('BOT_TOKEN')

  const ownerRaw = get('OWNER_ID')
  if (!ownerRaw) missing.push('OWNER_ID')
  else if (!/^\d+$/.test(ownerRaw)) missing.push('OWNER_ID (должно быть числом)')

  // Падаем со списком всего, чего не хватает, а не по одному.
  if (missing.length > 0 || !botToken || !ownerRaw) return { ok: false, missing }

  // Ключ провайдера — любая переменная *_API_KEY: таблица провайдеров сама
  // знает, какая ей нужна, и новый провайдер не требует правки этого файла.
  const providerKeys: Record<string, string> = {}
  for (const [name, value] of Object.entries(vars)) {
    if (name.endsWith('_API_KEY') && value?.trim()) providerKeys[name] = value.trim()
  }

  const localBaseUrl = get('LOCAL_BASE_URL')
  const secrets = [botToken, ...Object.values(providerKeys), ...Object.values(fileValues)]
  if (localBaseUrl) secrets.push(localBaseUrl)

  return {
    ok: true,
    env: {
      botToken,
      ownerId: Number(ownerRaw),
      providerKeys,
      localBaseUrl,
      dbPath: get('DB_PATH') ?? 'data/translator.db',
      secrets: [...new Set(secrets.filter((value) => value.length > 0))],
    },
  }
}

/** Читает .env (если есть) и окружение. Переменные окружения важнее файла: так в Docker их задают снаружи. */
export function loadEnv(path = '.env'): EnvResult {
  let fileValues: Record<string, string> = {}
  try {
    fileValues = parseDotEnv(readFileSync(path, 'utf8'))
  } catch {
    // .env нет — берём только окружение (Docker, CI)
  }
  return readEnv({ ...fileValues, ...process.env }, fileValues)
}
