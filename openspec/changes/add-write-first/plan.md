# План реализации: написать первым (add-write-first)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Владелец пишет иностранцу первым или упирается в правило суток — и получает готовый перевод с кнопками «Отправить через бота» и «Скопировать»; ответ собеседника ложится в тему, дальше всё снова автоматически.

**Architecture:** Новый модуль `src/owner/manual-send.ts` — оформление перевода для ручной отправки, кнопки, вход «Написать первым» и ответ на inline-запрос. Черновики перевода живут в таблице `drafts`: кнопка «Отправить через бота» находит перевод по номеру, а отправленное владельцем бот узнаёт по тексту. Причины отказа Telegram и ошибки провайдера — таблицы (`SEND_REFUSALS`, `PROVIDER_ERRORS`). Конвейер лички получает шаг `черновик`, реестр обработчиков — строку `inline-запрос`, маршрут ответа — вид `new`.

**Tech Stack:** TypeScript на Node 24 (`.ts` без сборки), grammy 1.46 (Bot API 9.4: `copy_text`, `switch_inline_query_chosen_chat`, `style`), `node:sqlite`, `node:test`.

**Создан:** 2026-10-12

**Spec:** `openspec/changes/add-write-first/` — `proposal.md`, `specs/*/spec.md`, `design.md`, `tasks.md`. План раскладывает `tasks.md` и не добавляет поведения: если план и спека расходятся, права спека. Каждая задача ниже называет пункты `tasks.md`, которые закрывает.

## Global Constraints

- Node ≥ 24, только стираемый синтаксис TypeScript (`verbatimModuleSyntax`, `erasableSyntaxOnly`): без `enum`, `namespace` и свойств в параметрах конструктора; типы — через `import type`.
- Зависимость в проде одна — `grammy` `^1.46.0`. Ничего не добавлять.
- Таблицы создаются при старте `CREATE TABLE IF NOT EXISTS`, миграций нет. Новая таблица — `drafts`.
- Тесты — `node:test`, `npm test`; сеть и модель в тестах не вызываются.
- Секреты не попадают ни в сообщения владельцу, ни в консоль — замена на `***` (`createScrubber`). Сырой ответ провайдера — только в консоль.
- Текст собеседника и модели перед `parse_mode: HTML` проходит `escapeHtml`. Собеседнику — обычный текст; вариант inline-ответа — `message_text` без `parse_mode`.
- Inline-запросы — только владельцу; ответ всегда с `is_personal: true` и `cache_time: 0`.
- «Скопировать» — перевод не длиннее 256 символов; «Отправить через бота» — не длиннее 4096. Черновик живёт 7 дней (`DRAFT_TTL`).
- «Активный разговор» — собеседник писал не раньше 24 часов назад. Разговор, заведённый отправкой через бота, получает `lastPeerAt = 0`.
- `allowed_updates`: `business_connection`, `business_message`, `message`, `callback_query`, `inline_query` (константа `ALLOWED_UPDATES`).
- Тексты бота — дословно из спек. Путь к настройке — «Настройки → Аккаунт → Автоматизация чатов», на Mac — «Настройки → Изменить профиль → Автоматизация чатов».
- Комментарии в коде — по-русски и объясняют «почему».
- Работа в ветке `feat/write-first` в каталоге продукта, без worktree. Коммит после каждой задачи с трейлером `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Пуш и слияние в `main` — только по команде автора.
- Код каждой задачи уже собран и прогнан в черновике контроллера. Исполнитель **накладывает патч** (`git apply`), а не переписывает код руками: так не теряются невидимые символы и мелочи. Патчи лежат в `.superpowers/sdd/write-first/task-N-test.patch` и `task-N-src.patch` (каталог в `.gitignore`), их текст — в задачах ниже. Патч не лёг — стоп и вопрос контроллеру, руками не чинить.
- Правила остановки из `../CLAUDE.md`, раздел «Как пишется код», отменяют правило Superpowers «решай сам и иди дальше». Сам исполнитель чинит только то, что не меняет поведения. Стоп и вопрос автору — если платформа ведёт себя не так, как в спеке; если задача требует больше спеки; если план противоречит спеке; если 5 кругов исправлений не закрыли замечание; если нужен живой аккаунт; если затронуты секреты, данные собеседников или публичный репозиторий.

## Review Focus

1. **Имя собеседника с «<» и «&» в тексте «Не отправлено»** — экранировано, сообщение в теме не ломается и не получает чужой разметки. Тест — в Task 10 («имя собеседника с «<» и «&»…»).
2. **Длинный перевод с «</pre>» и «&»** — блок кода не закрывается раньше времени, Telegram принимает сообщение. Тест — в Task 6 («длинный перевод с «</pre>»…»).
3. **Владелец вставил скопированный перевод, а буфер обмена добавил перевод строки** — бот всё равно узнаёт перевод и показывает «Вы: оригинал → перевод». Тесты — в Task 3 («…с другими переводами строк…») и Task 11 («вставленный перевод…»).
4. **Telegram повторно доставил сообщение «via @бот» после перезапуска** — одна тема и одна строка «Вы:». Тест — в Task 11 («отправка через бота, доставленная повторно…»).
5. **Короткое «OK» другу совпало с переводом** — тема у друга не появляется: разговор заводит только `via_bot`. Тест — в Task 11 («короткое «OK» другу…»).

## Для автора: как устроен план

Код в плане не придуман на ходу: весь он собран и прогнан в черновой копии проекта. После каждой задачи проверка типов чистая и все тесты зелёные (246 → 250 → 254 → 259 → 265 → 268 → 280 → 291 → 296 → 300 → 313 → 320). Тесты каждой задачи, наложенные без её кода, падают — это проверено.

| # | Задача | Пункты tasks.md | Кто |
|---|---|---|---|
| 1 | Кнопки и inline-ответ в обёртке Telegram | 1.1, 1.2 | субагент |
| 2 | Inline Mode: проверка при старте и без перезапуска | 1.3 | субагент |
| 3 | Черновики в базе | 2.1, 2.2 | субагент |
| 4 | Ошибки провайдера понятным текстом | 3.1, 3.2 | субагент |
| 5 | Путь к настройке и строка «Написать первым» в статусе | 4.1 | субагент |
| 6 | Оформление и кнопки ручной отправки | 5.1, 5.2 | субагент |
| 7 | «Написать первым» и ответ на inline-запрос | 5.3, 5.4 | субагент |
| 8 | Маршрут и «Кому?» | 6.1, 6.2, 6.3 | субагент |
| 9 | Inline-запрос в диспетчере | 7.1 | субагент |
| 10 | «Не отправлено» — причины и кнопки | 8.1–8.4 | субагент |
| 11 | Отправка через бота заводит разговор | 9.1–9.4 | субагент |
| 12 | Живая проверка | 10.1–10.5 | **с автором**, субагенту не отдаётся |
| 13 | Ревью всего изменения | 11.1 | контроллер |

Живой сеанс с автором один (Task 12) и начинается с разведки inline-режима. Код Task 11 написан по документации Bot API на образце, собранном вручную; разведка снимает настоящий образец. Если в нём нет `via_bot` — стоп и вопрос автору.

## Как исполнять задачу (кроме 12 и 13)

1. `git apply --check` обоих патчей задачи — без ошибок.
2. Наложить тесты (`task-N-test.patch`), запустить `npm test` — новые тесты падают.
3. Наложить код (`task-N-src.patch`), запустить `npm test` и `npm run typecheck` — всё зелёное, число тестов как в задаче.
4. `git status --short` — изменены ровно файлы из «Files» задачи.
5. Коммит с сообщением из задачи и трейлером.

---
### Task 1: Кнопки и inline-ответ в обёртке Telegram

Закрывает: `tasks.md` 1.1, 1.2.

**Files:**
- Modify: `src/telegram.ts` — `ButtonStyle`, новый `InlineButton`, `InlineArticle`, `InlineAnswerButton`, `toInlineKeyboard`, `BotInfo.supportsInlineQueries`, `TelegramApi.answerInline`
- Modify: `test/fakes.ts` — вызов `answerInline`, `getMe` отдаёт `supportsInlineQueries: true`
- Modify: `test/routing.test.ts` — `button.data!`: поле `data` стало необязательным
- Modify: `test/startup.test.ts` — `supportsInlineQueries` в образце `BotInfo`
- Create: `test/telegram.test.ts`

**Interfaces:**
- Produces: `type ButtonStyle = 'success' | 'primary' | 'danger'`; `type InlineButton = { text: string; data?: string; copy?: string; chooseChat?: string; style?: ButtonStyle }`; `type InlineArticle = { id: string; title: string; description: string; text: string }`; `type InlineAnswerButton = { text: string; startParameter: string }`; `toInlineKeyboard(keyboard: readonly (readonly InlineButton[])[]): InlineKeyboardButton[][]`; `TelegramApi.answerInline(queryId: string, articles: readonly InlineArticle[], opts?: { button?: InlineAnswerButton }): Promise<void>`; `BotInfo.supportsInlineQueries: boolean`.
- Подделка: `Call` с `method: 'answerInline'` и полями `queryId`, `articles`, `button?`.

- [ ] **Step 1: Наложить тесты**

```bash
git apply .superpowers/sdd/write-first/task-1-test.patch
```

<details><summary>task-1-test.patch</summary>

```diff
diff --git a/test/fakes.ts b/test/fakes.ts
index 600e460..920e960 100644
--- a/test/fakes.ts
+++ b/test/fakes.ts
@@ -1,4 +1,4 @@
-import type { BotInfo, BusinessConnectionInfo, MediaOptions, TelegramApi } from '../src/telegram.ts'
+import type { BotInfo, BusinessConnectionInfo, InlineAnswerButton, InlineArticle, MediaOptions, TelegramApi } from '../src/telegram.ts'
 import type { MediaKind } from '../src/types.ts'
 
 export type Call =
@@ -11,6 +11,7 @@ export type Call =
   | { method: 'editText'; chatId: number; messageId: number; text: string }
   | { method: 'deleteMessage'; chatId: number; messageId: number }
   | { method: 'getMe' }
+  | { method: 'answerInline'; queryId: string; articles: readonly InlineArticle[]; button?: InlineAnswerButton }
 
 type Method = Call['method']
 
@@ -75,7 +76,18 @@ export function fakeTelegram(init: { connections?: BusinessConnectionInfo[]; me?
     async getMe() {
       calls.push({ method: 'getMe' })
       maybeFail('getMe')
-      return { id: 300003, username: 'translator_test_bot', canConnectToBusiness: true, hasTopicsEnabled: true, ...init.me }
+      return {
+        id: 300003,
+        username: 'translator_test_bot',
+        canConnectToBusiness: true,
+        hasTopicsEnabled: true,
+        supportsInlineQueries: true,
+        ...init.me,
+      }
+    },
+    async answerInline(queryId, articles, opts = {}) {
+      calls.push({ method: 'answerInline', queryId, articles, ...(opts.button && { button: opts.button }) })
+      maybeFail('answerInline')
     },
   }
 
diff --git a/test/routing.test.ts b/test/routing.test.ts
index 405ce4f..9222265 100644
--- a/test/routing.test.ts
+++ b/test/routing.test.ts
@@ -96,7 +96,7 @@ test('«Кому?» — вопрос с кнопками в ответ на со
 test('выбор адресата: сообщение уходит ему, вопрос превращается в «Отправлено <имя>»', async () => {
   const { deps, question, sent, send, tg } = await asked()
   const annaButton = question.opts.keyboard![1]![0]!
-  await onChoice(deps, { id: 'CB1', data: annaButton.data }, send)
+  await onChoice(deps, { id: 'CB1', data: annaButton.data! }, send)
   assert.equal(sent.length, 1)
   assert.equal(sent[0]!.conversation.peerName, 'Anna')
   assert.deepEqual(sent[0]!.payload, payload)
@@ -106,8 +106,8 @@ test('выбор адресата: сообщение уходит ему, во
 test('повторное нажатие ничего не отправляет', async () => {
   const { deps, question, sent, send, tg } = await asked()
   const button = question.opts.keyboard![0]![0]!
-  await onChoice(deps, { id: 'CB1', data: button.data }, send)
-  await onChoice(deps, { id: 'CB2', data: button.data }, send)
+  await onChoice(deps, { id: 'CB1', data: button.data! }, send)
+  await onChoice(deps, { id: 'CB2', data: button.data! }, send)
   assert.equal(sent.length, 1)
   assert.equal(tg.callsOf('answerCallback').at(-1)!.text, ALREADY_HANDLED)
 })
@@ -115,28 +115,28 @@ test('повторное нажатие ничего не отправляет',
 test('«Отмена» ничего не отправляет и удаляет вопрос', async () => {
   const { deps, question, sent, send, tg } = await asked()
   const cancel = question.opts.keyboard!.at(-1)![0]!
-  await onChoice(deps, { id: 'CB1', data: cancel.data }, send)
+  await onChoice(deps, { id: 'CB1', data: cancel.data! }, send)
   assert.equal(sent.length, 0)
   assert.deepEqual(tg.callsOf('deleteMessage')[0], { method: 'deleteMessage', chatId: OWNER_ID, messageId: question.id })
 })
 
 test('не ушло — вопрос говорит об этом', async () => {
   const { deps, question, tg } = await asked()
-  await onChoice(deps, { id: 'CB1', data: question.opts.keyboard![0]![0]!.data }, async () => false)
+  await onChoice(deps, { id: 'CB1', data: question.opts.keyboard![0]![0]!.data! }, async () => false)
   assert.equal(tg.callsOf('editText')[0]!.text, 'Не отправлено Timon — причина в теме')
 })
 
 test('отложенное «Кому?» старше суток чистится', async () => {
   const { deps, store, question, sent, send } = await asked()
   store.cleanup(T0 + DAY + 1)
-  await onChoice(deps, { id: 'CB1', data: question.opts.keyboard![0]![0]!.data }, send)
+  await onChoice(deps, { id: 'CB1', data: question.opts.keyboard![0]![0]!.data! }, send)
   assert.equal(sent.length, 0)
 })
 
 test('ответ на «Отправлено <имя>» (бывший «Кому?») уходит выбранному собеседнику', async () => {
   const { deps, question, send } = await asked()
   const annaButton = question.opts.keyboard![1]![0]!
-  await onChoice(deps, { id: 'CB1', data: annaButton.data }, send)
+  await onChoice(deps, { id: 'CB1', data: annaButton.data! }, send)
   const route = routeOwnerMessage({ replyToMessageId: question.id }, deps.store, OWNER_ID, deps.now())
   assert.equal(route.kind, 'conversation')
   if (route.kind === 'conversation') assert.equal(route.conversation.peerName, 'Anna')
diff --git a/test/startup.test.ts b/test/startup.test.ts
index 32da9cb..51332ca 100644
--- a/test/startup.test.ts
+++ b/test/startup.test.ts
@@ -8,7 +8,7 @@ import { PROVIDER_DEFAULTS } from '../src/translate/providers.ts'
 import { fakeTelegram } from './fakes.ts'
 import { OWNER_ID } from './helpers.ts'
 
-const healthy: BotInfo = { id: 300003, username: 'translator_test_bot', canConnectToBusiness: true, hasTopicsEnabled: true }
+const healthy: BotInfo = { id: 300003, username: 'translator_test_bot', canConnectToBusiness: true, hasTopicsEnabled: true, supportsInlineQueries: true }
 
 function setup() {
   const tg = fakeTelegram()
diff --git a/test/telegram.test.ts b/test/telegram.test.ts
new file mode 100644
index 0000000..6bcb433
--- /dev/null
+++ b/test/telegram.test.ts
@@ -0,0 +1,63 @@
+import { test } from 'node:test'
+import assert from 'node:assert/strict'
+import type { Api } from 'grammy'
+import { createTelegramApi, toInlineKeyboard } from '../src/telegram.ts'
+
+test('кнопки: нажатие боту, копирование, выбор чата и цвет — в формате Bot API', () => {
+  assert.deepEqual(
+    toInlineKeyboard([
+      [{ text: 'Отправить через бота', chooseChat: '42', style: 'success' }],
+      [{ text: 'Скопировать', copy: 'Hi!' }],
+      [{ text: 'Отмена', data: 'cancel:1' }],
+    ]),
+    [
+      [{ text: 'Отправить через бота', switch_inline_query_chosen_chat: { query: '42', allow_user_chats: true }, style: 'success' }],
+      [{ text: 'Скопировать', copy_text: { text: 'Hi!' } }],
+      [{ text: 'Отмена', callback_data: 'cancel:1' }],
+    ],
+  )
+})
+
+// Настоящая обёртка с подменённым Api: сеть не нужна, смотрим только на аргументы.
+function recordingApi() {
+  const calls: { method: string; args: unknown[] }[] = []
+  const api = {
+    sendMessage: async (...args: unknown[]) => {
+      calls.push({ method: 'sendMessage', args })
+      return { message_id: 1 }
+    },
+    answerInlineQuery: async (...args: unknown[]) => {
+      calls.push({ method: 'answerInlineQuery', args })
+      return true
+    },
+  } as unknown as Api
+  return { calls, tg: createTelegramApi(api, 'TOKEN') }
+}
+
+test('sendText: клавиатура уходит в reply_markup в формате Bot API', async () => {
+  const { calls, tg } = recordingApi()
+  await tg.sendText(1, 'Hi', { keyboard: [[{ text: 'Скопировать', copy: 'Hi' }]] })
+  const other = calls[0]!.args[2] as { reply_markup: unknown }
+  assert.deepEqual(other.reply_markup, { inline_keyboard: [[{ text: 'Скопировать', copy_text: { text: 'Hi' } }]] })
+})
+
+test('answerInline: ответ личный и не кэшируется, даже если вызывающий об этом не просил', async () => {
+  const { calls, tg } = recordingApi()
+  await tg.answerInline('Q1', [{ id: '7', title: 'Hi there', description: 'Нажмите', text: 'Hi <there>' }])
+  const [queryId, results, other] = calls[0]!.args as [string, unknown[], Record<string, unknown>]
+  assert.equal(queryId, 'Q1')
+  assert.deepEqual(results, [
+    { type: 'article', id: '7', title: 'Hi there', description: 'Нажмите', input_message_content: { message_text: 'Hi <there>' } },
+  ])
+  assert.equal(other.is_personal, true)
+  assert.equal(other.cache_time, 0)
+  assert.equal('button' in other, false)
+})
+
+test('answerInline: кнопка над вариантами открывает чат с ботом', async () => {
+  const { calls, tg } = recordingApi()
+  await tg.answerInline('Q2', [], { button: { text: 'Перевод устарел — напишите заново', startParameter: 'draft' } })
+  const other = calls[0]!.args[2] as Record<string, unknown>
+  assert.deepEqual(other.button, { text: 'Перевод устарел — напишите заново', start_parameter: 'draft' })
+  assert.equal(other.is_personal, true)
+})
```

</details>

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `test/telegram.test.ts` не загружается: в `src/telegram.ts` нет `toInlineKeyboard`.

- [ ] **Step 3: Наложить код**

```bash
git apply .superpowers/sdd/write-first/task-1-src.patch
```

<details><summary>task-1-src.patch</summary>

```diff
diff --git a/src/telegram.ts b/src/telegram.ts
index fe84085..d4956b5 100644
--- a/src/telegram.ts
+++ b/src/telegram.ts
@@ -1,8 +1,30 @@
 import { GrammyError, InputFile, type Api } from 'grammy'
-import type { BusinessConnection } from 'grammy/types'
+import type { BusinessConnection, InlineKeyboardButton } from 'grammy/types'
 import type { MediaKind } from './types.ts'
 
-export type InlineButton = { text: string; data: string }
+/** Цвет кнопки (Bot API 9.4): зелёный — главное действие экрана, красный — «Отключить»/«Удалить». */
+export type ButtonStyle = 'success' | 'primary' | 'danger'
+
+/**
+ * Кнопка под сообщением. Вид задаёт заполненное поле: data — нажатие приходит боту,
+ * copy — текст ложится в буфер обмена, chooseChat — выбор личного чата и inline-запрос
+ * «@бот <chooseChat>» в нём.
+ */
+export type InlineButton = {
+  text: string
+  data?: string
+  /** copy_text: Telegram принимает до 256 символов */
+  copy?: string
+  /** switch_inline_query_chosen_chat: текст запроса, который подставится после имени бота */
+  chooseChat?: string
+  style?: ButtonStyle
+}
+
+/** Вариант в ответе на inline-запрос: нажатие отправляет text обычным сообщением. */
+export type InlineArticle = { id: string; title: string; description: string; text: string }
+
+/** Кнопка над вариантами inline-ответа: открывает чат с ботом с /start <startParameter>. */
+export type InlineAnswerButton = { text: string; startParameter: string }
 
 export type SendOptions = {
   /** Тема в чате владельца с ботом */
@@ -33,6 +55,8 @@ export type BotInfo = {
   username: string
   canConnectToBusiness: boolean
   hasTopicsEnabled: boolean
+  /** Inline Mode в BotFather: без него не работает кнопка «Отправить через бота» */
+  supportsInlineQueries: boolean
 }
 
 /** Ошибка Telegram в одном виде — и от настоящего API, и от подделки в тестах. */
@@ -69,6 +93,27 @@ export interface TelegramApi {
   editText(chatId: number, messageId: number, text: string): Promise<void>
   deleteMessage(chatId: number, messageId: number): Promise<void>
   getMe(): Promise<BotInfo>
+  /** Ответ на inline-запрос: виден только тому, кто спросил, и не кэшируется */
+  answerInline(queryId: string, articles: readonly InlineArticle[], opts?: { button?: InlineAnswerButton }): Promise<void>
+}
+
+/** Кнопки в формате Bot API. Вынесено из обёртки, чтобы преобразование проверялось тестом. */
+export function toInlineKeyboard(keyboard: readonly (readonly InlineButton[])[]): InlineKeyboardButton[][] {
+  return keyboard.map((row) =>
+    row.map((button): InlineKeyboardButton => {
+      const style = button.style && { style: button.style }
+      if (button.copy !== undefined) return { text: button.text, copy_text: { text: button.copy }, ...style }
+      if (button.chooseChat !== undefined) {
+        // Только личные чаты с людьми: перевод адресован собеседнику, а не группе или боту.
+        return {
+          text: button.text,
+          switch_inline_query_chosen_chat: { query: button.chooseChat, allow_user_chats: true },
+          ...style,
+        }
+      }
+      return { text: button.text, callback_data: button.data ?? '', ...style }
+    }),
+  )
 }
 
 export function toConnectionInfo(connection: BusinessConnection): BusinessConnectionInfo {
@@ -116,11 +161,7 @@ export function createTelegramApi(api: Api, token: string, fetchImpl: typeof fet
       ...(opts.businessConnectionId !== undefined && { business_connection_id: opts.businessConnectionId }),
       ...(opts.html && { parse_mode: 'HTML' as const }),
       ...(opts.caption !== undefined && { caption: opts.caption }),
-      ...(opts.keyboard && {
-        reply_markup: {
-          inline_keyboard: opts.keyboard.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
-        },
-      }),
+      ...(opts.keyboard && { reply_markup: { inline_keyboard: toInlineKeyboard(opts.keyboard) } }),
     }
   }
 
@@ -189,7 +230,28 @@ export function createTelegramApi(api: Api, token: string, fetchImpl: typeof fet
         username: me.username,
         canConnectToBusiness: me.can_connect_to_business,
         hasTopicsEnabled: me.has_topics_enabled,
+        supportsInlineQueries: me.supports_inline_queries,
       }
     },
+
+    async answerInline(queryId, articles, opts) {
+      const results = articles.map((article) => ({
+        type: 'article' as const,
+        id: article.id,
+        title: article.title,
+        description: article.description,
+        // Без parse_mode: у собеседника перевод выглядит обычным текстом владельца.
+        input_message_content: { message_text: article.text },
+      }))
+      await call(() =>
+        api.answerInlineQuery(queryId, results, {
+          // Без is_personal Telegram отдал бы закэшированный ответ другому человеку с тем же
+          // запросом — а в ответе перевод владельца.
+          is_personal: true,
+          cache_time: 0,
+          ...(opts?.button && { button: { text: opts.button.text, start_parameter: opts.button.startParameter } }),
+        }),
+      )
+    },
   }
 }
```

</details>

- [ ] **Step 4: Тесты и типы**

Run: `npm test && npm run typecheck`
Expected: PASS, 250 тестов; проверка типов без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add -A src test scripts
git commit -m "Написать первым: кнопки нового вида и inline-ответ в обёртке Telegram" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Inline Mode: проверка при старте и без перезапуска

Закрывает: `tasks.md` 1.3.

**Files:**
- Modify: `src/startup.ts` — `INLINE_OFF`, `INLINE_RECHECK_MS`, `createInlineCheck`, проверка в `startupChecks`
- Modify: `src/deps.ts` — `inlineEnabled`
- Modify: `src/main.ts` — `inlineEnabled: createInlineCheck(...)`
- Modify: `test/setup.ts` — `inlineEnabled: async () => true`
- Modify: `test/startup.test.ts`

**Interfaces:**
- Consumes: `BotInfo.supportsInlineQueries`, `TelegramApi.getMe` (Task 1).
- Produces: `INLINE_OFF: string` (текст из спеки `manual-send`); `INLINE_RECHECK_MS = 60_000`; `createInlineCheck(deps: { api: TelegramApi; initial: boolean; now: () => number }): () => Promise<boolean>`; `Deps.inlineEnabled: () => Promise<boolean>`.

- [ ] **Step 1: Наложить тесты**

```bash
git apply .superpowers/sdd/write-first/task-2-test.patch
```

<details><summary>task-2-test.patch</summary>

```diff
diff --git a/test/setup.ts b/test/setup.ts
index 343ce76..e2fee15 100644
--- a/test/setup.ts
+++ b/test/setup.ts
@@ -61,6 +61,7 @@ export function setupDeps(options: { overrides?: Partial<Deps>; connections?: Bu
     translatorProblem: null,
     translatorInfo: 'OpenRouter · openai/gpt-4.1-mini',
     review: passReview,
+    inlineEnabled: async () => true,
     dry: false,
     now,
     ...options.overrides,
diff --git a/test/startup.test.ts b/test/startup.test.ts
index 51332ca..e37d502 100644
--- a/test/startup.test.ts
+++ b/test/startup.test.ts
@@ -1,7 +1,15 @@
 import { test } from 'node:test'
 import assert from 'node:assert/strict'
 import { createAlerts } from '../src/alerts.ts'
-import { BUSINESS_MODE_OFF, TOPICS_OFF, loadSettings, startupChecks } from '../src/startup.ts'
+import {
+  BUSINESS_MODE_OFF,
+  INLINE_OFF,
+  INLINE_RECHECK_MS,
+  TOPICS_OFF,
+  createInlineCheck,
+  loadSettings,
+  startupChecks,
+} from '../src/startup.ts'
 import { LANGUAGE_DEFAULTS, SETTING, openStore } from '../src/store.ts'
 import type { BotInfo } from '../src/telegram.ts'
 import { PROVIDER_DEFAULTS } from '../src/translate/providers.ts'
@@ -56,3 +64,50 @@ test('пустая база после ensureDefaults — пара русски
   if (pair.ok) assert.deepEqual([pair.pair.owner.code, pair.pair.peer.code].sort(), ['en', 'ru'])
   store.close()
 })
+
+test('спека: Inline Mode выключен — что включить в BotFather', async () => {
+  const { tg, alerts } = setup()
+  await startupChecks({ me: { ...healthy, supportsInlineQueries: false }, alerts, languagesProblem: null, modelProblem: null })
+  assert.deepEqual(tg.callsOf('sendText').map((call) => call.text), [INLINE_OFF])
+  assert.equal(
+    INLINE_OFF,
+    'В BotFather выключен Inline Mode — без него не работает кнопка «Отправить через бота». ' +
+      'Откройте @BotFather → /mybots → этот бот → Bot Settings → Inline Mode → Turn on.',
+  )
+})
+
+test('Inline Mode включили без перезапуска — бот замечает, но спрашивает Telegram не чаще раза в минуту', async () => {
+  let clock = 0
+  const tg = fakeTelegram({ me: { supportsInlineQueries: true } })
+  const enabled = createInlineCheck({ api: tg.api, initial: false, now: () => clock })
+  assert.equal(await enabled(), false)
+  assert.equal(tg.callsOf('getMe').length, 0)
+  clock += INLINE_RECHECK_MS
+  assert.equal(await enabled(), true)
+  assert.equal(tg.callsOf('getMe').length, 1)
+  clock += INLINE_RECHECK_MS
+  assert.equal(await enabled(), true)
+  assert.equal(tg.callsOf('getMe').length, 1)
+})
+
+test('Inline Mode всё ещё выключен — повторный вопрос только через минуту', async () => {
+  let clock = 0
+  const tg = fakeTelegram({ me: { supportsInlineQueries: false } })
+  const enabled = createInlineCheck({ api: tg.api, initial: false, now: () => clock })
+  clock += INLINE_RECHECK_MS
+  assert.equal(await enabled(), false)
+  clock += INLINE_RECHECK_MS - 1
+  assert.equal(await enabled(), false)
+  assert.equal(tg.callsOf('getMe').length, 1)
+})
+
+test('проверка Inline Mode: сбой getMe — по-прежнему выключено, бот не падает', async () => {
+  let clock = 0
+  const tg = fakeTelegram({ me: { supportsInlineQueries: true } })
+  tg.failNext('getMe', new Error('сеть моргнула'))
+  const enabled = createInlineCheck({ api: tg.api, initial: false, now: () => clock })
+  clock += INLINE_RECHECK_MS
+  assert.equal(await enabled(), false)
+  clock += INLINE_RECHECK_MS
+  assert.equal(await enabled(), true)
+})
```

</details>

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — в `src/startup.ts` нет `INLINE_OFF` и `createInlineCheck`.

- [ ] **Step 3: Наложить код**

```bash
git apply .superpowers/sdd/write-first/task-2-src.patch
```

<details><summary>task-2-src.patch</summary>

```diff
diff --git a/src/deps.ts b/src/deps.ts
index 981d7ee..3fb3401 100644
--- a/src/deps.ts
+++ b/src/deps.ts
@@ -28,6 +28,8 @@ export type Deps = {
   translatorInfo: string
   /** Проверка ответа модели до показа владельцу и до отправки собеседнику */
   review: Reviewer
+  /** Включён ли Inline Mode в BotFather: без него у перевода нет кнопки «Отправить через бота» */
+  inlineEnabled: () => Promise<boolean>
   /** Холостой прогон: собеседнику ничего не уходит */
   dry: boolean
   now: () => number
diff --git a/src/main.ts b/src/main.ts
index df5cd4a..3a7358f 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -3,7 +3,7 @@ import { createAlerts, createScrubber } from './alerts.ts'
 import { createApp } from './app.ts'
 import { loadEnv } from './env.ts'
 import { createTopics } from './owner/topics.ts'
-import { loadSettings, startupChecks } from './startup.ts'
+import { createInlineCheck, loadSettings, startupChecks } from './startup.ts'
 import { HOUR, LANGUAGE_DEFAULTS, openStore } from './store.ts'
 import { createTelegramApi, describeError } from './telegram.ts'
 import { reviewTranslation } from './translate/check.ts'
@@ -65,6 +65,7 @@ const app = createApp({
   translatorProblem: model.ok ? null : model.problem,
   translatorInfo: model.ok ? `${model.provider.label} · ${model.model}` : model.problem,
   review: reviewTranslation,
+  inlineEnabled: createInlineCheck({ api, initial: me.supportsInlineQueries, now }),
   dry,
   now,
 })
diff --git a/src/startup.ts b/src/startup.ts
index d852f73..8d89e9c 100644
--- a/src/startup.ts
+++ b/src/startup.ts
@@ -1,7 +1,7 @@
 import type { Alerts } from './alerts.ts'
 import { resolvePair } from './lang/profiles.ts'
 import { LANGUAGE_DEFAULTS, SETTING, type Store } from './store.ts'
-import type { BotInfo } from './telegram.ts'
+import type { BotInfo, TelegramApi } from './telegram.ts'
 import { resolveModel } from './translate/providers.ts'
 
 export const BUSINESS_MODE_OFF =
@@ -12,6 +12,35 @@ export const TOPICS_OFF =
   'В BotFather выключен Threaded Mode — без него бот не может завести темы для собеседников. ' +
   'Откройте @BotFather → /mybots → этот бот → Bot Settings → Threaded Mode → Turn on.'
 
+export const INLINE_OFF =
+  'В BotFather выключен Inline Mode — без него не работает кнопка «Отправить через бота». ' +
+  'Откройте @BotFather → /mybots → этот бот → Bot Settings → Inline Mode → Turn on.'
+
+/** Как часто переспрашивать Telegram, пока Inline Mode выключен: владелец мог включить его в BotFather. */
+export const INLINE_RECHECK_MS = 60 * 1000
+
+/**
+ * Включён ли Inline Mode. Включённый не перепроверяем. Выключенный переспрашиваем у Telegram,
+ * но не чаще раза в минуту: так включение в BotFather бот замечает без перезапуска, а
+ * лишних запросов на каждый перевод нет.
+ */
+export function createInlineCheck(deps: { api: TelegramApi; initial: boolean; now: () => number }): () => Promise<boolean> {
+  let enabled = deps.initial
+  // Стартовый getMe только что был — первый повтор не раньше чем через минуту.
+  let checkedAt = deps.now()
+  return async () => {
+    if (enabled) return true
+    if (deps.now() - checkedAt < INLINE_RECHECK_MS) return false
+    checkedAt = deps.now()
+    try {
+      enabled = (await deps.api.getMe()).supportsInlineQueries
+    } catch {
+      // Сеть моргнула — считаем, что по-прежнему выключено, спросим через минуту.
+    }
+    return enabled
+  }
+}
+
 /** Языки и модель из базы. Вынесено из main.ts, чтобы выбор на старте покрывался тестами. */
 export function loadSettings(
   store: Store,
@@ -42,6 +71,7 @@ export async function startupChecks(input: {
   const { me, alerts } = input
   if (!me.canConnectToBusiness) await alerts.general('botfather:business', BUSINESS_MODE_OFF)
   if (!me.hasTopicsEnabled) await alerts.general('botfather:topics', TOPICS_OFF)
+  if (!me.supportsInlineQueries) await alerts.general('botfather:inline', INLINE_OFF)
   if (input.languagesProblem) await alerts.general('languages', input.languagesProblem)
   if (input.modelProblem) await alerts.general('model', input.modelProblem)
 }
```

</details>

- [ ] **Step 4: Тесты и типы**

Run: `npm test && npm run typecheck`
Expected: PASS, 254 теста; проверка типов без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add -A src test scripts
git commit -m "Написать первым: проверка Inline Mode при старте и без перезапуска" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Черновики в базе

Закрывает: `tasks.md` 2.1, 2.2.

**Files:**
- Modify: `src/types.ts` — тип `Draft`
- Modify: `src/store.ts` — `DRAFT_TTL`, `normalizeText`, таблица `drafts`, `createDraft`, `getDraft`, `findDraftByTranslation`, чистка; `createConversation` с `lastPeerAt`
- Modify: `src/channels/private-chat/incoming.ts` — `lastPeerAt: deps.now()` вместо `now`
- Modify: `test/store.test.ts`, `test/routing.test.ts`, `test/outgoing.test.ts`, `test/topics.test.ts` — `lastPeerAt` в вызовах `createConversation`

**Interfaces:**
- Produces: `type Draft = { id: number; ownerId: number; conversationId: number | null; original: string; translation: string; createdAt: number }`; `DRAFT_TTL = 7 * DAY`; `normalizeText(text: string): string`; `store.createDraft(input: { ownerId: number; conversationId: number | null; original: string; translation: string; now: number }): Draft` (перевод сохраняется после `normalizeText`); `store.getDraft(ownerId: number, id: number, now: number): Draft | undefined`; `store.findDraftByTranslation(ownerId: number, text: string, now: number): Draft | undefined`; `store.createConversation(input: { ownerId; connectionId; peerChatId; peerName; lastPeerAt: number })`.

- [ ] **Step 1: Наложить тесты**

```bash
git apply .superpowers/sdd/write-first/task-3-test.patch
```

<details><summary>task-3-test.patch</summary>

```diff
diff --git a/test/outgoing.test.ts b/test/outgoing.test.ts
index aef34f7..19dedf5 100644
--- a/test/outgoing.test.ts
+++ b/test/outgoing.test.ts
@@ -16,7 +16,7 @@ function prepared(options: Parameters<typeof setupDeps>[0] = {}) {
     connectionId: CONNECTION_ID,
     peerChatId: PEER_ID,
     peerName: 'Alex Peer',
-    now: ctx.deps.now(),
+    lastPeerAt: ctx.deps.now(),
   })
   ctx.store.addReplica(conversation.id, { role: 'peer', original: 'How are you?', translation: 'Как дела?' }, ctx.deps.now())
   return { ...ctx, conversation }
@@ -143,7 +143,7 @@ test('длинный перевод уходит собеседнику неск
 
 test('владелец переподключил бота — ответ идёт через текущее подключение, а не через старое', async () => {
   const { deps, tg, store } = prepared()
-  const old = store.createConversation({ ownerId: OWNER_ID, connectionId: 'BC_OLD', peerChatId: 200009, peerName: 'Old Peer', now: deps.now() })
+  const old = store.createConversation({ ownerId: OWNER_ID, connectionId: 'BC_OLD', peerChatId: 200009, peerName: 'Old Peer', lastPeerAt: deps.now() })
   await sendOwnerReply(deps, old, reply, { outsideTopic: false })
   const [toPeer] = tg.sentAsOwner()
   assert.ok(toPeer && toPeer.method === 'sendText')
diff --git a/test/routing.test.ts b/test/routing.test.ts
index 9222265..cf83418 100644
--- a/test/routing.test.ts
+++ b/test/routing.test.ts
@@ -9,7 +9,7 @@ import { setupDeps } from './setup.ts'
 function withConversations(...peers: { id: number; name: string; lastPeerAt: number }[]) {
   const ctx = setupDeps()
   const conversations = peers.map((peer) =>
-    ctx.store.createConversation({ ownerId: OWNER_ID, connectionId: CONNECTION_ID, peerChatId: peer.id, peerName: peer.name, now: peer.lastPeerAt }),
+    ctx.store.createConversation({ ownerId: OWNER_ID, connectionId: CONNECTION_ID, peerChatId: peer.id, peerName: peer.name, lastPeerAt: peer.lastPeerAt }),
   )
   return { ...ctx, conversations }
 }
diff --git a/test/store.test.ts b/test/store.test.ts
index c039b2b..bda063d 100644
--- a/test/store.test.ts
+++ b/test/store.test.ts
@@ -1,12 +1,12 @@
 import { test } from 'node:test'
 import assert from 'node:assert/strict'
-import { DAY, HISTORY_WINDOW, LANGUAGE_DEFAULTS, SETTING, openStore } from '../src/store.ts'
+import { DAY, DRAFT_TTL, HISTORY_WINDOW, LANGUAGE_DEFAULTS, SETTING, openStore } from '../src/store.ts'
 
 const OWNER = 100001
 const T0 = 1_760_000_000_000
 
 function conversation(store: ReturnType<typeof openStore>, peerChatId = 200002, now = T0) {
-  return store.createConversation({ ownerId: OWNER, connectionId: 'BC1', peerChatId, peerName: 'Alex Peer', now })
+  return store.createConversation({ ownerId: OWNER, connectionId: 'BC1', peerChatId, peerName: 'Alex Peer', lastPeerAt: now })
 }
 
 test('первый запуск: на пустой базе записывается пара «русский ↔ английский»', () => {
@@ -115,3 +115,46 @@ test('ownerConnection: рабочее подключение важнее поз
   store.saveConnection({ ...base, id: 'OLD', isEnabled: false }, T0 + 1000)
   assert.equal(store.ownerConnection(OWNER)?.id, 'LIVE')
 })
+
+test('разговор, заведённый владельцем (lastPeerAt = 0), не активен, пока собеседник не напишет', () => {
+  const store = openStore(':memory:')
+  const conv = conversation(store, 200005, 0)
+  assert.deepEqual(store.activeConversations(OWNER, T0), [])
+  store.touchPeer(conv.id, T0)
+  assert.deepEqual(store.activeConversations(OWNER, T0).map((c) => c.id), [conv.id])
+})
+
+test('перевод для ручной отправки: сохраняется без пробелов по краям и находится по номеру', () => {
+  const store = openStore(':memory:')
+  const draft = store.createDraft({ ownerId: OWNER, conversationId: null, original: 'Привет!', translation: '  Hi!\n', now: T0 })
+  assert.equal(draft.translation, 'Hi!')
+  assert.deepEqual(store.getDraft(OWNER, draft.id, T0), { ...draft })
+  assert.equal(store.getDraft(100002, draft.id, T0), undefined)
+})
+
+test('перевод для ручной отправки находится по тексту — с другими переводами строк и пробелами', () => {
+  const store = openStore(':memory:')
+  store.createDraft({ ownerId: OWNER, conversationId: 7, original: 'Да\nнет', translation: 'Yes\nno', now: T0 })
+  assert.equal(store.findDraftByTranslation(OWNER, 'Yes\r\nno\n', T0)?.original, 'Да\nнет')
+  assert.equal(store.findDraftByTranslation(OWNER, 'Yes no', T0), undefined)
+  assert.equal(store.findDraftByTranslation(100002, 'Yes\nno', T0), undefined)
+})
+
+test('одинаковый перевод дважды — находится свежий', () => {
+  const store = openStore(':memory:')
+  store.createDraft({ ownerId: OWNER, conversationId: null, original: 'Ок', translation: 'OK', now: T0 })
+  const fresh = store.createDraft({ ownerId: OWNER, conversationId: 3, original: 'Хорошо', translation: 'OK', now: T0 + 1 })
+  assert.equal(store.findDraftByTranslation(OWNER, 'OK', T0 + 1)?.id, fresh.id)
+})
+
+test('перевод для ручной отправки живёт 7 дней: потом не находится и удаляется чисткой', () => {
+  const store = openStore(':memory:')
+  const draft = store.createDraft({ ownerId: OWNER, conversationId: null, original: 'Привет!', translation: 'Hi!', now: T0 })
+  const later = T0 + DRAFT_TTL + 60_000
+  assert.equal(DRAFT_TTL, 7 * DAY)
+  assert.ok(store.getDraft(OWNER, draft.id, T0 + DRAFT_TTL))
+  assert.equal(store.getDraft(OWNER, draft.id, later), undefined)
+  assert.equal(store.findDraftByTranslation(OWNER, 'Hi!', later), undefined)
+  store.cleanup(later)
+  assert.equal(store.getDraft(OWNER, draft.id, T0), undefined)
+})
diff --git a/test/topics.test.ts b/test/topics.test.ts
index 1a89d4e..6835a2c 100644
--- a/test/topics.test.ts
+++ b/test/topics.test.ts
@@ -22,7 +22,7 @@ function setup() {
   const store = openStore(':memory:')
   const tg = fakeTelegram()
   const topics = createTopics({ api: tg.api, store, ownerChatId: OWNER_ID, now: () => T0, scrub: (t) => t.replace('SECRET-KEY-123', '***') })
-  const conversation = store.createConversation({ ownerId: OWNER_ID, connectionId: 'BC', peerChatId: PEER_ID, peerName: 'Timon', now: T0 })
+  const conversation = store.createConversation({ ownerId: OWNER_ID, connectionId: 'BC', peerChatId: PEER_ID, peerName: 'Timon', lastPeerAt: T0 })
   return { store, tg, topics, conversation }
 }
 
```

</details>

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — тесты передают `lastPeerAt`, а `createConversation` его не знает; в `store` нет `createDraft`.

- [ ] **Step 3: Наложить код**

```bash
git apply .superpowers/sdd/write-first/task-3-src.patch
```

<details><summary>task-3-src.patch</summary>

```diff
diff --git a/src/channels/private-chat/incoming.ts b/src/channels/private-chat/incoming.ts
index 297cf50..9aff293 100644
--- a/src/channels/private-chat/incoming.ts
+++ b/src/channels/private-chat/incoming.ts
@@ -77,7 +77,7 @@ export function incomingSteps(deps: Deps): Step<Replica>[] {
           connectionId: replica.connectionId,
           peerChatId: replica.peerChatId,
           peerName: replica.peerName,
-          now: deps.now(),
+          lastPeerAt: deps.now(),
         })
         return 'next'
       },
diff --git a/src/store.ts b/src/store.ts
index 2b1b05f..ef680c7 100644
--- a/src/store.ts
+++ b/src/store.ts
@@ -1,11 +1,22 @@
 import { DatabaseSync } from 'node:sqlite'
 import { mkdirSync } from 'node:fs'
 import { dirname } from 'node:path'
-import type { Connection, Conversation, HistoryLine, OwnerPayload, Role } from './types.ts'
+import type { Connection, Conversation, Draft, HistoryLine, OwnerPayload, Role } from './types.ts'
 
 export const HOUR = 60 * 60 * 1000
 export const DAY = 24 * HOUR
 
+/** Сколько живёт перевод для ручной отправки: кнопка под ним остаётся в теме надолго. */
+export const DRAFT_TTL = 7 * DAY
+
+/**
+ * Перевод для ручной отправки сравнивается с тем, что владелец отправил в личке. Telegram и
+ * буфер обмена могут срезать пробелы по краям и заменить перевод строки — сравниваем без них.
+ */
+export function normalizeText(text: string): string {
+  return text.replace(/\r\n/g, '\n').trim()
+}
+
 /** Сколько последних реплик разговора видит модель. Остальное удаляется: перевёл и забыл. */
 export const HISTORY_WINDOW = 20
 
@@ -84,6 +95,17 @@ const SCHEMA = `
     processed_at INTEGER NOT NULL
   ) STRICT;
 
+  -- Переводы для ручной отправки: «Отправить через бота» находит перевод по номеру, а текст,
+  -- отправленный владельцем в личке, узнаётся по совпадению. Живут 7 дней.
+  CREATE TABLE IF NOT EXISTS drafts (
+    id              INTEGER PRIMARY KEY AUTOINCREMENT,
+    owner_id        INTEGER NOT NULL,
+    conversation_id INTEGER,
+    original        TEXT NOT NULL,
+    translation     TEXT NOT NULL,
+    created_at      INTEGER NOT NULL
+  ) STRICT;
+
   -- Запасной способ узнать эхо своей отправки, если Telegram не пришлёт sender_business_bot.
   CREATE TABLE IF NOT EXISTS sent_echo (
     owner_id     INTEGER NOT NULL,
@@ -108,6 +130,17 @@ function toConversation(row: Row): Conversation {
   }
 }
 
+function toDraft(row: Row): Draft {
+  return {
+    id: Number(row.id),
+    ownerId: Number(row.owner_id),
+    conversationId: row.conversation_id === null ? null : Number(row.conversation_id),
+    original: String(row.original),
+    translation: String(row.translation),
+    createdAt: Number(row.created_at),
+  }
+}
+
 function toConnection(row: Row): Connection {
   return {
     id: String(row.id),
@@ -192,9 +225,18 @@ export function openStore(path: string) {
     rememberSent: db.prepare('INSERT OR IGNORE INTO sent_echo (owner_id, peer_chat_id, message_id, created_at) VALUES (?, ?, ?, ?)'),
     wasSent: db.prepare('SELECT 1 FROM sent_echo WHERE owner_id = ? AND peer_chat_id = ? AND message_id = ?'),
 
+    insertDraft: db.prepare(
+      'INSERT INTO drafts (owner_id, conversation_id, original, translation, created_at) VALUES (?, ?, ?, ?, ?)',
+    ),
+    draftById: db.prepare('SELECT * FROM drafts WHERE id = ? AND owner_id = ? AND created_at >= ?'),
+    draftByTranslation: db.prepare(
+      'SELECT * FROM drafts WHERE owner_id = ? AND translation = ? AND created_at >= ? ORDER BY id DESC LIMIT 1',
+    ),
+
     cleanPending: db.prepare('DELETE FROM pending_choices WHERE created_at < ?'),
     cleanProcessed: db.prepare('DELETE FROM processed_updates WHERE processed_at < ?'),
     cleanSent: db.prepare('DELETE FROM sent_echo WHERE created_at < ?'),
+    cleanDrafts: db.prepare('DELETE FROM drafts WHERE created_at < ?'),
   }
 
   return {
@@ -253,19 +295,23 @@ export function openStore(path: string) {
       return row ? toConversation(row) : undefined
     },
 
+    /**
+     * lastPeerAt — когда собеседник писал последний раз. Разговор, который завёл владелец
+     * отправкой через бота, получает 0: пока собеседник не ответил, разговор не активен.
+     */
     createConversation(input: {
       ownerId: number
       connectionId: string
       peerChatId: number
       peerName: string
-      now: number
+      lastPeerAt: number
     }): Conversation {
       const result = q.insertConversation.run(
         input.ownerId,
         input.connectionId,
         input.peerChatId,
         input.peerName,
-        input.now,
+        input.lastPeerAt,
       )
       return toConversation(q.conversationById.get(Number(result.lastInsertRowid)) as Row)
     },
@@ -335,6 +381,38 @@ export function openStore(path: string) {
       }
     },
 
+    /** Перевод сохраняется без пробелов по краям: ровно этот текст и уйдёт собеседнику. */
+    createDraft(input: {
+      ownerId: number
+      conversationId: number | null
+      original: string
+      translation: string
+      now: number
+    }): Draft {
+      const translation = normalizeText(input.translation)
+      const result = q.insertDraft.run(input.ownerId, input.conversationId, input.original, translation, input.now)
+      return {
+        id: Number(result.lastInsertRowid),
+        ownerId: input.ownerId,
+        conversationId: input.conversationId,
+        original: input.original,
+        translation,
+        createdAt: input.now,
+      }
+    },
+
+    /** Живой перевод владельца по номеру. Чужой или старше 7 дней — undefined, даже до чистки. */
+    getDraft(ownerId: number, id: number, now: number): Draft | undefined {
+      const row = q.draftById.get(id, ownerId, now - DRAFT_TTL) as Row | undefined
+      return row ? toDraft(row) : undefined
+    },
+
+    /** Самый свежий живой перевод владельца с таким текстом. */
+    findDraftByTranslation(ownerId: number, text: string, now: number): Draft | undefined {
+      const row = q.draftByTranslation.get(ownerId, normalizeText(text), now - DRAFT_TTL) as Row | undefined
+      return row ? toDraft(row) : undefined
+    },
+
     isProcessed(updateId: number): boolean {
       return q.isProcessed.get(updateId) !== undefined
     },
@@ -353,12 +431,14 @@ export function openStore(path: string) {
 
     /**
      * Чистка служебных записей. Апдейты держим 48 часов: Telegram хранит их 24 часа,
-     * запас — на случай, если сервер лежал. Отложенные «Кому?» и эхо живут сутки.
+     * запас — на случай, если сервер лежал. Отложенные «Кому?» и эхо живут сутки,
+     * переводы для ручной отправки — 7 дней.
      */
     cleanup(now: number): void {
       q.cleanPending.run(now - DAY)
       q.cleanProcessed.run(now - 2 * DAY)
       q.cleanSent.run(now - DAY)
+      q.cleanDrafts.run(now - DRAFT_TTL)
     },
 
     close(): void {
diff --git a/src/types.ts b/src/types.ts
index 3131087..c5a86e3 100644
--- a/src/types.ts
+++ b/src/types.ts
@@ -42,6 +42,19 @@ export type Conversation = {
   lastPeerAt: number
 }
 
+/** Перевод для ручной отправки: владелец сам отправит его кнопкой «Отправить через бота» или скопирует. */
+export type Draft = {
+  id: number
+  ownerId: number
+  /** Разговор, для которого готовился перевод; null — новый собеседник */
+  conversationId: number | null
+  /** Текст владельца */
+  original: string
+  /** Перевод — ровно то, что уйдёт собеседнику */
+  translation: string
+  createdAt: number
+}
+
 /** Строка истории для контекста модели — в оригинале. */
 export type HistoryLine = { role: Role; text: string }
 
```

</details>

- [ ] **Step 4: Тесты и типы**

Run: `npm test && npm run typecheck`
Expected: PASS, 259 тестов; проверка типов без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add -A src test scripts
git commit -m "Написать первым: черновики перевода в базе, lastPeerAt при создании разговора" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ошибки провайдера понятным текстом

Закрывает: `tasks.md` 3.1, 3.2.

**Files:**
- Create: `src/translate/errors.ts`
- Modify: `src/translate/llm.ts` — `TranslationError` с `hint` и `detail`, `createTranslator({ provider })`, разбор ошибок по таблице
- Modify: `src/alerts.ts` — `alertModelFailure(alerts, error)`
- Modify: `src/channels/private-chat/incoming.ts`, `src/channels/private-chat/outgoing.ts` — передают в `alertModelFailure` саму ошибку
- Modify: `src/main.ts`, `scripts/eval-injection.ts` — `provider: model.provider`
- Modify: `test/translate.test.ts`, `test/alerts.test.ts`, `test/incoming.test.ts`

**Interfaces:**
- Produces: `type ProviderInfo = Pick<Provider, 'label' | 'envKey' | 'keysUrl'>`; `PROVIDER_ERRORS`; `DEFAULT_HINT`; `describeProviderError(provider: ProviderInfo, status: number): { reason: string; hint: string }`; `new TranslationError(message: string, extra?: { hint?: string; detail?: string })` с полями `hint`, `detail`; `createTranslator(config: { baseUrl; apiKey; model; provider: ProviderInfo; fetchImpl?; timeoutMs?; fragments? })`; `alertModelFailure(alerts: Alerts, error: unknown): Promise<void>`.

- [ ] **Step 1: Наложить тесты**

```bash
git apply .superpowers/sdd/write-first/task-4-test.patch
```

<details><summary>task-4-test.patch</summary>

```diff
diff --git a/test/alerts.test.ts b/test/alerts.test.ts
index ebf6779..4e73301 100644
--- a/test/alerts.test.ts
+++ b/test/alerts.test.ts
@@ -1,6 +1,7 @@
 import { test } from 'node:test'
 import assert from 'node:assert/strict'
 import { THROTTLE_MS, alertModelFailure, createAlerts, createScrubber } from '../src/alerts.ts'
+import { TranslationError } from '../src/translate/llm.ts'
 import { TelegramError } from '../src/telegram.ts'
 import { fakeTelegram } from './fakes.ts'
 
@@ -127,3 +128,31 @@ test('сбой модели: разные причины в пределах 10
   assert.equal(sent.length, 1)
   assert.match(sent[0]!.text, /^Модель не переводит: ошибка 503, request abc\./)
 })
+
+test('спека: неверный ключ — причина и подсказка из ошибки, сырой ответ только в консоли и без ключа', async () => {
+  const tg = fakeTelegram()
+  const printed: string[] = []
+  const alerts = createAlerts({
+    api: tg.api,
+    ownerChatId: 1,
+    scrub: createScrubber(['sk-or-v1-secret-key']),
+    print: (line) => printed.push(line),
+  })
+  await alertModelFailure(
+    alerts,
+    new TranslationError('OpenRouter: ключ не подходит', {
+      hint: 'Проверьте OPENROUTER_API_KEY в .env — ключ берут здесь: https://openrouter.ai/keys',
+      detail: '401: {"error":{"message":"User not found.","key":"sk-or-v1-secret-key"}}',
+    }),
+  )
+  const [sent] = tg.callsOf('sendText')
+  assert.equal(
+    sent!.text,
+    'Модель не переводит: OpenRouter: ключ не подходит. Пока это так, входящие идут в темы без перевода, ' +
+      'а ответы собеседникам не уходят. Проверьте OPENROUTER_API_KEY в .env — ключ берут здесь: https://openrouter.ai/keys',
+  )
+  assert.ok(!sent!.text.includes('User not found'))
+  const raw = printed.find((line) => line.includes('User not found'))
+  assert.ok(raw)
+  assert.ok(!raw.includes('sk-or-v1-secret-key'))
+})
diff --git a/test/incoming.test.ts b/test/incoming.test.ts
index d0266cd..e6d640b 100644
--- a/test/incoming.test.ts
+++ b/test/incoming.test.ts
@@ -109,6 +109,22 @@ test('перевод не удался — в теме оригинал с по
   )
 })
 
+test('спека: неверный ключ — в теме «Перевод не удался: OpenRouter: ключ не подходит», общее сообщение с подсказкой', async () => {
+  const failing = fakeTranslator(() => {
+    throw new TranslationError('OpenRouter: ключ не подходит', {
+      hint: 'Проверьте OPENROUTER_API_KEY в .env — ключ берут здесь: https://openrouter.ai/keys',
+      detail: '401: {"error":{"message":"User not found.","code":401}}',
+    })
+  })
+  const { deps, tg, connectOwner } = setupDeps({ overrides: { translator: failing.translate } })
+  connectOwner()
+  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
+  const texts = tg.callsOf('sendText').map((call) => call.text)
+  assert.ok(texts.includes('See you at 7?\n<i>Перевод не удался: OpenRouter: ключ не подходит</i>'))
+  assert.ok(texts.some((text) => text.startsWith('Модель не переводит: OpenRouter: ключ не подходит.') && text.endsWith('https://openrouter.ai/keys')))
+  assert.ok(!texts.some((text) => text.includes('User not found')))
+})
+
 test('нет ключа модели — входящее в теме без перевода, с причиной', async () => {
   const { deps, tg, connectOwner } = setupDeps({
     overrides: { translator: null, translatorProblem: 'Нет ключа модели — переводить нечем.' },
diff --git a/test/translate.test.ts b/test/translate.test.ts
index 3561131..f1afde5 100644
--- a/test/translate.test.ts
+++ b/test/translate.test.ts
@@ -177,7 +177,8 @@ function jsonResponse(body: unknown, status = 200): Response {
   return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
 }
 
-const config = { baseUrl: 'https://llm.test/v1', apiKey: 'sk-test', model: 'm', label: 'OpenRouter' }
+const openrouter = { label: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', keysUrl: 'https://openrouter.ai/keys' }
+const config = { baseUrl: 'https://llm.test/v1', apiKey: 'sk-test', model: 'm', provider: openrouter }
 
 test('вызов модели: правильный запрос, кавычки срезаются', async () => {
   let sent: { url: string; body: Record<string, unknown>; auth: string | null } | undefined
@@ -225,10 +226,59 @@ test('вызов модели: таймаут — ошибка перевода'
   })
 })
 
-test('вызов модели: ошибка провайдера доходит с причиной', async () => {
-  const fetchImpl = (async () => new Response('rate limit exceeded', { status: 429 })) as typeof fetch
-  const translate = createTranslator({ ...config, fetchImpl })
-  await assert.rejects(translate({ target: ru, history: [], text: 'hi' }), /OpenRouter ответил ошибкой 429: rate limit exceeded/)
+/** Ошибка, которую бросил переводчик в ответ на этот ответ провайдера. */
+async function failureOf(response: () => Response | Promise<Response>): Promise<TranslationError> {
+  const fetchImpl = (async () => response()) as typeof fetch
+  try {
+    await createTranslator({ ...config, fetchImpl })({ target: ru, history: [], text: 'hi' })
+  } catch (error) {
+    assert.ok(error instanceof TranslationError)
+    return error
+  }
+  return assert.fail('перевод должен был не удаться')
+}
+
+test('спека: 401 — «ключ не подходит» и где взять ключ, сырого ответа в тексте нет', async () => {
+  const error = await failureOf(() => jsonResponse({ error: { message: 'User not found.', code: 401 } }, 401))
+  assert.equal(error.message, 'OpenRouter: ключ не подходит')
+  assert.equal(error.hint, 'Проверьте OPENROUTER_API_KEY в .env — ключ берут здесь: https://openrouter.ai/keys')
+  assert.ok(!error.message.includes('User not found'))
+  assert.match(error.detail ?? '', /User not found/)
+})
+
+test('спека: 402, 429, 503 — понятная причина и подсказка', async () => {
+  const cases: [number, string, RegExp][] = [
+    [402, 'OpenRouter: на балансе закончились деньги', /Пополните баланс у OpenRouter/],
+    [429, 'OpenRouter просит подождать — слишком много запросов', /проходит само/],
+    [503, 'OpenRouter временно не работает', /проходит само/],
+  ]
+  for (const [status, reason, hint] of cases) {
+    const error = await failureOf(() => new Response('overloaded, request abc', { status }))
+    assert.equal(error.message, reason)
+    assert.match(error.hint ?? '', hint)
+  }
+})
+
+test('спека: незнакомый код — «ответил ошибкой <код>» без тела ответа', async () => {
+  const error = await failureOf(() => new Response('I am a teapot '.repeat(50), { status: 418 }))
+  assert.equal(error.message, 'OpenRouter ответил ошибкой 418')
+  assert.ok(!error.message.includes('teapot'))
+})
+
+test('ответ 200 с ошибкой в теле разбирается по её коду', async () => {
+  const withCode = await failureOf(() => jsonResponse({ error: { message: 'Insufficient credits', code: 402 } }))
+  assert.equal(withCode.message, 'OpenRouter: на балансе закончились деньги')
+  const withoutCode = await failureOf(() => jsonResponse({ error: { message: 'Something odd' } }))
+  assert.equal(withoutCode.message, 'OpenRouter вернул ошибку')
+  assert.match(withoutCode.detail ?? '', /Something odd/)
+})
+
+test('нет сети — «нет связи с <провайдер>»', async () => {
+  const error = await failureOf(() => {
+    throw new TypeError('fetch failed')
+  })
+  assert.equal(error.message, 'нет связи с OpenRouter')
+  assert.equal(error.detail, 'fetch failed')
 })
 
 test('вызов модели: пустой ответ — ошибка', async () => {
```

</details>

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — тексты ошибок старые («ответил ошибкой 429: …»), у `TranslationError` нет `hint` и `detail`.

- [ ] **Step 3: Наложить код**

```bash
git apply .superpowers/sdd/write-first/task-4-src.patch
```

<details><summary>task-4-src.patch</summary>

```diff
diff --git a/scripts/eval-injection.ts b/scripts/eval-injection.ts
index 7d37d3b..ac8895e 100644
--- a/scripts/eval-injection.ts
+++ b/scripts/eval-injection.ts
@@ -42,7 +42,7 @@ const model = args.get('model') || resolved.model
 const runs = Number(args.get('runs') || 3)
 const only = args.get('only')?.split(',')
 const owner = getProfile('ru')!
-const translate = createTranslator({ baseUrl: resolved.baseUrl, apiKey: resolved.apiKey, model, label: resolved.provider.label })
+const translate = createTranslator({ baseUrl: resolved.baseUrl, apiKey: resolved.apiKey, model, provider: resolved.provider })
 
 type Run = { translation: string; review: Review; outcome: Outcome } | { error: string }
 
diff --git a/src/alerts.ts b/src/alerts.ts
index ecd3cfe..7e989d4 100644
--- a/src/alerts.ts
+++ b/src/alerts.ts
@@ -1,4 +1,6 @@
 import { describeError, type TelegramApi } from './telegram.ts'
+import { DEFAULT_HINT } from './translate/errors.ts'
+import { TranslationError } from './translate/llm.ts'
 
 /** Короче — не секрет, а слово вроде «true»: заменять такое значит портить текст. */
 const SECRET_MIN_LENGTH = 9
@@ -137,13 +139,19 @@ export function createAlerts(deps: {
   }
 }
 
-/** Модель не перевела: общее сообщение вне тем. Пометка в теме — отдельно, у каждого сообщения. */
-export function alertModelFailure(alerts: Alerts, reason: string): Promise<void> {
+/**
+ * Модель не перевела: общее сообщение вне тем. Пометка в теме — отдельно, у каждого сообщения.
+ * Что сделать, говорит сама ошибка (ключ, баланс, подождать); сырой ответ провайдера — только
+ * в консоль, через замену секретов.
+ */
+export function alertModelFailure(alerts: Alerts, error: unknown): Promise<void> {
+  const hint = error instanceof TranslationError && error.hint ? error.hint : DEFAULT_HINT
+  if (error instanceof TranslationError && error.detail) alerts.log(`ответ провайдера: ${error.detail}`)
   // Ключ постоянный: текст ошибки провайдера меняется от запроса к запросу (id запроса, имя
   // провайдера, время сброса лимита), и ключ из него не дал бы троттлингу сработать.
   return alerts.general(
     'model',
-    `Модель не переводит: ${reason}. Пока это так, входящие идут в темы без перевода, ` +
-      'а ответы собеседникам не уходят. Проверьте ключ и баланс у провайдера.',
+    `Модель не переводит: ${describeError(error)}. Пока это так, входящие идут в темы без перевода, ` +
+      `а ответы собеседникам не уходят. ${hint}`,
   )
 }
diff --git a/src/channels/private-chat/incoming.ts b/src/channels/private-chat/incoming.ts
index 9aff293..13f5ed6 100644
--- a/src/channels/private-chat/incoming.ts
+++ b/src/channels/private-chat/incoming.ts
@@ -100,7 +100,7 @@ export function incomingSteps(deps: Deps): Step<Replica>[] {
           replica.translationError = describeError(error)
           // Пометка в теме — у каждого сообщения, а общее сообщение говорит, что сломано и что
           // сделать; троттлинг по постоянному ключу не даёт лавины, пока провайдер лежит.
-          await alertModelFailure(deps.alerts, replica.translationError)
+          await alertModelFailure(deps.alerts, error)
         }
         if (replica.translation) {
           replica.review = deps.review({
diff --git a/src/channels/private-chat/outgoing.ts b/src/channels/private-chat/outgoing.ts
index 6118efe..9137aa9 100644
--- a/src/channels/private-chat/outgoing.ts
+++ b/src/channels/private-chat/outgoing.ts
@@ -42,7 +42,7 @@ export async function sendOwnerReply(
       translation = await deps.translator({ target: deps.languages.peer, history, text: payload.text })
     } catch (error) {
       const reason = describeError(error)
-      await alertModelFailure(deps.alerts, reason)
+      await alertModelFailure(deps.alerts, error)
       await deps.topics.postText(conversation, renderNotTranslated(reason))
       return false
     }
diff --git a/src/main.ts b/src/main.ts
index 3a7358f..257a87d 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -60,7 +60,7 @@ const app = createApp({
   languages: pair.ok ? pair.pair : null,
   languagesProblem: pair.ok ? null : pair.problem,
   translator: model.ok
-    ? createTranslator({ baseUrl: model.baseUrl, apiKey: model.apiKey, model: model.model, label: model.provider.label })
+    ? createTranslator({ baseUrl: model.baseUrl, apiKey: model.apiKey, model: model.model, provider: model.provider })
     : null,
   translatorProblem: model.ok ? null : model.problem,
   translatorInfo: model.ok ? `${model.provider.label} · ${model.model}` : model.problem,
diff --git a/src/translate/errors.ts b/src/translate/errors.ts
new file mode 100644
index 0000000..6eb7732
--- /dev/null
+++ b/src/translate/errors.ts
@@ -0,0 +1,46 @@
+import type { Provider } from './providers.ts'
+
+/** Что о провайдере нужно тексту ошибки: имя, переменная с ключом и где ключ взять. */
+export type ProviderInfo = Pick<Provider, 'label' | 'envKey' | 'keysUrl'>
+
+/** Ошибка провайдера для владельца: что случилось и что сделать. */
+export type ProviderErrorText = { reason: string; hint: string }
+
+type ErrorRow = {
+  match: (status: number) => boolean
+  text: (provider: ProviderInfo) => ProviderErrorText
+}
+
+/** Совет, когда код ответа ничего не говорит о причине. */
+export const DEFAULT_HINT = 'Проверьте ключ и баланс у провайдера.'
+
+/**
+ * Код ответа провайдера → понятная причина и подсказка. Таблица, а не switch: новый код —
+ * новая строка. Сырой ответ сюда не попадает: «User not found» покупателю ничего не скажет.
+ */
+export const PROVIDER_ERRORS: readonly ErrorRow[] = [
+  {
+    match: (status) => status === 401,
+    text: (p) => ({ reason: `${p.label}: ключ не подходит`, hint: `Проверьте ${p.envKey} в .env — ключ берут здесь: ${p.keysUrl}` }),
+  },
+  {
+    match: (status) => status === 402,
+    text: (p) => ({ reason: `${p.label}: на балансе закончились деньги`, hint: `Пополните баланс у ${p.label}.` }),
+  },
+  {
+    match: (status) => status === 429,
+    text: (p) => ({
+      reason: `${p.label} просит подождать — слишком много запросов`,
+      hint: 'Обычно это проходит само за минуту-другую.',
+    }),
+  },
+  {
+    match: (status) => status >= 500 && status < 600,
+    text: (p) => ({ reason: `${p.label} временно не работает`, hint: 'Обычно это проходит само — подождите.' }),
+  },
+]
+
+export function describeProviderError(provider: ProviderInfo, status: number): ProviderErrorText {
+  const row = PROVIDER_ERRORS.find((candidate) => candidate.match(status))
+  return row ? row.text(provider) : { reason: `${provider.label} ответил ошибкой ${status}`, hint: DEFAULT_HINT }
+}
diff --git a/src/translate/llm.ts b/src/translate/llm.ts
index 4b0b64f..4937d16 100644
--- a/src/translate/llm.ts
+++ b/src/translate/llm.ts
@@ -2,6 +2,7 @@ import { HISTORY_WINDOW } from '../store.ts'
 import type { LangProfile } from '../lang/profiles.ts'
 import type { HistoryLine } from '../types.ts'
 import { isPlantedCommand } from './check.ts'
+import { describeProviderError, type ProviderInfo } from './errors.ts'
 
 export type TranslateRequest = {
   /** На какой язык переводить */
@@ -15,9 +16,16 @@ export type Translator = (request: TranslateRequest) => Promise<string>
 
 /** Перевод не удался — текст сообщения показывается владельцу как причина. */
 export class TranslationError extends Error {
-  constructor(message: string) {
+  /** Что сделать владельцу; нет — общий совет про ключ и баланс */
+  readonly hint: string | undefined
+  /** Сырой ответ провайдера — только для консоли, владельцу не показывается */
+  readonly detail: string | undefined
+
+  constructor(message: string, extra: { hint?: string; detail?: string } = {}) {
     super(message)
     this.name = 'TranslationError'
+    this.hint = extra.hint
+    this.detail = extra.detail
   }
 }
 
@@ -163,14 +171,15 @@ export function createTranslator(config: {
   baseUrl: string
   apiKey: string
   model: string
-  /** Имя провайдера для сообщений об ошибке */
-  label: string
+  /** Провайдер для сообщений об ошибке: имя, переменная с ключом, где ключ взять */
+  provider: ProviderInfo
   fetchImpl?: typeof fetch
   timeoutMs?: number
   fragments?: readonly PromptFragment[]
 }): Translator {
   const fetchImpl = config.fetchImpl ?? fetch
   const timeoutMs = config.timeoutMs ?? TRANSLATE_TIMEOUT_MS
+  const { label } = config.provider
 
   return async (request) => {
     const { system, examples, user } = buildPrompt(request, config.fragments)
@@ -192,10 +201,11 @@ export function createTranslator(config: {
 
       if (!response.ok) {
         const body = (await response.text()).slice(0, 300)
-        throw new TranslationError(`${config.label} ответил ошибкой ${response.status}: ${body}`)
+        const { reason, hint } = describeProviderError(config.provider, response.status)
+        throw new TranslationError(reason, { hint, detail: `${response.status}: ${body}` })
       }
 
-      let data: { choices?: { message?: { content?: unknown } }[]; error?: { message?: string } }
+      let data: { choices?: { message?: { content?: unknown } }[]; error?: { message?: string; code?: unknown } }
       try {
         data = (await response.json()) as typeof data
       } catch (error) {
@@ -204,10 +214,18 @@ export function createTranslator(config: {
         if (signal.aborted && signal.reason instanceof Error && signal.reason.name === 'TimeoutError') {
           throw signal.reason
         }
-        throw new TranslationError(`${config.label} вернул не JSON`)
+        throw new TranslationError(`${label} вернул не JSON`)
       }
 
-      if (data.error) throw new TranslationError(`${config.label}: ${data.error.message ?? 'неизвестная ошибка'}`)
+      if (data.error) {
+        // OpenRouter иногда отвечает 200 и кладёт ошибку в тело — с тем же кодом, что и в статусе.
+        const detail = JSON.stringify(data.error).slice(0, 300)
+        if (typeof data.error.code === 'number') {
+          const { reason, hint } = describeProviderError(config.provider, data.error.code)
+          throw new TranslationError(reason, { hint, detail })
+        }
+        throw new TranslationError(`${label} вернул ошибку`, { detail })
+      }
 
       const rawContent = data.choices?.[0]?.message?.content
       if (typeof rawContent !== 'string') throw new TranslationError('модель вернула пустой ответ')
@@ -220,7 +238,10 @@ export function createTranslator(config: {
       if (error instanceof Error && error.name === 'TimeoutError') {
         throw new TranslationError(`модель не ответила за ${Math.round(timeoutMs / 1000)} с`)
       }
-      throw new TranslationError(`${config.label} недоступен: ${error instanceof Error ? error.message : String(error)}`)
+      throw new TranslationError(`нет связи с ${label}`, {
+        hint: 'Проверьте, что у сервера есть интернет.',
+        detail: error instanceof Error ? error.message : String(error),
+      })
     }
   }
 }
```

</details>

- [ ] **Step 4: Тесты и типы**

Run: `npm test && npm run typecheck`
Expected: PASS, 265 тестов; проверка типов без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add -A src test scripts
git commit -m "Ошибки провайдера модели понятным текстом, без сырого ответа" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Путь к настройке и строка «Написать первым» в статусе

Закрывает: `tasks.md` 4.1.

**Files:**
- Modify: `src/channels/private-chat/connection.ts` — `SETTINGS_PATH`, `BOT_SETTINGS_PATH`, тексты `NO_REPLY` и `DISABLED`
- Modify: `src/app.ts` — `connectionLine`, строка права и `WRITE_FIRST_HINT` в `statusText`
- Modify: `test/connection.test.ts`, `test/app.test.ts`

**Interfaces:**
- Produces: `SETTINGS_PATH: string`, `BOT_SETTINGS_PATH: string` (в `connection.ts`); `WRITE_FIRST_HINT: string` (в `app.ts`).

- [ ] **Step 1: Наложить тесты**

```bash
git apply .superpowers/sdd/write-first/task-5-test.patch
```

<details><summary>task-5-test.patch</summary>

```diff
diff --git a/test/app.test.ts b/test/app.test.ts
index 4f1f2e4..10b2e8f 100644
--- a/test/app.test.ts
+++ b/test/app.test.ts
@@ -89,6 +89,17 @@ test('/start — статус без подключения', async () => {
   assert.match(status, /Модель: OpenRouter · openai\/gpt-4\.1-mini/)
 })
 
+test('спека: в статусе — как написать первым и точный путь к настройке', async () => {
+  const { app, tg } = started()
+  await app.handleUpdate(fixture('owner-message-start'))
+  const status = tg.callsOf('sendText')[0]!.text
+  assert.match(
+    status,
+    /• Написать первым: отправьте текст сюда вне тем — бот переведёт и даст кнопку «Отправить через бота»/,
+  )
+  assert.match(status, /если нет — Настройки → Аккаунт → Автоматизация чатов \(на Mac — Настройки → Изменить профиль/)
+})
+
 test('/start — подключение выключено', () => {
   const { deps, connectOwner } = setupDeps()
   connectOwner({ isEnabled: false })
diff --git a/test/connection.test.ts b/test/connection.test.ts
index f40c38f..e1468e1 100644
--- a/test/connection.test.ts
+++ b/test/connection.test.ts
@@ -1,5 +1,6 @@
 import { test } from 'node:test'
 import assert from 'node:assert/strict'
+import { readFileSync, readdirSync } from 'node:fs'
 import {
   CONNECTED,
   DISABLED,
@@ -91,3 +92,19 @@ test('подключение до запуска: первый раз спраш
   assert.deepEqual(first, second)
   assert.deepEqual(notices(tg), [CONNECTED])
 })
+
+test('спека: путь к настройке — «Настройки → Аккаунт → Автоматизация чатов», для Mac — через «Изменить профиль»', () => {
+  for (const text of [NO_REPLY, DISABLED]) {
+    assert.match(text, /Настройки → Аккаунт → Автоматизация чатов/)
+    assert.match(text, /на Mac — Настройки → Изменить профиль → Автоматизация чатов/)
+  }
+  assert.match(NO_REPLY, /«Ответы на сообщения» \(раздел «Сообщения»\): Настройки → Аккаунт → Автоматизация чатов → этот бот/)
+})
+
+test('старый путь «Настройки → Автоматизация чатов» нигде в текстах бота не остался', () => {
+  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'))
+  for (const file of files) {
+    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
+    assert.ok(!source.includes('Настройки → Автоматизация чатов'), file)
+  }
+})
```

</details>

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — в текстах старый путь без «Аккаунт», в статусе нет строки «Написать первым».

- [ ] **Step 3: Наложить код**

```bash
git apply .superpowers/sdd/write-first/task-5-src.patch
```

<details><summary>task-5-src.patch</summary>

```diff
diff --git a/src/app.ts b/src/app.ts
index db913fa..67e7e8f 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,5 +1,5 @@
 import type { CallbackQuery, Message, Update } from 'grammy/types'
-import { isAllowedOwner, onBusinessConnection } from './channels/private-chat/connection.ts'
+import { BOT_SETTINGS_PATH, SETTINGS_PATH, isAllowedOwner, onBusinessConnection } from './channels/private-chat/connection.ts'
 import { onBusinessMessage } from './channels/private-chat/incoming.ts'
 import { sendOwnerReply } from './channels/private-chat/outgoing.ts'
 import type { Deps } from './deps.ts'
@@ -13,12 +13,14 @@ export const CANT_FORWARD = 'Такое бот переслать не умее
 /** Нет записи — бот ещё не видел подключения; запись выключена — владелец отключил бота. */
 function connectionLine(connection: Connection | undefined): string {
   if (!connection) {
-    return 'бот его ещё не видел. Если уже подключили — появится с первым сообщением в личке; ' +
-      'если нет — Настройки → Автоматизация чатов'
+    return `бот его ещё не видел. Если уже подключили — появится с первым сообщением в личке; если нет — ${SETTINGS_PATH}`
   }
-  return connection.isEnabled ? 'есть' : 'нет — подключите бота: Настройки → Автоматизация чатов'
+  return connection.isEnabled ? 'есть' : `нет — подключите бота: ${SETTINGS_PATH}`
 }
 
+export const WRITE_FIRST_HINT =
+  'Написать первым: отправьте текст сюда вне тем — бот переведёт и даст кнопку «Отправить через бота»'
+
 /** Статус по /start: по нему владелец видит, работает ли перевод и что включить. */
 export function statusText(deps: Deps): string {
   const connection = deps.store.ownerConnection(deps.ownerId)
@@ -30,10 +32,11 @@ export function statusText(deps: Deps): string {
     'Статус переводчика',
     `• Подключение к аккаунту: ${connectionLine(connection)}`,
     `• Право отвечать от вашего имени: ${
-      !connected ? '—' : connection.canReply ? 'есть' : 'нет — включите «Ответы на сообщения»: Настройки → Автоматизация чатов → этот бот'
+      !connected ? '—' : connection.canReply ? 'есть' : `нет — включите «Ответы на сообщения»: ${BOT_SETTINGS_PATH}`
     }`,
     `• Языки: ${languages}`,
     `• Модель: ${deps.translatorInfo}`,
+    `• ${WRITE_FIRST_HINT}`,
     ...(deps.dry ? ['• Холостой прогон: собеседникам ничего не уходит'] : []),
   ].join('\n')
 }
diff --git a/src/channels/private-chat/connection.ts b/src/channels/private-chat/connection.ts
index 61a58f8..8cdb82d 100644
--- a/src/channels/private-chat/connection.ts
+++ b/src/channels/private-chat/connection.ts
@@ -11,18 +11,27 @@ export function isAllowedOwner(userId: number, ownerId: number): boolean {
   return userId === ownerId
 }
 
+/**
+ * Где настройка подключения. Так пункт называется на деле (живая проверка 2026-10-12): между
+ * «Настройки» и «Автоматизацией чатов» есть «Аккаунт», а на Mac — «Изменить профиль».
+ */
+export const SETTINGS_PATH =
+  'Настройки → Аккаунт → Автоматизация чатов (на Mac — Настройки → Изменить профиль → Автоматизация чатов)'
+
+/** Та же настройка, но уже для подключённого бота. */
+export const BOT_SETTINGS_PATH =
+  'Настройки → Аккаунт → Автоматизация чатов → этот бот (на Mac — Настройки → Изменить профиль → Автоматизация чатов)'
+
 export const CONNECTED =
   'Бот подключён к вашему аккаунту — переводы включены. Когда вам напишут на другом языке, ' +
   'здесь появится тема с переводом.'
 
 export const NO_REPLY =
   'Бот подключён, но ему не разрешено отвечать от вашего имени: переводы входящих будут приходить, ' +
-  'а ваши ответы не уйдут. Включите «Ответы на сообщения» (раздел «Сообщения»): ' +
-  'Настройки → Автоматизация чатов → этот бот. Если на компьютере галочка не сохраняется, попробуйте с телефона.'
+  `а ваши ответы не уйдут. Включите «Ответы на сообщения» (раздел «Сообщения»): ${BOT_SETTINGS_PATH}. ` +
+  'Если на компьютере галочка не сохраняется, попробуйте с телефона.'
 
-export const DISABLED =
-  'Бот отключён от вашего аккаунта — переводы остановлены. Чтобы включить снова: ' +
-  'Настройки → Автоматизация чатов → выберите этого бота.'
+export const DISABLED = `Бот отключён от вашего аккаунта — переводы остановлены. Чтобы включить снова, выберите этого бота: ${SETTINGS_PATH}.`
 
 export function strangerNotice(userName: string): string {
   return `Кто-то пытался подключить бота к своему аккаунту: ${userName}. Его сообщения бот не обрабатывает и модели не отдаёт.`
```

</details>

- [ ] **Step 4: Тесты и типы**

Run: `npm test && npm run typecheck`
Expected: PASS, 268 тестов; проверка типов без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add -A src test scripts
git commit -m "Точный путь к «Автоматизации чатов» и подсказка «Написать первым» в статусе" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Оформление и кнопки ручной отправки

Закрывает: `tasks.md` 5.1, 5.2.

**Files:**
- Create: `src/owner/manual-send.ts`
- Create: `test/manual-send.test.ts`

**Interfaces:**
- Consumes: `InlineButton` (Task 1), `Draft` (Task 3).
- Produces: `COPY_LIMIT = 256`; `SEND_VIA_BOT`, `COPY`, `TAP_TO_COPY`, `SUSPICIOUS_DRAFT`; `manualKeyboard(draft: Pick<Draft, 'id' | 'translation'>, opts: { inline: boolean; media: boolean }): InlineButton[][]`; `renderDraft(head: string, translation: string): string[]` (head — готовый HTML); `newPeerHead(languageName: string): string`; `renderSuspiciousDraft(translation: string): string[]`; `renderDraftFailed(reason: string): string[]`.

- [ ] **Step 1: Наложить тесты**

```bash
git apply .superpowers/sdd/write-first/task-6-test.patch
```

<details><summary>task-6-test.patch</summary>

```diff
diff --git a/test/manual-send.test.ts b/test/manual-send.test.ts
new file mode 100644
index 0000000..68e8c33
--- /dev/null
+++ b/test/manual-send.test.ts
@@ -0,0 +1,81 @@
+import { test } from 'node:test'
+import assert from 'node:assert/strict'
+import {
+  COPY_LIMIT,
+  manualKeyboard,
+  newPeerHead,
+  renderDraft,
+  renderDraftFailed,
+  renderSuspiciousDraft,
+} from '../src/owner/manual-send.ts'
+
+const short = { id: 42, translation: "Hi! I'm writing about the apartment." }
+const long = { id: 43, translation: 'word '.repeat(60).trim() }
+
+test('спека: короткий перевод — зелёная «Отправить через бота» и «Скопировать» в двух строках', () => {
+  assert.deepEqual(manualKeyboard(short, { inline: true, media: false }), [
+    [{ text: 'Отправить через бота', chooseChat: '42', style: 'success' }],
+    [{ text: 'Скопировать', copy: "Hi! I'm writing about the apartment." }],
+  ])
+})
+
+test('спека: перевод длиннее 256 символов — без «Скопировать»', () => {
+  assert.ok(long.translation.length > COPY_LIMIT)
+  assert.deepEqual(manualKeyboard(long, { inline: true, media: false }), [
+    [{ text: 'Отправить через бота', chooseChat: '43', style: 'success' }],
+  ])
+})
+
+test('ровно 256 символов — «Скопировать» ещё есть', () => {
+  const edge = { id: 44, translation: 'a'.repeat(COPY_LIMIT) }
+  assert.equal(manualKeyboard(edge, { inline: false, media: false }).length, 1)
+})
+
+test('спека: Inline Mode выключен — одна «Скопировать»', () => {
+  assert.deepEqual(manualKeyboard(short, { inline: false, media: false }), [[{ text: 'Скопировать', copy: short.translation }]])
+})
+
+test('подпись к вложению — одна «Скопировать»: через бота ушёл бы текст без вложения', () => {
+  assert.deepEqual(manualKeyboard(short, { inline: true, media: true }), [[{ text: 'Скопировать', copy: short.translation }]])
+})
+
+test('перевод длиннее 4096 — без «Отправить через бота»: в одно сообщение не влезет', () => {
+  assert.deepEqual(manualKeyboard({ id: 45, translation: 'a'.repeat(4097) }, { inline: true, media: false }), [])
+})
+
+test('спека: перевод для нового собеседника — заголовок с языком и перевод обычным текстом', () => {
+  assert.deepEqual(renderDraft(newPeerHead('английский'), short.translation), [
+    "<i>Перевод для нового собеседника (английский):</i>\nHi! I'm writing about the apartment.",
+  ])
+})
+
+test('спека: длинный перевод — в блоке кода с подсказкой «Нажмите на перевод, чтобы скопировать»', () => {
+  assert.deepEqual(renderDraft('<b>Заголовок</b>', long.translation), [
+    `<b>Заголовок</b>\n<i>Нажмите на перевод, чтобы скопировать:</i>\n<pre>${long.translation}</pre>`,
+  ])
+})
+
+test('очень длинный перевод — по сообщению на кусок, подсказка в первом', () => {
+  const parts = renderDraft('<b>З</b>', 'слово '.repeat(1500))
+  assert.ok(parts.length >= 3)
+  assert.ok(parts[0]!.startsWith('<b>З</b>\n<i>Нажмите на перевод'))
+  for (const part of parts) assert.ok(part.length <= 4096 && part.includes('<pre>'))
+})
+
+test('перевод с «<b>» и «&» экранирован и не становится разметкой', () => {
+  assert.deepEqual(renderDraft('<i>З</i>', 'Tom & <b>Jerry</b>'), ['<i>З</i>\nTom &amp; &lt;b&gt;Jerry&lt;/b&gt;'])
+})
+
+test('длинный перевод с «</pre>» и «&» — экранирован, блок кода не ломается', () => {
+  const tricky = `${'x '.repeat(140)}</pre><b>&`
+  const [html] = renderDraft('<b>З</b>', tricky)
+  assert.ok(html!.endsWith('&lt;/pre&gt;&lt;b&gt;&amp;</pre>'))
+  assert.equal(html!.match(/<\/pre>/g)!.length, 1)
+})
+
+test('спека: подозрительный перевод — с пометкой, без кнопок; не удался — причина', () => {
+  assert.deepEqual(renderSuspiciousDraft('Привет <3'), [
+    '<i>⚠️ Перевод выглядит подозрительно — отправлять его не предлагаю</i>\nПривет &lt;3',
+  ])
+  assert.deepEqual(renderDraftFailed('OpenRouter: ключ не подходит'), ['<i>Перевод не удался: OpenRouter: ключ не подходит</i>'])
+})
```

</details>

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `test/manual-send.test.ts` не загружается: нет `src/owner/manual-send.ts`.

- [ ] **Step 3: Наложить код**

```bash
git apply .superpowers/sdd/write-first/task-6-src.patch
```

<details><summary>task-6-src.patch</summary>

```diff
diff --git a/src/owner/manual-send.ts b/src/owner/manual-send.ts
new file mode 100644
index 0000000..7a5f568
--- /dev/null
+++ b/src/owner/manual-send.ts
@@ -0,0 +1,65 @@
+import { MESSAGE_LIMIT, escapeHtml, splitText } from '../html.ts'
+import type { InlineButton } from '../telegram.ts'
+import type { Draft } from '../types.ts'
+
+/**
+ * Ручная отправка: когда бот не может или не должен писать от имени владельца сам —
+ * владелец пишет первым или Telegram отказал, — владелец получает готовый перевод с
+ * кнопками «Отправить через бота» и «Скопировать» и отправляет его в два нажатия.
+ */
+
+/** Telegram принимает в кнопке «Скопировать» не больше 256 символов. */
+export const COPY_LIMIT = 256
+
+/** Длина куска перевода в одном сообщении. Запас до 4096 — на заголовок и экранирование. */
+const CHUNK = MESSAGE_LIMIT - 512
+
+export const SEND_VIA_BOT = 'Отправить через бота'
+export const COPY = 'Скопировать'
+export const TAP_TO_COPY = 'Нажмите на перевод, чтобы скопировать'
+export const SUSPICIOUS_DRAFT = '⚠️ Перевод выглядит подозрительно — отправлять его не предлагаю'
+
+/**
+ * Кнопки под переводом. «Отправить через бота» — главное действие, зелёная и в своей строке:
+ * рядом с другой длинная кнопка на телефоне обрезалась бы. Её нет, если:
+ * - inline: false — Inline Mode выключен, кнопка не сработала бы;
+ * - media: true — перевод — подпись к вложению, а через бота ушёл бы один текст без вложения;
+ * - перевод длиннее 4096 — вариант inline-ответа — одно сообщение, больше Telegram не пустит.
+ */
+export function manualKeyboard(draft: Pick<Draft, 'id' | 'translation'>, opts: { inline: boolean; media: boolean }): InlineButton[][] {
+  const rows: InlineButton[][] = []
+  if (opts.inline && !opts.media && draft.translation.length <= MESSAGE_LIMIT) {
+    rows.push([{ text: SEND_VIA_BOT, chooseChat: String(draft.id), style: 'success' }])
+  }
+  if (draft.translation.length <= COPY_LIMIT) rows.push([{ text: COPY, copy: draft.translation }])
+  return rows
+}
+
+/**
+ * Заголовок и перевод для ручной отправки (HTML, кнопки вешаются на последнюю часть).
+ * Короткий перевод — обычным текстом: его копирует кнопка. Длинный кнопка не примет, поэтому
+ * он в блоке кода, который Telegram копирует нажатием, и над ним подсказка.
+ * head — уже готовый HTML.
+ */
+export function renderDraft(head: string, translation: string): string[] {
+  if (translation.length <= COPY_LIMIT) return [`${head}\n${escapeHtml(translation)}`]
+  const parts = splitText(translation, CHUNK).map((part) => `<pre>${escapeHtml(part)}</pre>`)
+  parts[0] = `${head}\n<i>${TAP_TO_COPY}:</i>\n${parts[0]}`
+  return parts
+}
+
+/** Заголовок перевода для нового собеседника: язык — из пары, на него и переводили. */
+export function newPeerHead(languageName: string): string {
+  return `<i>Перевод для нового собеседника (${escapeHtml(languageName)}):</i>`
+}
+
+/** Перевод не прошёл проверку: показываем, но отправлять не предлагаем. */
+export function renderSuspiciousDraft(translation: string): string[] {
+  const parts = splitText(translation, CHUNK).map(escapeHtml)
+  parts[0] = `<i>${SUSPICIOUS_DRAFT}</i>\n${parts[0]}`
+  return parts
+}
+
+export function renderDraftFailed(reason: string): string[] {
+  return [`<i>Перевод не удался: ${escapeHtml(reason)}</i>`]
+}
```

</details>

- [ ] **Step 4: Тесты и типы**

Run: `npm test && npm run typecheck`
Expected: PASS, 280 тестов; проверка типов без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add -A src test scripts
git commit -m "Написать первым: оформление перевода и кнопки ручной отправки" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: «Написать первым» и ответ на inline-запрос

Закрывает: `tasks.md` 5.3, 5.4.

**Files:**
- Modify: `src/owner/manual-send.ts` — `newPeerDraft`, `answerInline`, тексты
- Modify: `test/manual-send.test.ts`

**Interfaces:**
- Consumes: `Deps.inlineEnabled` (Task 2), `store.createDraft`/`getDraft` и `DRAFT_TTL` (Task 3), `alertModelFailure(alerts, error)` (Task 4), `manualKeyboard`/`renderDraft` (Task 6), `TelegramApi.answerInline` (Task 1).
- Produces: `FIRST_TEXT_ONLY`, `DRAFT_EXPIRED`, `INLINE_HINT`; `newPeerDraft(deps: Deps, payload: OwnerPayload): Promise<void>`; `answerInline(deps: Deps, query: { id: string; query: string }): Promise<void>`.

- [ ] **Step 1: Наложить тесты**

```bash
git apply .superpowers/sdd/write-first/task-7-test.patch
```

<details><summary>task-7-test.patch</summary>

```diff
diff --git a/test/manual-send.test.ts b/test/manual-send.test.ts
index 68e8c33..233f0ff 100644
--- a/test/manual-send.test.ts
+++ b/test/manual-send.test.ts
@@ -2,12 +2,22 @@ import { test } from 'node:test'
 import assert from 'node:assert/strict'
 import {
   COPY_LIMIT,
+  DRAFT_EXPIRED,
+  FIRST_TEXT_ONLY,
+  answerInline,
   manualKeyboard,
+  newPeerDraft,
   newPeerHead,
   renderDraft,
   renderDraftFailed,
   renderSuspiciousDraft,
 } from '../src/owner/manual-send.ts'
+import { DRAFT_TTL } from '../src/store.ts'
+import { reviewTranslation } from '../src/translate/check.ts'
+import { TranslationError } from '../src/translate/llm.ts'
+import type { OwnerPayload } from '../src/types.ts'
+import { OWNER_ID } from './helpers.ts'
+import { fakeTranslator, setupDeps } from './setup.ts'
 
 const short = { id: 42, translation: "Hi! I'm writing about the apartment." }
 const long = { id: 43, translation: 'word '.repeat(60).trim() }
@@ -79,3 +89,125 @@ test('спека: подозрительный перевод — с помет
   ])
   assert.deepEqual(renderDraftFailed('OpenRouter: ключ не подходит'), ['<i>Перевод не удался: OpenRouter: ключ не подходит</i>'])
 })
+
+const hello: OwnerPayload = { text: 'Привет! Я по поводу квартиры', media: null, sourceMessageId: 903 }
+const apartment = fakeTranslator(() => "Hi! I'm writing about the apartment.")
+
+test('спека: написать первым — перевод на язык собеседника без истории, ответом на сообщение, с кнопками', async () => {
+  const translator = fakeTranslator(() => "Hi! I'm writing about the apartment.")
+  const { deps, tg, store } = setupDeps({ overrides: { translator: translator.translate } })
+  await newPeerDraft(deps, hello)
+
+  assert.equal(translator.calls[0]!.target.code, 'en')
+  assert.deepEqual(translator.calls[0]!.history, [])
+  assert.equal(tg.sentAsOwner().length, 0)
+
+  const [reply] = tg.callsOf('sendText')
+  assert.equal(reply!.chatId, OWNER_ID)
+  assert.equal(reply!.opts.replyTo, 903)
+  assert.equal(reply!.opts.threadId, undefined)
+  assert.equal(reply!.text, "<i>Перевод для нового собеседника (английский):</i>\nHi! I'm writing about the apartment.")
+  const draftId = Number(reply!.opts.keyboard![0]![0]!.chooseChat)
+  assert.deepEqual(store.getDraft(OWNER_ID, draftId, deps.now()), {
+    id: draftId,
+    ownerId: OWNER_ID,
+    conversationId: null,
+    original: 'Привет! Я по поводу квартиры',
+    translation: "Hi! I'm writing about the apartment.",
+    createdAt: deps.now(),
+  })
+  assert.equal(reply!.opts.keyboard![1]![0]!.copy, "Hi! I'm writing about the apartment.")
+})
+
+test('спека: Inline Mode выключен — перевод с одной «Скопировать»', async () => {
+  const { deps, tg } = setupDeps({ overrides: { translator: apartment.translate, inlineEnabled: async () => false } })
+  await newPeerDraft(deps, hello)
+  assert.deepEqual(tg.callsOf('sendText')[0]!.opts.keyboard, [[{ text: 'Скопировать', copy: "Hi! I'm writing about the apartment." }]])
+})
+
+test('спека: холостой прогон — перевод с кнопками как обычно', async () => {
+  const { deps, tg } = setupDeps({ overrides: { translator: apartment.translate, dry: true } })
+  await newPeerDraft(deps, hello)
+  assert.equal(tg.callsOf('sendText')[0]!.opts.keyboard!.length, 2)
+})
+
+test('спека: первым — только текст: вложение не переводится', async () => {
+  const translator = fakeTranslator()
+  const { deps, tg } = setupDeps({ overrides: { translator: translator.translate } })
+  await newPeerDraft(deps, { text: 'Это тебе', media: { kind: 'photo', fileId: 'P' }, sourceMessageId: 904 })
+  assert.equal(translator.calls.length, 0)
+  assert.deepEqual(
+    tg.callsOf('sendText').map((call) => [call.text, call.opts.replyTo]),
+    [[FIRST_TEXT_ONLY, 904]],
+  )
+  assert.equal(FIRST_TEXT_ONLY, 'Первым бот отправляет только текст — вложение отправьте собеседнику в личке сами.')
+})
+
+test('спека: модель недоступна — «Перевод не удался: <причина>» без кнопок, перевод не сохраняется', async () => {
+  const failing = fakeTranslator(() => {
+    throw new TranslationError('OpenRouter временно не работает', { hint: 'Обычно это проходит само — подождите.' })
+  })
+  const { deps, tg } = setupDeps({ overrides: { translator: failing.translate } })
+  await newPeerDraft(deps, hello)
+  const reply = tg.callsOf('sendText').find((call) => call.opts.replyTo === 903)!
+  assert.equal(reply.text, '<i>Перевод не удался: OpenRouter временно не работает</i>')
+  assert.equal(reply.opts.keyboard, undefined)
+  assert.ok(tg.callsOf('sendText').some((call) => call.text.startsWith('Модель не переводит: OpenRouter временно не работает')))
+})
+
+test('нет ключа модели — причина без кнопок', async () => {
+  const { deps, tg } = setupDeps({ overrides: { translator: null, translatorProblem: 'Нет ключа модели — переводить нечем.' } })
+  await newPeerDraft(deps, hello)
+  assert.equal(tg.callsOf('sendText')[0]!.text, '<i>Перевод не удался: Нет ключа модели — переводить нечем.</i>')
+})
+
+test('спека: ответ модели не на языке собеседника — пометка и никаких кнопок', async () => {
+  const echo = fakeTranslator((request) => request.text)
+  const { deps, tg, store } = setupDeps({ overrides: { translator: echo.translate, review: reviewTranslation } })
+  await newPeerDraft(deps, { ...hello, text: 'Хорошо, созвонимся вечером и всё обсудим.' })
+  const [reply] = tg.callsOf('sendText')
+  assert.equal(reply!.text, '<i>⚠️ Перевод выглядит подозрительно — отправлять его не предлагаю</i>\nХорошо, созвонимся вечером и всё обсудим.')
+  assert.equal(reply!.opts.keyboard, undefined)
+  assert.equal(store.findDraftByTranslation(OWNER_ID, 'Хорошо, созвонимся вечером и всё обсудим.', deps.now()), undefined)
+})
+
+test('inline-запрос с номером живого перевода — один вариант, перевод обычным текстом', async () => {
+  const { deps, tg, store } = setupDeps()
+  const draft = store.createDraft({ ownerId: OWNER_ID, conversationId: null, original: 'Привет', translation: 'Hi <there> & bye', now: deps.now() })
+  await answerInline(deps, { id: 'Q1', query: String(draft.id) })
+  assert.deepEqual(tg.callsOf('answerInline'), [
+    {
+      method: 'answerInline',
+      queryId: 'Q1',
+      articles: [{ id: String(draft.id), title: 'Hi <there> & bye', description: 'Нажмите — уйдёт от вашего имени', text: 'Hi <there> & bye' }],
+    },
+  ])
+})
+
+test('заголовок варианта — первая строка перевода, длинная обрезается', async () => {
+  const { deps, tg, store } = setupDeps()
+  const draft = store.createDraft({ ownerId: OWNER_ID, conversationId: null, original: 'x', translation: `${'a'.repeat(100)}\nвторая`, now: deps.now() })
+  await answerInline(deps, { id: 'Q', query: String(draft.id) })
+  const title = tg.callsOf('answerInline')[0]!.articles[0]!.title
+  assert.equal(title.length, 64)
+  assert.ok(title.endsWith('…'))
+})
+
+test('спека: перевод устарел — вариантов нет, кнопка «Перевод устарел — напишите заново»', async () => {
+  const { deps, tg, store, advance } = setupDeps()
+  const draft = store.createDraft({ ownerId: OWNER_ID, conversationId: null, original: 'Привет', translation: 'Hi', now: deps.now() })
+  advance(DRAFT_TTL + 1)
+  await answerInline(deps, { id: 'Q2', query: String(draft.id) })
+  assert.deepEqual(tg.callsOf('answerInline'), [
+    { method: 'answerInline', queryId: 'Q2', articles: [], button: { text: DRAFT_EXPIRED, startParameter: 'draft' } },
+  ])
+})
+
+test('чужой номер, пустой и мусорный запрос — тоже без вариантов', async () => {
+  const { deps, tg, store } = setupDeps()
+  const foreign = store.createDraft({ ownerId: 100002, conversationId: null, original: 'x', translation: 'secret', now: deps.now() })
+  for (const query of [String(foreign.id), '', 'hello', '1e3', '99999999999999999999']) {
+    await answerInline(deps, { id: 'Q', query })
+  }
+  assert.ok(tg.callsOf('answerInline').every((call) => call.articles.length === 0))
+})
```

</details>

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — в `manual-send.ts` нет `newPeerDraft` и `answerInline`.

- [ ] **Step 3: Наложить код**

```bash
git apply .superpowers/sdd/write-first/task-7-src.patch
```

<details><summary>task-7-src.patch</summary>

```diff
diff --git a/src/owner/manual-send.ts b/src/owner/manual-send.ts
index 7a5f568..5a9eae9 100644
--- a/src/owner/manual-send.ts
+++ b/src/owner/manual-send.ts
@@ -1,6 +1,8 @@
+import { alertModelFailure } from '../alerts.ts'
+import type { Deps } from '../deps.ts'
 import { MESSAGE_LIMIT, escapeHtml, splitText } from '../html.ts'
-import type { InlineButton } from '../telegram.ts'
-import type { Draft } from '../types.ts'
+import { describeError, type InlineButton } from '../telegram.ts'
+import type { Draft, OwnerPayload } from '../types.ts'
 
 /**
  * Ручная отправка: когда бот не может или не должен писать от имени владельца сам —
@@ -18,6 +20,12 @@ export const SEND_VIA_BOT = 'Отправить через бота'
 export const COPY = 'Скопировать'
 export const TAP_TO_COPY = 'Нажмите на перевод, чтобы скопировать'
 export const SUSPICIOUS_DRAFT = '⚠️ Перевод выглядит подозрительно — отправлять его не предлагаю'
+export const FIRST_TEXT_ONLY = 'Первым бот отправляет только текст — вложение отправьте собеседнику в личке сами.'
+export const DRAFT_EXPIRED = 'Перевод устарел — напишите заново'
+/** Подпись варианта в inline-ответе: что будет по нажатию. */
+export const INLINE_HINT = 'Нажмите — уйдёт от вашего имени'
+/** Заголовок варианта: начало перевода, длиннее Telegram всё равно обрежет. */
+const TITLE_LIMIT = 64
 
 /**
  * Кнопки под переводом. «Отправить через бота» — главное действие, зелёная и в своей строке:
@@ -63,3 +71,91 @@ export function renderSuspiciousDraft(translation: string): string[] {
 export function renderDraftFailed(reason: string): string[] {
   return [`<i>Перевод не удался: ${escapeHtml(reason)}</i>`]
 }
+
+/** Части HTML в чат владельца вне тем: ответом на его сообщение, кнопки — под последней. */
+async function replyToOwner(deps: Deps, replyTo: number, html: readonly string[], keyboard?: InlineButton[][]): Promise<void> {
+  for (const [index, part] of html.entries()) {
+    const last = index === html.length - 1
+    await deps.api.sendText(deps.ownerId, part, {
+      html: true,
+      ...(index === 0 && { replyTo }),
+      ...(last && keyboard && keyboard.length > 0 && { keyboard }),
+    })
+  }
+}
+
+/**
+ * «Написать первым»: текст владельца → перевод на язык собеседника из пары → ответ на его
+ * сообщение с кнопками ручной отправки. Никому ничего не уходит само. Истории нет: разговора
+ * с этим человеком ещё нет, и подсунуть модели закладку из чужих реплик некому. Проверка — та
+ * же, что у ответа, который бот отправил бы сам: подозрительный перевод кнопок не получает.
+ */
+export async function newPeerDraft(deps: Deps, payload: OwnerPayload): Promise<void> {
+  if (payload.media) {
+    await deps.api.sendText(deps.ownerId, FIRST_TEXT_ONLY, { replyTo: payload.sourceMessageId })
+    return
+  }
+  if (!deps.translator || !deps.languages) {
+    const problem = deps.translatorProblem ?? deps.languagesProblem ?? 'переводчик не настроен'
+    await replyToOwner(deps, payload.sourceMessageId, renderDraftFailed(problem))
+    return
+  }
+
+  let translation: string
+  try {
+    translation = await deps.translator({ target: deps.languages.peer, history: [], text: payload.text })
+  } catch (error) {
+    await alertModelFailure(deps.alerts, error)
+    await replyToOwner(deps, payload.sourceMessageId, renderDraftFailed(describeError(error)))
+    return
+  }
+
+  const review = deps.review({
+    direction: 'outgoing',
+    original: payload.text,
+    translation,
+    owner: deps.languages.owner,
+    target: deps.languages.peer,
+  })
+  if (review.verdict !== 'ok') {
+    await replyToOwner(deps, payload.sourceMessageId, renderSuspiciousDraft(translation))
+    return
+  }
+
+  const draft = deps.store.createDraft({
+    ownerId: deps.ownerId,
+    conversationId: null,
+    original: payload.text,
+    translation,
+    now: deps.now(),
+  })
+  await replyToOwner(
+    deps,
+    payload.sourceMessageId,
+    renderDraft(newPeerHead(deps.languages.peer.nameRu), draft.translation),
+    manualKeyboard(draft, { inline: await deps.inlineEnabled(), media: false }),
+  )
+}
+
+function titleOf(translation: string): string {
+  const firstLine = translation.split('\n')[0]!
+  return firstLine.length > TITLE_LIMIT ? `${firstLine.slice(0, TITLE_LIMIT - 1)}…` : firstLine
+}
+
+/**
+ * Ответ на inline-запрос «@бот <номер>» — его подставляет кнопка «Отправить через бота».
+ * Вызывается только для владельца (фильтр в app.ts), перевод ищется среди его живых. Нет
+ * такого — вариантов нет, а кнопка над ними ведёт в чат с ботом написать заново.
+ */
+export async function answerInline(deps: Deps, query: { id: string; query: string }): Promise<void> {
+  const text = query.query.trim()
+  const id = /^\d{1,15}$/.test(text) ? Number(text) : undefined
+  const draft = id === undefined ? undefined : deps.store.getDraft(deps.ownerId, id, deps.now())
+  if (!draft) {
+    await deps.api.answerInline(query.id, [], { button: { text: DRAFT_EXPIRED, startParameter: 'draft' } })
+    return
+  }
+  await deps.api.answerInline(query.id, [
+    { id: String(draft.id), title: titleOf(draft.translation), description: INLINE_HINT, text: draft.translation },
+  ])
+}
```

</details>

- [ ] **Step 4: Тесты и типы**

Run: `npm test && npm run typecheck`
Expected: PASS, 291 тест; проверка типов без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add -A src test scripts
git commit -m "Написать первым: перевод для нового собеседника и ответ на inline-запрос" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Маршрут и «Кому?»

Закрывает: `tasks.md` 6.1, 6.2, 6.3.

**Files:**
- Modify: `src/owner/routing.ts` — вид `new`, «Кому?» при любом числе активных, «Новому собеседнику», `NO_TARGET` удалён
- Modify: `src/app.ts` — маршрут `new` → `newPeerDraft`
- Modify: `test/routing.test.ts`, `test/app.test.ts`

**Interfaces:**
- Consumes: `newPeerDraft` (Task 7).
- Produces: `Route` с видом `{ kind: 'new' }` вместо `{ kind: 'none' }`; `NEW_PEER = 'Новому собеседнику'`; `chooseKeyboard(pendingId: number, options: readonly Conversation[], opts?: { newPeer: boolean }): { text: string; data: string }[][]`; `Choice` с видом `{ kind: 'new'; pendingId: number }`.

- [ ] **Step 1: Наложить тесты**

```bash
git apply .superpowers/sdd/write-first/task-8-test.patch
```

<details><summary>task-8-test.patch</summary>

```diff
diff --git a/test/app.test.ts b/test/app.test.ts
index 10b2e8f..329d77f 100644
--- a/test/app.test.ts
+++ b/test/app.test.ts
@@ -3,7 +3,8 @@ import assert from 'node:assert/strict'
 import type { Update } from 'grammy/types'
 import { CANT_FORWARD, createApp, statusText } from '../src/app.ts'
 import { CONNECTED } from '../src/channels/private-chat/connection.ts'
-import { NO_TARGET, STRAY_TOPIC } from '../src/owner/routing.ts'
+import { FIRST_TEXT_ONLY } from '../src/owner/manual-send.ts'
+import { STRAY_TOPIC } from '../src/owner/routing.ts'
 import { CONNECTION_ID, OWNER_ID, PEER_ID, fixture } from './helpers.ts'
 import { TelegramError } from '../src/telegram.ts'
 import { setupDeps } from './setup.ts'
@@ -121,12 +122,26 @@ test('/start — статус показывает, что ключа нет и
   assert.match(status, /Холостой прогон/)
 })
 
-test('вне тем без активных разговоров — подсказка, никому ничего не уходит', async () => {
+test('спека: вне тем без активных разговоров — перевод для нового собеседника с кнопками, никому ничего не уходит', async () => {
   const { app, tg, connectOwner } = started()
   connectOwner()
   await app.handleUpdate(fixture('owner-message-outside'))
   assert.equal(tg.sentAsOwner().length, 0)
-  assert.equal(tg.callsOf('sendText')[0]!.text, NO_TARGET)
+  const [reply] = tg.callsOf('sendText')
+  assert.equal(reply!.text, '<i>Перевод для нового собеседника (английский):</i>\n[en] Привет!')
+  assert.equal(reply!.opts.replyTo, 903)
+  assert.deepEqual(reply!.opts.keyboard!.map((row) => row[0]!.text), ['Отправить через бота', 'Скопировать'])
+})
+
+test('спека: фото вне тем без активных разговоров — «Первым бот отправляет только текст», модель не вызывается', async () => {
+  const { app, tg, translator, connectOwner } = started()
+  connectOwner()
+  const photo = fixture('owner-message-photo-in-topic')
+  delete photo.message!.message_thread_id
+  delete photo.message!.reply_to_message
+  await app.handleUpdate(photo)
+  assert.equal(translator.calls.length, 0)
+  assert.equal(tg.callsOf('sendText')[0]!.text, FIRST_TEXT_ONLY)
 })
 
 test('ответ «Ответить» в ленте «Все» уходит собеседнику без «✓»', async () => {
@@ -140,13 +155,15 @@ test('ответ «Ответить» в ленте «Все» уходит со
   assert.ok(!tg.callsOf('sendText').some((call) => call.text.startsWith('✓')))
 })
 
-test('ответ вне темы при одном активном разговоре — ему, с «✓ <имя>»', async () => {
+test('спека: вне темы при одном активном разговоре — «Кому?» с ним, «Новому собеседнику» и «Отмена»', async () => {
   const { app, tg, connectOwner } = started()
   connectOwner()
   await app.handleUpdate(fixture('business-message-peer-text'))
   await app.handleUpdate(fixture('owner-message-outside'))
-  assert.equal(tg.sentAsOwner().length, 1)
-  assert.equal(tg.callsOf('sendText').at(-1)!.text, '✓ Alex Peer')
+  assert.equal(tg.sentAsOwner().length, 0)
+  const question = tg.callsOf('sendText').at(-1)!
+  assert.equal(question.text, 'Кому?')
+  assert.deepEqual(question.opts.keyboard!.map((row) => row[0]!.text), ['Alex Peer', 'Новому собеседнику', 'Отмена'])
 })
 
 test('несколько активных разговоров: «Кому?» → кнопка → отправка и «Отправлено <имя>»', async () => {
diff --git a/test/routing.test.ts b/test/routing.test.ts
index cf83418..8b12ab2 100644
--- a/test/routing.test.ts
+++ b/test/routing.test.ts
@@ -31,10 +31,11 @@ test('ответ кнопкой «Ответить» на перевод — с
   assert.equal(route.kind === 'conversation' && route.conversation.peerName, 'Anna')
 })
 
-test('вне тем при одном активном разговоре — ему', () => {
+test('спека: вне тем при одном активном разговоре — тоже «Кому?», бот адресата не угадывает', () => {
   const { store } = withConversations({ id: 1, name: 'Timon', lastPeerAt: T0 - DAY }, { id: 2, name: 'Old', lastPeerAt: T0 - DAY - 1 })
   const route = routeOwnerMessage({}, store, OWNER_ID, T0)
-  assert.equal(route.kind === 'conversation' && route.conversation.peerName, 'Timon')
+  assert.equal(route.kind, 'choose')
+  if (route.kind === 'choose') assert.deepEqual(route.options.map((c) => c.peerName), ['Timon'])
 })
 
 test('вне тем при нескольких активных — «Кому?»', () => {
@@ -44,9 +45,9 @@ test('вне тем при нескольких активных — «Кому?
   if (route.kind === 'choose') assert.deepEqual(route.options.map((c) => c.peerName), ['Timon', 'Anna'])
 })
 
-test('активных нет — некому', () => {
+test('спека: активных нет — перевод для нового собеседника', () => {
   const { store } = withConversations({ id: 1, name: 'Timon', lastPeerAt: T0 - DAY - 1 })
-  assert.deepEqual(routeOwnerMessage({}, store, OWNER_ID, T0), { kind: 'none' })
+  assert.deepEqual(routeOwnerMessage({}, store, OWNER_ID, T0), { kind: 'new' })
 })
 
 test('незнакомая тема — никому, даже при одном активном разговоре', () => {
@@ -63,7 +64,17 @@ test('кнопки «Кому?»: имена, «Отмена», данные в
   for (const row of keyboard) for (const button of row) assert.ok(Buffer.byteLength(button.data) <= 64)
 })
 
+test('кнопки «Кому?» для текста: имена, «Новому собеседнику», «Отмена»', () => {
+  const conversation = { id: 5, peerName: 'Timon' } as Conversation
+  assert.deepEqual(chooseKeyboard(9, [conversation], { newPeer: true }), [
+    [{ text: 'Timon', data: 'to:9:5' }],
+    [{ text: 'Новому собеседнику', data: 'new:9' }],
+    [{ text: 'Отмена', data: 'cancel:9' }],
+  ])
+})
+
 test('parseChoice', () => {
+  assert.deepEqual(parseChoice('new:7'), { kind: 'new', pendingId: 7 })
   assert.deepEqual(parseChoice('to:1:2'), { kind: 'to', pendingId: 1, conversationId: 2 })
   assert.deepEqual(parseChoice('cancel:3'), { kind: 'cancel', pendingId: 3 })
   assert.equal(parseChoice('to:x:1'), null)
@@ -88,7 +99,10 @@ test('«Кому?» — вопрос с кнопками в ответ на со
   const { question, sent, tg } = await asked()
   assert.equal(question.text, 'Кому?')
   assert.equal(question.opts.replyTo, 903)
-  assert.equal(question.opts.keyboard?.length, 3)
+  assert.deepEqual(
+    question.opts.keyboard!.map((row) => row[0]!.text),
+    ['Timon', 'Anna', 'Новому собеседнику', 'Отмена'],
+  )
   assert.equal(sent.length, 0)
   assert.equal(tg.sentAsOwner().length, 0)
 })
@@ -141,3 +155,31 @@ test('ответ на «Отправлено <имя>» (бывший «Кому
   assert.equal(route.kind, 'conversation')
   if (route.kind === 'conversation') assert.equal(route.conversation.peerName, 'Anna')
 })
+
+test('«Кому?» для вложения — без «Новому собеседнику»: первым бот отправляет только текст', async () => {
+  const ctx = withConversations({ id: 1, name: 'Timon', lastPeerAt: T0 })
+  await askWhom(ctx.deps, { text: 'Это тебе', media: { kind: 'photo', fileId: 'P' }, sourceMessageId: 904 }, ctx.conversations)
+  assert.deepEqual(ctx.tg.callsOf('sendText')[0]!.opts.keyboard!.map((row) => row[0]!.text), ['Timon', 'Отмена'])
+})
+
+test('спека: «Новому собеседнику» — вопрос меняется, перевод с кнопками, собеседникам ничего', async () => {
+  const { deps, question, sent, send, tg, translator } = await asked()
+  const fresh = question.opts.keyboard!.find((row) => row[0]!.text === 'Новому собеседнику')![0]!
+  await onChoice(deps, { id: 'CB1', data: fresh.data! }, send)
+  assert.equal(sent.length, 0)
+  assert.equal(tg.sentAsOwner().length, 0)
+  assert.deepEqual(tg.callsOf('editText')[0], { method: 'editText', chatId: OWNER_ID, messageId: question.id, text: 'Новому собеседнику' })
+  assert.deepEqual(translator.calls[0]!.history, [])
+  const draft = tg.callsOf('sendText').at(-1)!
+  assert.equal(draft.opts.replyTo, 903)
+  assert.equal(draft.text, '<i>Перевод для нового собеседника (английский):</i>\n[en] Привет!')
+  assert.equal(draft.opts.keyboard![0]![0]!.text, 'Отправить через бота')
+})
+
+test('спека: повторное нажатие «Новому собеседнику» — второго перевода нет', async () => {
+  const { deps, question, send, translator } = await asked()
+  const fresh = question.opts.keyboard!.find((row) => row[0]!.text === 'Новому собеседнику')![0]!
+  await onChoice(deps, { id: 'CB1', data: fresh.data! }, send)
+  await onChoice(deps, { id: 'CB2', data: fresh.data! }, send)
+  assert.equal(translator.calls.length, 1)
+})
```

</details>

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — маршрут при одном активном отдаёт разговор, без активных — `none`; нет кнопки «Новому собеседнику».

- [ ] **Step 3: Наложить код**

```bash
git apply .superpowers/sdd/write-first/task-8-src.patch
```

<details><summary>task-8-src.patch</summary>

```diff
diff --git a/src/app.ts b/src/app.ts
index 67e7e8f..e2a671e 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -4,7 +4,8 @@ import { onBusinessMessage } from './channels/private-chat/incoming.ts'
 import { sendOwnerReply } from './channels/private-chat/outgoing.ts'
 import type { Deps } from './deps.ts'
 import { extractMedia, unsupportedLabel } from './media.ts'
-import { NO_TARGET, STRAY_TOPIC, askWhom, onChoice, routeOwnerMessage } from './owner/routing.ts'
+import { newPeerDraft } from './owner/manual-send.ts'
+import { STRAY_TOPIC, askWhom, onChoice, routeOwnerMessage } from './owner/routing.ts'
 import { TelegramError, describeError, toConnectionInfo } from './telegram.ts'
 import type { Connection } from './types.ts'
 
@@ -70,7 +71,9 @@ async function onOwnerMessage(deps: Deps, message: Message): Promise<void> {
   } else if (route.kind === 'choose') {
     await askWhom(deps, payload, route.options)
   } else {
-    await deps.api.sendText(deps.ownerId, NO_TARGET, { replyTo: message.message_id })
+    // Активных разговоров нет: владелец пишет первым или тому, кто давно молчит, — от его
+    // имени бот туда всё равно не напишет (правило суток), поэтому сразу перевод с кнопками.
+    await newPeerDraft(deps, payload)
   }
 }
 
diff --git a/src/owner/routing.ts b/src/owner/routing.ts
index 8bf9500..00a2d5f 100644
--- a/src/owner/routing.ts
+++ b/src/owner/routing.ts
@@ -1,20 +1,24 @@
 import type { Deps } from '../deps.ts'
 import type { Store } from '../store.ts'
-import type { InlineButton } from '../telegram.ts'
 import type { Conversation, OwnerPayload } from '../types.ts'
+import { newPeerDraft } from './manual-send.ts'
 
 export type Route =
   /** viaTopic — сообщение написано в теме этого разговора */
   | { kind: 'conversation'; conversation: Conversation; viaTopic: boolean }
   | { kind: 'choose'; options: Conversation[] }
-  | { kind: 'none' }
+  /** Активных разговоров нет — перевод для нового собеседника с кнопками ручной отправки. */
+  | { kind: 'new' }
   /** Тема, которой нет в базе: осталась с прошлой установки. */
   | { kind: 'stray-topic' }
 
 /**
  * Кому адресовано сообщение владельца в чате с ботом. Цепочка до первого совпадения:
- * тема → ответ на сообщение бота → единственный активный разговор → «Кому?».
- * Нужна потому, что в ленте «Все» Telegram отправляет сообщение вне темы.
+ * тема → ответ на сообщение бота → «Кому?», если есть хоть один активный разговор →
+ * перевод для нового собеседника. Нужна потому, что в ленте «Все» Telegram отправляет
+ * сообщение вне темы. Без «Ответить» адресата не угадываем даже при одном активном
+ * разговоре: молчаливая отправка не тому дороже лишнего нажатия, а написать первым новому
+ * человеку иначе было бы нельзя (решение автора 2026-10-12).
  * Исключение: сообщение в теме, которой база не знает, дальше по цепочке не идёт —
  * иначе после удаления базы текст из старой темы ушёл бы не тому человеку.
  */
@@ -34,41 +38,53 @@ export function routeOwnerMessage(
     if (conversation) return { kind: 'conversation', conversation, viaTopic: false }
   }
   const active = store.activeConversations(ownerId, now)
-  if (active.length === 1) return { kind: 'conversation', conversation: active[0]!, viaTopic: false }
-  if (active.length > 1) return { kind: 'choose', options: active }
-  return { kind: 'none' }
+  if (active.length > 0) return { kind: 'choose', options: active }
+  return { kind: 'new' }
 }
 
-export const NO_TARGET = 'Не понял, кому отправить — ответьте в теме собеседника.'
+export const NEW_PEER = 'Новому собеседнику'
 export const STRAY_TOPIC =
   'Эту тему бот не узнаёт — похоже, она осталась с прошлой установки. Сообщение никуда не ушло. ' +
   'Напишите в теме собеседника; если её ещё нет, она появится, когда он напишет снова. Эту тему можно удалить.'
 export const ALREADY_HANDLED = 'Уже обработано'
 
-/** callback_data ограничена 64 байтами: «to:<pending>:<conv>» влезает с запасом. */
-export function chooseKeyboard(pendingId: number, options: readonly Conversation[]): InlineButton[][] {
+/**
+ * callback_data ограничена 64 байтами: «to:<pending>:<conv>» влезает с запасом.
+ * newPeer — показать «Новому собеседнику»: только для текста, первым вложение бот не отправит.
+ */
+export function chooseKeyboard(
+  pendingId: number,
+  options: readonly Conversation[],
+  opts: { newPeer: boolean } = { newPeer: false },
+): { text: string; data: string }[][] {
   return [
     ...options.map((conversation) => [{ text: conversation.peerName, data: `to:${pendingId}:${conversation.id}` }]),
+    ...(opts.newPeer ? [[{ text: NEW_PEER, data: `new:${pendingId}` }]] : []),
     [{ text: 'Отмена', data: `cancel:${pendingId}` }],
   ]
 }
 
-export type Choice = { kind: 'to'; pendingId: number; conversationId: number } | { kind: 'cancel'; pendingId: number }
+export type Choice =
+  | { kind: 'to'; pendingId: number; conversationId: number }
+  | { kind: 'new'; pendingId: number }
+  | { kind: 'cancel'; pendingId: number }
 
 export function parseChoice(data: string): Choice | null {
   const to = /^to:(\d+):(\d+)$/.exec(data)
   if (to) return { kind: 'to', pendingId: Number(to[1]), conversationId: Number(to[2]) }
+  const fresh = /^new:(\d+)$/.exec(data)
+  if (fresh) return { kind: 'new', pendingId: Number(fresh[1]) }
   const cancel = /^cancel:(\d+)$/.exec(data)
   if (cancel) return { kind: 'cancel', pendingId: Number(cancel[1]) }
   return null
 }
 
-/** Несколько активных разговоров: сообщение откладывается, бот спрашивает «Кому?». */
+/** Есть активные разговоры: сообщение откладывается, бот спрашивает «Кому?». */
 export async function askWhom(deps: Deps, payload: OwnerPayload, options: readonly Conversation[]): Promise<void> {
   const pendingId = deps.store.createPending(deps.ownerId, payload, deps.now())
   const questionId = await deps.api.sendText(deps.ownerId, 'Кому?', {
     replyTo: payload.sourceMessageId,
-    keyboard: chooseKeyboard(pendingId, options),
+    keyboard: chooseKeyboard(pendingId, options, { newPeer: payload.media === null && payload.text !== '' }),
   })
   deps.store.setPendingQuestion(pendingId, questionId)
 }
@@ -100,6 +116,13 @@ export async function onChoice(
     return
   }
 
+  if (choice.kind === 'new') {
+    await deps.api.answerCallback(callback.id)
+    if (taken.questionMessageId !== null) await deps.api.editText(deps.ownerId, taken.questionMessageId, NEW_PEER)
+    await newPeerDraft(deps, taken.payload)
+    return
+  }
+
   const conversation = deps.store.getConversation(choice.conversationId)
   await deps.api.answerCallback(callback.id)
   if (!conversation) return
```

</details>

- [ ] **Step 4: Тесты и типы**

Run: `npm test && npm run typecheck`
Expected: PASS, 296 тестов; проверка типов без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add -A src test scripts
git commit -m "Маршрут: «Кому?» и при одном активном, без активных — перевод для нового собеседника" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Inline-запрос в диспетчере

Закрывает: `tasks.md` 7.1.

**Files:**
- Modify: `src/app.ts` — `ALLOWED_UPDATES`, строка `inline-запрос` в реестре, фильтр постороннего по `inline_query.from`
- Modify: `src/main.ts` — `allowed_updates: [...ALLOWED_UPDATES]`
- Create: `test/fixtures/inline-query-owner.json` — по документации Bot API
- Modify: `test/app.test.ts`

**Interfaces:**
- Consumes: `answerInline(deps, query)` (Task 7).
- Produces: `ALLOWED_UPDATES` (в `app.ts`).

- [ ] **Step 1: Наложить тесты**

```bash
git apply .superpowers/sdd/write-first/task-9-test.patch
```

<details><summary>task-9-test.patch</summary>

```diff
diff --git a/test/app.test.ts b/test/app.test.ts
index 329d77f..0eddd9f 100644
--- a/test/app.test.ts
+++ b/test/app.test.ts
@@ -1,7 +1,7 @@
 import { test } from 'node:test'
 import assert from 'node:assert/strict'
 import type { Update } from 'grammy/types'
-import { CANT_FORWARD, createApp, statusText } from '../src/app.ts'
+import { ALLOWED_UPDATES, CANT_FORWARD, createApp, statusText } from '../src/app.ts'
 import { CONNECTED } from '../src/channels/private-chat/connection.ts'
 import { FIRST_TEXT_ONLY } from '../src/owner/manual-send.ts'
 import { STRAY_TOPIC } from '../src/owner/routing.ts'
@@ -275,3 +275,40 @@ test('поломка при подключении — сказано отпра
   await app.handleUpdate(fixture('business-connection-owner'))
   assert.ok(tg.callsOf('sendText').some((call) => call.text.includes('/start')))
 })
+
+test('спека: посторонний набирает «@бот 12» — ни ответа, ни записей, ни модели', async () => {
+  const { app, tg, store, translator, deps } = started()
+  store.createDraft({ ownerId: OWNER_ID, conversationId: null, original: 'Привет', translation: 'Hi', now: deps.now() })
+  const update = fixture('inline-query-owner')
+  update.inline_query!.from = { ...update.inline_query!.from, id: 400004 }
+  await app.handleUpdate(update)
+  assert.equal(tg.calls.length, 0)
+  assert.equal(translator.calls.length, 0)
+  assert.equal(store.isProcessed(1401), false)
+})
+
+test('inline-запрос владельца — ответ с его переводом', async () => {
+  const { app, tg, store, deps } = started()
+  const draft = store.createDraft({ ownerId: OWNER_ID, conversationId: null, original: 'Привет', translation: 'Hi', now: deps.now() })
+  const update = fixture('inline-query-owner')
+  update.inline_query!.query = String(draft.id)
+  await app.handleUpdate(update)
+  const [answer] = tg.callsOf('answerInline')
+  assert.equal(answer!.queryId, 'IQ1')
+  assert.deepEqual(answer!.articles.map((article) => article.text), ['Hi'])
+})
+
+test('inline-ответ не ушёл — владелец знает, что нажать', async () => {
+  const { app, tg } = started()
+  tg.failNext('answerInline', new TelegramError(400, 'Bad Request: query is too old'))
+  await app.handleUpdate(fixture('inline-query-owner'))
+  assert.ok(
+    tg.callsOf('sendText').some((call) =>
+      call.text.startsWith('Не удалось ответить на кнопку «Отправить через бота»: Bad Request: query is too old. Попробуйте ещё раз или нажмите «Скопировать».'),
+    ),
+  )
+})
+
+test('бот просит у Telegram inline-запросы — иначе «Отправить через бота» молча не работает', () => {
+  assert.ok(ALLOWED_UPDATES.includes('inline_query'))
+})
diff --git a/test/fixtures/inline-query-owner.json b/test/fixtures/inline-query-owner.json
new file mode 100644
index 0000000..f90bf7b
--- /dev/null
+++ b/test/fixtures/inline-query-owner.json
@@ -0,0 +1,18 @@
+{
+  "update_id": 1401,
+  "inline_query": {
+    "id": "IQ1",
+    "from": {
+      "id": 100001,
+      "is_bot": false,
+      "first_name": "Owner",
+      "last_name": "Test",
+      "username": "owner_test",
+      "language_code": "ru",
+      "is_premium": true
+    },
+    "query": "1",
+    "offset": "",
+    "chat_type": "private"
+  }
+}
```

</details>

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — нет `ALLOWED_UPDATES`; inline-запрос постороннего проходит фильтр, владельца — не обрабатывается.

- [ ] **Step 3: Наложить код**

```bash
git apply .superpowers/sdd/write-first/task-9-src.patch
```

<details><summary>task-9-src.patch</summary>

```diff
diff --git a/src/app.ts b/src/app.ts
index e2a671e..f518220 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -4,11 +4,17 @@ import { onBusinessMessage } from './channels/private-chat/incoming.ts'
 import { sendOwnerReply } from './channels/private-chat/outgoing.ts'
 import type { Deps } from './deps.ts'
 import { extractMedia, unsupportedLabel } from './media.ts'
-import { newPeerDraft } from './owner/manual-send.ts'
+import { answerInline, newPeerDraft } from './owner/manual-send.ts'
 import { STRAY_TOPIC, askWhom, onChoice, routeOwnerMessage } from './owner/routing.ts'
 import { TelegramError, describeError, toConnectionInfo } from './telegram.ts'
 import type { Connection } from './types.ts'
 
+/**
+ * Какие апдейты просить у Telegram. Без inline_query кнопка «Отправить через бота» молча не
+ * сработала бы: Telegram не прислал бы боту запрос, и выбор чата закончился бы пустотой.
+ */
+export const ALLOWED_UPDATES = ['business_connection', 'business_message', 'message', 'callback_query', 'inline_query'] as const
+
 export const CANT_FORWARD = 'Такое бот переслать не умеет — отправьте это собеседнику в личке сами.'
 
 /** Нет записи — бот ещё не видел подключения; запись выключена — владелец отключил бота. */
@@ -124,12 +130,21 @@ export function createApp(deps: Deps): { handleUpdate(update: Update): Promise<v
       run: (u) => onCallback(deps, u.callback_query!),
       failure: OWN_MESSAGE_FAILURE,
     },
+    {
+      // Кнопка «Отправить через бота» подставляет в выбранный чат «@бот <номер перевода>».
+      name: 'inline-запрос',
+      match: (u) => u.inline_query !== undefined,
+      run: (u) => answerInline(deps, { id: u.inline_query!.id, query: u.inline_query!.query }),
+      failure: (reason) =>
+        `Не удалось ответить на кнопку «Отправить через бота»: ${reason}. Попробуйте ещё раз или нажмите «Скопировать».`,
+    },
   ]
 
   return {
     async handleUpdate(update) {
       // Посторонний не оставляет в базе ничего — даже номера апдейта: спека «ничего не сохраняет».
-      const from = update.message?.from ?? update.callback_query?.from
+      // Inline-запрос постороннего («@бот 12» в любом чате) остаётся без ответа: переводы — только владельцу.
+      const from = update.message?.from ?? update.callback_query?.from ?? update.inline_query?.from
       if (from && !isAllowedOwner(from.id, deps.ownerId)) return
       // После перезапуска Telegram может прислать уже обработанный апдейт — второй раз не отправляем.
       if (deps.store.isProcessed(update.update_id)) return
diff --git a/src/main.ts b/src/main.ts
index 257a87d..c8b3b7d 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,6 +1,6 @@
 import { Bot } from 'grammy'
 import { createAlerts, createScrubber } from './alerts.ts'
-import { createApp } from './app.ts'
+import { ALLOWED_UPDATES, createApp } from './app.ts'
 import { loadEnv } from './env.ts'
 import { createTopics } from './owner/topics.ts'
 import { createInlineCheck, loadSettings, startupChecks } from './startup.ts'
@@ -87,5 +87,5 @@ for (const signal of ['SIGINT', 'SIGTERM'] as const) {
 }
 
 alerts.log(dry ? `@${me.username}: холостой прогон — собеседникам ничего не уходит` : `@${me.username} запущен`)
-await bot.start({ allowed_updates: ['business_connection', 'business_message', 'message', 'callback_query'] })
+await bot.start({ allowed_updates: [...ALLOWED_UPDATES] })
 store.close()
```

</details>

- [ ] **Step 4: Тесты и типы**

Run: `npm test && npm run typecheck`
Expected: PASS, 300 тестов; проверка типов без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add -A src test scripts
git commit -m "Inline-запрос в диспетчере: ответ только владельцу" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: «Не отправлено» — причины и кнопки

Закрывает: `tasks.md` 8.1, 8.2, 8.3, 8.4.

**Files:**
- Create: `src/channels/private-chat/refusals.ts`
- Modify: `src/channels/private-chat/outgoing.ts` — `notSent`, порядок проверок, `rethrow: isFinalRefusal`
- Modify: `src/owner/topics.ts` — `postText` с клавиатурой, `renderNotSent` удалён
- Create: `test/refusals.test.ts`
- Modify: `test/outgoing.test.ts`, `test/topics.test.ts`

**Interfaces:**
- Consumes: `BOT_SETTINGS_PATH`, `SETTINGS_PATH` (Task 5), `manualKeyboard`, `renderDraft` (Task 6), `store.createDraft` (Task 3), `Deps.inlineEnabled` (Task 2).
- Produces: `SEND_REFUSALS`, `NO_REPLY_RIGHT`, `BOT_DISCONNECTED`, `isFinalRefusal(error: unknown): boolean`, `refusalText(error: unknown, peerName: string): string`; `Topics.postText(conversation, html, opts?: { keyboard?: InlineButton[][] })`.

- [ ] **Step 1: Наложить тесты**

```bash
git apply .superpowers/sdd/write-first/task-10-test.patch
```

<details><summary>task-10-test.patch</summary>

```diff
diff --git a/test/outgoing.test.ts b/test/outgoing.test.ts
index 19dedf5..05ce275 100644
--- a/test/outgoing.test.ts
+++ b/test/outgoing.test.ts
@@ -76,25 +76,128 @@ test('перевод не удался — собеседнику ничего,
   assert.equal(tg.callsOf('sendText').at(-1)!.text, '<b>Не отправлено:</b> перевод не удался — модель не ответила за 30 с')
 })
 
-test('Telegram отказал — «Не отправлено», причина и перевод, повтора нет', async () => {
+const SETTINGS = 'Настройки → Аккаунт → Автоматизация чатов → этот бот (на Mac — Настройки → Изменить профиль → Автоматизация чатов)'
+
+test('спека: собеседник давно не писал — понятная причина, перевод и кнопки, повтора нет', async () => {
   const { deps, tg, store, conversation } = prepared()
   tg.failNext('sendText', new TelegramError(400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING'))
   const ok = await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
   assert.equal(ok, false)
   assert.equal(tg.sentAsOwner().length, 1)
+  const notice = tg.callsOf('sendText').at(-1)!
   assert.equal(
-    tg.callsOf('sendText').at(-1)!.text,
-    '<b>Не отправлено.</b> Bad Request: BUSINESS_PEER_USAGE_MISSING\nПеревод:\n[en] Отлично, а ты?',
+    notice.text,
+    '<b>Не отправлено:</b> от Alex Peer давно не было сообщений, а от вашего имени бот может писать только тем, ' +
+      'кто писал вам недавно. Отправьте перевод сами — кнопками ниже. Когда Alex Peer ответит, бот снова будет отправлять сам.\n' +
+      'Перевод:\n[en] Отлично, а ты?',
   )
+  const draftId = Number(notice.opts.keyboard![0]![0]!.chooseChat)
+  assert.deepEqual(notice.opts.keyboard, [
+    [{ text: 'Отправить через бота', chooseChat: String(draftId), style: 'success' }],
+    [{ text: 'Скопировать', copy: '[en] Отлично, а ты?' }],
+  ])
+  const draft = store.getDraft(OWNER_ID, draftId, deps.now())!
+  assert.equal(draft.conversationId, conversation.id)
+  assert.equal(draft.original, 'Отлично, а ты?')
   assert.equal(store.recentReplicas(conversation.id).length, 1)
 })
 
-test('бот отключён от аккаунта — не отправляем, говорим почему', async () => {
+test('спека: бот не видит чат — путь к настройке и кнопки', async () => {
+  const { deps, tg, conversation } = prepared()
+  tg.failNext('sendText', new TelegramError(400, 'Bad Request: BUSINESS_PEER_INVALID'))
+  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
+  const notice = tg.callsOf('sendText').at(-1)!
+  assert.equal(
+    notice.text,
+    `<b>Не отправлено:</b> бот не видит чат с Alex Peer — его нет среди чатов, доступных боту. Добавьте его: ${SETTINGS}. ` +
+      'Пока отправьте перевод сами — кнопками ниже.\nПеревод:\n[en] Отлично, а ты?',
+  )
+  assert.equal(notice.opts.keyboard!.length, 2)
+})
+
+test('спека: незнакомый отказ — словами Telegram, перевод и кнопки', async () => {
+  const { deps, tg, conversation } = prepared()
+  tg.failNext('sendText', new TelegramError(403, 'Forbidden: bot was blocked by the user'))
+  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
+  const notice = tg.callsOf('sendText').at(-1)!
+  assert.equal(
+    notice.text,
+    '<b>Не отправлено:</b> Telegram не принял сообщение — Forbidden: bot was blocked by the user\nПеревод:\n[en] Отлично, а ты?',
+  )
+  assert.equal(notice.opts.keyboard!.length, 2)
+})
+
+test('спека: нет права отвечать — бот не пробует отправить, в холостом прогоне нет «ушло бы»', async () => {
+  for (const dry of [false, true]) {
+    const { deps, tg, connectOwner, conversation } = prepared({ overrides: { dry } })
+    connectOwner({ canReply: false })
+    await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
+    assert.equal(tg.sentAsOwner().length, 0)
+    const notice = tg.callsOf('sendText').at(-1)!
+    assert.equal(
+      notice.text,
+      `<b>Не отправлено:</b> боту не разрешено отвечать от вашего имени. Включите «Ответы на сообщения»: ${SETTINGS}.\n` +
+        'Перевод:\n[en] Отлично, а ты?',
+    )
+    assert.equal(notice.opts.keyboard!.length, 2)
+    assert.ok(!tg.callsOf('sendText').some((call) => call.text.includes('Холостой прогон')))
+  }
+})
+
+test('бот отключён от аккаунта — не отправляем, говорим почему и как подключить', async () => {
   const { deps, tg, connectOwner, conversation } = prepared()
   connectOwner({ isEnabled: false })
   await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
   assert.equal(tg.sentAsOwner().length, 0)
-  assert.match(tg.callsOf('sendText').at(-1)!.text, /Не отправлено\.<\/b> бот отключён/)
+  const notice = tg.callsOf('sendText').at(-1)!
+  assert.match(notice.text, /^<b>Не отправлено:<\/b> бот отключён от вашего аккаунта\. Подключите его снова: Настройки → Аккаунт/)
+  assert.equal(notice.opts.keyboard!.length, 2)
+})
+
+test('Inline Mode выключен — под «Не отправлено» одна «Скопировать»', async () => {
+  const { deps, tg, conversation } = prepared({ overrides: { inlineEnabled: async () => false } })
+  tg.failNext('sendText', new TelegramError(400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING'))
+  await sendOwnerReply(deps, conversation, reply, { outsideTopic: false })
+  assert.deepEqual(tg.callsOf('sendText').at(-1)!.opts.keyboard, [[{ text: 'Скопировать', copy: '[en] Отлично, а ты?' }]])
+})
+
+test('спека: вложение на отказе — не загружается заново, перевод подписи, одна «Скопировать» и подсказка', async () => {
+  const { deps, tg, conversation } = prepared()
+  tg.failNext('sendMedia', new TelegramError(400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING'))
+  await sendOwnerReply(
+    deps,
+    conversation,
+    { text: 'Это тебе', media: { kind: 'photo', fileId: 'OWNER_PHOTO_1' }, sourceMessageId: 904 },
+    { outsideTopic: false },
+  )
+  assert.equal(tg.callsOf('downloadFile').length, 0)
+  assert.equal(tg.callsOf('sendMedia').length, 1)
+  const notice = tg.callsOf('sendText').at(-1)!
+  assert.match(notice.text, /^<b>Не отправлено:<\/b> от Alex Peer давно не было сообщений/)
+  assert.match(notice.text, /\n<i>Фото отправьте Alex Peer сами — через кнопку бот отправляет только текст\.<\/i>\nПеревод подписи:\n\[en\] Это тебе$/)
+  assert.deepEqual(notice.opts.keyboard, [[{ text: 'Скопировать', copy: '[en] Это тебе' }]])
+})
+
+test('стикер на отказе — подсказка отправить самому, без кнопок: переводить нечего', async () => {
+  const { deps, tg, conversation } = prepared()
+  tg.failNext('sendMedia', new TelegramError(400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING'))
+  await sendOwnerReply(deps, conversation, { text: '', media: { kind: 'sticker', fileId: 'S' }, sourceMessageId: 905 }, { outsideTopic: false })
+  const notice = tg.callsOf('sendText').at(-1)!
+  assert.match(notice.text, /\n<i>Стикер отправьте Alex Peer сами — через кнопку бот отправляет только текст\.<\/i>$/)
+  assert.equal(notice.opts.keyboard, undefined)
+})
+
+test('прочая ошибка первой ступени — вложение, как и раньше, загружается заново', async () => {
+  const { deps, tg, conversation } = prepared()
+  tg.failNext('sendMedia', new TelegramError(400, 'Bad Request: wrong file identifier'))
+  const ok = await sendOwnerReply(
+    deps,
+    conversation,
+    { text: 'Это тебе', media: { kind: 'photo', fileId: 'OWNER_PHOTO_1' }, sourceMessageId: 904 },
+    { outsideTopic: false },
+  )
+  assert.equal(ok, true)
+  assert.equal(tg.callsOf('downloadFile').length, 1)
 })
 
 test('холостой прогон: от имени владельца ничего не уходит, в теме — «ушло бы»', async () => {
@@ -257,3 +360,12 @@ test('проверка ответа получает направление outg
   assert.equal(seen[0]!.owner.code, 'ru')
   assert.equal(seen[0]!.target.code, 'en')
 })
+
+test('имя собеседника с «<» и «&» в причине «Не отправлено» экранировано', async () => {
+  const { deps, tg, store } = prepared()
+  const odd = store.createConversation({ ownerId: OWNER_ID, connectionId: CONNECTION_ID, peerChatId: 200007, peerName: 'Tom & <b>Jerry</b>', lastPeerAt: deps.now() })
+  tg.failNext('sendText', new TelegramError(400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING'))
+  await sendOwnerReply(deps, odd, reply, { outsideTopic: false })
+  const notice = tg.callsOf('sendText').at(-1)!
+  assert.match(notice.text, /^<b>Не отправлено:<\/b> от Tom &amp; &lt;b&gt;Jerry&lt;\/b&gt; давно не было сообщений/)
+})
diff --git a/test/refusals.test.ts b/test/refusals.test.ts
new file mode 100644
index 0000000..906c4f3
--- /dev/null
+++ b/test/refusals.test.ts
@@ -0,0 +1,24 @@
+import { test } from 'node:test'
+import assert from 'node:assert/strict'
+import { SEND_REFUSALS, isFinalRefusal, refusalText } from '../src/channels/private-chat/refusals.ts'
+import { TelegramError } from '../src/telegram.ts'
+
+test('отказы подключения узнаются по коду и называют собеседника', () => {
+  const usage = refusalText(new TelegramError(400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING'), 'Maria')
+  assert.match(usage, /^от Maria давно не было сообщений/)
+  assert.match(usage, /Когда Maria ответит, бот снова будет отправлять сам\.$/)
+  assert.match(refusalText(new TelegramError(400, 'Bad Request: BUSINESS_PEER_INVALID'), 'Maria'), /^бот не видит чат с Maria/)
+})
+
+test('незнакомый отказ — словами Telegram', () => {
+  assert.equal(refusalText(new TelegramError(429, 'Too Many Requests: retry after 5'), 'Maria'), 'Telegram не принял сообщение — Too Many Requests: retry after 5')
+  assert.equal(refusalText('файл больше 20 МБ', 'Maria'), 'Telegram не принял сообщение — файл больше 20 МБ')
+})
+
+test('окончательный отказ — только отказ подключения от Telegram', () => {
+  assert.equal(isFinalRefusal(new TelegramError(400, 'Bad Request: BUSINESS_PEER_USAGE_MISSING')), true)
+  assert.equal(isFinalRefusal(new TelegramError(400, 'Bad Request: BUSINESS_PEER_INVALID')), true)
+  assert.equal(isFinalRefusal(new TelegramError(400, 'Bad Request: wrong file identifier')), false)
+  assert.equal(isFinalRefusal(new Error('BUSINESS_PEER_INVALID')), false)
+  assert.equal(SEND_REFUSALS.length, 2)
+})
diff --git a/test/topics.test.ts b/test/topics.test.ts
index 6835a2c..67c6b38 100644
--- a/test/topics.test.ts
+++ b/test/topics.test.ts
@@ -7,7 +7,6 @@ import {
   renderAsIs,
   renderDryRun,
   renderIncoming,
-  renderNotSent,
   renderNotTranslated,
   renderOwnerDirect,
   renderSent,
@@ -135,9 +134,6 @@ test('остальные пометки', () => {
   assert.deepEqual(renderOwnerDirect('ok, see you'), ['<i>Вы в личке:</i> ok, see you'])
   assert.deepEqual(renderSent('Отлично, а ты?', 'Great, and you?'), ['<i>Вы:</i> Отлично, а ты?\n→ Great, and you?'])
   assert.deepEqual(renderSent('[фото]', ''), ['<i>Вы:</i> [фото]'])
-  assert.deepEqual(renderNotSent('Forbidden: bot was blocked', 'Great'), [
-    '<b>Не отправлено.</b> Forbidden: bot was blocked\nПеревод:\nGreat',
-  ])
   assert.deepEqual(renderNotTranslated('нет ключа'), ['<b>Не отправлено:</b> перевод не удался — нет ключа'])
   assert.deepEqual(renderUnsupported('Timon', 'геопозицию'), ['Timon прислал геопозицию — посмотрите в личке'])
   assert.deepEqual(renderDryRun('Great'), ['<i>Холостой прогон: ушло бы —</i> Great'])
@@ -151,3 +147,20 @@ test('длинная причина обрезается', () => {
 test('имя собеседника с разметкой не ломает пометку', () => {
   assert.deepEqual(renderUnsupported('<b>Boss</b> & Co', 'контакт'), ['&lt;b&gt;Boss&lt;/b&gt; &amp; Co прислал контакт — посмотрите в личке'])
 })
+
+test('кнопки — под последней частью сообщения в теме', async () => {
+  const { tg, topics, conversation } = setup()
+  const keyboard = [[{ text: 'Скопировать', copy: 'Hi' }]]
+  await topics.postText(conversation, ['часть 1', 'часть 2'], { keyboard })
+  const sent = tg.callsOf('sendText')
+  assert.equal(sent[0]!.opts.keyboard, undefined)
+  assert.deepEqual(sent[1]!.opts.keyboard, keyboard)
+})
+
+test('тему удалили — кнопки всё равно под последней частью в новой теме', async () => {
+  const { tg, topics, conversation } = setup()
+  await topics.ensure(conversation)
+  tg.failNext('sendText', new TelegramError(400, 'Bad Request: message thread not found'))
+  await topics.postText(conversation, ['перевод'], { keyboard: [[{ text: 'Скопировать', copy: 'Hi' }]] })
+  assert.deepEqual(tg.callsOf('sendText').at(-1)!.opts.keyboard, [[{ text: 'Скопировать', copy: 'Hi' }]])
+})
```

</details>

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — нет `refusals.ts`; «Не отправлено» в старом виде и без кнопок; на отказе фото скачивается заново.

- [ ] **Step 3: Наложить код**

```bash
git apply .superpowers/sdd/write-first/task-10-src.patch
```

<details><summary>task-10-src.patch</summary>

```diff
diff --git a/src/channels/private-chat/outgoing.ts b/src/channels/private-chat/outgoing.ts
index 9137aa9..2d6d6ea 100644
--- a/src/channels/private-chat/outgoing.ts
+++ b/src/channels/private-chat/outgoing.ts
@@ -1,10 +1,12 @@
 import { alertModelFailure } from '../../alerts.ts'
 import type { Deps } from '../../deps.ts'
-import { splitText } from '../../html.ts'
+import { escapeHtml, splitText } from '../../html.ts'
 import { mediaSpec, sendMediaLadder } from '../../media.ts'
-import { renderDryRun, renderNotSent, renderNotTranslated, renderSent, renderSuspiciousReply } from '../../owner/topics.ts'
+import { manualKeyboard, renderDraft } from '../../owner/manual-send.ts'
+import { renderDryRun, renderNotTranslated, renderSent, renderSuspiciousReply } from '../../owner/topics.ts'
 import { describeError } from '../../telegram.ts'
 import type { Conversation, OwnerPayload } from '../../types.ts'
+import { BOT_DISCONNECTED, NO_REPLY_RIGHT, isFinalRefusal, refusalText } from './refusals.ts'
 
 /** Как ответ владельца выглядит в истории и в теме: текст или «[фото]». */
 function originalOf(payload: OwnerPayload): string {
@@ -12,6 +14,43 @@ function originalOf(payload: OwnerPayload): string {
   return payload.media ? `[${mediaSpec(payload.media.kind).label}]` : ''
 }
 
+/**
+ * Не ушло: «Не отправлено», причина, готовый перевод и кнопки ручной отправки — владелец
+ * отправит сам в два нажатия. Перевод сохраняется: по номеру его найдёт «Отправить через
+ * бота», а по тексту бот узнает его, когда владелец отправит его в личке. Вложение через бота
+ * не уйдёт, поэтому для него — только «Скопировать» подписи и подсказка отправить самому.
+ */
+async function notSent(
+  deps: Deps,
+  conversation: Conversation,
+  payload: OwnerPayload,
+  why: string,
+  translation: string,
+): Promise<false> {
+  const label = payload.media ? mediaSpec(payload.media.kind).label : null
+  const lines = [`<b>Не отправлено:</b> ${escapeHtml(why)}`]
+  if (label) {
+    const what = label[0]!.toUpperCase() + label.slice(1)
+    lines.push(`<i>${what} отправьте ${escapeHtml(conversation.peerName)} сами — через кнопку бот отправляет только текст.</i>`)
+  }
+  if (!translation) {
+    await deps.topics.postText(conversation, [lines.join('\n')])
+    return false
+  }
+  lines.push(label ? 'Перевод подписи:' : 'Перевод:')
+  const draft = deps.store.createDraft({
+    ownerId: conversation.ownerId,
+    conversationId: conversation.id,
+    original: payload.text,
+    translation,
+    now: deps.now(),
+  })
+  await deps.topics.postText(conversation, renderDraft(lines.join('\n'), draft.translation), {
+    keyboard: manualKeyboard(draft, { inline: await deps.inlineEnabled(), media: label !== null }),
+  })
+  return false
+}
+
 /**
  * Ответ владельца → перевод на язык собеседника → отправка от имени владельца.
  * Оригинал собеседнику не уходит никогда: не перевелось — не отправляем.
@@ -64,10 +103,10 @@ export async function sendOwnerReply(
   // Текущее подключение владельца, а не то, что было при начале разговора: владелец мог
   // отключить и снова подключить бота, и старое подключение больше не работает.
   const connection = deps.store.ownerConnection(conversation.ownerId)
-  if (!connection?.isEnabled) {
-    await deps.topics.postText(conversation, renderNotSent('бот отключён от вашего аккаунта', translation))
-    return false
-  }
+  if (!connection?.isEnabled) return notSent(deps, conversation, payload, BOT_DISCONNECTED, translation)
+  // Без права отвечать Telegram всё равно откажет — не пробуем. До холостого прогона: иначе
+  // «ушло бы» обещало бы то, что не уйдёт.
+  if (!connection.canReply) return notSent(deps, conversation, payload, NO_REPLY_RIGHT, translation)
 
   if (deps.dry) {
     // Владелец проверяет, что уйдёт собеседнику, — оригинала подписи там быть не должно,
@@ -83,14 +122,14 @@ export async function sendOwnerReply(
   try {
     if (payload.media) {
       // Собеседнику — обычный текст без разметки: так сообщение выглядит как написанное владельцем.
+      // Отказ подключения (правило суток, чат не виден боту) выходит из лестницы сразу: скачать
+      // и загрузить вложение заново — лишняя работа, Telegram откажет так же.
       const result = await sendMediaLadder(deps.api, conversation.peerChatId, payload.media, {
         businessConnectionId: connection.id,
         ...(translation && { caption: translation }),
+        rethrow: isFinalRefusal,
       })
-      if (!result.ok) {
-        await deps.topics.postText(conversation, renderNotSent(result.reason, translation))
-        return false
-      }
+      if (!result.ok) return notSent(deps, conversation, payload, refusalText(result.reason, conversation.peerName), translation)
       sent.push(...result.messageIds)
     } else {
       for (const part of splitText(translation)) {
@@ -100,8 +139,7 @@ export async function sendOwnerReply(
       }
     }
   } catch (error) {
-    await deps.topics.postText(conversation, renderNotSent(describeError(error), translation))
-    return false
+    return notSent(deps, conversation, payload, refusalText(error, conversation.peerName), translation)
   }
 
   const now = deps.now()
diff --git a/src/channels/private-chat/refusals.ts b/src/channels/private-chat/refusals.ts
new file mode 100644
index 0000000..b6104e0
--- /dev/null
+++ b/src/channels/private-chat/refusals.ts
@@ -0,0 +1,47 @@
+import { TelegramError, describeError } from '../../telegram.ts'
+import { BOT_SETTINGS_PATH, SETTINGS_PATH } from './connection.ts'
+
+/**
+ * Отказ Telegram в отправке от имени владельца, который мы узнаём по коду в описании ошибки.
+ * Коды сняты живьём 2026-10-11. Таблица, а не switch: новый код — новая строка.
+ */
+export type SendRefusal = {
+  match: RegExp
+  /** Понятная причина: что случилось и что сделать */
+  text: (peerName: string) => string
+}
+
+export const SEND_REFUSALS: readonly SendRefusal[] = [
+  {
+    // Правило суток: от имени владельца — только тем, кто сам писал недавно.
+    match: /BUSINESS_PEER_USAGE_MISSING/,
+    text: (name) =>
+      `от ${name} давно не было сообщений, а от вашего имени бот может писать только тем, кто писал вам недавно. ` +
+      `Отправьте перевод сами — кнопками ниже. Когда ${name} ответит, бот снова будет отправлять сам.`,
+  },
+  {
+    // Чата нет среди чатов бота: «Только выбранные чаты» без этого человека.
+    match: /BUSINESS_PEER_INVALID/,
+    text: (name) =>
+      `бот не видит чат с ${name} — его нет среди чатов, доступных боту. Добавьте его: ${BOT_SETTINGS_PATH}. ` +
+      'Пока отправьте перевод сами — кнопками ниже.',
+  },
+]
+
+/** Права «Ответы на сообщения» нет — бот и не пробует отправлять. */
+export const NO_REPLY_RIGHT = `боту не разрешено отвечать от вашего имени. Включите «Ответы на сообщения»: ${BOT_SETTINGS_PATH}.`
+
+/** Владелец отключил бота от аккаунта — отправлять не через что. */
+export const BOT_DISCONNECTED = `бот отключён от вашего аккаунта. Подключите его снова: ${SETTINGS_PATH}.`
+
+/** Отказ подключения: повтор с загрузкой вложения заново ничего не даст. */
+export function isFinalRefusal(error: unknown): boolean {
+  return error instanceof TelegramError && SEND_REFUSALS.some((refusal) => refusal.match.test(error.description))
+}
+
+/** Причина «Не отправлено»: знакомый отказ — по таблице, незнакомый — словами Telegram. */
+export function refusalText(error: unknown, peerName: string): string {
+  const description = describeError(error)
+  const known = SEND_REFUSALS.find((refusal) => refusal.match.test(description))
+  return known ? known.text(peerName) : `Telegram не принял сообщение — ${description}`
+}
diff --git a/src/owner/topics.ts b/src/owner/topics.ts
index 85c7128..5842981 100644
--- a/src/owner/topics.ts
+++ b/src/owner/topics.ts
@@ -1,6 +1,6 @@
 import { MESSAGE_LIMIT, escapeHtml, splitText } from '../html.ts'
 import { sendMediaLadder, type LadderResult } from '../media.ts'
-import { TelegramError, type TelegramApi } from '../telegram.ts'
+import { TelegramError, type InlineButton, type TelegramApi } from '../telegram.ts'
 import type { Store } from '../store.ts'
 import type { Conversation, MediaRef, Review } from '../types.ts'
 
@@ -109,11 +109,6 @@ function withTranslation(head: string, translation: string): string[] {
   return [`${head}\nПеревод — ниже.`, ...parts]
 }
 
-/** Telegram не принял отправку: причина и готовый перевод, чтобы ничего не пропало. */
-export function renderNotSent(why: string, translation: string): string[] {
-  return withTranslation(`<b>Не отправлено.</b> ${reason(why)}`, translation)
-}
-
 /** Перевод ответа владельца не прошёл проверку — собеседнику ничего не ушло. */
 export function renderSuspiciousReply(translation: string): string[] {
   return withTranslation('<b>Не отправлено:</b> перевод выглядит подозрительно', translation)
@@ -146,8 +141,8 @@ export function renderCaption(text: string): string {
 export type Topics = {
   /** Тема разговора; если её ещё нет — создаётся с именем собеседника. */
   ensure(conversation: Conversation): Promise<number>
-  /** Сообщения в тему разговора (уже готовый HTML). Возвращает id сообщений. */
-  postText(conversation: Conversation, html: readonly string[]): Promise<number[]>
+  /** Сообщения в тему разговора (уже готовый HTML); кнопки — под последним. Возвращает id сообщений. */
+  postText(conversation: Conversation, html: readonly string[], opts?: { keyboard?: InlineButton[][] }): Promise<number[]>
   /** Вложение в тему разговора по лестнице пересылки. */
   postMedia(conversation: Conversation, media: MediaRef, captionHtml?: string): Promise<LadderResult>
 }
@@ -197,12 +192,16 @@ export function createTopics(deps: {
   return {
     ensure,
 
-    async postText(conversation, html) {
+    async postText(conversation, html, opts = {}) {
+      const keyboard = opts.keyboard && opts.keyboard.length > 0 ? opts.keyboard : undefined
       // Каждая попытка шлёт все части заново: при пересоздании темы старые части остались в удалённой.
       const ids = await inTopic(conversation, async (threadId) => {
         const sent: number[] = []
-        for (const part of html) {
-          sent.push(await deps.api.sendText(deps.ownerChatId, deps.scrub(part), { threadId, html: true }))
+        for (const [index, part] of html.entries()) {
+          const last = index === html.length - 1
+          sent.push(
+            await deps.api.sendText(deps.ownerChatId, deps.scrub(part), { threadId, html: true, ...(last && keyboard && { keyboard }) }),
+          )
         }
         return sent
       })
```

</details>

- [ ] **Step 4: Тесты и типы**

Run: `npm test && npm run typecheck`
Expected: PASS, 313 тестов; проверка типов без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add -A src test scripts
git commit -m "«Не отправлено»: понятная причина, перевод и кнопки ручной отправки" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Отправка через бота заводит разговор

Закрывает: `tasks.md` 9.1, 9.2, 9.3, 9.4.

**Files:**
- Modify: `src/types.ts` — `Replica.viaBot`, `Replica.draft`
- Modify: `src/channels/private-chat/incoming.ts` — `viaBot` в разборе, шаг `черновик`, разговор от владельца, «Вы: оригинал → перевод»
- Create: `test/fixtures/business-message-via-bot.json` — по документации Bot API, сверяется с живым в Task 12
- Modify: `test/incoming.test.ts`, `test/app.test.ts`

**Interfaces:**
- Consumes: `store.findDraftByTranslation`, `createConversation({ lastPeerAt })` (Task 3), `renderSent` (`topics.ts`), весь путь Tasks 7–9 в сквозном тесте.
- Produces: `Replica.viaBot?: boolean`, `Replica.draft?: Draft`; шаг конвейера `черновик` между `язык` и `разговор`.

- [ ] **Step 1: Наложить тесты**

```bash
git apply .superpowers/sdd/write-first/task-11-test.patch
```

<details><summary>task-11-test.patch</summary>

```diff
diff --git a/test/app.test.ts b/test/app.test.ts
index 0eddd9f..c231cd4 100644
--- a/test/app.test.ts
+++ b/test/app.test.ts
@@ -7,7 +7,7 @@ import { FIRST_TEXT_ONLY } from '../src/owner/manual-send.ts'
 import { STRAY_TOPIC } from '../src/owner/routing.ts'
 import { CONNECTION_ID, OWNER_ID, PEER_ID, fixture } from './helpers.ts'
 import { TelegramError } from '../src/telegram.ts'
-import { setupDeps } from './setup.ts'
+import { fakeTranslator, setupDeps } from './setup.ts'
 
 function withUpdateId(update: Update, updateId: number): Update {
   return { ...update, update_id: updateId }
@@ -312,3 +312,70 @@ test('inline-ответ не ушёл — владелец знает, что н
 test('бот просит у Telegram inline-запросы — иначе «Отправить через бота» молча не работает', () => {
   assert.ok(ALLOWED_UPDATES.includes('inline_query'))
 })
+
+test('спека: новый собеседник ответил — написать первым, отправить через бота, ответ в той же теме, дальше автоматически', async () => {
+  const dictionary: Record<string, string> = {
+    'Привет! Я по поводу квартиры': "Hi! I'm writing about the apartment.",
+    "Yes, it's still available": 'Да, ещё свободна',
+    'Когда можно посмотреть?': 'When can I see it?',
+  }
+  const translator = fakeTranslator((request) => dictionary[request.text] ?? `[${request.target.code}] ${request.text}`)
+  const { app, tg, store, connectOwner } = started({ overrides: { translator: translator.translate } })
+  connectOwner()
+  const MARIA = 200005
+
+  // 1. Владелец пишет вне тем — перевод с кнопками.
+  const first = fixture('owner-message-outside')
+  first.message!.text = 'Привет! Я по поводу квартиры'
+  await app.handleUpdate(first)
+  const draftMessage = tg.callsOf('sendText').at(-1)!
+  const draftId = draftMessage.opts.keyboard![0]![0]!.chooseChat!
+
+  // 2. «Отправить через бота» → выбор чата → Telegram спрашивает бота.
+  const query = fixture('inline-query-owner')
+  query.inline_query!.query = draftId
+  await app.handleUpdate(query)
+  const [article] = tg.callsOf('answerInline')[0]!.articles
+  assert.equal(article!.text, "Hi! I'm writing about the apartment.")
+
+  // 3. Нажатие на вариант: сообщение «via @бот» приходит боту из лички Maria.
+  const sent = fixture('business-message-via-bot')
+  sent.business_message!.text = article!.text
+  await app.handleUpdate(sent)
+  const conversation = store.findConversationByPeer(OWNER_ID, MARIA)!
+  assert.ok(conversation)
+
+  // 4. Maria отвечает — перевод в ту же тему.
+  const answer = withUpdateId(fixture('business-message-peer-text'), 1180)
+  answer.business_message!.chat = { id: MARIA, type: 'private', first_name: 'Maria' }
+  answer.business_message!.from = { id: MARIA, is_bot: false, first_name: 'Maria' }
+  answer.business_message!.message_id = 720
+  answer.business_message!.text = "Yes, it's still available"
+  await app.handleUpdate(answer)
+  assert.equal(tg.callsOf('createTopic').length, 1)
+  const topicId = store.findConversationByPeer(OWNER_ID, MARIA)!.topicId!
+  const translated = tg.callsOf('sendText').at(-1)!
+  assert.equal(translated.opts.threadId, topicId)
+  assert.match(translated.text, /^Да, ещё свободна/)
+
+  // 5. Ответ владельца в теме уходит Maria от его имени, сам.
+  const reply = withUpdateId(fixture('owner-message-in-topic'), 1181)
+  reply.message!.message_thread_id = topicId
+  reply.message!.text = 'Когда можно посмотреть?'
+  await app.handleUpdate(reply)
+  const [toMaria] = tg.sentAsOwner()
+  assert.ok(toMaria && toMaria.method === 'sendText')
+  assert.equal(toMaria.chatId, MARIA)
+  assert.equal(toMaria.text, 'When can I see it?')
+  assert.equal(toMaria.opts.businessConnectionId, CONNECTION_ID)
+})
+
+test('отправка через бота, доставленная повторно после перезапуска, — одна тема и одна строка «Вы:»', async () => {
+  const { app, tg, store, connectOwner, deps } = started()
+  connectOwner()
+  store.createDraft({ ownerId: OWNER_ID, conversationId: null, original: 'Привет! Я по поводу квартиры', translation: "Hi! I'm writing about the apartment.", now: deps.now() })
+  await app.handleUpdate(fixture('business-message-via-bot'))
+  await app.handleUpdate(fixture('business-message-via-bot'))
+  assert.equal(tg.callsOf('createTopic').length, 1)
+  assert.equal(tg.callsOf('sendText').filter((call) => call.text.startsWith('<i>Вы:</i>')).length, 1)
+})
diff --git a/test/fixtures/business-message-via-bot.json b/test/fixtures/business-message-via-bot.json
new file mode 100644
index 0000000..6eafbef
--- /dev/null
+++ b/test/fixtures/business-message-via-bot.json
@@ -0,0 +1,29 @@
+{
+  "update_id": 1108,
+  "business_message": {
+    "business_connection_id": "BCOWNER000001",
+    "message_id": 508,
+    "from": {
+      "id": 100001,
+      "is_bot": false,
+      "first_name": "Owner",
+      "last_name": "Test",
+      "username": "owner_test",
+      "language_code": "ru",
+      "is_premium": true
+    },
+    "chat": {
+      "id": 200005,
+      "first_name": "Maria",
+      "type": "private"
+    },
+    "date": 1760000150,
+    "text": "Hi! I'm writing about the apartment.",
+    "via_bot": {
+      "id": 300003,
+      "is_bot": true,
+      "first_name": "Translator",
+      "username": "translator_test_bot"
+    }
+  }
+}
diff --git a/test/incoming.test.ts b/test/incoming.test.ts
index e6d640b..e35a8fa 100644
--- a/test/incoming.test.ts
+++ b/test/incoming.test.ts
@@ -412,3 +412,60 @@ test('перевод не удался — проверка не вызывае
   await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
   assert.equal(reviewed, 0)
 })
+
+const MARIA_ID = 200005
+
+test('разбор: сообщение владельца, отправленное через бота, помечено viaBot', () => {
+  const via = parseBusinessMessage(messageFixture('business-message-via-bot'), ownerConnection, BOT_ID)
+  if (via === 'echo') return assert.fail('отправка через бота — не эхо')
+  assert.equal(via.direction, 'owner-direct')
+  assert.equal(via.viaBot, true)
+  const direct = parseBusinessMessage(messageFixture('business-message-owner-direct'), ownerConnection, BOT_ID)
+  if (direct === 'echo') return assert.fail('своё сообщение владельца — не эхо')
+  assert.equal(direct.viaBot, false)
+})
+
+test('спека: перевод, отправленный через бота, заводит разговор и тему с «Вы: оригинал → перевод»', async () => {
+  const { deps, tg, store, translator, connectOwner } = setupDeps()
+  connectOwner()
+  store.createDraft({ ownerId: OWNER_ID, conversationId: null, original: 'Привет! Я по поводу квартиры', translation: "Hi! I'm writing about the apartment.", now: deps.now() })
+  await onBusinessMessage(deps, messageFixture('business-message-via-bot'))
+
+  const conversation = store.findConversationByPeer(OWNER_ID, MARIA_ID)!
+  assert.ok(conversation)
+  assert.equal(conversation.lastPeerAt, 0)
+  assert.deepEqual(store.activeConversations(OWNER_ID, deps.now()), [])
+  assert.equal(tg.callsOf('createTopic')[0]!.name, 'Maria')
+  assert.equal(tg.callsOf('sendText').at(-1)!.text, "<i>Вы:</i> Привет! Я по поводу квартиры\n→ Hi! I'm writing about the apartment.")
+  assert.deepEqual(store.recentReplicas(conversation.id), [{ role: 'owner', text: 'Привет! Я по поводу квартиры' }])
+  assert.equal(translator.calls.length, 0)
+})
+
+test('отправка через бота без сохранённого перевода (устарел) — разговор всё равно заводится', async () => {
+  const { deps, tg, store, connectOwner } = setupDeps()
+  connectOwner()
+  await onBusinessMessage(deps, messageFixture('business-message-via-bot'))
+  assert.ok(store.findConversationByPeer(OWNER_ID, MARIA_ID))
+  assert.equal(tg.callsOf('sendText').at(-1)!.text, "<i>Вы в личке:</i> Hi! I'm writing about the apartment.")
+})
+
+test('короткое «OK» другу совпало с переводом, но не через бота — тема не появляется', async () => {
+  const { deps, tg, store, connectOwner } = setupDeps()
+  connectOwner()
+  store.createDraft({ ownerId: OWNER_ID, conversationId: null, original: 'Ок', translation: 'OK', now: deps.now() })
+  const message = { ...messageFixture('business-message-owner-direct'), text: 'OK' }
+  await onBusinessMessage(deps, message)
+  assert.equal(store.findConversationByPeer(OWNER_ID, PEER_ID), undefined)
+  assert.equal(tg.calls.length, 0)
+})
+
+test('спека: в начатом разговоре вставленный перевод — «Вы: оригинал → перевод», в истории оригинал', async () => {
+  const { deps, tg, store, connectOwner } = setupDeps()
+  connectOwner()
+  await onBusinessMessage(deps, messageFixture('business-message-peer-text'))
+  const conversation = store.findConversationByPeer(OWNER_ID, PEER_ID)!
+  store.createDraft({ ownerId: OWNER_ID, conversationId: conversation.id, original: 'Отлично, а ты?', translation: 'Great, and you?', now: deps.now() })
+  await onBusinessMessage(deps, { ...messageFixture('business-message-owner-direct'), text: 'Great, and you?\n' })
+  assert.equal(tg.callsOf('sendText').at(-1)!.text, '<i>Вы:</i> Отлично, а ты?\n→ Great, and you?')
+  assert.deepEqual(store.recentReplicas(conversation.id).at(-1), { role: 'owner', text: 'Отлично, а ты?' })
+})
```

</details>

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — сообщение «via @бот» не заводит разговор, вставленный перевод показывается как «Вы в личке».

- [ ] **Step 3: Наложить код**

```bash
git apply .superpowers/sdd/write-first/task-11-src.patch
```

<details><summary>task-11-src.patch</summary>

```diff
diff --git a/src/channels/private-chat/incoming.ts b/src/channels/private-chat/incoming.ts
index 13f5ed6..04ece3c 100644
--- a/src/channels/private-chat/incoming.ts
+++ b/src/channels/private-chat/incoming.ts
@@ -10,6 +10,7 @@ import {
   renderOwnerDirect,
   renderOwnerDirectMarker,
   renderOwnerUnsupported,
+  renderSent,
   renderUnsupported,
   renderUntranslated,
 } from '../../owner/topics.ts'
@@ -42,6 +43,7 @@ export function parseBusinessMessage(message: Message, connection: Connection, b
     text,
     media,
     unsupported: unsupportedLabel(message),
+    viaBot: message.via_bot?.id === botId,
   }
 }
 
@@ -62,8 +64,20 @@ export function incomingSteps(deps: Deps): Step<Replica>[] {
       },
     },
     {
-      // Разговор начинает только собеседник, пишущий на чужом языке. Друзья, пишущие
-      // на языке владельца, не попадают ни в базу, ни к модели.
+      // Перевод, который владелец отправил сам — кнопкой «Отправить через бота» или вставив
+      // скопированное, — узнаём по тексту: в теме он покажется ответом с оригиналом, а не
+      // «Вы в личке» на чужом языке. Только текст: вложение через бота не уходит.
+      name: 'черновик',
+      run: (replica) => {
+        if (replica.direction === 'owner-direct' && replica.text && !replica.media) {
+          replica.draft = deps.store.findDraftByTranslation(replica.ownerId, replica.text, deps.now())
+        }
+        return 'next'
+      },
+    },
+    {
+      // Разговор начинает собеседник, пишущий на чужом языке, — или владелец, отправивший
+      // перевод через бота. Друзья, пишущие на языке владельца, не попадают ни в базу, ни к модели.
       name: 'разговор',
       run: (replica) => {
         const existing = deps.store.findConversationByPeer(replica.ownerId, replica.peerChatId)
@@ -71,6 +85,19 @@ export function incomingSteps(deps: Deps): Step<Replica>[] {
           replica.conversation = existing
           return 'next'
         }
+        // Только по via_bot, а не по совпадению текста: короткий перевод («OK», «Thanks!»)
+        // совпал бы с обычным сообщением другу, и у друга появилась бы тема. lastPeerAt = 0:
+        // пока собеседник не ответил, разговор не активен и в «Кому?» не попадает.
+        if (replica.direction === 'owner-direct' && replica.viaBot) {
+          replica.conversation = deps.store.createConversation({
+            ownerId: replica.ownerId,
+            connectionId: replica.connectionId,
+            peerChatId: replica.peerChatId,
+            peerName: replica.peerName,
+            lastPeerAt: 0,
+          })
+          return 'next'
+        }
         if (replica.direction !== 'peer' || !deps.languages || replica.verdict !== 'foreign') return 'stop'
         replica.conversation = deps.store.createConversation({
           ownerId: replica.ownerId,
@@ -143,11 +170,14 @@ export function incomingSteps(deps: Deps): Step<Replica>[] {
           return 'stop'
         }
 
-        // То, что не похоже на перевод, переводом и не храним.
+        // То, что не похоже на перевод, переводом и не храним. Отправленный вручную перевод —
+        // в истории как обычный ответ владельца: его текст и перевод.
         const translation = replica.review?.verdict === 'not-translation' ? null : (replica.translation ?? null)
         deps.store.addReplica(
           conversation.id,
-          { role: isPeer ? 'peer' : 'owner', original: historyText(replica), translation },
+          replica.draft
+            ? { role: 'owner', original: replica.draft.original, translation: replica.draft.translation }
+            : { role: isPeer ? 'peer' : 'owner', original: historyText(replica), translation },
           deps.now(),
         )
         if (isPeer) deps.store.touchPeer(conversation.id, deps.now())
@@ -158,6 +188,7 @@ export function incomingSteps(deps: Deps): Step<Replica>[] {
 }
 
 function textFor(replica: Replica): string[] {
+  if (replica.draft) return renderSent(replica.draft.original, replica.draft.translation)
   if (replica.direction === 'owner-direct') return renderOwnerDirect(replica.text)
   if (replica.translation) return renderIncoming(replica.translation, replica.text, replica.review)
   if (replica.translationError) return renderUntranslated(replica.text, replica.translationError)
diff --git a/src/types.ts b/src/types.ts
index c5a86e3..b91ed70 100644
--- a/src/types.ts
+++ b/src/types.ts
@@ -86,6 +86,10 @@ export type Replica = {
   media: MediaRef | null
   /** Что пришло, если переслать это нельзя: «геопозицию», «контакт» */
   unsupported: string | null
+  /** Сообщение владельца отправлено кнопкой «Отправить через бота» (via @бот) */
+  viaBot?: boolean
+  /** Перевод для ручной отправки, с которым совпал текст владельца */
+  draft?: Draft
   verdict?: Verdict
   conversation?: Conversation
   translation?: string | null
```

</details>

- [ ] **Step 4: Тесты и типы**

Run: `npm test && npm run typecheck`
Expected: PASS, 320 тестов; проверка типов без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add -A src test scripts
git commit -m "Отправка через бота заводит разговор, отправленный вручную перевод — ответом в теме" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Живая проверка

**Субагенту не отдаётся:** нужны автор, его аккаунт, аккаунт Timon и BotFather. Исполняет контроллер вместе с автором.

Закрывает: `tasks.md` 10.1, 10.2, 10.3, 10.4, 10.5.

**Files:**
- Create: `scripts/check-inline.ts` — одноразовая разведка
- Modify: `test/fixtures/business-message-via-bot.json` — обезличенный живой образец
- Modify: `../docs/проекты.md`, `../docs/подводные-камни/tg-chat-translator.md` — итоги (вне репозитория продукта)

- [ ] **Step 1: Скрипт разведки**

```bash
git apply .superpowers/sdd/write-first/task-12-src.patch
npm run typecheck
```

<details><summary>task-12-src.patch</summary>

```diff
diff --git a/scripts/check-inline.ts b/scripts/check-inline.ts
new file mode 100644
index 0000000..3ef1058
--- /dev/null
+++ b/scripts/check-inline.ts
@@ -0,0 +1,79 @@
+/**
+ * Одноразовая разведка inline-режима (изменение add-write-first, живая задача плана).
+ *
+ * Запуск: node scripts/check-inline.ts — основной бот на это время остановлен, иначе апдейты
+ * разойдутся между двумя процессами. Каждый апдейт ложится в data/captured/ (каталог в
+ * .gitignore: там настоящие id и тексты).
+ *
+ * Команды владельца в чате с ботом:
+ *   /buttons — в тему Timon: сообщение с зелёной «Отправить через бота» и «Скопировать»,
+ *              следом длинный текст в <pre> и в <code> — проверить копирование нажатием.
+ * Inline-запрос владельца получает один вариант — текст проверки. Для business_message в
+ * консоль печатается, есть ли via_bot: от этого зависит, заведёт ли отправка через бота тему.
+ */
+import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
+import { Bot } from 'grammy'
+import { loadEnv, parseDotEnv } from '../src/env.ts'
+import { openStore } from '../src/store.ts'
+
+const result = loadEnv()
+if (!result.ok) {
+  console.error(`Не заполнено в .env: ${result.missing.join(', ')}`)
+  process.exit(1)
+}
+const { botToken, ownerId, dbPath } = result.env
+const raw = parseDotEnv(readFileSync('.env', 'utf8'))
+const peerChatId = Number(raw.TEST_PEER_CHAT_ID)
+
+// Тема Timon — из базы основного бота: кнопку надо проверить именно в сообщении внутри темы.
+const store = openStore(dbPath)
+const threadId = store.findConversationByPeer(ownerId, peerChatId)?.topicId ?? undefined
+store.close()
+
+const PROBE = 'Inline check: this text was sent via the bot button — no need to reply'
+const LONG = 'This is a long text to check copying by tap. '.repeat(8).trim()
+
+const bot = new Bot(botToken)
+mkdirSync('data/captured', { recursive: true })
+let counter = 0
+
+bot.use(async (ctx) => {
+  const kind = Object.keys(ctx.update).find((key) => key !== 'update_id') ?? 'unknown'
+  const file = `data/captured/${String(++counter).padStart(3, '0')}-inline-${kind}.json`
+  writeFileSync(file, JSON.stringify(ctx.update, null, 2) + '\n')
+  console.log(`сохранён ${file}`)
+
+  const business = ctx.update.business_message
+  if (business) {
+    console.log(`  business_message от ${business.from?.id === ownerId ? 'владельца' : 'собеседника'}, via_bot: ${business.via_bot ? `@${business.via_bot.username}` : 'нет'}`)
+  }
+
+  const message = ctx.message
+  if (message?.from?.id === ownerId && message.text === '/buttons') {
+    const where = threadId === undefined ? {} : { message_thread_id: threadId }
+    if (threadId === undefined) console.log('Темы Timon в базе нет — кнопки уйдут вне тем')
+    await ctx.api.sendMessage(ownerId, `Проверка кнопок:\n${PROBE}`, {
+      ...where,
+      reply_markup: {
+        inline_keyboard: [
+          [{ text: 'Отправить через бота', switch_inline_query_chosen_chat: { query: '1', allow_user_chats: true }, style: 'success' }],
+          [{ text: 'Скопировать', copy_text: { text: PROBE } }],
+        ],
+      },
+    })
+    await ctx.api.sendMessage(ownerId, `<i>Блок pre — нажмите, чтобы скопировать:</i>\n<pre>${LONG}</pre>`, { ...where, parse_mode: 'HTML' })
+    await ctx.api.sendMessage(ownerId, `<i>Блок code — нажмите, чтобы скопировать:</i>\n<code>${LONG}</code>`, { ...where, parse_mode: 'HTML' })
+  }
+
+  const inline = ctx.inlineQuery
+  if (inline) {
+    if (inline.from.id !== ownerId) return
+    await ctx.answerInlineQuery(
+      [{ type: 'article', id: 'probe', title: PROBE.slice(0, 64), description: 'Нажмите — уйдёт от вашего имени', input_message_content: { message_text: PROBE } }],
+      { is_personal: true, cache_time: 0 },
+    )
+  }
+})
+
+console.log('Слушаю апдейты. Владельцу: /buttons в чате с ботом. Остановить — Ctrl+C.')
+await bot.start({ allowed_updates: ['business_message', 'message', 'inline_query'] })
```

</details>

- [ ] **Step 2: Разведка (10.1)**

Остановить основной бот. `node scripts/check-inline.ts`. Автор отправляет боту `/buttons` и проверяет:
- зелёная ли кнопка «Отправить через бота» на Mac и телефоне;
- открывает ли она выбор чата, есть ли в выборе Timon;
- уходит ли Timon проверочный текст с «via @бот» после нажатия на вариант;
- копирует ли «Скопировать»;
- копируются ли блоки `<pre>` и `<code>` нажатием — на телефоне и на Mac.

В консоли — пришёл ли `business_message` и есть ли `via_bot`. Если `via_bot` нет — **стоп и вопрос автору**.

Живой `business_message` обезличить по образцу `test/fixtures/business-message-via-bot.json`: id, имена, username и текст заменить выдуманными, `via_bot` оставить в форме Telegram. Сверить поля с ручным образцом; если отличаются те, что читает код, — стоп и вопрос автору. Затем `npm test` — зелёный. Если `<pre>` не копируется нажатием, а `<code>` копируется — заменить `<pre>` на `<code>` в `renderDraft` и его тестах: поведение по спеке то же.

Проверка: `grep` по `test/fixtures` настоящих id и имён из `.env` и живого теста ничего не находит. Итоги — в `../docs/проекты.md`, неочевидное — в `../docs/подводные-камни/tg-chat-translator.md`.

- [ ] **Step 3: Написать первым (10.2)**

Автор добавляет в список чатов бота второй чат, кроме Timon, и решает какой. Запустить бота из ветки. Путь:
1. Владелец пишет вне тем, когда активных разговоров нет.
2. Приходит перевод с кнопками.
3. «Отправить через бота» → выбор чата → у собеседника перевод с «via @бот».
4. У владельца появляется тема с «Вы: … → …».
5. Собеседник отвечает — перевод в той же теме.
6. Ответ владельца в теме уходит от его имени сам.

- [ ] **Step 4: «Кому?» (10.3)**

При одном активном Timon владелец пишет вне тем без «Ответить». Ожидается «Кому?» с кнопками «Timon», «Новому собеседнику» и «Отмена». «Новому собеседнику» даёт перевод с кнопками, Timon ничего не получает.

- [ ] **Step 5: Отказы (10.4)**

- Правило суток: ответ владельца в теме из Step 3 до ответа собеседника → «Не отправлено: от … давно не было сообщений» с кнопками. «Скопировать», вставить в личку → в теме «Вы: … → …».
- `BUSINESS_PEER_INVALID`: чат временно убрать из списка бота, ответить в теме → текст с путём к настройке. Вернуть чат в список.

- [ ] **Step 6: Ошибки и настройки (10.5)**

- Неверный ключ на один запуск → «OpenRouter: ключ не подходит», «User not found» нигде нет.
- Inline Mode выключить в BotFather → сообщение при старте; перевод вне тем — с одной «Скопировать».
- Inline Mode включить обратно, не перезапуская бота → через минуту снова обе кнопки.

- [ ] **Step 7: Итоги и коммит**

Итоги шагов 3–6 — в `../docs/проекты.md`, неочевидное — в `../docs/подводные-камни/tg-chat-translator.md`. Галочки 10.1–10.5 в `tasks.md`.

```bash
git add scripts/check-inline.ts test/fixtures/business-message-via-bot.json openspec/changes/add-write-first/tasks.md
git commit -m "Живая проверка «Написать первым»: разведка inline-режима и итоги" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Ревью всего изменения

Исполняет контроллер. Закрывает: `tasks.md` 11.1.

- [ ] **Step 1:** `/code-review high` по всей ветке относительно `main`.
- [ ] **Step 2:** `/simplify` по всей ветке.
- [ ] **Step 3:** `/security-review`: изменение затрагивает inline-ответы, чужой текст и ключи.
- [ ] **Step 4:** Замечания в пределах спеки — чинятся с тестом. Меняющие поведение — стоп и вопрос автору, решение записывается в журнал.
- [ ] **Step 5:** `npm test && npm run typecheck` — зелёные; галочка 11.1 в `tasks.md`; коммит.
