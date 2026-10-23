import Button from './ui/Button.jsx'
import Icon from './ui/Icon.jsx'
import Badge from './ui/Badge.jsx'

// Restricted state: replaces the question workspace while answers are locked.
export default function LockedPanel({ confirmed, isFullscreen, lockedAt }) {
  const formattedTime = lockedAt ? new Date(lockedAt).toLocaleTimeString() : null

  return (
    <section className="locked-panel" role="alert" aria-labelledby="locked-title">
      <div className="locked-header">
        <span className="locked-icon"><Icon name="lock" size={24} /></span>
        <div>
          <div className="locked-status-tag">
            <Badge tone={confirmed ? 'danger' : 'warning'} dot>
              {confirmed ? 'Exam Security Lock' : 'Synchronizing Lock…'}
            </Badge>
          </div>
          <h1 id="locked-title">Assessment Locked</h1>
        </div>
      </div>

      <div className="locked-summary">
        <p>
          Athena detected that you exited fullscreen mode{formattedTime ? ` at ${formattedTime}` : ''}. Under exam integrity rules,
          all question answering and answer modifications have been immediately suspended.
        </p>
        <p className="locked-reassurance">
          <Icon name="check" size={16} />
          <strong>Your previously saved answers are safe and stored on the server.</strong>
        </p>
      </div>

      <div className="locked-actions-card">
        <h2 className="section-title">Required steps to continue</h2>
        <ol className="locked-steps">
          <li className={isFullscreen ? 'done' : ''}>
            <span className="step-num">{isFullscreen ? <Icon name="check" size={14} /> : '1'}</span>
            <div className="step-content">
              <strong>Return to fullscreen mode</strong>
              <p className="subtle">You must be in fullscreen before an instructor can restore your exam.</p>
            </div>
            {!isFullscreen && (
              <Button size="sm" variant="secondary" icon="screen" onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>
                Enter fullscreen
              </Button>
            )}
          </li>
          <li>
            <span className="step-num">2</span>
            <div className="step-content">
              <strong>Contact your instructor or invigilator</strong>
              <p className="subtle">Inform them of the fullscreen departure. Only an authorised instructor key can unlock your session.</p>
            </div>
          </li>
        </ol>
      </div>

      <div className="locked-footer">
        <div className="status-line">
          <span className="spinner" aria-hidden="true" />
          <span>The exam countdown continues in the background. This workstation will automatically resume as soon as the instructor unlocks your attempt.</span>
        </div>
      </div>
    </section>
  )
}
