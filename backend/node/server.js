import 'dotenv/config'
import app from './app.js'
import { closePool } from './config/database.js'

const port = Number(process.env.PORT ?? 3000)
const server = app.listen(port, '127.0.0.1', () => {
  console.info(`API Node/Express ouvindo na porta ${port}.`)
})

async function shutdown(signal) {
  console.info(`Encerrando API (${signal}).`)
  server.close(async (error) => {
    if (error) {
      console.error('Falha ao encerrar o servidor:', error.code ?? 'unknown')
      process.exitCode = 1
    }
    await closePool()
  })
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
