import { chmodSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

/**
 * Копия базы перед удалением. VACUUM INTO даёт целую копию, даже пока бот работает и пишет
 * в базу, а отдельный sqlite3 не нужен — на Windows его нет. Чужой файл не перезаписываем:
 * там может лежать прошлая копия.
 */
export function backupDatabase(dbPath: string, outPath: string): void {
  if (existsSync(outPath)) throw new Error(`Файл ${outPath} уже есть — копию поверх не пишу`)
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    db.prepare('VACUUM INTO ?').run(outPath)
  } finally {
    db.close()
  }
  // В копии ключ модели — права как у .env.
  chmodSync(outPath, 0o600)
}

// node src/install/backup.ts <куда> [база] — так её зовут скрипты удаления.
if (import.meta.main) {
  const [outPath, dbPath = 'data/translator.db'] = process.argv.slice(2)
  if (!outPath) {
    console.error('Куда сохранить копию? node src/install/backup.ts <файл> [база]')
    process.exit(1)
  }
  if (!existsSync(dbPath)) {
    console.error(`Базы нет: ${dbPath}`)
    process.exit(1)
  }
  try {
    backupDatabase(dbPath, outPath)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
