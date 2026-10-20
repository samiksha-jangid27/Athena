// Small inline icon set (stroke icons, 20px grid). Decorative by default.
const PATHS = {
  check: 'M4 10.5l4 4 8-9',
  x: 'M5 5l10 10M15 5L5 15',
  alert: 'M10 3l8 14H2L10 3zm0 5v4m0 2.5v.5',
  lock: 'M5 9h10v8H5zM7 9V6a3 3 0 016 0v3',
  camera: 'M3 6h3l2-2h4l2 2h3v10H3zM10 14a3 3 0 100-6 3 3 0 000 6z',
  screen: 'M3 4h14v9H3zM7 17h6M10 13v4',
  wifi: 'M2 8a12 12 0 0116 0M5 11a8 8 0 0110 0M8 14a4 4 0 014 0M10 17h0',
  flag: 'M5 17V3m0 1h9l-2 3 2 3H5',
  clock: 'M10 18a8 8 0 100-16 8 8 0 000 16zm0-12v4l3 2',
  cloud: 'M6 15h8a3.5 3.5 0 00.5-7A5 5 0 005 9a3 3 0 001 6z',
  arrowLeft: 'M16 10H4m5-5l-5 5 5 5',
  arrowRight: 'M4 10h12m-5-5l5 5-5 5',
  sun: 'M10 14a4 4 0 100-8 4 4 0 000 8zM10 1v2M10 17v2M1 10h2M17 10h2M3.6 3.6l1.4 1.4M15 15l1.4 1.4M3.6 16.4L5 15M15 5l1.4-1.4',
  moon: 'M16 12.5A7 7 0 017.5 4 7 7 0 1016 12.5z',
  monitor: 'M3 4h14v9H3zM7 17h6',
  user: 'M10 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM3 18a7 7 0 0114 0',
  list: 'M7 5h10M7 10h10M7 15h10M3 5h0M3 10h0M3 15h0',
  file: 'M5 2h7l4 4v12H5zM12 2v4h4',
  code: 'M7 6l-4 4 4 4M13 6l4 4-4 4',
  play: 'M6 4l10 6-10 6z',
  upload: 'M10 14V3M5 8l5-5 5 5M3 17h14',
  refresh: 'M16 10a6 6 0 11-2-4.5M16 3v4h-4',
}

export default function Icon({ name, size = 18, label, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" className={`icon ${className}`}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={PATHS[name]} />
    </svg>
  )
}
