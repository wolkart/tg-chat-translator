import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Message } from 'grammy/types'
import { DOWNLOAD_LIMIT, MEDIA, extractMedia, sendMediaLadder, unsupportedLabel } from '../src/media.ts'
import { TelegramError } from '../src/telegram.ts'
import { fakeTelegram } from './fakes.ts'
import { messageFixture } from './helpers.ts'

test('таблица покрывает все восемь типов вложений', () => {
  assert.deepEqual(
    MEDIA.map((spec) => spec.kind).sort(),
    ['animation', 'audio', 'document', 'photo', 'sticker', 'video', 'video_note', 'voice'],
  )
})

test('фото: берётся самый большой размер', () => {
  assert.deepEqual(extractMedia(messageFixture('business-message-peer-photo')), {
    kind: 'photo',
    fileId: 'PHOTO_BIG_1',
    fileSize: 64000,
  })
})

test('голосовое и стикер из образцов', () => {
  assert.equal(extractMedia(messageFixture('business-message-peer-voice'))?.kind, 'voice')
  assert.equal(extractMedia(messageFixture('business-message-peer-sticker'))?.fileId, 'STICKER_1')
})

test('GIF распознаётся как GIF, хотя у него есть и document', () => {
  const gif = {
    message_id: 1,
    date: 0,
    chat: { id: 1, type: 'private', first_name: 'A' },
    animation: { file_id: 'GIF_1', file_unique_id: 'U', width: 1, height: 1, duration: 1 },
    document: { file_id: 'GIF_1', file_unique_id: 'U' },
  } as unknown as Message
  assert.equal(extractMedia(gif)?.kind, 'animation')
})

test('текст — не вложение и не «неподдерживаемое»', () => {
  const message = messageFixture('business-message-peer-text')
  assert.equal(extractMedia(message), null)
  assert.equal(unsupportedLabel(message), null)
})

test('геопозиция помечается как неподдерживаемая', () => {
  assert.equal(unsupportedLabel(messageFixture('business-message-peer-location')), 'геопозицию')
})

test('лестница: по file_id с подписью', async () => {
  const tg = fakeTelegram()
  const media = extractMedia(messageFixture('business-message-peer-photo'))!
  const result = await sendMediaLadder(tg.api, 100001, media, { threadId: 77, caption: 'Моя новая машина', html: true })
  assert.equal(result.ok, true)
  const sent = tg.callsOf('sendMedia')
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.file, 'PHOTO_BIG_1')
  assert.equal(sent[0]!.opts.caption, 'Моя новая машина')
  assert.equal(sent[0]!.opts.threadId, 77)
})

test('лестница: file_id не принят — файл скачивается и загружается заново', async () => {
  const tg = fakeTelegram()
  tg.failNext('sendMedia', new TelegramError(400, 'Bad Request: wrong file identifier'))
  const media = extractMedia(messageFixture('business-message-peer-voice'))!
  const result = await sendMediaLadder(tg.api, 100001, media, {})
  assert.equal(result.ok, true)
  assert.equal(tg.callsOf('downloadFile')[0]!.fileId, 'VOICE_1')
  assert.ok(tg.callsOf('sendMedia')[1]!.file instanceof Uint8Array)
})

test('лестница: падают обе ступени — отказ с причиной', async () => {
  const tg = fakeTelegram()
  tg.failNext('sendMedia', new TelegramError(400, 'wrong file identifier'))
  tg.failNext('downloadFile', new TelegramError(400, 'file is temporarily unavailable'))
  const result = await sendMediaLadder(tg.api, 100001, extractMedia(messageFixture('business-message-peer-voice'))!, {})
  assert.deepEqual(result, { ok: false, reason: 'file is temporarily unavailable' })
})

test('лестница: файл больше 20 МБ не скачивается', async () => {
  const tg = fakeTelegram()
  tg.failNext('sendMedia', new TelegramError(400, 'wrong file identifier'))
  const result = await sendMediaLadder(tg.api, 1, { kind: 'video', fileId: 'BIG', fileSize: DOWNLOAD_LIMIT + 1 }, {})
  assert.equal(result.ok, false)
  assert.equal(tg.callsOf('downloadFile').length, 0)
})

test('лестница: длинная подпись уходит отдельным сообщением после вложения', async () => {
  const tg = fakeTelegram()
  const caption = 'а'.repeat(1500)
  const result = await sendMediaLadder(tg.api, 1, { kind: 'photo', fileId: 'P' }, { caption, threadId: 5 })
  assert.equal(result.ok && result.messageIds.length, 2)
  assert.equal(tg.callsOf('sendMedia')[0]!.opts.caption, undefined)
  const text = tg.callsOf('sendText')[0]!
  assert.equal(text.text, caption)
  assert.equal(text.opts.threadId, 5)
})

test('лестница: у стикера подписи не бывает — текст идёт следом', async () => {
  const tg = fakeTelegram()
  await sendMediaLadder(tg.api, 1, { kind: 'sticker', fileId: 'S' }, { caption: 'подпись' })
  assert.equal(tg.callsOf('sendMedia')[0]!.opts.caption, undefined)
  assert.equal(tg.callsOf('sendText')[0]!.text, 'подпись')
})

test('лестница: ошибка из rethrow не уходит на следующую ступень', async () => {
  const tg = fakeTelegram()
  const notFound = new TelegramError(400, 'Bad Request: message thread not found')
  tg.failNext('sendMedia', notFound)
  await assert.rejects(
    sendMediaLadder(tg.api, 1, { kind: 'photo', fileId: 'P' }, { rethrow: (error) => error === notFound }),
    TelegramError,
  )
  assert.equal(tg.callsOf('downloadFile').length, 0)
})
