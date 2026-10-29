import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import milenaPhoto from './assets/milena_img-removebg-preview.png'
import './App.css'

type Screen = 'home' | 'request' | 'lookup' | 'urgency' | 'admin' | 'dashboard'
type RequestResult = { protocol: string; status: string; queue_position?: number }
type RequestStatus = 'waiting' | 'review' | 'in_progress' | 'completed' | 'cancelled'
type ContactStatus = 'not_started' | 'contacted' | 'awaiting_response'
type UrgencyEvaluation = 'pending' | 'confirmed' | 'not_urgent' | 'more_info'
type CallListItem = {
  id: number
  full_name: string
  classroom: string
  received_at: string
  status: RequestStatus
  contact_status: ContactStatus
  queue_position: number
}
type NewRequestNotification = {
  id: number
  full_name: string
  classroom: string
  protocol: string
  received_at: string
}
type UrgencyItem = {
  id: number
  request_id: number
  student_name: string
  classroom: string
  protocol: string
  description: string
  submitted_at: string
  evaluation: UrgencyEvaluation
  evaluated_at: string | null
  reason: string
}
type RequestDetails = {
  id: number
  full_name: string
  classroom: string
  cpf_masked: string
  protocol: string
  status: RequestStatus
  contact_status: 'not_started' | 'contacted' | 'awaiting_response'
  contacted_at: string | null
  contact_note: string
  received_at: string
  history: Array<{ action: string; reason: string; created_at: string }>
}

const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''

async function requestApi<T>(path: string, body: unknown, method: 'POST' | 'PATCH' = 'POST'): Promise<T> {
  await fetch(`${apiBase}/api/csrf/`, { credentials: 'include' })
  const csrfToken = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)?.[1]
  const response = await fetch(`${apiBase}/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRFToken': decodeURIComponent(csrfToken) } : {}) },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.detail ?? payload.error ?? 'Não foi possível concluir agora. Tente novamente mais tarde.')
  return payload as T
}

function validCpf(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) return false
  const check = (length: number) => {
    const sum = digits.slice(0, length).split('').reduce((total, digit, index) => total + Number(digit) * (length + 1 - index), 0)
    const remainder = (sum * 10) % 11
    return (remainder === 10 ? 0 : remainder) === Number(digits[length])
  }
  return check(9) && check(10)
}

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [fullName, setFullName] = useState('')
  const [cpf, setCpf] = useState('')
  const [classroom, setClassroom] = useState('')
  const [protocol, setProtocol] = useState('')
  const [result, setResult] = useState<RequestResult | null>(null)
  const [description, setDescription] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  function navigate(next: Screen) {
    setScreen(next)
    setMessage('')
    setResult(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function submit(event: FormEvent<HTMLFormElement>, action: () => Promise<void>) {
    event.preventDefault()
    setMessage('')
    setBusy(true)
    try { await action() }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Ocorreu um erro. Tente novamente.') }
    finally { setBusy(false) }
  }

  async function createRequest() {
    if (fullName.trim().split(/\s+/).length < 2) throw new Error('Informe seu nome completo.')
    if (!validCpf(cpf)) throw new Error('Confira os números do CPF informado.')
    if (!classroom.trim()) throw new Error('Informe sua turma.')
    const response = await requestApi<{ protocol: string }>('requests/', { full_name: fullName, cpf, classroom })
    setProtocol(response.protocol)
    setResult({ protocol: response.protocol, status: 'Aguardando' })
  }

  async function lookupRequest() {
    if (!protocol.trim()) throw new Error('Informe o protocolo recebido ao registrar a solicitação.')
    if (!validCpf(cpf)) throw new Error('Informe um CPF válido para confirmar sua identidade.')
    const response = await requestApi<RequestResult>('requests/status/', {
      protocol: protocol.trim(),
      cpf,
    })
    setResult(response)
  }

  async function sendUrgency() {
    if (!validCpf(cpf)) throw new Error('Informe o CPF usado na solicitação para confirmar sua identidade.')
    if (description.trim().length < 10) throw new Error('Conte brevemente o que está acontecendo (mínimo de 10 caracteres).')
    await requestApi('requests/urgency/', { protocol: protocol.trim(), cpf, description: description.trim() })
    setMessage('Sua solicitação foi encaminhada para avaliação da psicóloga. Este canal não garante atendimento imediato.')
    setDescription('')
  }

  async function login() {
    const response = await requestApi<{ authenticated: boolean }>('admin/login/', { username, password })
    if (!response.authenticated) throw new Error('Não foi possível entrar. Verifique os dados ou tente mais tarde.')
    setPassword('')
    navigate('dashboard')
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('home')} aria-label="Página inicial">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>Acolhimento</strong><small>Atendimento psicológico escolar</small></span>
        </button>
        <nav aria-label="Navegação principal">
          <button onClick={() => navigate('home')}>Início</button>
          <button onClick={() => navigate('lookup')}>Consultar solicitação</button>
          <button className="nav-admin" onClick={() => navigate('admin')}>Acesso da psicóloga</button>
        </nav>
      </header>

      <main>
        {screen === 'home' && <>
          <section className="hero-section">
            <div className="hero-copy">
              <p className="eyebrow"><span /> Um espaço de escuta na escola</p>
              <h1>Você não precisa<br />ter tudo <em>resolvido.</em></h1>
              <p className="hero-intro">Pedir apoio pode ser um primeiro passo. Este é um espaço reservado para solicitar atendimento psicológico escolar, no seu tempo e sem julgamentos.</p>
              <div className="hero-actions">
                <button className="button button-primary" onClick={() => navigate('request')}>Solicitar atendimento <span aria-hidden="true">↗</span></button>
                <button className="button button-secondary" onClick={() => navigate('lookup')}>Consultar minha solicitação</button>
              </div>
              <p className="queue-note"><span className="note-line" /> Os pedidos são organizados por ordem de recebimento. O envio não garante atendimento imediato nem uma data específica.</p>
            </div>
            <div className="hero-art">
              <img className="psychologist-photo" src={milenaPhoto} alt="Psicóloga Milena, pronta para acolher e orientar" />
              <div className="art-caption"><span>01</span><span>Escuta<br />com cuidado</span></div>
            </div>
          </section>

          <section className="help-strip" aria-labelledby="urgency-title">
            <div className="help-symbol" aria-hidden="true">!</div>
            <div><h2 id="urgency-title">Precisa de ajuda com urgência?</h2><p>Conte o que está acontecendo para que a psicóloga possa avaliar sua solicitação.</p></div>
            <button className="button button-urgent" onClick={() => navigate('urgency')}>Pedir avaliação <span aria-hidden="true">↗</span></button>
          </section>
          <p className="emergency-copy">Este canal não garante atendimento imediato. Se você ou outra pessoa estiver em perigo imediato, procure um adulto de confiança ou um serviço de emergência.</p>

          <section className="info-section" id="como-funciona">
            <div className="section-heading"><p className="eyebrow">Como funciona</p><h2>Um passo de cada vez.</h2></div>
            <div className="steps-grid">
              <article><span>01</span><h3>Você solicita</h3><p>Preencha apenas seu nome, CPF e turma. Não é necessário explicar sua situação nesse primeiro momento.</p></article>
              <article><span>02</span><h3>A psicóloga analisa</h3><p>Os pedidos seguem a ordem de chegada e são considerados conforme a disponibilidade de atendimento.</p></article>
              <article><span>03</span><h3>Você acompanha</h3><p>Guarde seu protocolo. Você poderá consultar o andamento usando também o CPF para confirmar sua identidade.</p></article>
            </div>
          </section>
          <section className="privacy-band"><div className="privacy-mark" aria-hidden="true">⌂</div><div><p className="eyebrow">Privacidade em primeiro lugar</p><h2>Seus dados são tratados com cuidado.</h2><p>As informações da solicitação ficam restritas à profissional autorizada e são usadas para organizar o atendimento. Não compartilhe seu protocolo com outras pessoas.</p></div><button onClick={() => setMessage('A política de privacidade detalhada será publicada após validação pela instituição.')}>Privacidade</button></section>
        </>}

        {screen === 'request' && <section className="form-page"><button className="back-link" onClick={() => navigate('home')}>← Voltar ao início</button>{result ? <div className="success-panel"><span className="success-mark">✓</span><p className="eyebrow">Pedido registrado</p><h1>Obrigado por dar esse passo.</h1><p>Seu pedido foi registrado. As solicitações são organizadas por ordem de recebimento e a psicóloga analisará os pedidos conforme a disponibilidade de atendimento.</p>                <div className="protocol-box"><small>Seu protocolo</small><strong>{result.protocol}</strong></div><p className="form-hint">Guarde este código em um lugar seguro. Para consultar a solicitação, também será necessário confirmar sua identidade.</p><button className="button button-primary" onClick={() => navigate('lookup')}>Consultar solicitação</button></div> : <><p className="eyebrow">Solicitação de atendimento</p><h1>Vamos começar pelo básico.</h1><p className="form-lead">Preencha seus dados para registrar seu pedido. Não escolha data ou horário: a fila segue a ordem de recebimento.</p><form onSubmit={(event) => void submit(event, createRequest)} noValidate>
            <label>Nome completo<input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required /></label>
            <label>CPF<input inputMode="numeric" autoComplete="off" value={cpf} onChange={(event) => setCpf(event.target.value)} placeholder="000.000.000-00" required /></label>
            <label>Turma<input value={classroom} onChange={(event) => setClassroom(event.target.value)} placeholder="Ex.: 2º ano B" required /></label>
            {message && <p className="form-message" role="alert">{message}</p>}
            <button className="button button-primary form-submit" disabled={busy}>{busy ? 'Enviando…' : 'Registrar solicitação'} <span aria-hidden="true">↗</span></button>
          </form><p className="form-hint">Ao enviar, seus dados serão utilizados para organizar o pedido e permitir o acompanhamento pela profissional responsável.</p></>}</section>}

        {screen === 'lookup' && <section className="form-page"><button className="back-link" onClick={() => navigate('home')}>← Voltar ao início</button><p className="eyebrow">Acompanhamento</p><h1>Consulte seu pedido.</h1><p className="form-lead">Informe o protocolo recebido ao solicitar atendimento e o CPF usado no pedido.</p><form onSubmit={(event) => void submit(event, lookupRequest)} noValidate><label>Protocolo<input autoComplete="off" value={protocol} onChange={(event) => setProtocol(event.target.value)} required /></label><label>CPF<input inputMode="numeric" autoComplete="off" value={cpf} onChange={(event) => setCpf(event.target.value)} placeholder="000.000.000-00" required /></label>{message && <p className="form-message" role="alert">{message}</p>}<button className="button button-primary form-submit" disabled={busy}>{busy ? 'Consultando…' : 'Consultar situação'}</button></form>{result && <div className="status-result"><span className="status-dot" /><div><small>Situação atual</small><strong>{result.status}</strong>{result.queue_position && <p>Posição informativa na fila: {result.queue_position}</p>}</div></div>}<button className="inline-link" onClick={() => navigate('urgency')}>Preciso de ajuda com urgência</button></section>}

        {screen === 'urgency' && <section className="form-page urgency-page"><button className="back-link" onClick={() => navigate('home')}>← Voltar ao início</button><p className="eyebrow">Pedido de avaliação</p><h1>Estamos ouvindo.</h1><p className="form-lead">Este canal permite que a psicóloga avalie um pedido de urgência. Envie apenas o necessário; sua mensagem não será exibida na consulta pública.</p><form onSubmit={(event) => void submit(event, sendUrgency)} noValidate><label>Protocolo<input autoComplete="off" value={protocol} onChange={(event) => setProtocol(event.target.value)} required /></label><label>CPF usado na solicitação<input inputMode="numeric" autoComplete="off" value={cpf} onChange={(event) => setCpf(event.target.value)} placeholder="000.000.000-00" required /></label><label>Conte brevemente o que está acontecendo<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} maxLength={2000} required /><small>Compartilhe apenas o que considera necessário. Até 2.000 caracteres.</small></label>{message && <p className={message.startsWith('Sua solicitação') ? 'form-success' : 'form-message'} role="status">{message}</p>}<button className="button button-primary form-submit" disabled={busy}>{busy ? 'Enviando…' : 'Enviar para avaliação'}</button></form><div className="safety-note"><strong>Se houver perigo imediato</strong><p>Este canal não garante atendimento imediato. Se você ou outra pessoa estiver em perigo imediato, procure um adulto de confiança ou um serviço de emergência.</p></div></section>}

        {screen === 'admin' && <section className="form-page"><button className="back-link" onClick={() => navigate('home')}>← Voltar ao início</button><p className="eyebrow">Área restrita</p><h1>Acesso da psicóloga.</h1><p className="form-lead">Entre com as credenciais administrativas fornecidas pela instituição.</p><form onSubmit={(event) => void submit(event, login)} noValidate><label>Usuário ou e-mail<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label><label>Senha<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{message && <p className="form-message" role="alert">{message}</p>}<button className="button button-primary form-submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button></form><p className="form-hint">Não há cadastro público. A conta deve ser criada por procedimento seguro no servidor.</p></section>}

        {screen === 'dashboard' && <AdminDashboard onLogout={() => { void requestApi('admin/logout/', {}).finally(() => navigate('home')) }} />}
      </main>

      <footer className="footer"><button className="brand footer-brand" onClick={() => navigate('home')}><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span><strong>Acolhimento</strong><small>Atendimento psicológico escolar</small></span></button><p>Um espaço de escuta, cuidado e respeito.</p><span>© Atendimento psicológico escolar</span></footer>
    </div>
  )
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [error, setError] = useState('')
  const [items, setItems] = useState<Array<{ id: number; full_name: string; classroom: string; status: RequestStatus; protocol: string; received_at: string; queue_position: number | null }>>([])
  const [callList, setCallList] = useState<CallListItem[]>([])
  const [notifications, setNotifications] = useState<NewRequestNotification[]>([])
  const knownRequestIds = useRef<Set<number> | null>(null)
  const [urgencies, setUrgencies] = useState<UrgencyItem[]>([])
  const [counts, setCounts] = useState<Record<RequestStatus, number>>({ waiting: 0, review: 0, in_progress: 0, completed: 0, cancelled: 0 })
  const [pendingUrgencies, setPendingUrgencies] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [details, setDetails] = useState<RequestDetails | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [detailsTab, setDetailsTab] = useState<'summary' | 'note'>('summary')
  const [noteDraft, setNoteDraft] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteMessage, setNoteMessage] = useState('')
  const [queueMoveId, setQueueMoveId] = useState<number | null>(null)
  const [queuePosition, setQueuePosition] = useState('')
  const [queueReason, setQueueReason] = useState('')
  const [savingQueueOrder, setSavingQueueOrder] = useState(false)
  const [evaluatingUrgencyId, setEvaluatingUrgencyId] = useState<number | null>(null)
  async function load(filters = { query, status: statusFilter }) {
    setLoaded(false)
    try {
      const params = new URLSearchParams()
      if (filters.query.trim()) params.set('q', filters.query.trim())
      if (filters.status) params.set('status', filters.status)
      const suffix = params.size ? `?${params.toString()}` : ''
      const [response, urgencyResponse] = await Promise.all([
        fetch(`${apiBase}/api/admin/dashboard/${suffix}`, { credentials: 'include' }),
        fetch(`${apiBase}/api/admin/urgencies/`, { credentials: 'include' }),
      ])
      const [data, urgencyData] = await Promise.all([
        response.json().catch(() => ({})),
        urgencyResponse.json().catch(() => ({})),
      ])
      if (!response.ok) throw new Error(data.detail ?? 'Sessão expirada ou acesso não autorizado.')
      if (!urgencyResponse.ok) throw new Error(urgencyData.detail ?? 'Não foi possível carregar os pedidos de urgência.')
      setItems(data.requests ?? [])
      setCallList(data.call_list ?? [])
      if (knownRequestIds.current === null) {
        knownRequestIds.current = new Set((data.requests ?? []).map((request: NewRequestNotification) => request.id))
      }
      setUrgencies(urgencyData.urgencies ?? [])
      setCounts({ waiting: 0, review: 0, in_progress: 0, completed: 0, cancelled: 0, ...data.counts })
      setPendingUrgencies(data.pending_urgencies ?? 0)
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os pedidos.') }
    finally { setLoaded(true) }
  }
  async function checkForNewRequests() {
    try {
      const response = await fetch(`${apiBase}/api/admin/dashboard/`, { credentials: 'include' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível verificar novas solicitações.')
      const requests = (data.requests ?? []) as NewRequestNotification[]
      setCallList(data.call_list ?? [])
      const currentIds = new Set(requests.map((request) => request.id))
      if (knownRequestIds.current === null) {
        knownRequestIds.current = currentIds
        return
      }
      const newRequests = requests.filter((request) => !knownRequestIds.current?.has(request.id))
      knownRequestIds.current = new Set([...knownRequestIds.current, ...currentIds])
      if (newRequests.length) {
        setNotifications((current) => [...newRequests, ...current].slice(0, 20))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível verificar novas solicitações.')
    }
  }
  useEffect(() => {
    const task = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(task)
  }, [])
  useEffect(() => {
    const interval = window.setInterval(() => { void checkForNewRequests() }, 30_000)
    return () => window.clearInterval(interval)
  }, [])
  async function updateStatus(id: number, status: RequestStatus) {
    setUpdatingId(id)
    setError('')
    try {
      await requestApi(`admin/requests/${id}/`, { status }, 'PATCH')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o status.')
    } finally {
      setUpdatingId(null)
    }
  }
  async function updateContactStatus(id: number, contact_status: ContactStatus) {
    setUpdatingId(id)
    setError('')
    try {
      await requestApi(`admin/requests/${id}/`, { contact_status }, 'PATCH')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o andamento do contato.')
    } finally {
      setUpdatingId(null)
    }
  }
  async function saveQueuePosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (queueMoveId === null) return
    setSavingQueueOrder(true)
    setError('')
    try {
      await requestApi(`admin/requests/${queueMoveId}/`, {
        queue_position: Number(queuePosition),
        reason: queueReason.trim(),
      }, 'PATCH')
      setQueueMoveId(null)
      setQueueReason('')
      setQueuePosition('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível reorganizar a fila.')
    } finally {
      setSavingQueueOrder(false)
    }
  }
  async function evaluateUrgency(id: number, evaluation: Exclude<UrgencyEvaluation, 'pending'>, reason: string) {
    setEvaluatingUrgencyId(id)
    setError('')
    try {
      await requestApi(`admin/urgencies/${id}/`, { evaluation, reason: reason.trim() }, 'PATCH')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a avaliação de urgência.')
    } finally {
      setEvaluatingUrgencyId(null)
    }
  }
  async function showDetails(id: number) {
    setDetails(null)
    setDetailsError('')
    setDetailsTab('summary')
    setNoteDraft('')
    setNoteMessage('')
    setDetailsLoading(true)
    try {
      const response = await fetch(`${apiBase}/api/admin/requests/${id}/`, { credentials: 'include' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível carregar os detalhes do atendimento.')
      const requestDetails = data as RequestDetails
      setDetails(requestDetails)
      setNoteDraft(requestDetails.contact_note)
    } catch (cause) {
      setDetailsError(cause instanceof Error ? cause.message : 'Não foi possível carregar os detalhes do atendimento.')
    } finally {
      setDetailsLoading(false)
    }
  }
  function closeDetails() {
    setDetails(null)
    setDetailsError('')
    setNoteMessage('')
  }
  async function saveContactNote() {
    if (!details) return
    setNoteSaving(true)
    setDetailsError('')
    setNoteMessage('')
    try {
      await requestApi(`admin/requests/${details.id}/`, { contact_note: noteDraft.trim() }, 'PATCH')
      const response = await fetch(`${apiBase}/api/admin/requests/${details.id}/`, { credentials: 'include' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail ?? 'O texto foi salvo, mas não foi possível atualizar os detalhes.')
      const updatedDetails = data as RequestDetails
      setDetails(updatedDetails)
      setNoteDraft(updatedDetails.contact_note)
      setNoteMessage('Texto salvo nos detalhes do atendimento.')
    } catch (cause) {
      setDetailsError(cause instanceof Error ? cause.message : 'Não foi possível salvar o texto.')
    } finally {
      setNoteSaving(false)
    }
  }
  const statusLabels: Record<RequestStatus, string> = {
    waiting: 'Aguardando',
    review: 'Em análise',
    in_progress: 'Em atendimento',
    completed: 'Concluído',
    cancelled: 'Cancelado',
  }
  const contactStatusLabels: Record<ContactStatus, string> = {
    not_started: 'Não iniciado',
    contacted: 'Contato realizado',
    awaiting_response: 'Aguardando resposta',
  }
  const urgencyEvaluationLabels: Record<UrgencyEvaluation, string> = {
    pending: 'Aguardando avaliação',
    confirmed: 'Urgência confirmada',
    not_urgent: 'Não classificada como urgência',
    more_info: 'Precisa de mais informações',
  }
  return (
    <section className="admin-page">
      <div className="admin-heading">
        <div><p className="eyebrow">Painel da psicóloga</p><h1>Fila de atendimento</h1><p className="form-lead">Acompanhe os pedidos e atualize o andamento dos atendimentos.</p></div>
        <button className="button button-secondary" onClick={onLogout}>Encerrar sessão</button>
      </div>
      {error && <p role="alert" className="form-message">{error}</p>}
      <section className="notification-panel" aria-labelledby="notifications-title">
        <div className="admin-section-title">
          <div><p className="eyebrow">Avisos do sistema</p><h2 id="notifications-title">Notificações</h2></div>
          <span>{notifications.length} {notifications.length === 1 ? 'novo aviso' : 'novos avisos'}</span>
        </div>
        {notifications.length ? <ul>
          {notifications.map((notification) => (
            <li key={notification.id}>
              <span className="notification-indicator" aria-hidden="true" />
              <div><strong>Nova solicitação de {notification.full_name}</strong><span>Turma {notification.classroom} · {notification.protocol} · {new Date(notification.received_at).toLocaleString('pt-BR')}</span></div>
              <button aria-label={`Dispensar aviso de ${notification.full_name}`} onClick={() => setNotifications((current) => current.filter((item) => item.id !== notification.id))}>Dispensar</button>
            </li>
          ))}
        </ul> : <p className="notification-empty">Novos pedidos aparecerão aqui enquanto você estiver conectada ao painel.</p>}
      </section>
      <div className="metrics">
        <div><small>Aguardando</small><strong>{counts.waiting}</strong></div>
        <div><small>Em análise</small><strong>{counts.review}</strong></div>
        <div><small>Em atendimento</small><strong>{counts.in_progress}</strong></div>
        <div><small>Concluídos</small><strong>{counts.completed}</strong></div>
        <div><small>Cancelados</small><strong>{counts.cancelled}</strong></div>
        <div className="urgency-metric"><small>Urgências pendentes</small><strong>{pendingUrgencies}</strong></div>
      </div>
      <section className="call-list-section" aria-labelledby="call-list-title">
        <div className="admin-section-title">
          <div><p className="eyebrow">Ordem de recebimento</p><h2 id="call-list-title">Lista de chamada</h2></div>
          <span>{callList.length} {callList.length === 1 ? 'pessoa na fila' : 'pessoas na fila'}</span>
        </div>
        <p className="call-list-intro">A fila segue a posição de cada solicitação. Quem está no topo é a próxima pessoa a ser chamada.</p>
        {callList.length ? (
          <ol className="call-list">
            {callList.map((item) => (
              <li key={item.id} className={item.queue_position === 1 ? 'call-list-next' : undefined}>
                <span className="call-list-position" aria-label={`Posição ${item.queue_position}`}>{item.queue_position}</span>
                <div className="call-list-person"><strong>{item.full_name}</strong><span>Turma {item.classroom} · Pedido recebido em {new Date(item.received_at).toLocaleString('pt-BR')}</span></div>
                  <div className="call-list-status">
                    <strong>{item.queue_position === 1 ? 'Próximo da fila' : statusLabels[item.status]}</strong>
                    <select aria-label={`Contato de ${item.full_name}`} value={item.contact_status} disabled={updatingId === item.id} onChange={(event) => void updateContactStatus(item.id, event.target.value as ContactStatus)}>
                      {Object.entries(contactStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <button className="details-button" onClick={() => { setQueueMoveId(queueMoveId === item.id ? null : item.id); setQueuePosition(String(item.queue_position)); setQueueReason('') }}>Alterar posição</button>
                  </div>
                  {queueMoveId === item.id && (
                    <form className="queue-reorder-form" onSubmit={(event) => void saveQueuePosition(event)}>
                      <label>Nova posição<select value={queuePosition} onChange={(event) => setQueuePosition(event.target.value)}>{callList.map((entry) => <option key={entry.id} value={entry.queue_position}>{entry.queue_position}</option>)}</select></label>
                      <label>Justificativa<input value={queueReason} maxLength={500} onChange={(event) => setQueueReason(event.target.value)} required placeholder="Informe o motivo da alteração" /></label>
                      <button className="button button-primary" disabled={savingQueueOrder || !queueReason.trim()}>{savingQueueOrder ? 'Salvando…' : 'Salvar posição'}</button>
                    </form>
                  )}
                </li>
            ))}
          </ol>
        ) : <p className="empty-state">{loaded ? 'Não há pessoas aguardando atendimento na fila.' : 'Carregando lista de chamada…'}</p>}
      </section>
      <section className="urgency-section" aria-labelledby="urgency-list-title">
        <div className="admin-section-title">
          <div><p className="eyebrow">Avaliação da psicóloga</p><h2 id="urgency-list-title">Pedidos de urgência</h2></div>
          <span>{urgencies.filter((item) => item.evaluation === 'pending').length} aguardando avaliação</span>
        </div>
        {urgencies.length ? <div className="urgency-list">{urgencies.map((urgency) => (
          <UrgencyReviewCard
            key={urgency.id}
            urgency={urgency}
            evaluationLabels={urgencyEvaluationLabels}
            disabled={evaluatingUrgencyId === urgency.id}
            onEvaluate={evaluateUrgency}
          />
        ))}</div> : <p className="empty-state">{loaded ? 'Nenhum pedido de urgência recebido.' : 'Carregando pedidos de urgência…'}</p>}
      </section>
      <div className="admin-section-title"><h2>Solicitações</h2><button onClick={() => { setError(''); void load() }}>Atualizar fila</button></div>
      <form className="dashboard-filters" onSubmit={(event) => { event.preventDefault(); void load() }}>
        <label>Buscar por nome ou turma<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite para buscar" /></label>
        <label>Filtrar por status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos os status</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="button button-primary" disabled={!loaded}>{loaded ? 'Filtrar' : 'Carregando…'}</button>
      </form>
      {items.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Aluno</th><th>Turma</th><th>Recebido</th><th>Protocolo</th><th>Status</th><th>Posição</th><th>Detalhes</th></tr></thead>
            <tbody>{items.map((item) => (
              <tr key={item.id}>
                <td>{item.full_name}</td>
                <td>{item.classroom}</td>
                <td>{new Date(item.received_at).toLocaleString('pt-BR')}</td>
                <td>{item.protocol}</td>
                <td><select className="status-select" aria-label={`Status de ${item.full_name}`} value={item.status} disabled={updatingId === item.id} onChange={(event) => void updateStatus(item.id, event.target.value as RequestStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                <td>{item.queue_position ?? '—'}</td>
                <td><button className="details-button" onClick={() => void showDetails(item.id)}>Ver detalhes</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="empty-state">{loaded && !error ? 'Nenhuma solicitação encontrada.' : 'Carregando solicitações…'}</p>}
      {(detailsLoading || detailsError || details) && (
        <div className="details-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetails() }}>
          <section className="details-dialog" role="dialog" aria-modal="true" aria-labelledby="details-title">
            <div className="details-heading">
              <div><p className="eyebrow">Solicitação de atendimento</p><h2 id="details-title">Detalhes do atendimento</h2></div>
              <button className="details-close" aria-label="Fechar detalhes" onClick={closeDetails}>×</button>
            </div>
            {detailsLoading && <p className="empty-state">Carregando detalhes…</p>}
            {detailsError && <p role="alert" className="form-message">{detailsError}</p>}
            {details && <>
              <div className="details-tabs" role="tablist" aria-label="Seções dos detalhes do atendimento">
                <button id="details-summary-tab" role="tab" aria-selected={detailsTab === 'summary'} aria-controls="details-summary-panel" onClick={() => setDetailsTab('summary')}>Resumo</button>
                <button id="details-note-tab" role="tab" aria-selected={detailsTab === 'note'} aria-controls="details-note-panel" onClick={() => { setDetailsTab('note'); setNoteMessage(''); setDetailsError('') }}>Adicionar texto</button>
              </div>
              {detailsTab === 'summary' ? (
                <div id="details-summary-panel" role="tabpanel" aria-labelledby="details-summary-tab">
                  <dl className="details-grid">
                    <div><dt>Aluno</dt><dd>{details.full_name}</dd></div>
                    <div><dt>Turma</dt><dd>{details.classroom}</dd></div>
                    <div><dt>CPF</dt><dd>{details.cpf_masked}</dd></div>
                    <div><dt>Protocolo</dt><dd>{details.protocol}</dd></div>
                    <div><dt>Status</dt><dd>{statusLabels[details.status]}</dd></div>
                    <div><dt>Solicitado em</dt><dd>{new Date(details.received_at).toLocaleString('pt-BR')}</dd></div>
                    <div><dt>Situação do contato</dt><dd>{{ not_started: 'Não iniciado', contacted: 'Contato realizado', awaiting_response: 'Aguardando resposta' }[details.contact_status]}</dd></div>
                    {details.contacted_at && <div><dt>Contato realizado em</dt><dd>{new Date(details.contacted_at).toLocaleString('pt-BR')}</dd></div>}
                    <div className="details-wide"><dt>Texto do atendimento</dt><dd>{details.contact_note || 'Nenhum texto registrado.'}</dd></div>
                  </dl>
                  <div className="details-history">
                    <h3>Histórico</h3>
                    {details.history.length ? <ul>{details.history.map((entry, index) => (
                      <li key={`${entry.action}-${entry.created_at}-${index}`}>
                        <strong>{{ request_created: 'Solicitação registrada', request_updated: 'Atendimento atualizado', queue_reordered: 'Posição na fila alterada', urgency_submitted: 'Pedido de urgência enviado', urgency_evaluated: 'Urgência avaliada' }[entry.action] ?? 'Atualização'}</strong>
                        <time>{new Date(entry.created_at).toLocaleString('pt-BR')}</time>
                        {entry.reason && <p>{entry.reason}</p>}
                      </li>
                    ))}</ul> : <p>Nenhuma atualização registrada.</p>}
                  </div>
                </div>
              ) : (
                <div id="details-note-panel" role="tabpanel" aria-labelledby="details-note-tab" className="details-note-panel">
                  <label htmlFor="contact-note">Texto ou observação do atendimento</label>
                  <textarea id="contact-note" value={noteDraft} maxLength={500} rows={6} onChange={(event) => { setNoteDraft(event.target.value); setNoteMessage('') }} placeholder="Escreva uma observação interna para este atendimento…" />
                  <small>Este texto fica visível apenas na área restrita. Máximo de 500 caracteres.</small>
                  {noteMessage && <p className="form-success" role="status">{noteMessage}</p>}
                  <button className="button button-primary" disabled={noteSaving} onClick={() => void saveContactNote()}>{noteSaving ? 'Salvando…' : 'Salvar texto'}</button>
                </div>
              )}
            </>}
          </section>
        </div>
      )}
    </section>
  )
}

function UrgencyReviewCard({
  urgency,
  evaluationLabels,
  disabled,
  onEvaluate,
}: {
  urgency: UrgencyItem
  evaluationLabels: Record<UrgencyEvaluation, string>
  disabled: boolean
  onEvaluate: (id: number, evaluation: Exclude<UrgencyEvaluation, 'pending'>, reason: string) => Promise<void>
}) {
  const [evaluation, setEvaluation] = useState<Exclude<UrgencyEvaluation, 'pending'>>(
    urgency.evaluation === 'pending' ? 'confirmed' : urgency.evaluation,
  )
  const [reason, setReason] = useState(urgency.reason)
  return (
    <article className="urgency-card">
      <div className="urgency-card-heading">
        <div><strong>{urgency.student_name}</strong><span>Turma {urgency.classroom} · {urgency.protocol}</span></div>
        <span className={urgency.evaluation === 'pending' ? 'urgency-state-pending' : 'urgency-state-reviewed'}>{evaluationLabels[urgency.evaluation]}</span>
      </div>
      <p className="urgency-card-date">Recebido em {new Date(urgency.submitted_at).toLocaleString('pt-BR')}</p>
      <p className="urgency-card-description">{urgency.description}</p>
      <form className="urgency-review-form" onSubmit={(event) => { event.preventDefault(); void onEvaluate(urgency.id, evaluation, reason) }}>
        <label>Avaliação<select value={evaluation} onChange={(event) => setEvaluation(event.target.value as Exclude<UrgencyEvaluation, 'pending'>)}>
          <option value="confirmed">{evaluationLabels.confirmed}</option>
          <option value="not_urgent">{evaluationLabels.not_urgent}</option>
          <option value="more_info">{evaluationLabels.more_info}</option>
        </select></label>
        <label>Observação ou encaminhamento<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Opcional" /></label>
        <button className="button button-primary" disabled={disabled}>{disabled ? 'Salvando…' : 'Salvar avaliação'}</button>
      </form>
    </article>
  )
}

export default App
