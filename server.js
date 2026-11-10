import app from './server/app.js'
import { closePool } from './server/config/database.js'

const port = Number(process.env.PORT ?? 3000)
const server = app.listen(port, () => {
  console.info(JSON.stringify({ event: 'api_listening', port }))
})

async function shutdown(signal) {
  console.info(JSON.stringify({ event: 'api_shutdown', signal }))
  server.close(async () => {
    await closePool()
    process.exit(0)
  })
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
