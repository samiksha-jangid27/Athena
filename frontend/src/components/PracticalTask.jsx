import { useRef, useState } from 'react'
import { formatBytes } from '../lib/files.js'
import Button from './ui/Button.jsx'
import Callout from './ui/Callout.jsx'
import Field from './ui/Field.jsx'
import Icon from './ui/Icon.jsx'

export default function PracticalTask({ task, practical, canEdit }) {
  const inputRef = useRef(null)
  const [label, setLabel] = useState('')

  async function onFiles(event) {
    for (const file of event.target.files) {
      if (!(await practical.upload(task, file))) break
    }
    event.target.value = ''
  }

  return (
    <article className="practical" aria-labelledby="practical-title">
      <p className="eyebrow">Practical task</p>
      <h1 id="practical-title" className="question-text">{task.title}</h1>
      <div className="practical-instructions">
        {task.instructions.split('\n\n').map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </div>

      <section className="practical-section">
        <div className="section-head">
          <h2>Files <span className="subtle num">{task.files.length}/{task.maxFiles}</span></h2>
          <input ref={inputRef} type="file" multiple hidden onChange={onFiles} accept={task.allowedExtensions.join(',')} />
          <Button variant="secondary" size="sm" icon="upload" disabled={!canEdit || practical.busy || task.files.length >= task.maxFiles}
            loading={practical.busy} onClick={() => inputRef.current.click()}>Upload files</Button>
        </div>
        <p className="subtle">Allowed: {task.allowedExtensions.join(' ')} · up to {formatBytes(task.maxFileBytes)} each. Files are stored for your instructor and never run by Athena.</p>
        {practical.error && <Callout tone="danger" role="alert">{practical.error}</Callout>}
        {task.files.length === 0 ? <p className="empty-line">No files uploaded yet.</p> : (
          <ul className="file-list">
            {task.files.map((file) => (
              <li key={file.id}>
                <Icon name="file" size={16} />
                <span className="file-name">{file.name}</span>
                <span className="subtle num">{formatBytes(file.size)}</span>
                <code className="hash" title={`SHA-256 ${file.sha256}`}>{file.sha256.slice(0, 10)}</code>
                <Button variant="ghost" size="sm" icon="x" aria-label={`Remove ${file.name}`} disabled={!canEdit || practical.busy}
                  onClick={() => practical.remove(task, file.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="practical-section">
        <div className="section-head"><h2>Checkpoints</h2></div>
        <form className="checkpoint-form" onSubmit={async (event) => {
          event.preventDefault()
          if (await practical.checkpoint(task, label)) setLabel('')
        }}>
          <Field label="Checkpoint note" placeholder="e.g. First working version" maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} />
          <Button type="submit" variant="secondary" disabled={!canEdit || practical.busy || task.files.length === 0}>Save checkpoint</Button>
        </form>
        {task.checkpoints.length === 0 ? <p className="empty-line">No checkpoints yet. A checkpoint records exactly which files you had at that moment.</p> : (
          <ol className="checkpoint-list">
            {[...task.checkpoints].reverse().map((checkpoint) => (
              <li key={checkpoint.id}>
                <time className="num subtle">{new Date(checkpoint.at).toLocaleTimeString()}</time>
                <strong>{checkpoint.label}</strong>
                <span className="subtle">{checkpoint.files.map((file) => file.name).join(', ')}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="practical-section">
        <div className="section-head"><h2>How this task is checked</h2></div>
        <ul className="test-list">
          {task.tests.map((test) => <li key={test.id}><strong>{test.name}</strong><span className="subtle">{test.description}</span></li>)}
        </ul>
        <p className="subtle">Your instructor reviews these checks after the exam.</p>
      </section>
    </article>
  )
}
