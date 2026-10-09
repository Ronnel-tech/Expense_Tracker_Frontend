import { useEffect, useMemo, useRef, useState } from 'react'
import { createApiClient, sessionStorageApi } from './api'

const categories = [
  'general',
  'food',
  'transport',
  'bills',
  'shopping',
  'health',
  'entertainment',
  'education',
  'travel',
  'other',
]

const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://expense-tracker-lavalust-api.onrender.com'
const apiHostLabel = apiBaseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')

const backendEndpoints = [
  'POST /api/register',
  'POST /api/login',
  'POST /api/refresh',
  'GET /api/expenses',
  'GET /api/expenses/summary',
  'POST /api/expenses',
  'PUT /api/expenses/{id}',
  'DELETE /api/expenses/{id}',
]

const pad = (value) => String(value).padStart(2, '0')

const getLocalDateTimeValue = (date = new Date()) => (
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
)

const formatMoney = (value) => {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

const toInputDateTime = (value) => {
  if (!value) {
    return ''
  }

  return String(value).replace(' ', 'T').slice(0, 16)
}

const toBackendDateTime = (value) => {
  if (!value) {
    return ''
  }

  if (value.includes(' ')) {
    return value
  }

  return `${value.replace('T', ' ')}:00`
}

const formatDateTime = (value) => {
  if (!value) {
    return '—'
  }

  const date = new Date(String(value).replace(' ', 'T'))

  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const normalizeFiltersForApi = (nextFilters) => ({
  category: nextFilters.category || '',
  start_date: nextFilters.start_date ? `${nextFilters.start_date} 00:00:00` : '',
  end_date: nextFilters.end_date ? `${nextFilters.end_date} 23:59:59` : '',
})

const defaultForm = {
  description: '',
  amount: '',
  category: 'general',
  date: getLocalDateTimeValue(),
}

const defaultAuthForm = {
  username: '',
  email: '',
  password: '',
}

function App() {
  const [session, setSessionState] = useState(() => sessionStorageApi.read())
  const sessionRef = useRef(session)
  const [mode, setMode] = useState('login')
  const [authForm, setAuthForm] = useState(defaultAuthForm)
  const [form, setForm] = useState(defaultForm)
  const [expenses, setExpenses] = useState([])
  const [summary, setSummary] = useState([])
  const [totalAmount, setTotalAmount] = useState(0)
  const [filters, setFilters] = useState({
    category: '',
    start_date: '',
    end_date: '',
  })
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const updateSession = (nextSession) => {
    sessionRef.current = nextSession
    setSessionState(nextSession)
    sessionStorageApi.write(nextSession)
  }

  const clearSession = () => {
    sessionRef.current = null
    setSessionState(null)
    sessionStorageApi.clear()
  }

  const api = useMemo(() => createApiClient({
    baseUrl: apiBaseUrl,
    getSession: () => sessionRef.current,
    setSession: updateSession,
    clearSession,
  }), [])

  const totals = useMemo(() => {
    const count = expenses.length

    return {
      total: totalAmount,
      count,
      categories: summary.length,
    }
  }, [expenses.length, summary.length, totalAmount])

  const filteredExpenses = useMemo(() => {
    const query = search.trim().toLowerCase()

    return expenses.filter((expense) => {
      if (!query) {
        return true
      }

      return [
        expense.description,
        expense.category,
        expense.amount,
        expense.date,
      ].some((value) => String(value || '').toLowerCase().includes(query))
    })
  }, [expenses, search])

  const loadDashboard = async (nextFilters = filters) => {
    if (!sessionRef.current?.accessToken) {
      return
    }

    setLoading(true)
    setError('')
    const apiFilters = normalizeFiltersForApi(nextFilters)

    try {
      const [expensesResponse, summaryResponse] = await Promise.all([
        api.loadExpenses(apiFilters),
        api.loadSummary(apiFilters),
      ])

      setExpenses(expensesResponse?.expenses || [])
      setSummary(summaryResponse?.summary || [])
      setTotalAmount(Number(summaryResponse?.total_amount || 0))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAuthSubmit = async (event) => {
    event.preventDefault()
    setAuthLoading(true)
    setError('')
    setInfo('')

    try {
      if (mode === 'login') {
        const response = await api.login(authForm.username, authForm.password)
        if (!response || !response.tokens) {
          throw new Error(response?.message || 'Login failed: no tokens returned by the server.')
        }
        const nextSession = {
          accessToken: response.tokens?.access_token || response.access_token,
          refreshToken: response.tokens?.refresh_token || response.refresh_token,
          user: response.user || { username: authForm.username },
        }
        updateSession(nextSession)
      } else {
        const response = await api.register(authForm.username, authForm.email, authForm.password)
        if (response?.tokens?.access_token) {
          const nextSession = {
            accessToken: response.tokens.access_token,
            refreshToken: response.tokens.refresh_token,
            user: {
              id: response.user_id,
              username: authForm.username,
              role: 'user',
            },
          }
          updateSession(nextSession)
        } else {
          // If register succeeded in DB but did not return tokens (e.g. backend requires login or refresh table missing)
          setInfo(response?.message || 'Registration successful! Please log in with your credentials.')
          setMode('login')
          setAuthForm({
            username: authForm.username,
            email: '',
            password: '',
          })
          return
        }
      }

      setAuthForm(defaultAuthForm)
      setForm({
        ...defaultForm,
        date: getLocalDateTimeValue(),
      })
    } catch (requestError) {
      setError(requestError.message || 'Authentication failed.')
    } finally {
      setAuthLoading(false)
    }
  }

  useEffect(() => {
    if (sessionRef.current?.accessToken) {
      loadDashboard(filters)
    } else {
      setExpenses([])
      setSummary([])
      setTotalAmount(0)
      setEditingId(null)
      setForm({
        ...defaultForm,
        date: getLocalDateTimeValue(),
      })
    }
  }, [session])

  const handleLogout = () => {
    clearSession()
    setError('')
    setInfo('')
    setAuthForm(defaultAuthForm)
    setSearch('')
    setExpenses([])
    setSummary([])
    setTotalAmount(0)
    setFilters({
      category: '',
      start_date: '',
      end_date: '',
    })
    setForm({
      ...defaultForm,
      date: getLocalDateTimeValue(),
    })
  }

  const handleExpenseSubmit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')

    const payload = {
      description: form.description.trim(),
      amount: Number(form.amount),
      category: form.category || 'general',
      date: toBackendDateTime(form.date),
    }

    try {
      if (editingId) {
        await api.updateExpense(editingId, payload)
      } else {
        await api.createExpense(payload)
      }

      setForm({
        ...defaultForm,
        date: getLocalDateTimeValue(),
      })
      setEditingId(null)
      await loadDashboard(filters)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (expense) => {
    setEditingId(expense.id)
    setForm({
      description: expense.description || '',
      amount: expense.amount || '',
      category: expense.category || 'general',
      date: toInputDateTime(expense.date),
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this expense?')) {
      return
    }

    setError('')

    try {
      await api.deleteExpense(id)
      await loadDashboard(filters)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const applyFilters = async (event) => {
    event.preventDefault()
    await loadDashboard(filters)
  }

  const resetFilters = async () => {
    const cleared = {
      category: '',
      start_date: '',
      end_date: '',
    }

    setFilters(cleared)
    setSearch('')
    await loadDashboard(cleared)
  }

  const isAuthed = Boolean(session?.accessToken)

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">LavaLust + React + Vite</p>
          <h1>Expense Tracker</h1>
          <p className="hero-copy">
            A simple frontend for your deployed LavaLust API with auth, CRUD, filters, and summaries.
          </p>
        </div>
        {isAuthed ? (
          <div className="hero-panel">
            <span className="pill">API {apiHostLabel}</span>
            <span className="pill">Signed in as {session.user?.username}</span>
            <button className="button button-secondary" type="button" onClick={handleLogout}>
              Log out
            </button>
          </div>
        ) : null}
      </header>

      {error ? <div className="alert">{error}</div> : null}
      {info ? <div className="alert alert-info">{info}</div> : null}

      {!isAuthed ? (
        <div className="auth-layout">
          <section className="card">
            <div className="card-header">
              <h2>{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
              <p>Connect to your Render API and start tracking expenses.</p>
            </div>

            <form className="stack" onSubmit={handleAuthSubmit}>
              <label>
                Username
                <input
                  value={authForm.username}
                  onChange={(event) => setAuthForm((current) => ({ ...current, username: event.target.value }))}
                  required
                  autoComplete="username"
                />
              </label>

              {mode === 'register' ? (
                <label>
                  Email
                  <input
                    type="email"
                    value={authForm.email}
                    onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                    required
                    autoComplete="email"
                  />
                </label>
              ) : null}

              <label>
                Password
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                  required
                  minLength={8}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </label>

              <button className="button" type="submit" disabled={authLoading}>
                {authLoading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Register'}
              </button>
            </form>

            <button
              type="button"
              className="button button-link"
              onClick={() => setMode((current) => (current === 'login' ? 'register' : 'login'))}
            >
              {mode === 'login' ? 'Need an account? Register' : 'Already have an account? Sign in'}
            </button>
          </section>

          <section className="card feature-card">
            <h2>Included</h2>
            <ul>
              <li>JWT login and registration</li>
              <li>Expense CRUD against the API</li>
              <li>Date and category filters</li>
              <li>Summary totals by category</li>
              <li>Automatic token refresh</li>
            </ul>
          </section>

          <section className="card feature-card">
            <h2>Backend API</h2>
            <p>Connected to <strong>{apiHostLabel}</strong> with the exact LavaLust endpoints below.</p>
            <ul>
              {backendEndpoints.map((endpoint) => (
                <li key={endpoint}>{endpoint}</li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <main className="dashboard">
          <section className="stats-grid">
            <article className="stat-card">
              <span>Total spent</span>
              <strong>{formatMoney(totals.total)}</strong>
            </article>
            <article className="stat-card">
              <span>Expenses</span>
              <strong>{totals.count}</strong>
            </article>
            <article className="stat-card">
              <span>Categories</span>
              <strong>{totals.categories}</strong>
            </article>
          </section>

          <section className="content-grid">
            <div className="stack">
              <section className="card">
                <div className="card-header">
                  <h2>{editingId ? 'Edit expense' : 'Add expense'}</h2>
                  <p>Save a new entry or update an existing one.</p>
                </div>

                <form className="stack" onSubmit={handleExpenseSubmit}>
                  <label>
                    Description
                    <input
                      value={form.description}
                      onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                      required
                    />
                  </label>

                  <div className="form-row">
                    <label>
                      Amount
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={form.amount}
                        onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                        required
                      />
                    </label>

                    <label>
                      Category
                      <select
                        value={form.category}
                        onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                      >
                        {categories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label>
                    Date and time
                    <input
                      type="datetime-local"
                      value={form.date}
                      onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                      required
                    />
                  </label>

                  <div className="actions">
                    <button className="button" type="submit" disabled={saving}>
                      {saving ? 'Saving...' : editingId ? 'Update expense' : 'Add expense'}
                    </button>

                    {editingId ? (
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={() => {
                          setEditingId(null)
                          setForm({
                            ...defaultForm,
                            date: getLocalDateTimeValue(),
                          })
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </form>
              </section>

              <section className="card">
                <div className="card-header">
                  <h2>Filters</h2>
                  <p>Use backend filtering for category and date ranges.</p>
                </div>

                <form className="stack" onSubmit={applyFilters}>
                  <div className="form-row">
                    <label>
                      Category
                      <select
                        value={filters.category}
                        onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}
                      >
                        <option value="">All categories</option>
                        {categories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Search
                      <input
                        placeholder="Description, amount, or date"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                  </div>

                  <div className="form-row">
                    <label>
                      Start date
                      <input
                        type="date"
                        value={filters.start_date}
                        onChange={(event) => setFilters((current) => ({ ...current, start_date: event.target.value }))}
                      />
                    </label>

                    <label>
                      End date
                      <input
                        type="date"
                        value={filters.end_date}
                        onChange={(event) => setFilters((current) => ({ ...current, end_date: event.target.value }))}
                      />
                    </label>
                  </div>

                  <div className="actions">
                    <button className="button" type="submit" disabled={loading}>
                      {loading ? 'Loading...' : 'Apply filters'}
                    </button>
                    <button className="button button-secondary" type="button" onClick={resetFilters}>
                      Reset
                    </button>
                  </div>
                </form>
              </section>
            </div>

            <section className="card">
              <div className="card-header">
                <h2>Summary</h2>
                <p>Grouped by category from the API.</p>
              </div>

              <div className="summary-list">
                {summary.length ? summary.map((item) => (
                  <div className="summary-item" key={item.category}>
                    <div>
                      <strong>{item.category}</strong>
                      <span>{item.count} expense{Number(item.count) === 1 ? '' : 's'}</span>
                    </div>
                    <strong>{formatMoney(item.total)}</strong>
                  </div>
                )) : (
                  <p className="muted">No summary yet.</p>
                )}
              </div>

              <div className="card-header card-header-spaced">
                <h2>Expenses</h2>
                <p>{filteredExpenses.length} shown</p>
              </div>

              {loading ? (
                <p className="muted">Loading expenses...</p>
              ) : filteredExpenses.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Category</th>
                        <th>Amount</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredExpenses.map((expense) => (
                        <tr key={expense.id}>
                          <td>{formatDateTime(expense.date)}</td>
                          <td>{expense.description}</td>
                          <td>{expense.category}</td>
                          <td>{formatMoney(expense.amount)}</td>
                          <td>
                            <div className="inline-actions">
                              <button className="button button-small" type="button" onClick={() => handleEdit(expense)}>
                                Edit
                              </button>
                              <button className="button button-small button-danger" type="button" onClick={() => handleDelete(expense.id)}>
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">No expenses found.</p>
              )}
            </section>
          </section>
        </main>
      )}
    </div>
  )
}

export default App
