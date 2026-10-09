/** Письменности, которые различает проверка языка. */
export type Script =
  | 'Cyrillic'
  | 'Latin'
  | 'Han'
  | 'Hiragana'
  | 'Katakana'
  | 'Hangul'
  | 'Arabic'
  | 'Hebrew'
  | 'Devanagari'
  | 'Thai'
  | 'Georgian'
  | 'Armenian'

/**
 * Профиль языка — данные, а не ветки в коде: новый язык добавляется строкой.
 * letters — алфавит в нижнем регистре. Пустая строка — у языка своя письменность,
 * и проверять отдельные буквы не нужно: хватает письменности.
 */
export type LangProfile = {
  code: string
  /** Название для инструкции модели */
  name: string
  /** Название для владельца */
  nameRu: string
  scripts: readonly Script[]
  letters: string
}

const EN = 'abcdefghijklmnopqrstuvwxyz'
const RU = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'

// Болгарского нет намеренно: от русского его по буквам не отличить.
export const PROFILES: readonly LangProfile[] = [
  { code: 'ru', name: 'Russian', nameRu: 'русский', scripts: ['Cyrillic'], letters: RU },
  { code: 'uk', name: 'Ukrainian', nameRu: 'украинский', scripts: ['Cyrillic'], letters: 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя' },
  { code: 'be', name: 'Belarusian', nameRu: 'белорусский', scripts: ['Cyrillic'], letters: 'абвгдеёжзійклмнопрстуўфхцчшыьэюя' },
  { code: 'kk', name: 'Kazakh', nameRu: 'казахский', scripts: ['Cyrillic'], letters: RU + 'әғқңөұүһі' },
  { code: 'sr', name: 'Serbian', nameRu: 'сербский', scripts: ['Cyrillic'], letters: 'абвгдђежзијклљмнњопрстћуфхцчџш' },
  { code: 'en', name: 'English', nameRu: 'английский', scripts: ['Latin'], letters: EN },
  { code: 'de', name: 'German', nameRu: 'немецкий', scripts: ['Latin'], letters: EN + 'äöüß' },
  { code: 'fr', name: 'French', nameRu: 'французский', scripts: ['Latin'], letters: EN + 'àâæçéèêëîïôœùûüÿ' },
  { code: 'es', name: 'Spanish', nameRu: 'испанский', scripts: ['Latin'], letters: EN + 'áéíñóúü' },
  { code: 'pt', name: 'Portuguese', nameRu: 'португальский', scripts: ['Latin'], letters: EN + 'áâãàçéêíóôõú' },
  { code: 'it', name: 'Italian', nameRu: 'итальянский', scripts: ['Latin'], letters: EN + 'àèéìíîòóùú' },
  { code: 'pl', name: 'Polish', nameRu: 'польский', scripts: ['Latin'], letters: EN + 'ąćęłńóśźż' },
  { code: 'tr', name: 'Turkish', nameRu: 'турецкий', scripts: ['Latin'], letters: EN + 'çğıöşü' },
  {
    code: 'vi',
    name: 'Vietnamese',
    nameRu: 'вьетнамский',
    scripts: ['Latin'],
    letters: EN + 'ăâđêôơư' + 'àáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ',
  },
  { code: 'zh', name: 'Chinese', nameRu: 'китайский', scripts: ['Han'], letters: '' },
  { code: 'ja', name: 'Japanese', nameRu: 'японский', scripts: ['Han', 'Hiragana', 'Katakana'], letters: '' },
  { code: 'ko', name: 'Korean', nameRu: 'корейский', scripts: ['Hangul'], letters: '' },
  { code: 'ar', name: 'Arabic', nameRu: 'арабский', scripts: ['Arabic'], letters: '' },
  { code: 'he', name: 'Hebrew', nameRu: 'иврит', scripts: ['Hebrew'], letters: '' },
  { code: 'hi', name: 'Hindi', nameRu: 'хинди', scripts: ['Devanagari'], letters: '' },
  { code: 'th', name: 'Thai', nameRu: 'тайский', scripts: ['Thai'], letters: '' },
  { code: 'ka', name: 'Georgian', nameRu: 'грузинский', scripts: ['Georgian'], letters: '' },
  { code: 'hy', name: 'Armenian', nameRu: 'армянский', scripts: ['Armenian'], letters: '' },
]

export function getProfile(code: string): LangProfile | undefined {
  return PROFILES.find((profile) => profile.code === code)
}

export type LanguagePair = { owner: LangProfile; peer: LangProfile }

/**
 * Пара языков из настроек. Язык без профиля не принимается: проверка не сможет
 * отличить язык владельца от чужого, а модели нечего будет назвать в инструкции.
 */
export function resolvePair(
  ownerCode: string,
  peerCode: string,
): { ok: true; pair: LanguagePair } | { ok: false; problem: string } {
  const owner = getProfile(ownerCode)
  const peer = getProfile(peerCode)
  if (owner && peer) return { ok: true, pair: { owner, peer } }

  const unknown = [!owner && `ваш язык «${ownerCode}»`, !peer && `язык собеседника «${peerCode}»`].filter(Boolean)
  const available = PROFILES.map((profile) => `${profile.code} — ${profile.nameRu}`).join(', ')
  return {
    ok: false,
    problem:
      `Не поддерживается ${unknown.join(' и ')}, поэтому новые разговоры не заводятся. ` +
      `Доступны: ${available}.`,
  }
}
