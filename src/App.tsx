import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type Screen = 'home' | 'request' | 'lookup' | 'urgency' | 'admin' | 'dashboard'
type RequestResult = { protocol: string; status: string; queue_position?: number }

const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''

async function requestApi<T>(path: string, body: unknown): Promise<T> {
  await fetch(`${apiBase}/api/csrf/`, { credentials: 'include' })
  const csrfToken = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)?.[1]
  const response = await fetch(`${apiBase}/api/${path}`, {
    method: 'POST',
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
    if (!validCpf(cpf)) throw new Error('Informe um CPF válido para confirmar sua identidade.')
    const response = await requestApi<RequestResult>('requests/status/', { protocol: protocol.trim(), cpf })
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
            <div className="hero-art" aria-label="Ilustração abstrata de formas orgânicas em diálogo" role="img">
              <div className="art-sun" /><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
              <div className="art-leaf leaf-one" /><div className="art-leaf leaf-two" />
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

        {screen === 'request' && <section className="form-page"><button className="back-link" onClick={() => navigate('home')}>← Voltar ao início</button>{result ? <div className="success-panel"><span className="success-mark">✓</span><p className="eyebrow">Pedido registrado</p><h1>Obrigado por dar esse passo.</h1><p>Seu pedido foi registrado. As solicitações são organizadas por ordem de recebimento e a psicóloga analisará os pedidos conforme a disponibilidade de atendimento.</p><div className="protocol-box"><small>Seu protocolo</small><strong>{result.protocol}</strong></div><p className="form-hint">Guarde este código em um lugar seguro. Para consultar a solicitação, também será necessário confirmar sua identidade.</p><button className="button button-primary" onClick={() => navigate('lookup')}>Consultar solicitação</button></div> : <><p className="eyebrow">Solicitação de atendimento</p><h1>Vamos começar pelo básico.</h1><p className="form-lead">Preencha seus dados para registrar seu pedido. Não escolha data ou horário: a fila segue a ordem de recebimento.</p><form onSubmit={(event) => void submit(event, createRequest)} noValidate>
            <label>Nome completo<input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required /></label>
            <label>CPF<input inputMode="numeric" autoComplete="off" value={cpf} onChange={(event) => setCpf(event.target.value)} placeholder="000.000.000-00" required /></label>
            <label>Turma<input value={classroom} onChange={(event) => setClassroom(event.target.value)} placeholder="Ex.: 2º ano B" required /></label>
            {message && <p className="form-message" role="alert">{message}</p>}
            <button className="button button-primary form-submit" disabled={busy}>{busy ? 'Enviando…' : 'Registrar solicitação'} <span aria-hidden="true">↗</span></button>
          </form><p className="form-hint">Ao enviar, seus dados serão utilizados para organizar o pedido e permitir o acompanhamento pela profissional responsável.</p></>}</section>}

        {screen === 'lookup' && <section className="form-page"><button className="back-link" onClick={() => navigate('home')}>← Voltar ao início</button><p className="eyebrow">Acompanhamento</p><h1>Consulte seu pedido.</h1><p className="form-lead">Para proteger suas informações, precisamos do protocolo e do CPF informado na solicitação.</p><form onSubmit={(event) => void submit(event, lookupRequest)} noValidate><label>Protocolo<input autoComplete="off" value={protocol} onChange={(event) => setProtocol(event.target.value)} required /></label><label>CPF<input inputMode="numeric" autoComplete="off" value={cpf} onChange={(event) => setCpf(event.target.value)} placeholder="000.000.000-00" required /></label>{message && <p className="form-message" role="alert">{message}</p>}<button className="button button-primary form-submit" disabled={busy}>{busy ? 'Consultando…' : 'Consultar situação'}</button></form>{result && <div className="status-result"><span className="status-dot" /><div><small>Situação atual</small><strong>{result.status}</strong>{result.queue_position && <p>Posição informativa na fila: {result.queue_position}</p>}</div></div>}<button className="inline-link" onClick={() => navigate('urgency')}>Preciso de ajuda com urgência</button></section>}

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
  const [items, setItems] = useState<Array<{ id: number; full_name: string; classroom: string; status: string; protocol: string; received_at: string; queue_position: number | null }>>([])
  const [loaded, setLoaded] = useState(false)
  async function load() {
    setLoaded(false)
    try {
      const response = await fetch(`${apiBase}/api/admin/dashboard/`, { credentials: 'include' })
      if (!response.ok) throw new Error('Sessão expirada ou acesso não autorizado.')
      const data = await response.json()
      setItems(data.requests ?? [])
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os pedidos.') }
    finally { setLoaded(true) }
  }
  useEffect(() => {
    const task = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(task)
  }, [])
  const count = (status: string) => items.filter((item) => item.status === status).length
  return <section className="admin-page"><div className="admin-heading"><div><p className="eyebrow">Painel da psicóloga</p><h1>Fila de atendimento</h1></div><button className="button button-secondary" onClick={onLogout}>Encerrar sessão</button></div>{error && <p role="alert" className="form-message">{error}</p>}<div className="metrics"><div><small>Aguardando</small><strong>{count('waiting')}</strong></div><div><small>Em análise</small><strong>{count('review')}</strong></div><div><small>Em atendimento</small><strong>{count('in_progress')}</strong></div><div><small>Concluídos</small><strong>{count('completed')}</strong></div><div><small>Cancelados</small><strong>{count('cancelled')}</strong></div></div><div className="admin-section-title"><h2>Solicitações</h2><button onClick={() => { setError(''); void load() }}>Atualizar</button></div>{items.length ? <div className="table-wrap"><table><thead><tr><th>Aluno</th><th>Turma</th><th>Recebido</th><th>Protocolo</th><th>Status</th><th>Posição</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.full_name}</td><td>{item.classroom}</td><td>{new Date(item.received_at).toLocaleString('pt-BR')}</td><td>{item.protocol}</td><td>{item.status}</td><td>{item.queue_position ?? '—'}</td></tr>)}</tbody></table></div> : <p className="empty-state">{loaded && !error ? 'Nenhuma solicitação na fila.' : 'Carregando solicitações…'}</p>}</section>
}

export default App
