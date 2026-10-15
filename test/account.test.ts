import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkKeyByModels, createAccounts, type Http } from '../src/translate/account.ts'
import { PRICES_TTL_MS, createOpenRouterAccount } from '../src/translate/openrouter.ts'
import { PROVIDERS, getProvider, looksLikeKey } from '../src/translate/providers.ts'
import { T0 } from './helpers.ts'

/** Сохранённый живой ответ OpenRouter (2026-10-15), обезличенный. */
function sample(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as Record<string, unknown>
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Подделка сети: ответ по адресу; адреса и заголовки запросов записываются. */
function fakeHttp(routes: Record<string, () => Response | Promise<Response>>, clock = { now: T0 }) {
  const requests: { url: string; auth: string | null }[] = []
  const http: Http = {
    now: () => clock.now,
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') })
      const path = new URL(String(url)).pathname
      const route = routes[path]
      if (!route) throw new TypeError('fetch failed')
      return route()
    }) as typeof fetch,
  }
  return { http, requests, clock }
}

const KEY = `sk-or-v1-${'ab'.repeat(32)}`

test('спека: остаток — меньшее из баланса счёта и лимита ключа', async () => {
  const { http, requests } = fakeHttp({
    '/api/v1/key': () => json(sample('openrouter-key')),
    '/api/v1/credits': () => json(sample('openrouter-credits')),
  })
  const balance = await createOpenRouterAccount(http).balance(KEY)
  assert.ok(balance)
  assert.equal(balance.account?.toFixed(2), '6.53')
  assert.equal(balance.keyLeft?.toFixed(2), '9.80')
  assert.equal(balance.remaining?.toFixed(2), '6.53')
  assert.equal(balance.accountHidden, false)
  assert.equal(balance.spentToday, 0)
  assert.equal(balance.spentMonth?.toFixed(2), '0.20')
  assert.equal(new Date(balance.expiresAt!).toISOString(), '2026-10-16T20:04:00.002Z')
  assert.ok(requests.every((request) => request.auth === `Bearer ${KEY}`))
})

test('спека: ключ без лимита — остаток по счёту', async () => {
  const key = sample('openrouter-key') as { data: Record<string, unknown> }
  const { http } = fakeHttp({
    '/api/v1/key': () => json({ data: { ...key.data, limit: null, limit_remaining: null } }),
    '/api/v1/credits': () => json(sample('openrouter-credits')),
  })
  const balance = await createOpenRouterAccount(http).balance(KEY)
  assert.equal(balance?.keyLeft, null)
  assert.equal(balance?.remaining?.toFixed(2), '6.53')
})

test('спека: баланс счёта не виден (403) — остаток по лимиту ключа', async () => {
  const { http } = fakeHttp({
    '/api/v1/key': () => json(sample('openrouter-key')),
    '/api/v1/credits': () => json({ error: { message: 'Only management keys can perform this operation', code: 403 } }, 403),
  })
  const balance = await createOpenRouterAccount(http).balance(KEY)
  assert.equal(balance?.accountHidden, true)
  assert.equal(balance?.account, null)
  assert.equal(balance?.remaining?.toFixed(2), '9.80')
})

test('спека: OpenRouter не ответил — остаток не узнать', async () => {
  const { http } = fakeHttp({})
  assert.equal(await createOpenRouterAccount(http).balance(KEY), null)
  assert.deepEqual(await createOpenRouterAccount(http).verify!(KEY), { verdict: 'unknown', reason: 'нет связи с OpenRouter' })
})

test('ответ без половины полей не роняет разбор', async () => {
  const { http } = fakeHttp({
    '/api/v1/key': () => json({ data: { limit: 5 } }),
    '/api/v1/credits': () => new Response('<html>oops</html>', { status: 200 }),
  })
  const balance = await createOpenRouterAccount(http).balance(KEY)
  assert.deepEqual(balance, {
    remaining: null,
    account: null,
    accountHidden: false,
    keyLeft: null,
    spentToday: null,
    spentMonth: null,
    expiresAt: null,
  })
})

test('проверка ключа OpenRouter — через /key: 401 — не принят, 200 — принят с балансом', async () => {
  const rejected = fakeHttp({
    '/api/v1/key': () => json({ error: { message: 'User not found.', code: 401 } }, 401),
    '/api/v1/credits': () => json({ error: { code: 401 } }, 401),
    // Список моделей открыт без ключа: если бы проверка шла по нему, ключ «приняли» бы.
    '/api/v1/models': () => json(sample('openrouter-models')),
  })
  assert.deepEqual(await createOpenRouterAccount(rejected.http).verify!(KEY), { verdict: 'rejected' })
  assert.ok(!rejected.requests.some((request) => request.url.endsWith('/models')))

  const accepted = fakeHttp({
    '/api/v1/key': () => json(sample('openrouter-key')),
    '/api/v1/credits': () => json(sample('openrouter-credits')),
  })
  const check = await createOpenRouterAccount(accepted.http).verify!(KEY)
  assert.equal(check.verdict, 'ok')
  assert.equal(check.verdict === 'ok' && check.balance?.remaining?.toFixed(2), '6.53')
})

test('цены: за токен из /models, дата ухода модели, кэш на час', async () => {
  const { http, requests, clock } = fakeHttp({ '/api/v1/models': () => json(sample('openrouter-models')) })
  const account = createOpenRouterAccount(http)
  const prices = await account.prices()
  assert.deepEqual(prices?.get('anthropic/claude-haiku-5.5'), { input: 0.0000001, output: 0.0000005, expiresAt: null })
  assert.equal(new Date(prices!.get('google/gemini-2.5-flash')!.expiresAt!).toISOString(), '2026-10-20T00:00:00.000Z')
  assert.equal(requests[0]!.auth, null)
  await account.prices()
  assert.equal(requests.length, 1)
  clock.now += PRICES_TTL_MS
  await account.prices()
  assert.equal(requests.length, 2)
})

test('цены не узнать — null, и неудача не кэшируется', async () => {
  let up = false
  const { http, requests } = fakeHttp({
    '/api/v1/models': () => (up ? json(sample('openrouter-models')) : new Response('down', { status: 502 })),
  })
  const account = createOpenRouterAccount(http)
  assert.equal(await account.prices(), null)
  up = true
  assert.ok(await account.prices())
  assert.equal(requests.length, 2)
})

test('общая проверка ключа по списку моделей: 200 — принят, 401 — нет, тайм-аут — не проверить', async () => {
  const deepseek = getProvider('deepseek')
  const ok = fakeHttp({ '/v1/models': () => json({ data: [] }) })
  assert.deepEqual(await checkKeyByModels(deepseek, 'k', deepseek.baseUrl, ok.http), { verdict: 'ok', balance: null })
  assert.equal(ok.requests[0]!.url, 'https://api.deepseek.com/v1/models')
  assert.equal(ok.requests[0]!.auth, 'Bearer k')

  const bad = fakeHttp({ '/v1/models': () => json({ error: 'invalid' }, 401) })
  assert.deepEqual(await checkKeyByModels(deepseek, 'k', deepseek.baseUrl, bad.http), { verdict: 'rejected' })

  const hanging: Http = {
    now: () => T0,
    fetchImpl: (() => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))) as typeof fetch,
  }
  assert.deepEqual(await checkKeyByModels(deepseek, 'k', deepseek.baseUrl, hanging), {
    verdict: 'unknown',
    reason: 'нет связи с DeepSeek',
  })
})

test('счета: у OpenRouter свой, у остальных нет; проверка ключа идёт туда, где она есть', async () => {
  const { http, requests } = fakeHttp({
    '/api/v1/key': () => json(sample('openrouter-key')),
    '/api/v1/credits': () => json(sample('openrouter-credits')),
    '/v1/models': () => json({ data: [] }),
  })
  const accounts = createAccounts(PROVIDERS, http)
  assert.ok(accounts.of(getProvider('openrouter')))
  assert.equal(accounts.of(getProvider('deepseek')), undefined)
  await accounts.verify(getProvider('openrouter'), KEY, getProvider('openrouter').baseUrl)
  await accounts.verify(getProvider('deepseek'), 'k', getProvider('deepseek').baseUrl)
  assert.deepEqual(
    requests.map((request) => new URL(request.url).pathname),
    ['/api/v1/key', '/api/v1/credits', '/v1/models'],
  )
})

test('ключ по виду: синтетические ключи каждого провайдера узнаются, обычный текст — нет', () => {
  const samples = [
    `вот ключ sk-or-v1-${'0123456789abcdef'.repeat(4)}`,
    `sk-${'a1B2'.repeat(8)}`,
    `gsk_${'Ab3'.repeat(14)}`,
  ]
  for (const text of samples) assert.equal(looksLikeKey(text), true, text)
  for (const text of ['скинь ссылку на sk-board', 'sk-or-v1-short', 'ok, see you', 'task-1234567890abcdef']) {
    assert.equal(looksLikeKey(text), false, text)
  }
})
