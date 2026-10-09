const STORAGE_KEY = 'expense-tracker-auth'

const trimTrailingSlash = (value) => String(value || '').replace(/\/$/, '')

const readStoredSession = () => {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const writeStoredSession = (session) => {
  if (typeof window === 'undefined') {
    return
  }

  if (!session) {
    window.localStorage.removeItem(STORAGE_KEY)
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

const parseJsonResponse = async (response) => {
  const text = await response.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const buildQueryString = (params = {}) => {
  const searchParams = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      searchParams.set(key, value)
    }
  })

  const query = searchParams.toString()
  return query ? `?${query}` : ''
}

export const createApiClient = ({
  baseUrl,
  getSession,
  setSession,
  clearSession,
}) => {
  const apiBaseUrl = trimTrailingSlash(baseUrl)

  const refreshTokens = async () => {
    const currentSession = getSession()

    if (!currentSession?.refreshToken) {
      throw new Error('Session expired. Please sign in again.')
    }

    const response = await fetch(`${apiBaseUrl}/api/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refresh_token: currentSession.refreshToken,
      }),
    })

    const data = await parseJsonResponse(response)

    if (!response.ok) {
      clearSession()
      throw new Error(data?.error || 'Session expired. Please sign in again.')
    }

    const nextSession = {
      ...currentSession,
      accessToken: data?.tokens?.access_token,
      refreshToken: data?.tokens?.refresh_token,
    }

    if (!nextSession.accessToken || !nextSession.refreshToken) {
      clearSession()
      throw new Error('Invalid refresh response from the API.')
    }

    setSession(nextSession)
    return nextSession
  }

  const requestJson = async (path, options = {}, retry = true) => {
    const currentSession = getSession()
    const headers = {
      ...(options.headers || {}),
    }

    if (!(options.auth === false) && currentSession?.accessToken) {
      headers.Authorization = `Bearer ${currentSession.accessToken}`
    }

    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers,
    })

    if (response.status === 401 && retry && currentSession?.refreshToken && options.auth !== false) {
      await refreshTokens()
      return requestJson(path, options, false)
    }

    const data = await parseJsonResponse(response)

    if (!response.ok) {
      throw new Error(data?.error || data?.message || 'Request failed.')
    }

    return data
  }

  return {
    login: async (username, password) => {
      const data = await requestJson('/api/login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ username, password }),
      })

      return data
    },
    register: async (username, email, password) => {
      const data = await requestJson('/api/register', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ username, email, password }),
      })

      return data
    },
    loadExpenses: async (filters = {}) => {
      const query = buildQueryString(filters)
      return requestJson(`/api/expenses${query}`, { method: 'GET' })
    },
    loadSummary: async (filters = {}) => {
      const query = buildQueryString(filters)
      return requestJson(`/api/expenses/summary${query}`, { method: 'GET' })
    },
    createExpense: async (expense) => requestJson('/api/expenses', {
      method: 'POST',
      body: JSON.stringify(expense),
    }),
    updateExpense: async (id, expense) => requestJson(`/api/expenses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(expense),
    }),
    deleteExpense: async (id) => requestJson(`/api/expenses/${id}`, {
      method: 'DELETE',
    }),
    refreshTokens,
  }
}

export const sessionStorageApi = {
  read: readStoredSession,
  write: writeStoredSession,
  clear: () => writeStoredSession(null),
  key: STORAGE_KEY,
}
