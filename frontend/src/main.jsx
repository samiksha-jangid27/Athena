import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/layout.css'
import './styles/readiness.css'
import './styles/exam.css'
import './styles/instructor.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
    <App />
)
