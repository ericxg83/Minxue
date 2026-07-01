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
          <AlertCircle size={48} color="#EF4444" />
          <h2 style={{
            fontSize: '16px',
            fontWeight: 600,
            color: '#111827',
            margin: 0
          }}>
            应用出错了
          </h2>
          <p style={{
            fontSize: '13px',
            color: '#6B7280',
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
              background: '#2563EB',
              color: '#fff',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px',
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
              color: '#6B7280',
              borderRadius: '8px',
              border: '1px solid #E5E7EB',
              cursor: 'pointer',
              fontSize: '12px'
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
