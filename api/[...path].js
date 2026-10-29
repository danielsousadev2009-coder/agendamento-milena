const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'content-type',
  'cookie',
  'origin',
  'referer',
  'user-agent',
  'x-csrftoken',
]

const FORWARDED_RESPONSE_HEADERS = [
  'content-disposition',
  'content-type',
  'location',
  'retry-after',
]

export default async function handler(request, response) {
  const backendUrl = process.env.BACKEND_URL
  if (!backendUrl) {
    response.status(500).json({ detail: 'A variável BACKEND_URL não está configurada.' })
    return
  }

  let upstreamUrl
  try {
    upstreamUrl = new URL(backendUrl)
  } catch (error) {
    console.error('BACKEND_URL inválida:', error)
    response.status(500).json({ detail: 'A variável BACKEND_URL não contém uma URL válida.' })
    return
  }

  if (upstreamUrl.protocol !== 'https:') {
    response.status(500).json({ detail: 'BACKEND_URL deve usar HTTPS.' })
    return
  }

  const path = request.query.path
  const pathSegments = Array.isArray(path) ? path : path ? [path] : []
  const requestUrl = new URL(request.url, 'https://vercel.local')
  const trailingSlash = requestUrl.pathname.endsWith('/')
  const targetUrl = new URL(
    `/api/${pathSegments.map((segment) => encodeURIComponent(segment)).join('/')}${trailingSlash ? '/' : ''}`,
    upstreamUrl,
  )
  targetUrl.search = requestUrl.search

  const headers = new Headers()
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers[name]
    if (typeof value === 'string') headers.set(name, value)
  }

  let body
  if (!['GET', 'HEAD'].includes(request.method)) {
    if (Buffer.isBuffer(request.body) || typeof request.body === 'string') {
      body = request.body
    } else if (request.body !== undefined) {
      body = JSON.stringify(request.body)
    }
  }

  try {
    const upstreamResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
    })

    response.status(upstreamResponse.status)
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstreamResponse.headers.get(name)
      if (value) response.setHeader(name, value)
    }

    const cookies = upstreamResponse.headers.getSetCookie()
    if (cookies.length) response.setHeader('set-cookie', cookies)
    response.setHeader('cache-control', 'no-store')

    const payload = Buffer.from(await upstreamResponse.arrayBuffer())
    response.send(payload)
  } catch (error) {
    console.error('Falha ao encaminhar solicitação à API:', error)
    response.status(502).json({ detail: 'Não foi possível conectar à API do sistema.' })
  }
}
