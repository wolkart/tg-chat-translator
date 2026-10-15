import type { Section } from '../screen.ts'
import { ADDRESS } from './address.ts'
import { KEY } from './key.ts'
import { LANGUAGES } from './languages.ts'

/**
 * Реестр разделов панели. Порядок — порядок кнопок на главном экране, по две в ряд.
 * Новый раздел, в том числе платный, — новая строка здесь.
 */
export const SECTIONS: readonly Section[] = [LANGUAGES, ADDRESS, KEY]
