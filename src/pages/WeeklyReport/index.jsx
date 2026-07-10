import { useEffect, useState, useRef, useCallback } from 'react'
import {
  Button,
  Toast,
  Empty,
  SpinLoading,
  Popup,
  Space,
  Segmented,
  Picker
} from 'antd-mobile'
import { Download, FileText, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react'
import { useStudentStore, useUIStore } from '../../store'
import { getStudents, getAllWeeklyReports } from '../../services/apiService'
import { generateWeeklyReport, generateAllWeeklyReports } from '../../utils/weeklyReportGenerator'
import { saveAs } from 'file-saver'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import StudentSwitcher from '../../components/StudentSwitcher'

dayjs.extend(isoWeek)

const CLAUDE_COLORS = {
  primary: '#3B82F6',
  success: '#16A34A',
  danger: '#DC2626',
  warning: '#D97706',
  background: '#EEF2FF',
  card: '#FFFFFF',
  text: '#1E293B',
  textSecondary: '#64748B',
  border: '#E2E8F0'
}

export default function WeeklyReport() {
  const { currentStudent, students, setCurrentStudent } = useStudentStore()
  const { setLoading } = useUIStore()

  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatingAll, setGeneratingAll] = useState(false)
  const [progressList, setProgressList] = useState([])
  const [results, setResults] = useState([])
  const [summaryData, setSummaryData] = useState(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const weekNum = dayjs().isoWeek()

  // ── Period State ──
  const [periodMode, setPeriodMode] = useState('week')
  const [periodOffset, setPeriodOffset] = useState(0)

  const periodLabel = (() => {
    if (periodMode === 'all') return '全部时间'
    if (periodMode === 'week') {
      const start = dayjs().subtract(periodOffset, 'week').startOf('isoWeek')
      const end = dayjs().subtract(periodOffset, 'week').endOf('isoWeek')
      return `第${dayjs().subtract(periodOffset, 'week').isoWeek()}周 ${start.format('MM/DD')} ~ ${end.format('MM/DD')}`
    }
    if (periodMode === 'month') {
      return dayjs().subtract(periodOffset, 'month').format('YYYY年M月')
    }
    return ''
  })()

  const periodModeOptions = [
    { label: '周', value: 'week' },
    { label: '月', value: 'month' },
    { label: '全部', value: 'all' }
  ]

  // 当周期变化时刷新数据
  useEffect(() => {
    loadSummary()
  }, [periodMode, periodOffset])

  const loadSummary = async () => {
    setLoadingSummary(true)
    try {
      const data = await getAllWeeklyReports({ mode: periodMode, offset: periodOffset })
      if (data.success) {
        setSummaryData(data)
      }
    } catch (err) {
      console.warn('加载周统计摘要失败:', err)
    } finally {
      setLoadingSummary(false)
    }
  }

  // 为单个学生生成报告
  const handleGenerate = async () => {
    if (!currentStudent) {
      Toast.show('请先选择学生')
      return
    }
    if (generating) return
    setGenerating(true)

    try {
      const pdfBlob = await generateWeeklyReport(currentStudent.id, { mode: periodMode, offset: periodOffset })
      if (pdfBlob) {
        const suffix = periodMode === 'all' ? '全部时间' : (periodMode === 'month' ? dayjs().subtract(periodOffset, 'month').format('M月') : `第${weekNum}周`)
        const filename = `${currentStudent.name}_周学习诊断报告_${suffix}_${dayjs().format('YYYYMMDD')}.pdf`
        saveAs(pdfBlob, filename)
        Toast.show({ icon: 'success', content: '报告已生成' })
      } else {
        Toast.show({ icon: 'fail', content: '本周暂无学习数据' })
      }
    } catch (err) {
      console.error('生成失败:', err)
      Toast.show({ icon: 'fail', content: '生成失败: ' + (err.message || '未知错误') })
    } finally {
      setGenerating(false)
    }
  }

  // 为所有学生生成报告
  const handleGenerateAll = async () => {
    if (generatingAll) return
    setGeneratingAll(true)
    setResults([])
    setProgressList([])

    try {
      const resultsArr = await generateAllWeeklyReports({
        mode: periodMode,
        offset: periodOffset,
        onProgress: (studentName, status) => {
          setProgressList(prev => {
            const existing = prev.findIndex(p => p.name === studentName)
            if (existing >= 0) {
              const updated = [...prev]
              updated[existing] = { ...updated[existing], status }
              return updated
            }
            return [...prev, { name: studentName, status }]
          })
        }
      })

      setResults(resultsArr)

      const doneCount = resultsArr.filter(r => r.status === 'done').length
      const skippedCount = resultsArr.filter(r => r.status === 'skipped').length
      const failedCount = resultsArr.filter(r => r.status === 'failed').length

      Toast.show({
        icon: 'success',
        content: `已完成！成功 ${doneCount} 人${skippedCount > 0 ? `，无数据 ${skippedCount} 人` : ''}${failedCount > 0 ? `，失败 ${failedCount} 人` : ''}`
      })
    } catch (err) {
      console.error('批量生成失败:', err)
      Toast.show({ icon: 'fail', content: '批量生成失败: ' + (err.message || '未知错误') })
    } finally {
      setGeneratingAll(false)
    }
  }

  // 下载某个学生的报告
  const handleDownload = (result) => {
    if (!result.pdfBlob) return
    const filename = `${result.student.name}_周学习诊断报告_第${weekNum}周_${dayjs().format('YYYYMMDD')}.pdf`
    saveAs(result.pdfBlob, filename)
  }

  // 批量下载所有成功的报告
  const handleDownloadAll = () => {
    const doneResults = results.filter(r => r.status === 'done' && r.pdfBlob)
    doneResults.forEach((result, i) => {
      setTimeout(() => handleDownload(result), i * 500)
    })
    Toast.show({ icon: 'success', content: `开始下载 ${doneResults.length} 份报告` })
  }

  const stats = summaryData?.reports?.find(
    r => r.student?.id === currentStudent?.id
  )?.stats

  // 获取进度状态的显示
  const getStatusDisplay = (status) => {
    switch (status) {
      case 'generating': return { icon: <Loader2 size={14} className="animate-spin" />, color: CLAUDE_COLORS.primary, label: '生成中...' }
      case 'done': return { icon: <CheckCircle2 size={14} />, color: CLAUDE_COLORS.success, label: '已完成' }
      case 'failed': return { icon: <XCircle size={14} />, color: CLAUDE_COLORS.danger, label: '失败' }
      case 'skipped': return { icon: <AlertTriangle size={14} />, color: CLAUDE_COLORS.warning, label: '无数据' }
      default: return { icon: null, color: CLAUDE_COLORS.textSecondary, label: status }
    }
  }

  return (
    <div style={{ padding: '0', background: CLAUDE_COLORS.background, minHeight: '100%', paddingBottom: '80px' }}>
      {/* 标题栏 */}
      <div style={{
        background: CLAUDE_COLORS.card,
        padding: '16px',
        borderBottom: '1px solid ' + CLAUDE_COLORS.border
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: CLAUDE_COLORS.text, flex: 1 }}>
            周学习诊断报告
          </h1>
          <Segmented
            options={periodModeOptions}
            value={periodMode}
            onChange={v => setPeriodMode(v)}
            style={{ '--font-size': '12px' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ fontSize: '13px', color: CLAUDE_COLORS.textSecondary }}>
            {periodLabel}
          </div>
          {periodMode !== 'all' && (
            <select
              value={periodOffset}
              onChange={e => setPeriodOffset(Number(e.target.value))}
              style={{
                fontSize: '12px', padding: '2px 6px', borderRadius: '6px',
                border: '1px solid ' + CLAUDE_COLORS.border, background: CLAUDE_COLORS.card, color: CLAUDE_COLORS.text
              }}
            >
              {periodMode === 'week' ? (
                <>
                  <option value={0}>本周</option>
                  <option value={1}>上周</option>
                  <option value={2}>前2周</option>
                  <option value={3}>前3周</option>
                  <option value={4}>前4周</option>
                  <option value={5}>前5周</option>
                  <option value={6}>前6周</option>
                  <option value={7}>前7周</option>
                  <option value={8}>前8周</option>
                  <option value={9}>前9周</option>
                  <option value={10}>前10周</option>
                </>
              ) : (
                <>
                  <option value={0}>本月</option>
                  <option value={1}>上月</option>
                  <option value={2}>前2月</option>
                  <option value={3}>前3月</option>
                </>
              )}
            </select>
          )}
        </div>
      </div>

      {/* 当前学生信息 */}
      <div style={{
        background: CLAUDE_COLORS.card,
        padding: '16px',
        borderBottom: '1px solid ' + CLAUDE_COLORS.border,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '44px', height: '44px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #E8F4FD 0%, #D6EBFA 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden'
          }}>
            {currentStudent?.avatar ? (
              <img src={currentStudent.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <svg width="24" height="24" viewBox="0 0 1024 1024" fill={CLAUDE_COLORS.primary}>
                <path d="M512 512c88 0 160-72 160-160s-72-160-160-160-160 72-160 160 72 160 160 160zm0-256c52.8 0 96 43.2 96 96s-43.2 96-96 96-96-43.2-96-96 43.2-96 96-96zm448 544v64c0 35.2-28.8 64-64 64H128c-35.2 0-64-28.8-64-64v-64c0-88 72-160 160-160h32c17.6 0 34.4 3.2 50.4 9.6 33.6 12.8 70.4 20.8 108.8 23.2 9.6 0.8 19.2 1.2 28.8 1.2s19.2-0.4 28.8-1.2c38.4-2.4 75.2-10.4 108.8-23.2 16-6.4 32.8-9.6 50.4-9.6h32c88 0 160 72 160 160zM128 800h768c0-52.8-43.2-96-96-96h-32c-11.2 0-22.4 2.4-32.8 6.4-40 16-84.8 25.6-130.4 28.8-11.2 0.8-22.4 1.2-33.6 1.2s-22.4-0.4-33.6-1.2c-45.6-3.2-90.4-12.8-130.4-28.8-10.4-4-21.6-6.4-32.8-6.4h-32c-52.8 0-96 43.2-96 96z"/>
              </svg>
            )}
          </div>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: CLAUDE_COLORS.text }}>
              {currentStudent?.name || '未选择学生'}
            </div>
            <div style={{ fontSize: '12px', color: CLAUDE_COLORS.textSecondary }}>
              {currentStudent?.class || ''}
            </div>
          </div>
        </div>
        <Button
          fill="none"
          size="small"
          onClick={() => setShowStudentSwitcher(true)}
          style={{ color: CLAUDE_COLORS.primary, fontSize: '13px' }}
        >
          切换
        </Button>
      </div>

      {/* 本周概览卡片 */}
      <div style={{
        background: CLAUDE_COLORS.card,
        margin: '12px',
        borderRadius: '12px',
        padding: '16px',
        border: '1px solid ' + CLAUDE_COLORS.border
      }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: CLAUDE_COLORS.text, marginBottom: '12px' }}>
          本周学习概览
        </div>
        {loadingSummary ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <SpinLoading style={{ '--size': '24px' }} />
            <div style={{ fontSize: '13px', color: CLAUDE_COLORS.textSecondary, marginTop: '8px' }}>加载中...</div>
          </div>
        ) : stats ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <div style={{ textAlign: 'center', padding: '8px', background: '#F8FAFC', borderRadius: '8px' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: CLAUDE_COLORS.primary }}>{stats.totalTasks || 0}</div>
              <div style={{ fontSize: '11px', color: CLAUDE_COLORS.textSecondary }}>作业（份）</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: '#F8FAFC', borderRadius: '8px' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: stats.accuracy >= 80 ? CLAUDE_COLORS.success : CLAUDE_COLORS.danger }}>{stats.accuracy || 0}%</div>
              <div style={{ fontSize: '11px', color: CLAUDE_COLORS.textSecondary }}>正确率</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: '#F8FAFC', borderRadius: '8px' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: stats.newWrongCount > 0 ? CLAUDE_COLORS.danger : CLAUDE_COLORS.success }}>{stats.newWrongCount || 0}</div>
              <div style={{ fontSize: '11px', color: CLAUDE_COLORS.textSecondary }}>新增错题</div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: '13px', color: CLAUDE_COLORS.textSecondary, textAlign: 'center', padding: '12px' }}>
            {currentStudent ? '暂无本周学习数据' : '请选择学生'}
          </div>
        )}
      </div>

      {/* 操作按钮区 */}
      <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <Button
          color="primary"
          size="large"
          loading={generating}
          disabled={generating || !currentStudent}
          onClick={handleGenerate}
          block
          style={{ borderRadius: '10px', height: '48px', fontSize: '16px' }}
        >
          {generating ? '生成中...' : `生成 ${currentStudent?.name || ''} 的诊断报告`}
        </Button>

        <Button
          fill="outline"
          size="large"
          loading={generatingAll}
          disabled={generatingAll}
          onClick={handleGenerateAll}
          block
          style={{ borderRadius: '10px', height: '48px', fontSize: '16px', borderColor: CLAUDE_COLORS.primary, color: CLAUDE_COLORS.primary }}
        >
          {generatingAll ? '正在为全体学生生成...' : '一键生成全部学生'}
        </Button>
      </div>

      {/* 生成进度 */}
      {progressList.length > 0 && (
        <div style={{
          background: CLAUDE_COLORS.card,
          margin: '12px',
          borderRadius: '12px',
          padding: '16px',
          border: '1px solid ' + CLAUDE_COLORS.border
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: CLAUDE_COLORS.text, marginBottom: '12px' }}>
            生成进度
          </div>
          {progressList.map((p, i) => {
            const display = getStatusDisplay(p.status)
            return (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 0', borderBottom: i < progressList.length - 1 ? '1px solid ' + CLAUDE_COLORS.border : 'none'
              }}>
                <span style={{ fontSize: '14px', color: CLAUDE_COLORS.text }}>{p.name}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: display.color, fontSize: '12px' }}>
                  {display.icon}
                  {display.label}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* 生成结果 — 仅供下载 */}
      {results.length > 0 && !generatingAll && (
        <div style={{
          background: CLAUDE_COLORS.card,
          margin: '12px',
          borderRadius: '12px',
          padding: '16px',
          border: '1px solid ' + CLAUDE_COLORS.border
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '12px'
          }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: CLAUDE_COLORS.text }}>
              生成结果
            </div>
            {results.some(r => r.status === 'done' && r.pdfBlob) && (
              <Button
                fill="none"
                size="small"
                onClick={handleDownloadAll}
                style={{ color: CLAUDE_COLORS.primary, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Download size={14} />
                全部下载
              </Button>
            )}
          </div>
          {results.map((r, i) => {
            const display = getStatusDisplay(r.status)
            return (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 0', borderBottom: i < results.length - 1 ? '1px solid ' + CLAUDE_COLORS.border : 'none'
              }}>
                <div>
                  <div style={{ fontSize: '14px', color: CLAUDE_COLORS.text, fontWeight: 500 }}>
                    {r.student.name}
                  </div>
                  <div style={{ fontSize: '11px', color: display.color, marginTop: '2px' }}>
                    {display.label}
                  </div>
                </div>
                {r.status === 'done' && r.pdfBlob ? (
                  <Button
                    fill="none"
                    size="small"
                    onClick={() => handleDownload(r)}
                    style={{ color: CLAUDE_COLORS.primary, display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Download size={14} />
                    下载
                  </Button>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {/* 学生切换弹窗 */}
      <StudentSwitcher
        visible={showStudentSwitcher}
        onClose={() => setShowStudentSwitcher(false)}
      />
    </div>
  )
}