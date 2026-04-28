import { TabBar } from 'antd-mobile'
import { useUIStore, useStudentStore } from '../../store'

const COLORS = {
  primary: '#2B7DE9',
  accent: '#4A9EFF',
  background: '#F5F8FC',
  card: '#FFFFFF',
  text: '#1A3A5C',
  textSecondary: '#8B9DB5',
  inactiveIcon: '#A8B8CC'
}

const CameraIcon = ({ active }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill={active ? COLORS.primary : COLORS.inactiveIcon}>
    <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"/>
    <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" fillRule="evenodd"/>
  </svg>
)

const BookIcon = ({ active }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill={active ? COLORS.primary : COLORS.inactiveIcon}>
    <path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z"/>
  </svg>
)

const ChartIcon = ({ active }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill={active ? COLORS.primary : COLORS.inactiveIcon}>
    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
  </svg>
)

const ExamIcon = ({ active }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill={active ? COLORS.primary : COLORS.inactiveIcon}>
    <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
    <path d="M8 12h8v2H8zm0 4h5v2H8z"/>
  </svg>
)

const tabs = [
  {
    key: 'processing',
    title: '处理',
    icon: (active) => <CameraIcon active={active} />,
  },
  {
    key: 'pending',
    title: '待确认',
    icon: (active) => <BookIcon active={active} />,
  },
  {
    key: 'wrongbook',
    title: '错题本',
    icon: (active) => <ChartIcon active={active} />,
  },
  {
    key: 'exam',
    title: '试卷',
    icon: (active) => <ExamIcon active={active} />,
  },
]

export default function Layout({ children }) {
  const { currentPage, setCurrentPage } = useUIStore()
  const { currentStudent } = useStudentStore()

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: COLORS.background
    }}>
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        paddingBottom: 'env(safe-area-inset-bottom, 80px)'
      }}>
        {children}
      </div>

      <TabBar
        activeKey={currentPage}
        onChange={setCurrentPage}
        style={{
          background: COLORS.card,
          borderTop: '1px solid #F0F4F8',
          paddingBottom: 'env(safe-area-inset-bottom)',
          boxShadow: '0 -2px 12px rgba(0,0,0,0.03)'
        }}
      >
        {tabs.map(item => (
          <TabBar.Item 
            key={item.key} 
            icon={item.icon(item.key === currentPage)} 
            title={item.title}
            style={{
              '--color': COLORS.textSecondary,
              '--active-color': COLORS.primary,
              fontSize: '11px',
              fontWeight: item.key === currentPage ? 600 : 400
            }}
          />
        ))}
      </TabBar>
    </div>
  )
}
