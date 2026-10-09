import { loadEnv } from './env.ts'

const result = loadEnv()
if (!result.ok) {
  console.error(
    `\nНе заполнены обязательные переменные в .env:\n` +
      result.missing.map((name) => `  - ${name}`).join('\n') +
      `\n\nСкопируйте .env.example в .env и заполните.\n`,
  )
  process.exit(1)
}

// Подключение к Telegram появится в задаче 14 («Запуск»); пока проверяем только настройки.
console.log('Настройки прочитаны.')
