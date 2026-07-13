import { useEffect, useState } from 'react'
import {
  Toast,
  SpinLoading,
  Segmented
} from 'antd-mobile'
import { Download } from 'lucide-react'
import { useStudentStore } from '../../store'
import { getAllWeeklyReports } from '../../services/apiService'
import { generateWeeklyReport } from '../../utils/weeklyReportGenerator'
import { saveAs } from 'file-saver'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

dayjs.extend(isoWeek)

const T = {
  primary: '#007AFF', primarySoft: '#E1EFFF',
  success: '#34C759', successSoft: '#E4F8EA',
  danger: '#FF3B30', dangerSoft: '#FFE9E7',
  warning: '#FF9F0A', warningSoft: '#FFF3E0',
  accent: '#FF9500',
  text: '#1C1C1E', textSec: '#6C6C70', textTer: '#A9A9AE',
  border: '#C6C6C8', borderLight: '#E5E5EA', bg: '#F2F2F7', card: '#FFFFFF'
}

function colorForAccuracy(acc) {
  if (acc == null) return T.textTer
  return acc >= 80 ? T.success : acc >= 60 ? T.warning : T.danger
}

/** 老师寄语 */
function buildComment(stats, weakestTag) {
  const parts = []
  const completeRate = stats.totalTasks > 0 ? stats.completedTasks / stats.totalTasks : 0
  if (completeRate >= 0.8) parts.push('本周学习态度认真，作业完成情况良好')
  else if (completeRate >= 0.4) parts.push('本周作业完成情况尚可，仍有提升空间')
  else parts.push('本周作业完成率偏低，请督促孩子按时完成练习')
  if (stats.accuracy >= 85) parts.push('整体正确率优秀，继续保持')
  else if (stats.accuracy >= 60) parts.push(`整体正确率 ${stats.accuracy}%，${weakestTag ? '「' + weakestTag + '」' : '部分知识点'}仍需加强练习`)
  else parts.push(`整体正确率 ${stats.accuracy}%，建议重点复习本周错题，夯实基础`)
  return parts.join('，') + '！'
}

/** 老师建议 */
function buildAdvice(subjectDiagnosis) {
  if (!subjectDiagnosis || subjectDiagnosis.length === 0) {
    return '本周暂无明显薄弱知识点，建议保持练习节奏，适当拓展提高题型。'
  }
  const tips = subjectDiagnosis.slice(0, 2).map(s => {
    const top = s.topTags && s.topTags[0]
    if (top) return `${s.subject}重点加强「${top.tag}」类型题训练`
    return `${s.subject}保持巩固练习`
  })
  return `建议周末${tips.join('；')}；多做变式练习，及时复盘错题，提升举一反三能力。`
}

export default function WeeklyReport() {
  const { currentStudent } = useStudentStore()

  const [generating, setGenerating] = useState(false)
  const [summaryData, setSummaryData] = useState(null)
  const [loadingSummary, setLoadingSummary] = useState(false)

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

  useEffect(() => {
    loadSummary()
  }, [periodMode, periodOffset])

  const loadSummary = async () => {
    setLoadingSummary(true)
    try {
      const data = await getAllWeeklyReports({ mode: periodMode, offset: periodOffset })
      if (data.success) setSummaryData(data)
    } catch (err) {
      console.warn('加载统计摘要失败:', err)
    } finally {
      setLoadingSummary(false)
    }
  }

  const handleDownloadPDF = async () => {
    if (!currentStudent) {
      Toast.show('请先选择学生')
      return
    }
    if (generating) return
    setGenerating(true)
    try {
      const pdfBlob = await generateWeeklyReport(currentStudent.id, { mode: periodMode, offset: periodOffset })
      if (pdfBlob) {
        const suffix = periodMode === 'all' ? '全部时间' : (periodMode === 'month' ? dayjs().subtract(periodOffset, 'month').format('M月') : `第${dayjs().isoWeek()}周`)
        saveAs(pdfBlob, `${currentStudent.name}_周学习诊断报告_${suffix}_${dayjs().format('YYYYMMDD')}.pdf`)
        Toast.show({ icon: 'success', content: '报告已生成' })
      } else {
        Toast.show({ icon: 'fail', content: '本周暂无学习数据' })
      }
    } catch (err) {
      Toast.show({ icon: 'fail', content: '生成失败: ' + (err.message || '未知错误') })
    } finally {
      setGenerating(false)
    }
  }

  const stats = summaryData?.reports?.find(r => r.student?.id === currentStudent?.id)?.stats
  const reportData = summaryData?.reports?.find(r => r.student?.id === currentStudent?.id)
  const subjectDiagnosis = reportData?.subjectDiagnosis || []
  const dailyTrend = reportData?.dailyTrend || []

  // 最薄弱知识点
  let weakestTag = ''
  for (const s of subjectDiagnosis) {
    if (s.topTags && s.topTags[0]) { weakestTag = s.topTags[0].tag; break }
  }
  const teacherComment = stats ? buildComment(stats, weakestTag) : ''
  const teacherAdvice = subjectDiagnosis.length > 0 ? buildAdvice(subjectDiagnosis) : ''

  return (
    <div style={{ background: T.bg, minHeight: '100%' }}>
      {/* 时间段选择 */}
      <div style={{
        background: T.card, padding: '12px 16px', borderBottom: '1px solid ' + T.borderLight,
        display: 'flex', alignItems: 'center', gap: '10px'
      }}>
        <Segmented
          options={[
            { label: '周', value: 'week' },
            { label: '月', value: 'month' },
            { label: '全部', value: 'all' }
          ]}
          value={periodMode}
          onChange={v => { setPeriodMode(v); setPeriodOffset(0) }}
          style={{ '--font-size': '12px', flexShrink: 0 }}
        />
        <div style={{ fontSize: '12px', color: T.textSec }}>{periodLabel}</div>
        {periodMode !== 'all' && (
          <select
            value={periodOffset}
            onChange={e => setPeriodOffset(Number(e.target.value))}
            style={{
              fontSize: '12px', padding: '2px 6px', borderRadius: '6px',
              border: '1px solid ' + T.borderLight, background: T.card, color: T.text, marginLeft: 'auto'
            }}
          >
            {periodMode === 'week' ? (
              <>
                <option value={0}>本周</option>
                <option value={1}>上周</option>
                <option value={2}>前2周</option>
                <option value={3}>前3周</option>
                <option value={4}>前4周</option>
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

      {/* 学生信息 */}
      <div style={{
        background: T.card, padding: '14px 16px', borderBottom: '1px solid ' + T.borderLight,
        display: 'flex', alignItems: 'center', gap: '12px'
      }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '50%',
          background: T.primarySoft, display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden'
        }}>
          {currentStudent?.avatar ? (
            <img src={currentStudent.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <svg width="20" height="20" viewBox="0 0 1024 1024" fill={T.primary}>
              <path d="M512 512c88 0 160-72 160-160s-72-160-160-160-160 72-160 160 72 160 160 160zm0-256c52.8 0 96 43.2 96 96s-43.2 96-96 96-96-43.2-96-96 43.2-96 96-96zm448 544v64c0 35.2-28.8 64-64 64H128c-35.2 0-64-28.8-64-64v-64c0-88 72-160 160-160h32c17.6 0 34.4 3.2 50.4 9.6 33.6 12.8 70.4 20.8 108.8 23.2 9.6 0.8 19.2 1.2 28.8 1.2s19.2-0.4 28.8-1.2c38.4-2.4 75.2-10.4 108.8-23.2 16-6.4 32.8-9.6 50.4-9.6h32c88 0 160 72 160 160zM128 800h768c0-52.8-43.2-96-96-96h-32c-11.2 0-22.4 2.4-32.8 6.4-40 16-84.8 25.6-130.4 28.8-11.2 0.8-22.4 1.2-33.6 1.2s-22.4-0.4-33.6-1.2c-45.6-3.2-90.4-12.8-130.4-28.8-10.4-4-21.6-6.4-32.8-6.4h-32c-52.8 0-96 43.2-96 96z"/>
            </svg>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: T.text }}>
            {currentStudent?.name || '未选择学生'}
          </div>
          <div style={{ fontSize: '12px', color: T.textSec }}>{currentStudent?.grade || currentStudent?.class || ''}</div>
        </div>
      </div>

      {/* 加载中 */}
      {loadingSummary && (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <SpinLoading style={{ '--size': '24px' }} />
          <div style={{ fontSize: '13px', color: T.textSec, marginTop: '8px' }}>加载中...</div>
        </div>
      )}

      {/* 报告内容 */}
      {!loadingSummary && (
        <>
          {/* KPI 概览卡片 */}
          <div style={{ padding: '12px' }}>
            <div style={{
              background: T.card, borderRadius: '14px', padding: '16px',
              border: '1px solid ' + T.borderLight
            }}>
              <div style={{ fontSize: '15px', fontWeight: 600, color: T.text, marginBottom: '14px' }}>
                学习概览
              </div>
              {stats ? (
                <>
                  {/* 三个核心指标 */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                    <div style={{ textAlign: 'center', padding: '12px 8px', background: T.primarySoft, borderRadius: '10px' }}>
                      <div style={{ fontSize: '24px', fontWeight: 700, color: T.primary }}>{stats.completedTasks || 0}</div>
                      <div style={{ fontSize: '11px', color: T.textSec, marginTop: '2px' }}>完成作业</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '12px 8px', background: T.successSoft, borderRadius: '10px' }}>
                      <div style={{ fontSize: '24px', fontWeight: 700, color: stats.accuracy >= 80 ? T.success : T.danger }}>
                        {stats.accuracy || 0}%
                      </div>
                      <div style={{ fontSize: '11px', color: T.textSec, marginTop: '2px' }}>正确率</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '12px 8px', background: T.warningSoft, borderRadius: '10px' }}>
                      <div style={{ fontSize: '24px', fontWeight: 700, color: stats.newWrongCount > 0 ? T.warning : T.success }}>
                        {stats.newWrongCount || 0}
                      </div>
                      <div style={{ fontSize: '11px', color: T.textSec, marginTop: '2px' }}>新增错题</div>
                    </div>
                  </div>

                  {/* 第二行微指标 */}
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ flex: 1, background: '#F8F9FA', borderRadius: '8px', padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: T.text }}>{stats.totalQuestions || 0}</div>
                      <div style={{ fontSize: '10px', color: T.textSec, marginTop: '1px' }}>批改题量</div>
                    </div>
                    <div style={{ flex: 1, background: '#F8F9FA', borderRadius: '8px', padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: T.text }}>{stats.masteredCount || 0}</div>
                      <div style={{ fontSize: '10px', color: T.textSec, marginTop: '1px' }}>已掌握</div>
                    </div>
                    <div style={{ flex: 1, background: '#F8F9FA', borderRadius: '8px', padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: T.text }}>{stats.pendingCount || 0}</div>
                      <div style={{ fontSize: '10px', color: T.textSec, marginTop: '1px' }}>待提升</div>
                    </div>
                  </div>

                  {/* 老师寄语 */}
                  <div style={{
                    marginTop: '16px', background: T.primarySoft, borderRadius: '10px',
                    padding: '14px 16px'
                  }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: T.primary, marginBottom: '6px' }}>
                      老师寄语
                    </div>
                    <div style={{ fontSize: '13px', color: T.textSec, lineHeight: 1.6 }}>
                      {teacherComment}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '20px', color: T.textTer, fontSize: '13px' }}>
                  {currentStudent ? '暂无学习数据' : '请选择学生'}
                </div>
              )}
            </div>

            {/* 学科诊断 */}
            {subjectDiagnosis.length > 0 && (
              <div style={{
                background: T.card, borderRadius: '14px', padding: '16px', marginTop: '12px',
                border: '1px solid ' + T.borderLight
              }}>
                <div style={{ fontSize: '15px', fontWeight: 600, color: T.text, marginBottom: '12px' }}>
                  学科诊断
                </div>
                {subjectDiagnosis.map((s, i) => (
                  <div key={i} style={{ marginBottom: i < subjectDiagnosis.length - 1 ? '12px' : 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: T.text }}>{s.subject}</span>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: colorForAccuracy(s.accuracy) }}>
                        正确率 {s.accuracy != null ? s.accuracy + '%' : '--'}
                      </span>
                    </div>
                    {s.topTags && s.topTags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {s.topTags.slice(0, 3).map((t, j) => (
                          <span key={j} style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            padding: '3px 10px', borderRadius: '20px', fontSize: '11px',
                            background: t.wrongCount >= 3 ? T.dangerSoft : T.primarySoft,
                            color: t.wrongCount >= 3 ? T.danger : T.primary
                          }}>
                            {t.tag}
                            <span style={{ fontWeight: 600 }}>{t.wrongCount}次</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {/* 老师建议 */}
                <div style={{
                  marginTop: '12px', background: '#FFF7ED', borderRadius: '10px',
                  padding: '12px 14px', border: '1px solid #FED7AA'
                }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: T.accent, marginBottom: '4px' }}>
                    老师建议
                  </div>
                  <div style={{ fontSize: '13px', color: '#9A3412', lineHeight: 1.6 }}>
                    {teacherAdvice}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 下载 PDF（次要操作） */}
          <div style={{ padding: '0 12px 20px' }}>
            <button
              onClick={handleDownloadPDF}
              disabled={generating || !currentStudent}
              style={{
                width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid ' + T.borderLight,
                background: T.card, color: T.textSec, fontSize: '14px', fontWeight: 500,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                cursor: generating || !currentStudent ? 'not-allowed' : 'pointer', opacity: generating || !currentStudent ? 0.5 : 1
              }}
            >
              {generating ? '生成中...' : <Download size={16} />}
              {generating ? '正在生成 PDF...' : '下载完整报告 PDF'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}