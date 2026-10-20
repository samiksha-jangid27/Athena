import Button from './ui/Button.jsx'
import Icon from './ui/Icon.jsx'

// Restricted state: replaces the question while answers are locked.
export default function LockedPanel({ confirmed, isFullscreen, lockedAt }) {
  return (
    <section className="locked-panel" role="alert" aria-labelledby="locked-title">
      <span className="locked-icon"><Icon name="lock" size={22} /></span>
      <h1 id="locked-title">Answers locked</h1>
      <p>
        You left fullscreen{lockedAt ? ` at ${new Date(lockedAt).toLocaleTimeString()}` : ''}. Under this exam’s policy your answers
        are locked until an instructor reviews the event and unlocks your attempt. Your saved answers are safe.
      </p>
      <ol className="locked-steps">
        <li className={isFullscreen ? 'done' : ''}>
          <span>{isFullscreen ? <Icon name="check" size={14} /> : 1}</span>
          Return to fullscreen
          {!isFullscreen && (
            <Button size="sm" variant="secondary" onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>Enter fullscreen</Button>
          )}
        </li>
        <li><span>2</span>Ask your instructor to unlock your attempt</li>
      </ol>
      <p className="subtle">
        {confirmed ? 'The exam server has recorded the lock.' : 'Sending the lock event to the exam server…'} The timer keeps running.
        This screen updates automatically when you are unlocked.
      </p>
    </section>
  )
}
