import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeHtml, splitText } from '../src/html.ts'

test('escapeHtml: теги и ссылки становятся текстом', () => {
  assert.equal(
    escapeHtml('<b>hi</b> <a href="http://x">link</a>'),
    '&lt;b&gt;hi&lt;/b&gt; &lt;a href="http://x"&gt;link&lt;/a&gt;',
  )
})

test('escapeHtml: амперсанд экранируется первым и не двоится', () => {
  assert.equal(escapeHtml('Tom & Jerry &lt;'), 'Tom &amp; Jerry &amp;lt;')
})

test('splitText: короткий текст — одна часть', () => {
  assert.deepEqual(splitText('привет'), ['привет'])
  assert.deepEqual(splitText(''), [''])
})

test('splitText: режет по абзацам и ничего не теряет', () => {
  const paragraph = 'а'.repeat(3000)
  const text = `${paragraph}\n\n${paragraph}\n\n${paragraph}`
  const parts = splitText(text)
  assert.equal(parts.join(''), text)
  assert.ok(parts.length >= 2)
  for (const part of parts) assert.ok(part.length <= 4096)
  assert.ok(parts[0]!.endsWith('\n\n'))
})

test('splitText: без пробелов режет по лимиту и не рвёт эмодзи', () => {
  const text = 'a'.repeat(4095) + '😀' + 'b'.repeat(10)
  const parts = splitText(text)
  assert.equal(parts.join(''), text)
  assert.equal(parts[0], 'a'.repeat(4095))
  assert.ok(parts[1]!.startsWith('😀'))
})
