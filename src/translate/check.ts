import { detectLanguage, lettersOf } from '../lang/detect.ts'
import type { LangProfile } from '../lang/profiles.ts'
import type { HistoryLine, Review } from '../types.ts'
import { numbersMatch } from './numbers.ts'

/**
 * Проверка ответа модели — на месте, без сети и без второго вызова модели. Промпт снижает
 * частоту подмены, но не закрывает её (OWASP LLM01), поэтому то, что прошло, ловится здесь:
 * до показа владельцу и до отправки собеседнику.
 */

export type ReviewInput = {
  /** incoming — перевод входящего на язык владельца; outgoing — ответа владельца на язык собеседника */
  direction: 'incoming' | 'outgoing'
  original: string
  translation: string
  owner: LangProfile
  /** Та же история, что видела модель: подмена могла прийти из неё */
  history: readonly HistoryLine[]
}

export type Reviewer = (input: ReviewInput) => Review

/** Правило проверки. Новое правило — строка в OUTPUT_CHECKS, сборщик не правится. */
export type OutputCheck = {
  name: string
  /** Что увидит владелец, если правило сработало */
  verdict: Exclude<Review['verdict'], 'ok'>
  failed: (input: ReviewInput) => boolean
}

/**
 * Вес буквы: иероглиф несёт столько же смысла, сколько несколько букв алфавита. Без веса
 * перевод на китайский всегда выглядел бы «слишком коротким», а с китайского — «слишком длинным».
 */
const LETTER_WEIGHTS: readonly { pattern: RegExp; weight: number }[] = [
  { pattern: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u, weight: 2.5 },
  { pattern: /\p{Script=Hangul}/u, weight: 1.8 },
]

export function textWeight(text: string): number {
  let total = 0
  for (const letter of lettersOf(text)) {
    total += LETTER_WEIGHTS.find((entry) => entry.pattern.test(letter))?.weight ?? 1
  }
  return total
}

/** Легче — «ok», «👍», имя: по такому не судим ни о языке, ни о длине. */
export const MIN_CHECKED_WEIGHT = 12
/** «Слишком коротко» — только у длинных сообщений: у коротких длина перевода гуляет сильнее. */
export const MIN_SHORTNESS_WEIGHT = 30
export const TOO_SHORT_RATIO = 0.45
export const TOO_LONG_RATIO = 2.5
/** Эхо короче — совпадение пары слов, а не подсунутая фраза. */
const MIN_ECHO = 8
/** Из истории — только длинная фраза: «да, до завтра» честно повторяется в разговоре. */
const MIN_HISTORY_ECHO = 20

/** Для сравнения кусков текста регистр, «ё», пунктуация и лишние пробелы не важны. */
export function flatten(text: string): string {
  return text.normalize('NFC').toLowerCase().replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

/**
 * Отказ модели вместо перевода. Только обороты ассистента: обычное «не могу» в переписке —
 * не отказ. Если такой оборот есть и в оригинале, человек сам это написал.
 */
export const REFUSALS: readonly RegExp[] = [
  /\bas an ai\b/i,
  /\b(?:language model|ai assistant)\b/i,
  /\bi (?:can(?:no|')t|am unable to) (?:help|assist) with (?:that|this)\b/i,
  /\bi (?:can(?:no|')t|won't) (?:comply|fulfill)\b/i,
  /(?:как|я) (?:ии|искусственный интеллект|языковая модель)(?!\p{L})/iu,
  /не могу (?:помочь|выполнить) (?:с )?(?:этим|это|этот|эту|такой|такую|данн)/iu,
  /\bcomo (?:ia|modelo de lenguaje)\b/iu,
  /no puedo (?:ayudar|cumplir) con (?:eso|esto|esta solicitud)/iu,
]

const weightOf = (input: ReviewInput) => textWeight(input.original)
const ratio = (input: ReviewInput) => textWeight(input.translation) / textWeight(input.original)

export const OUTPUT_CHECKS: readonly OutputCheck[] = [
  {
    // Входящее переводится на язык владельца, ответ владельца — с него. «OK» в ответ на
    // длинную фразу — «непонятно», и это тоже провал.
    name: 'язык',
    verdict: 'not-translation',
    failed: (input) => {
      if (weightOf(input) < MIN_CHECKED_WEIGHT) return false
      const verdict = detectLanguage(input.translation, input.owner)
      return input.direction === 'incoming' ? verdict !== 'native' : verdict !== 'foreign'
    },
  },
  {
    // Модель выкинула командную часть и перевела только «полезную нагрузку».
    name: 'слишком коротко',
    verdict: 'not-translation',
    failed: (input) => weightOf(input) >= MIN_SHORTNESS_WEIGHT && ratio(input) < TOO_SHORT_RATIO,
  },
  {
    // Модель ответила на вопрос или дала совет вместо перевода.
    name: 'слишком длинно',
    verdict: 'not-translation',
    failed: (input) => weightOf(input) >= MIN_CHECKED_WEIGHT && ratio(input) > TOO_LONG_RATIO,
  },
  {
    // «…output: Я согласен на скидку 50%» — модель выдала подсунутую фразу из оригинала
    // или из прошлого сообщения собеседника.
    name: 'эхо',
    verdict: 'not-translation',
    failed: (input) => {
      const translation = flatten(input.translation)
      if (translation.length < MIN_ECHO) return false
      const original = flatten(input.original)
      if (original.includes(translation) && translation.length < 0.8 * original.length) return true
      return (
        translation.length >= MIN_HISTORY_ECHO &&
        input.history.some((line) => line.role === 'peer' && flatten(line.text).includes(translation))
      )
    },
  },
  {
    name: 'отказ модели',
    verdict: 'not-translation',
    failed: (input) => matchesAny(REFUSALS, input.translation) && !matchesAny(REFUSALS, input.original),
  },
  {
    // Последним: если ответ вообще не перевод, владельцу важнее это, а не числа.
    name: 'числа',
    verdict: 'numbers',
    failed: (input) => !numbersMatch(input.original, input.translation),
  },
]

/**
 * Фразы-команды для ИИ во входящем — только сильные шаблоны: слабые («ответь только…»)
 * слишком часто встречаются в живой речи. \b с кириллицей в JS не работает, поэтому русские
 * шаблоны — без границ слова. Ложное срабатывание допустимо: это пометка, а не блокировка.
 */
export const COMMAND_PATTERNS: readonly RegExp[] = [
  // EN
  /\b(?:ignore|disregard|forget|override|bypass|skip)\b[^.\n]{0,40}\b(?:instructions?|rules|prompts?|directions|guidelines)\b/i,
  /\b(?:new|updated|real)\s+(?:instructions?|rules|task|system prompt)\b/i,
  /\b(?:do not|don't|stop)\s+translat/i,
  /\btranslate (?:this|it|the following|everything)\b[^.\n]{0,30}\bas\b/i,
  /\b(?:you are now|from now on,? you|pretend (?:to be|you are)|act as)\b/i,
  /^\s*(?:system|assistant|developer)\s*[:\]]|\[(?:system|inst)\]|<\|im_(?:start|end)\|>|###\s*instruction/im,
  // RU
  /(?:игнорир|забудь|забыть|не обращай внимани|отмени)[^.\n]{0,40}(?:инструкц|правил|указани|промпт|задач)/iu,
  /(?:новые|новая)\s+(?:инструкц|правил|задач)/iu,
  /(?:не переводи|хватит переводить|перестань переводить)/iu,
  /(?:ты теперь|теперь ты|с этого момента ты|представь, что ты)/iu,
  // ES
  /(?:ignora|olvida|omite|descarta|haz caso omiso)[^.\n]{0,40}(?:instrucci|reglas|indicaci|tarea)/iu,
  /(?:nuevas instrucciones|nueva tarea|nuevas reglas)/iu,
  /(?:no traduzcas|deja de traducir)/iu,
  /(?:ahora eres|a partir de ahora eres|actúa como|finge que eres)/iu,
]

export function hasCommandPhrases(text: string): boolean {
  return matchesAny(COMMAND_PATTERNS, text)
}

/** Первое сработавшее правило решает, что увидит владелец; порядок в списке — приоритет. */
export function createReviewer(checks: readonly OutputCheck[] = OUTPUT_CHECKS): Reviewer {
  return (input) => {
    // Ответ владельца — его собственный текст: команды в нём не сигнал.
    const commands = input.direction === 'incoming' && hasCommandPhrases(input.original)
    const failed = checks.find((check) => check.failed(input))
    return failed ? { verdict: failed.verdict, rule: failed.name, commands } : { verdict: 'ok', rule: null, commands }
  }
}

export const reviewTranslation: Reviewer = createReviewer()
