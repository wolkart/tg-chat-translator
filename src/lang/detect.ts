import type { Verdict } from '../types.ts'
import type { LangProfile, Script } from './profiles.ts'

/**
 * Детектор отвечает, написан ли текст на языке владельца. Работает только
 * на месте: переписка друзей не должна уходить ни в сеть, ни модели.
 */
export type Detector = (text: string, owner: LangProfile) => Verdict

const SCRIPT_PATTERNS: Record<Script, RegExp> = {
  Cyrillic: /\p{Script=Cyrillic}/u,
  Latin: /\p{Script=Latin}/u,
  Han: /\p{Script=Han}/u,
  Hiragana: /\p{Script=Hiragana}/u,
  Katakana: /\p{Script=Katakana}/u,
  Hangul: /\p{Script=Hangul}/u,
  Arabic: /\p{Script=Arabic}/u,
  Hebrew: /\p{Script=Hebrew}/u,
  Devanagari: /\p{Script=Devanagari}/u,
  Thai: /\p{Script=Thai}/u,
  Georgian: /\p{Script=Georgian}/u,
  Armenian: /\p{Script=Armenian}/u,
}

/** Меньше трёх букв — «ok», «👍», ссылка: по ним язык не определить. */
const MIN_LETTERS = 3

function lettersOf(text: string): string[] {
  // NFC — чтобы вьетнамское «ế», пришедшее как «e» + два значка, считалось одной буквой.
  // Ссылки и упоминания — латиница, которую человек не писал словами.
  const cleaned = text
    .normalize('NFC')
    .replace(/https?:\/\/\S+|www\.\S+/giu, ' ')
    .replace(/@\w+/gu, ' ')
  return [...cleaned].filter((char) => /\p{L}/u.test(char))
}

function scriptOf(letter: string): Script | undefined {
  for (const [script, pattern] of Object.entries(SCRIPT_PATTERNS) as [Script, RegExp][]) {
    if (pattern.test(letter)) return script
  }
  return undefined
}

/** Звено «алфавит»: письменность и буквы, которых в языке владельца нет. */
export const alphabetDetector: Detector = (text, owner) => {
  const letters = lettersOf(text)
  if (letters.length < MIN_LETTERS) return 'unknown'

  const own = letters.filter((letter) => {
    const script = scriptOf(letter)
    return script !== undefined && owner.scripts.includes(script)
  })
  if (letters.length - own.length > own.length) return 'foreign'

  if (owner.letters) {
    const alphabet = new Set(owner.letters)
    // Турецкая İ в нижнем регистре без локали распадается на две кодовые точки.
    if (own.some((letter) => !alphabet.has(letter.toLocaleLowerCase(owner.code)))) return 'foreign'
  }
  return 'native'
}

/**
 * Цепочка детекторов: первый уверенный ответ побеждает. Сейчас звено одно;
 * n-граммный детектор или модель встанут сюда, если алфавита не хватит.
 */
export const DETECTORS: readonly Detector[] = [alphabetDetector]

export function detectLanguage(text: string, owner: LangProfile, detectors: readonly Detector[] = DETECTORS): Verdict {
  for (const detect of detectors) {
    const verdict = detect(text, owner)
    if (verdict !== 'unknown') return verdict
  }
  return 'unknown'
}
