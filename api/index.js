import app from '../backend/node/app.js'

export default function handler(request, response) {
  const requestUrl = new URL(request.url, 'https://vercel.local')
  const path = request.query?.path ?? requestUrl.searchParams.get('path')

  if (path) {
    const segments = (Array.isArray(path) ? path : [path])
      .flatMap((segment) => String(segment).split('/'))
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
    const route = segments.join('/')
    const query = new URLSearchParams(requestUrl.search)
    query.delete('path')
    request.url = `/api/${route}/${query.size ? `?${query}` : ''}`
  }

  return app(request, response)
}
