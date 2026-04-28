import { useState, useRef } from 'react'
import { Button, ActionSheet, Badge } from 'antd-mobile'
import { useStudentStore } from '../../store'
import StudentSwitcher from '../../components/StudentSwitcher'

const COLORS = {
  primary: '#2B7DE9',
  primaryLight: '#EBF5FF',
  primaryDark: '#1A3A5C',
  accent: '#4A9EFF',
  bg: '#F5F8FC',
  card: '#FFFFFF',
  text: '#1A3A5C',
  textSecondary: '#8B9DB5',
  textTertiary: '#A8B8CC',
  border: '#E5ECF5',
  success: '#34C759',
  danger: '#FF3B30',
  gradientStart: '#2B7DE9',
  gradientEnd: '#1A6DD4'
}

export default function Home({ onNavigate }) {
  const { currentStudent, setCurrentStudent } = useStudentStore()
  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false)
  const fileInputRef = useRef(null)

  const handleUpload = (action) => {
    if (action === 'camera') {
      if (fileInputRef.current) {
        fileInputRef.current.setAttribute('capture', 'environment')
        fileInputRef.current.click()
      }
    } else {
      if (fileInputRef.current) {
        fileInputRef.current.removeAttribute('capture')
        fileInputRef.current.click()
      }
    }
  }

  const showUploadOptions = () => {
    ActionSheet.show({
      actions: [
        { key: 'camera', text: '拍照上传', description: '拍摄试卷或作业' },
        { key: 'album', text: '从相册选择', description: '选择已有照片' },
      ],
      onAction: (action) => handleUpload(action.key)
    })
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(180deg, ${COLORS.primaryLight} 0%, ${COLORS.bg} 300px, ${COLORS.bg} 100%)`,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
      />

      {/* Header */}
      <div style={{
        padding: '16px 20px 0',
      }}>
        {/* Logo Area */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '14px',
              background: `linear-gradient(135deg, ${COLORS.gradientStart} 0%, ${COLORS.gradientEnd} 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 4px 12px rgba(43, 125, 233, 0.3)`
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M2 3h8a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" fill="white" opacity="0.9"/>
                <path d="M22 3h-8a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h9z" fill="white" opacity="0.6"/>
              </svg>
            </div>
            <div>
              <div style={{
                fontSize: '20px',
                fontWeight: 700,
                color: COLORS.primaryDark,
                letterSpacing: '-0.02em',
                lineHeight: '1.2'
              }}>敏学错题助手</div>
              <div style={{
                fontSize: '11px',
                color: COLORS.accent,
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase'
              }}>AI Study Assistant</div>
            </div>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: COLORS.card,
            padding: '6px 12px',
            borderRadius: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={COLORS.accent}>
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fillRule="evenodd"/>
            </svg>
            <span style={{
              fontSize: '13px',
              fontWeight: 600,
              color: COLORS.accent
            }}>0</span>
          </div>
        </div>

        {/* Student Section */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: COLORS.textSecondary,
            fontSize: '14px'
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
            归属学生
          </div>
          <Button
            fill="none"
            style={{
              color: COLORS.accent,
              fontSize: '13px',
              fontWeight: 600,
              padding: '0'
            }}
            onClick={() => onNavigate && onNavigate('students')}
          >
            新增学生
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h2v-4h4v-2h-4V7h-2v4H7v2h4v4z"/>
            </svg>
          </Button>
        </div>

        {/* Student Card */}
        {currentStudent ? (
          <div
            onClick={() => setShowStudentSwitcher(true)}
            style={{
              background: `linear-gradient(135deg, ${COLORS.card} 0%, #F8FBFF 100%)`,
              borderRadius: '16px',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 2px 12px rgba(43, 125, 233, 0.08)',
              border: `1px solid ${COLORS.border}`,
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                background: COLORS.primaryLight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden'
              }}>
                {currentStudent.avatar ? (
                  <img src={currentStudent.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill={COLORS.accent}>
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                  </svg>
                )}
              </div>
              <div>
                <div style={{
                  fontSize: '11px',
                  color: COLORS.textSecondary,
                  fontWeight: 500
                }}>当前选择</div>
                <div style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  color: COLORS.primaryDark
                }}>{currentStudent.name}</div>
              </div>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: COLORS.accent
            }}>
              <span style={{ fontSize: '13px', fontWeight: 500 }}>切换</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
              </svg>
            </div>
          </div>
        ) : (
          <div
            onClick={() => setShowStudentSwitcher(true)}
            style={{
              background: COLORS.card,
              borderRadius: '16px',
              padding: '24px 16px',
              textAlign: 'center',
              boxShadow: '0 2px 12px rgba(43, 125, 233, 0.08)',
              border: `1px solid ${COLORS.border}`,
              cursor: 'pointer'
            }}
          >
            <div style={{
              fontSize: '14px',
              color: COLORS.textSecondary,
              fontWeight: 500
            }}>暂无学生，请先添加</div>
          </div>
        )}
      </div>

      {/* Upload Card - Main Area */}
      <div style={{
        flex: 1,
        padding: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div
          onClick={showUploadOptions}
          style={{
            width: '100%',
            minHeight: '320px',
            borderRadius: '28px',
            padding: '48px 32px',
            background: `linear-gradient(160deg, ${COLORS.primaryLight} 0%, #E0EEFB 50%, #D6E8F7 100%)`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '24px',
            cursor: 'pointer',
            boxShadow: '0 8px 32px rgba(43, 125, 233, 0.12), 0 2px 8px rgba(43, 125, 233, 0.06)',
            border: `2px dashed ${COLORS.accent}40`,
            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          {/* Decorative circles */}
          <div style={{
            position: 'absolute',
            top: '-40px',
            right: '-40px',
            width: '120px',
            height: '120px',
            borderRadius: '50%',
            background: `${COLORS.accent}08`,
          }} />
          <div style={{
            position: 'absolute',
            bottom: '-20px',
            left: '-20px',
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: `${COLORS.accent}06`,
          }} />

          {/* Icon Container */}
          <div style={{
            width: '88px',
            height: '88px',
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${COLORS.gradientStart} 0%, ${COLORS.gradientEnd} 100%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 12px 28px rgba(43, 125, 233, 0.35), inset 0 1px 0 rgba(255,255,255,0.2)`,
            position: 'relative',
            zIndex: 1
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="white">
              <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"/>
              <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" fillRule="evenodd"/>
            </svg>
          </div>

          {/* Text Content */}
          <div style={{
            textAlign: 'center',
            position: 'relative',
            zIndex: 1
          }}>
            <div style={{
              fontSize: '24px',
              fontWeight: 700,
              color: COLORS.primaryDark,
              marginBottom: '8px',
              letterSpacing: '-0.02em',
              lineHeight: '1.3'
            }}>立即拍照</div>
            <div style={{
              fontSize: '14px',
              color: COLORS.accent,
              lineHeight: '1.5',
              fontWeight: 500
            }}>Qwen-VL 智能识别题目</div>
          </div>
        </div>
      </div>

      {/* Student Switcher Modal */}
      <StudentSwitcher
        visible={showStudentSwitcher}
        onClose={() => setShowStudentSwitcher(false)}
        onSelect={(student) => {
          setCurrentStudent(student)
          setShowStudentSwitcher(false)
        }}
      />
    </div>
  )
}
