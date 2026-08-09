import { Component } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: '#fff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          gap: '16px'
        }}>
          <AlertCircle size={48} color="var(--danger)" />
          <h2 style={{
            fontSize: 'var(--fs-16)',
            fontWeight: 600,
            color: 'var(--text)',
            margin: 0
          }}>
            应用出错了
          </h2>
          <p style={{
            fontSize: 'var(--fs-13)',
            color: 'var(--text-secondary)',
            textAlign: 'center',
            maxWidth: '300px',
            margin: 0
          }}>
            {this.state.error?.message || '发生了意外错误'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 24px',
              background: 'var(--primary-hover)',
              color: '#fff',
              borderRadius: 'var(--radius-8)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 'var(--fs-14)',
              fontWeight: 600
            }}
          >
            <RefreshCw size={16} />
            重新加载
          </button>
          <button
            onClick={() => {
              // 清除所有缓存后重新加载
              localStorage.clear()
              window.location.reload()
            }}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-8)',
              border: '1px solid var(--border-light)',
              cursor: 'pointer',
              fontSize: 'var(--fs-12)'
            }}
          >
            清除缓存并重新加载
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
