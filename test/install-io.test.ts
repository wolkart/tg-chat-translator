import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { SetupAborted, createConsoleIo, feedMasked } from '../src/install/io.ts'
import { runSetup, type SetupStep } from '../src/install/run.ts'
import { fakeFetch, fakeIo, setupContext } from './install-fakes.ts'

const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)
const DEL = String.fromCharCode(0x7f)
const BS = String.fromCharCode(8)
const CTRL_C = String.fromCharCode(3)
const ESC = String.fromCharCode(0x1b)

test('feedMasked: на каждый знак — звёздочка, Enter завершает', () => {
  const step = feedMasked('', 'abc' + CR)
  assert.deepEqual(step, { value: 'abc', echo: '***', done: 'enter' })
})

test('feedMasked: вставка приходит одним куском, перевод строки тоже завершает', () => {
  const step = feedMasked('', '8123:AAF' + LF)
  assert.equal(step.value, '8123:AAF')
  assert.equal(step.echo, '********')
  assert.equal(step.done, 'enter')
})

test('feedMasked: Backspace стирает знак и звёздочку, на пустом — ничего', () => {
  const first = feedMasked('', 'ab' + DEL)
  assert.equal(first.value, 'a')
  assert.equal(first.echo, '**' + BS + ' ' + BS)
  const second = feedMasked('', BS)
  assert.deepEqual(second, { value: '', echo: '', done: undefined })
})

test('feedMasked: Ctrl+C прерывает', () => {
  assert.equal(feedMasked('abc', CTRL_C).done, 'abort')
})

test('feedMasked: метки вставки терминала и стрелки не попадают в токен', () => {
  const step = feedMasked('', ESC + '[200~' + 'tok' + ESC + '[201~' + ESC + '[D' + CR)
  assert.equal(step.value, 'tok')
  assert.equal(step.echo, '***')
})

test('askMasked на терминале: токен не попадает в вывод', async () => {
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (on: boolean) => void }
  const modes: boolean[] = []
  input.isTTY = true
  input.setRawMode = (on) => {
    modes.push(on)
  }
  const output = new PassThrough()
  let printed = ''
  output.on('data', (chunk) => {
    printed += String(chunk)
  })
  const io = createConsoleIo(input as unknown as NodeJS.ReadStream, output as unknown as NodeJS.WriteStream)
  const answer = io.askMasked('Токен бота: ')
  input.write('8123456789:SECRET' + CR)
  assert.equal(await answer, '8123456789:SECRET')
  assert.doesNotMatch(printed, /SECRET|8123/)
  assert.match(printed, /Токен бота: \*{17}/)
  // Сырой режим включили и обязательно выключили: иначе терминал останется без эха.
  assert.deepEqual(modes, [true, false])
})

test('askMasked: токен, вставленный с пробелами вокруг, приходит без них', async () => {
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (on: boolean) => void }
  input.isTTY = true
  input.setRawMode = () => {}
  const io = createConsoleIo(input as unknown as NodeJS.ReadStream, new PassThrough() as unknown as NodeJS.WriteStream)
  const answer = io.askMasked('Токен бота: ')
  input.write('  8123456789:SECRET  ' + CR)
  assert.equal(await answer, '8123456789:SECRET')
})

test('ask без терминала: строка целиком, без пробелов по краям', async () => {
  const input = new PassThrough()
  const output = new PassThrough()
  const io = createConsoleIo(input as unknown as NodeJS.ReadStream, output as unknown as NodeJS.WriteStream)
  const answer = io.ask('Это вы? ')
  input.write('  да ' + LF)
  assert.equal(await answer, 'да')
})

test('ask: ввод закрыт — установка прерывается, а не висит', async () => {
  const input = new PassThrough()
  const io = createConsoleIo(input as unknown as NodeJS.ReadStream, new PassThrough() as unknown as NodeJS.WriteStream)
  const answer = io.ask('Это вы? ')
  input.end()
  await assert.rejects(answer, SetupAborted)
})

function step(id: string, log: string[], result: Awaited<ReturnType<SetupStep['run']>> = { ok: true }): SetupStep {
  return {
    id,
    async run() {
      log.push(id)
      return result
    },
  }
}

test('runSetup: шаги по порядку, код 0', async () => {
  const log: string[] = []
  const { io } = fakeIo()
  const code = await runSetup([step('a', log), step('b', log), step('c', log)], setupContext({ io, fetch: fakeFetch(() => new Error()).fetchImpl }))
  assert.equal(code, 0)
  assert.deepEqual(log, ['a', 'b', 'c'])
})

test('runSetup: шаг не прошёл — причина на экране, дальше не идём, код 1', async () => {
  const log: string[] = []
  const { io, text } = fakeIo()
  const code = await runSetup(
    [step('a', log), step('b', log, { ok: false, reason: 'Не достучаться до Telegram.' }), step('c', log)],
    setupContext({ io, fetch: fakeFetch(() => new Error()).fetchImpl }),
  )
  assert.equal(code, 1)
  assert.deepEqual(log, ['a', 'b'])
  assert.match(text(), /✗ Не достучаться до Telegram\./)
})

test('runSetup: Ctrl+C — «Установка прервана», код 130', async () => {
  const { io, text } = fakeIo()
  const aborting: SetupStep = {
    id: 'x',
    async run() {
      throw new SetupAborted()
    },
  }
  const code = await runSetup([aborting], setupContext({ io, fetch: fakeFetch(() => new Error()).fetchImpl }))
  assert.equal(code, 130)
  assert.match(text(), /Установка прервана/)
})
