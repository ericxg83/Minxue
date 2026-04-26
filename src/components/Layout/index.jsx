import { NavBar, TabBar } from 'antd-mobile'
import { useUIStore, useStudentStore } from '../../store'

// 苹果风格颜色
const APPLE_COLORS = {
  primary: '#007AFF',
  success: '#34C759',
  danger: '#FF3B30',
  warning: '#FF9500',
  background: '#F2F2F7',
  card: '#FFFFFF',
  text: '#1C1C1E',
  textSecondary: '#8E8E93',
  border: '#E5E5EA'
}

// 自定义处理中图标
const ProcessingOutline = ({ active }) => (
  <svg viewBox="0 0 1024 1024" width="24" height="24" fill={active ? APPLE_COLORS.primary : APPLE_COLORS.textSecondary}>
    <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 832c-212 0-384-172-384-384s172-384 384-384 384 172 384 384-172 384-384 384z"/>
    <path d="M704 480H544V320c0-17.6-14.4-32-32-32s-32 14.4-32 32v192c0 17.6 14.4 32 32 32h192c17.6 0 32-14.4 32-32s-14.4-32-32-32z"/>
  </svg>
)

// 自定义确认图标
const ConfirmOutline = ({ active }) => (
  <svg viewBox="0 0 1024 1024" width="24" height="24" fill={active ? APPLE_COLORS.primary : APPLE_COLORS.textSecondary}>
    <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 832c-212 0-384-172-384-384s172-384 384-384 384 172 384 384-172 384-384 384z"/>
    <path d="M704 352L448 608 320 480l-45.3 45.3 173.3 173.3L749.3 397.3z"/>
  </svg>
)

// 自定义书本图标
const BookOutline = ({ active }) => (
  <svg viewBox="0 0 1024 1024" width="24" height="24" fill={active ? APPLE_COLORS.primary : APPLE_COLORS.textSecondary}>
    <path d="M832 128H320c-35.2 0-64 28.8-64 64v64H192c-35.2 0-64 28.8-64 64v512c0 35.2 28.8 64 64 64h640c35.2 0 64-28.8 64-64V192c0-35.2-28.8-64-64-64zM320 192h512v64H320V192zm512 576H192V320h128v384c0 35.2 28.8 64 64 64h448v64z"/>
  </svg>
)

// 自定义试卷图标
const ExamOutline = ({ active }) => (
  <svg viewBox="0 0 1024 1024" width="24" height="24" fill={active ? APPLE_COLORS.primary : APPLE_COLORS.textSecondary}>
    <path d="M832 128H192c-35.2 0-64 28.8-64 64v640c0 35.2 28.8 64 64 64h640c35.2 0 64-28.8 64-64V192c0-35.2-28.8-64-64-64zM320 256h384v64H320V256zm0 192h384v64H320V448zm0 192h256v64H320v-64z"/>
  </svg>
)

const tabs = [
  {
    key: 'processing',
    title: '处理',
    icon: (active) => <ProcessingOutline active={active} />,
  },
  {
    key: 'pending',
    title: '待确认',
    icon: (active) => <ConfirmOutline active={active} />,
  },
  {
    key: 'wrongbook',
    title: '错题本',
    icon: (active) => <BookOutline active={active} />,
  },
  {
    key: 'exam',
    title: '试卷',
    icon: (active) => <ExamOutline active={active} />,
  },
]

export default function Layout({ children }) {
  const { currentPage, setCurrentPage } = useUIStore()
  const { currentStudent } = useStudentStore()

  return (
    <div className="page-container">
      <NavBar
        back={null}
        style={{
          '--height': '48px',
          background: APPLE_COLORS.card,
          color: APPLE_COLORS.text,
          borderBottom: '1px solid ' + APPLE_COLORS.border,
          fontWeight: 600
        }}
      >
        {currentStudent ? `${currentStudent.name} - 数学错题本` : '数学错题本'}
      </NavBar>

      <div className="page-content hide-scrollbar">
        {children}
      </div>

      <TabBar
        activeKey={currentPage}
        onChange={setCurrentPage}
        style={{
          background: APPLE_COLORS.card,
          borderTop: '1px solid ' + APPLE_COLORS.border,
          paddingBottom: 'env(safe-area-inset-bottom)'
        }}
      >
        {tabs.map(item => (
          <TabBar.Item 
            key={item.key} 
            icon={item.icon(item.key === currentPage)} 
            title={item.title}
            style={{
              '--color': APPLE_COLORS.textSecondary,
              '--active-color': APPLE_COLORS.primary,
              fontSize: '11px',
              fontWeight: item.key === currentPage ? 600 : 400
            }}
          />
        ))}
      </TabBar>
    </div>
  )
}
