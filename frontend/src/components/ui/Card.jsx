export default function Card({ as: Tag = 'section', className = '', children, ...props }) {
  return <Tag className={`card ${className}`} {...props}>{children}</Tag>
}
