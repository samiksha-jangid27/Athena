import Icon from './Icon.jsx'

const ICON = { danger: 'alert', warning: 'alert', info: 'clock', success: 'check' }

export default function Callout({ tone = 'info', icon, children, role }) {
  return (
    <div className={`callout callout-${tone}`} role={role}>
      <Icon name={icon || ICON[tone]} size={16} />
      <div>{children}</div>
    </div>
  )
}
