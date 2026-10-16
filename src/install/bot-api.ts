/**
 * Вызов Bot API напрямую, без grammY: установщику нужен точный контроль над параметрами
 * (getUpdates без offset и allowed_updates — см. owner.ts) и над тем, что считать обрывом сети.
 * Токен попадает в адрес запроса, поэтому сюда передаётся только токен, прошедший
 * TOKEN_PATTERN, и текст ошибки fetch наружу не выводится.
 */
export type BotApiResult<T> =
  | { kind: 'ok'; result: T }
  | { kind: 'error'; code: number; description: string }
  | { kind: 'network' }

export async function callBotApi<T = unknown>(
  fetchImpl: typeof fetch,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 15_000,
): Promise<BotApiResult<T>> {
  let response: Response
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { kind: 'network' }
  }
  type Body = { ok?: boolean; result?: T; error_code?: number; description?: string }
  let body: Body
  try {
    body = (await response.json()) as Body
  } catch {
    // Не JSON — ответил не Bot API, а прокси или балансировщик перед ним.
    return { kind: 'error', code: response.status, description: '' }
  }
  if (body.ok) return { kind: 'ok', result: body.result as T }
  return { kind: 'error', code: body.error_code ?? response.status, description: body.description ?? '' }
}
