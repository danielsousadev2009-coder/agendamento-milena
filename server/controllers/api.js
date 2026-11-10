import { authenticatePsychologist, clearAccessCookie, setAccessCookie, setCsrfCookie, revokeSession } from '../services/auth.js'
import {
  createRequest,
  createUrgency,
  evaluateUrgency,
  getDashboard,
  getRequestDetails,
  getRequestStatus,
  getUrgencies,
  getUrgencyHistory,
  updateRequest,
} from '../services/requests.js'
import {
  validatePrivateIdentity,
  validateRequestCreate,
  validateRequestUpdate,
  validateUrgencyCreate,
  validateUrgencyEvaluation,
} from '../validators/api.js'

function getValidated(response, result) {
  if (result.errors) {
    response.status(400).json(result.errors)
    return null
  }
  return result.values
}

function parseId(value) {
  if (!/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function healthCheck(_request, response) {
  response.json({ status: 'ok' })
}

export function csrfToken(_request, response) {
  setCsrfCookie(response)
  response.json({ detail: 'CSRF cookie set.' })
}

export async function requestCreate(request, response) {
  const data = getValidated(response, validateRequestCreate(request.body))
  if (!data) return
  const created = await createRequest(data)
  response.status(201).json({ protocol: created.protocol, status: created.status })
}

export async function requestStatus(request, response) {
  const data = getValidated(response, validatePrivateIdentity(request.body))
  if (!data) return
  const result = await getRequestStatus(data.protocol, data.cpf)
  if (!result) {
    response.status(404).json({ detail: 'Não encontramos uma solicitação com esses dados.' })
    return
  }
  response.json(result)
}

export async function urgencyCreate(request, response) {
  const data = getValidated(response, validateUrgencyCreate(request.body))
  if (!data) return
  const urgency = await createUrgency(data.protocol, data.cpf, data.description)
  if (!urgency) {
    response.status(404).json({ detail: 'Não foi possível vincular o pedido. Confira o protocolo e o CPF.' })
    return
  }
  response.status(201).json({ received: true, evaluation: urgency.evaluation })
}

export async function adminLogin(request, response) {
  const username = String(request.body?.username ?? '').slice(0, 150)
  const password = String(request.body?.password ?? '')
  const authenticated = await authenticatePsychologist(username, password)
  if (!authenticated) {
    response.status(400).json({ detail: 'Não foi possível entrar. Confira os dados ou tente mais tarde.' })
    return
  }
  setAccessCookie(response, authenticated.token)
  response.json({ authenticated: true })
}

export async function adminLogout(request, response) {
  await revokeSession(request.user.sessionKey)
  clearAccessCookie(response)
  response.status(204).end()
}

export async function adminDashboard(request, response) {
  response.json(await getDashboard({
    q: String(request.query.q ?? ''),
    classroom: String(request.query.classroom ?? ''),
    status: String(request.query.status ?? ''),
  }))
}

export async function adminRequestDetails(request, response) {
  const id = parseId(request.params.id)
  const details = id ? await getRequestDetails(id) : null
  if (!details) {
    response.status(404).json({ detail: 'Solicitação não encontrada.' })
    return
  }
  response.json(details)
}

export async function adminRequestUpdate(request, response) {
  const id = parseId(request.params.id)
  if (!id) {
    response.status(404).json({ detail: 'Solicitação não encontrada.' })
    return
  }
  const data = getValidated(response, validateRequestUpdate(request.body))
  if (!data) return
  if (Object.hasOwn(data, 'queue_position') && !data.reason?.trim()) {
    response.status(400).json({ detail: 'Informe uma justificativa para alterar a ordem da fila.' })
    return
  }
  try {
    const updated = await updateRequest(id, data, request.user.id)
    if (!updated) {
      response.status(404).json({ detail: 'Solicitação não encontrada.' })
      return
    }
  } catch (error) {
    if (error.message === 'A posição informada não está disponível na fila ativa.') {
      response.status(400).json({ detail: error.message })
      return
    }
    throw error
  }
  response.json({ updated: true })
}

export async function adminUrgencyList(request, response) {
  response.json(await getUrgencies(String(request.query.evaluation ?? '')))
}

export async function adminUrgencyUpdate(request, response) {
  const id = parseId(request.params.id)
  if (!id) {
    response.status(404).json({ detail: 'Solicitação de urgência não encontrada.' })
    return
  }
  const data = getValidated(response, validateUrgencyEvaluation(request.body))
  if (!data) return
  const updated = await evaluateUrgency(id, data.evaluation, data.reason, request.user.id)
  if (!updated) {
    response.status(404).json({ detail: 'Solicitação de urgência não encontrada.' })
    return
  }
  response.json({ updated: true })
}

export async function adminUrgencyHistory(request, response) {
  const id = parseId(request.params.id)
  const history = id ? await getUrgencyHistory(id) : null
  if (!history) {
    response.status(404).json({ detail: 'Histórico não encontrado.' })
    return
  }
  response.json(history)
}
