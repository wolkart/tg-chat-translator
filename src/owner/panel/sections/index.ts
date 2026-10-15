import type { Section } from '../screen.ts'
import { ADDRESS } from './address.ts'
import { BALANCE } from './balance.ts'
import { KEY } from './key.ts'
import { LANGUAGES } from './languages.ts'
import { MODEL } from './model.ts'

/**
 * Реестр разделов панели. Порядок — порядок кнопок на главном экране, по две в ряд.
 * Новый раздел, в том числе платный, — новая строка здесь.
 */
export const SECTIONS: readonly Section[] = [LANGUAGES, ADDRESS, MODEL, KEY, BALANCE]
