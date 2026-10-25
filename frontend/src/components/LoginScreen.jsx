import { useState, useEffect } from 'react'
import { api, getApiUrl, setApiUrl } from '../services/api.js'
import Button from './ui/Button.jsx'
import Field from './ui/Field.jsx'
import Icon from './ui/Icon.jsx'
import Callout from './ui/Callout.jsx'
import Modal from './ui/Modal.jsx'
import Logo from './ui/Logo.jsx'

export default function LoginScreen({ onLoginSuccess }) {
  const [roleTab, setRoleTab] = useState('STUDENT') // 'STUDENT' | 'ADMIN'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Server diagnostics
  const [showSettings, setShowSettings] = useState(false)
  const [serverUrl, setServerUrl] = useState(getApiUrl())
  // api.diagnose() returns the effective URL, whether the build pins it, and a
  // differentiated failure reason (http / timeout / network / database).
  const [diagnostic, setDiagnostic] = useState(null)
  const [checkingHealth, setCheckingHealth] = useState(false)
  const urlLocked = api.isApiUrlLocked()

  const checkStatus = async () => {
    setCheckingHealth(true)
    try {
      setDiagnostic(await api.diagnose())
    } finally {
      setCheckingHealth(false)
    }
  }

  useEffect(() => {
    let mounted = true
    api.diagnose().then((result) => {
      if (mounted) setDiagnostic(result)
    })
    return () => {
      mounted = false
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!username.trim() || !password.trim()) {
      setError('Please enter both your username and password.')
      return
    }

    setLoading(true)
    try {
      const res = await api.auth.login(username.trim(), password)
      if (res.user && res.token) {
        if (roleTab === 'ADMIN' && res.user.role !== 'ADMIN') {
          setError('This account does not have administrator privileges.')
          return
        }
        onLoginSuccess(res.user, res.token)
      } else {
        setError('Login failed. Please check your credentials.')
      }
    } catch (err) {
      if (err.status === 401) {
        setError('Invalid username or password.')
      } else if (err.message && err.message.includes('fetch')) {
        setError('Unable to reach the Athena server. Check your connection or server settings below.')
      } else {
        setError(err.message || 'Authentication error. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="center-screen login-wrap">
      <div className="login-card">
        <div className="login-header">
          <div className="brand-badge">
            <Logo size={28} />
            <span className="brand-name">Athena</span>
          </div>
          <h1 className="login-title">Examination Portal</h1>
          <p className="login-subtitle">
            {roleTab === 'STUDENT'
              ? 'Sign in with your assigned credentials to access your examinations.'
              : 'Administrator control panel for exam creation and proctoring.'}
          </p>
        </div>

        <div className="segmented role-switch" role="tablist" aria-label="Portal Mode">
          <button
            type="button"
            role="tab"
            aria-selected={roleTab === 'STUDENT'}
            onClick={() => { setRoleTab('STUDENT'); setError(null) }}>
            <Icon name="user" size={14} /> Student Login
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={roleTab === 'ADMIN'}
            onClick={() => { setRoleTab('ADMIN'); setError(null) }}>
            <Icon name="lock" size={14} /> Administrator
          </button>
        </div>

        {error && (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <Field
            label={roleTab === 'STUDENT' ? 'Student ID / Username' : 'Administrator Username'}
            value={username}
            autoFocus
            autoComplete="username"
            placeholder={roleTab === 'STUDENT' ? 'e.g. student01' : 'e.g. admin'}
            onChange={(e) => setUsername(e.target.value)}
          />

          <Field
            label="Password"
            type="password"
            value={password}
            autoComplete="current-password"
            placeholder="••••••••••••"
            onChange={(e) => setPassword(e.target.value)}
          />

          <Button type="submit" loading={loading} iconRight="arrowRight" className="login-btn">
            {roleTab === 'STUDENT' ? 'Enter Examination Platform' : 'Access Admin Dashboard'}
          </Button>
        </form>

        <div className="login-footer">
          <div className="server-status-pill" onClick={() => setShowSettings(true)}>
            <span className={`pulse-dot ${diagnostic?.online ? 'tone-success live' : 'tone-danger'}`} />
            <span className="server-label">
              {checkingHealth
                ? 'Connecting to server…'
                : diagnostic?.online
                ? 'Server connected'
                : diagnostic
                ? 'Server offline / Wake up'
                : 'Checking server…'}
            </span>
            <Icon name="settings" size={13} className="settings-icon" />
          </div>
        </div>
      </div>

      <Modal
        open={showSettings}
        title="Server Configuration & Diagnostics"
        onClose={() => setShowSettings(false)}
        footer={(
          <Button
            variant="secondary"
            onClick={() => setShowSettings(false)}>
            Close
          </Button>
        )}>
        <div className="settings-body">
          {urlLocked ? (
            <p className="subtle">
              This packaged build is pinned to the backend it was built for, so the address below cannot
              be changed here. Copied or modified settings are ignored.
            </p>
          ) : (
            <p className="subtle">
              Athena connects to a shared hosted backend. In production builds, clients connect securely over HTTPS.
            </p>
          )}
          <Field
            label="Backend Server URL"
            value={urlLocked ? getApiUrl() : serverUrl}
            readOnly={urlLocked}
            disabled={urlLocked}
            onChange={(e) => setServerUrl(e.target.value)}
            hint={urlLocked
              ? 'Locked by this build’s configuration.'
              : 'Default: Central Render backend. You can customize this if your institution uses a private deployment.'}
          />
          <div className="settings-actions">
            <Button
              size="sm"
              variant="secondary"
              loading={checkingHealth}
              onClick={() => {
                setApiUrl(serverUrl)
                checkStatus()
              }}>
              Save & Test Connection
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setApiUrl('')
                setServerUrl(getApiUrl())
                checkStatus()
              }}>
              Reset to Default
            </Button>
          </div>

          {diagnostic && (
            <Callout tone={diagnostic.online ? 'success' : 'danger'} role="status">
              {diagnostic.message}
            </Callout>
          )}

          <div className="diag-box">
            <strong>Diagnostic Info:</strong>
            <pre>
              {JSON.stringify(
                {
                  activeUrl: diagnostic?.url ?? getApiUrl(),
                  urlLockedByBuild: urlLocked,
                  status: checkingHealth
                    ? 'checking…'
                    : diagnostic?.online
                    ? 'ONLINE'
                    : diagnostic
                    ? `UNREACHABLE (${diagnostic.category})`
                    : 'UNKNOWN',
                  latencyMs: diagnostic?.latencyMs ?? null,
                  httpStatus: diagnostic?.httpStatus ?? null,
                  serverTime: diagnostic?.serverTime ?? null,
                  database: diagnostic?.database ?? null,
                },
                null,
                2
              )}
            </pre>
          </div>
        </div>
      </Modal>
    </main>
  )
}
