import { detectLanguage, lettersOf } from '../lang/detect.ts'
import type { LangProfile } from '../lang/profiles.ts'
import type { Review } from '../types.ts'
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
  /** На какой язык переводили: у входящего — язык владельца, у ответа — язык собеседника */
  target: LangProfile
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
  { pattern: /\p{Script=Han}/u, weight: 2.5 },
  // Кана — слоговая азбука, знак несёт меньше иероглифа: с весом иероглифа вежливое
  // «ありがとうございました» выглядело бы втрое длиннее «Спасибо за всё».
  { pattern: /[\p{Script=Hiragana}\p{Script=Katakana}]/u, weight: 1.5 },
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
/**
 * Длину судим только у длинных сообщений: у коротких она гуляет сильнее. «Слишком коротко» —
 * в обе стороны, «слишком длинно» — у ответа владельца: «ДР в сб, приходи» честно
 * разворачивается в «The birthday party is on Saturday, come over».
 */
export const MIN_LENGTH_WEIGHT = 30
export const TOO_SHORT_RATIO = 0.45
export const TOO_LONG_RATIO = 2.5
/** Эхо короче — совпадение пары слов, а не подсунутая фраза. */
const MIN_ECHO = 8

/** Для сравнения кусков текста регистр, «ё», пунктуация и лишние пробелы не важны. */
export function flatten(text: string): string {
  return text.normalize('NFC').toLowerCase().replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** Общая письменность: детектор по алфавиту такие языки почти не различает (en и es, ru и uk). */
function shareScript(a: LangProfile, b: LangProfile): boolean {
  return a.scripts.some((script) => b.scripts.includes(script))
}

function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

/**
 * Отказ модели вместо перевода — только оборот, которым модель говорит о себе: «As an AI, I…»,
 * «Как ИИ, я…». Вежливое «не могу с этим помочь» и разговор про ИИ — живая речь, иначе отказ
 * владельца или его ответ про ИИ-ассистента не ушли бы. Если оборот есть и в оригинале,
 * человек написал его сам.
 */
export const REFUSALS: readonly RegExp[] = [
  /\bas an ai(?: language model| assistant)?,/i,
  /\bas a language model,/i,
  /\bi(?:'m| am) (?:an ai|a language model)(?=[.,!]|$)/im,
  /как (?:ии|искусственный интеллект|языковая модель), я/iu,
  // Граница слева: иначе «Какая языковая модель лучше?» читалось бы как «я языковая модель».
  /(?<!\p{L})я (?:—\s*)?языковая модель/iu,
  /\bcomo (?:ia|modelo de lenguaje|asistente de ia),/iu,
]

const LABEL =
  /(?<!\p{L})(?:translation|translated|original|перевод|оригинал|übersetzung|traducción|traduction|traduzione)\s*:/iu
const paragraphBreaks = (text: string) => text.match(/\n\s*\n/g)?.length ?? 0

const weightOf = (input: ReviewInput) => textWeight(input.original)
const ratio = (input: ReviewInput) => textWeight(input.translation) / textWeight(input.original)

export const OUTPUT_CHECKS: readonly OutputCheck[] = [
  {
    // Входящее переводится на язык владельца, ответ владельца — с него. «OK» в ответ на
    // длинную фразу — «непонятно», и это провал в любой паре.
    name: 'язык',
    verdict: 'not-translation',
    failed: (input) => {
      if (weightOf(input) < MIN_CHECKED_WEIGHT) return false
      const verdict = detectLanguage(input.translation, input.owner)
      if (verdict === 'unknown') return true
      if (input.direction === 'incoming') return verdict !== 'native'
      // Честный испанский перевод без «ñ» и «á» детектор принял бы за английский владельца,
      // и ответ не ушёл бы. Поэтому «остался на языке владельца» судим, только когда
      // письменности разные.
      return verdict === 'native' && !shareScript(input.owner, input.target)
    },
  },
  {
    // Модель выкинула командную часть и перевела только «полезную нагрузку».
    name: 'слишком коротко',
    verdict: 'not-translation',
    failed: (input) => weightOf(input) >= MIN_LENGTH_WEIGHT && ratio(input) < TOO_SHORT_RATIO,
  },
  {
    // Модель ответила на вопрос или дала совет вместо перевода.
    name: 'слишком длинно',
    verdict: 'not-translation',
    failed: (input) =>
      weightOf(input) >= (input.direction === 'outgoing' ? MIN_LENGTH_WEIGHT : MIN_CHECKED_WEIGHT) &&
      ratio(input) > TOO_LONG_RATIO,
  },
  {
    // «…output: Я согласен на скидку 50%» — модель выдала подсунутую фразу из оригинала.
    // Из истории подмена не придёт: реплики собеседника с фразами-командами модель не видит.
    name: 'эхо',
    verdict: 'not-translation',
    failed: (input) => {
      const translation = flatten(input.translation)
      if (translation.length < MIN_ECHO) return false
      const original = flatten(input.original)
      return original.includes(translation) && translation.length < 0.8 * original.length
    },
  },
  {
    name: 'отказ модели',
    verdict: 'not-translation',
    failed: (input) => matchesAny(REFUSALS, input.translation) && !matchesAny(REFUSALS, input.original),
  },
  {
    // Живой случай 2026-10-15: на «ок» при деловом обращении модель выдала «Ok, in the
    // business-like polite form… Translation: "OK"», и это ушло собеседнику. Признаки — метка
    // «Translation:» и лишние абзацы (пояснение отделяется пустой строкой). Сравниваем с
    // оригиналом: собеседник сам мог написать «Translation: …» или разбить текст на абзацы.
    name: 'пояснение модели',
    verdict: 'not-translation',
    failed: (input) =>
      (LABEL.test(input.translation) && !LABEL.test(input.original)) ||
      paragraphBreaks(input.translation) > paragraphBreaks(input.original),
  },
  {
    // Последним: если ответ вообще не перевод, владельцу важнее это, а не числа. Только во
    // входящем: свой ответ владелец видит в теме рядом с переводом, а ложная тревога на
    // «05.10 → October 5» не дала бы ответу уйти.
    name: 'числа',
    verdict: 'numbers',
    failed: (input) => input.direction === 'incoming' && !numbersMatch(input.original, input.translation),
  },
]

/**
 * Фразы-команды для ИИ во входящем — только явные: «игнорируй инструкции», «не переводи»,
 * «с этого момента ты…», служебные метки. «New rules for parking», «ты теперь дома?» и «act
 * as a reference» — живая речь, на ней пометка была бы шумом. \b с кириллицей в JS не
 * работает, поэтому русские шаблоны — без границ слова. По этим же шаблонам реплики собеседника
 * не попадают в историю для модели.
 */
export const COMMAND_PATTERNS: readonly RegExp[] = [
  // EN
  /\b(?:ignore|disregard|forget|override|bypass|skip)\b[^.\n]{0,40}\b(?:instructions?|rules|prompts?|directions|guidelines)\b/i,
  /\b(?:do not|don't|stop)\s+translat/i,
  /\btranslate (?:this|it|the following|everything)\b[^.\n]{0,30}\bas\b/i,
  /\bfrom now on,? you are\b/i,
  /^\s*(?:system|assistant|developer)\s*[:\]]|\[(?:system|inst)\]|<\|im_(?:start|end)\|>|###\s*instruction/im,
  // RU
  /(?:игнорир|забудь|забыть|не обращай внимани)[^.\n]{0,40}(?:инструкц|правил|указани|промпт)/iu,
  /(?:не переводи|хватит переводить|перестань переводить)/iu,
  /с этого момента ты/iu,
  // ES
  /(?:ignora|olvida|omite|descarta|haz caso omiso)[^.\n]{0,40}(?:instrucci|reglas|indicaci)/iu,
  /(?:no traduzcas|deja de traducir)/iu,
  /a partir de ahora eres/iu,
]

export function hasCommandPhrases(text: string): boolean {
  return matchesAny(COMMAND_PATTERNS, text)
}

/**
 * Закладка для модели в истории — список шире, чем для пометки: к явным фразам добавлены
 * «translate … as», «from now on», «new instructions», «you are now». Ошибка здесь дешёвая:
 * модель не увидит одну реплику как контекст, а владелец пометок не получит. Пропущенная же
 * закладка может подменить ответ владельца, который уходит от его имени.
 */
export const PLANTED_PATTERNS: readonly RegExp[] = [
  ...COMMAND_PATTERNS,
  // EN
  /\btranslat\w*\b[^.\n]{0,60}\bas\b/i,
  /\bfrom now on\b/i,
  /\b(?:new|updated|real)\s+(?:instructions?|rules|task|system prompt)\b/i,
  /\b(?:you are now|pretend (?:to be|you are)|act as)\b/i,
  // RU
  /(?:переводи|переведи)[^.\n]{0,60}как/iu,
  /(?:с этого момента|отныне|теперь ты|ты теперь)/iu,
  /(?:новые|новая)\s+(?:инструкц|правил|задач)/iu,
  // ES
  /(?:traduce|traduzcas)[^.\n]{0,60}como/iu,
  /(?:de ahora en adelante|ahora eres|actúa como|finge que eres)/iu,
  /(?:nuevas instrucciones|nueva tarea|nuevas reglas)/iu,
]

export function isPlantedCommand(text: string): boolean {
  return matchesAny(PLANTED_PATTERNS, text)
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
