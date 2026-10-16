import { createInterface } from 'node:readline'

/** Консоль установщика. Шаги говорят только через неё — в тестах её подменяет сценарий. */
export type Io = {
  say(text: string): void
  /** Вопрос с обычным вводом: «да/нет», число */
  ask(question: string): Promise<string>
  /** Вопрос, где вместо знаков на экране звёздочки: токен */
  askMasked(question: string): Promise<string>
}

/** Человек прервал установку (Ctrl+C) или ввод закрылся. */
export class SetupAborted extends Error {
  constructor() {
    super('Установка прервана')
    this.name = 'SetupAborted'
  }
}

// Управляющие знаки — по коду, а не escape-последовательностями в тексте: так их не
// потеряет ни редактор, ни нейросеть, переписывающая код.
const ESC = String.fromCharCode(0x1b)
const CTRL_C = String.fromCharCode(3)
const BACKSPACE = String.fromCharCode(8)
const DELETE = String.fromCharCode(0x7f)
const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)

/**
 * Один кусок ввода в сыром режиме → новое значение и что напечатать. Вставка приходит одним
 * куском. Последовательности терминала (ESC [ … буква или ~) пропускаются целиком: это метки
 * вставки и стрелки, в токене им не место.
 */
export function feedMasked(
  value: string,
  chunk: string,
): { value: string; echo: string; done: 'enter' | 'abort' | undefined } {
  let echo = ''
  const chars = [...chunk]
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!
    if (ch === CR || ch === LF) return { value, echo, done: 'enter' }
    if (ch === CTRL_C) return { value, echo, done: 'abort' }
    if (ch === ESC) {
      if (chars[i + 1] === '[') {
        i += 2
        // Конец последовательности — знак от «@» до «~».
        while (i < chars.length && !(chars[i]! >= '@' && chars[i]! <= '~')) i++
      }
      continue
    }
    if (ch === DELETE || ch === BACKSPACE) {
      if (value.length > 0) {
        value = [...value].slice(0, -1).join('')
        echo += BACKSPACE + ' ' + BACKSPACE
      }
      continue
    }
    if (ch < ' ') continue
    value += ch
    echo += '*'
  }
  return { value, echo, done: undefined }
}

export function createConsoleIo(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): Io {
  function ask(question: string): Promise<string> {
    // terminal: false — эхо оставляем терминалу: readline в режиме терминала включил бы
    // сырой режим сам и спорил бы с askMasked.
    const rl = createInterface({ input, terminal: false })
    output.write(question)
    return new Promise<string>((resolve, reject) => {
      rl.once('line', (line) => {
        resolve(line.trim())
        rl.close()
      })
      // Ввод закрылся раньше ответа — ждать нечего; после ответа reject уже ничего не меняет.
      rl.once('close', () => reject(new SetupAborted()))
    })
  }

  function askMasked(question: string): Promise<string> {
    // Без терминала (ввод из файла или трубы) сырого режима нет — обычный ввод.
    if (!input.isTTY) return ask(question)
    output.write(question)
    input.setRawMode(true)
    input.setEncoding('utf8')
    input.resume()
    return new Promise<string>((resolve, reject) => {
      let value = ''
      const finish = (settle: () => void) => {
        input.off('data', onData)
        input.setRawMode(false)
        input.pause()
        output.write('\n')
        settle()
      }
      const onData = (chunk: string) => {
        const step = feedMasked(value, chunk)
        value = step.value
        if (step.echo) output.write(step.echo)
        if (step.done === 'enter') finish(() => resolve(value.trim()))
        if (step.done === 'abort') finish(() => reject(new SetupAborted()))
      }
      input.on('data', onData)
    })
  }

  return {
    say: (text) => {
      output.write(text + '\n')
    },
    ask,
    askMasked,
  }
}
