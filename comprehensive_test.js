/**
 * 敏学App V3 综合功能测试脚本
 * 测试前端和后端的所有API接口功能
 * 自动生成测试报告
 */
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createServer } from './server/index.js'
import { query, TABLES, TASK_STATUS } from './server/config/neon.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE_URL = 'http://localhost:3001/api'
const PORT = 3001

// Test results tracking
const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  details: [],
  startTime: null,
  endTime: null
}

// Test data tracking
let testStudentId = null
let testTaskId = null
let testQuestionId = null
let testWrongQuestionId = null
let testExamId = null

// Helper functions
function log(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString('zh-CN')
  const prefix = {
    info: '📝',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    test: '🧪',
    section: '📋',
    report: '📊'
  }[type] || '📝'
  
  console.log(`${prefix} [${timestamp}] ${message}`)
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function test(name, fn, category = 'general') {
  testResults.total++
  const startTime = Date.now()
  
  try {
    log(`测试: ${name}`, 'test')
    await fn()
    const duration = Date.now() - startTime
    testResults.passed++
    log(`✓ 通过 (${duration}ms)`, 'success')
    testResults.details.push({
      name,
      category,
      status: 'PASSED',
      duration,
      error: null,
      timestamp: new Date().toISOString()
    })
  } catch (err) {
    const duration = Date.now() - startTime
    testResults.failed++
    log(`✗ 失败: ${err.message}`, 'error')
    testResults.details.push({
      name,
      category,
      status: 'FAILED',
      duration,
      error: err.message,
      timestamp: new Date().toISOString()
    })
  }
}

function section(name) {
  log(`\n${'='.repeat(50)}`, 'section')
  log(`模块: ${name}`, 'section')
  log(`${'='.repeat(50)}\n`, 'section')
}

// Cleanup test data
async function cleanupTestData(studentId) {
  if (!studentId) return
  try {
    log('清理测试数据...', 'info')
    await query(`DELETE FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1`, [studentId])
    await query(`DELETE FROM ${TABLES.GENERATED_EXAMS} WHERE student_id = $1`, [studentId])
    await query(`DELETE FROM ${TABLES.QUESTIONS} WHERE student_id = $1`, [studentId])
    await query(`DELETE FROM ${TABLES.TASKS} WHERE student_id = $1`, [studentId])
    await query(`DELETE FROM ${TABLES.STUDENTS} WHERE id = $1`, [studentId])
    log('测试数据清理完成', 'success')
  } catch (err) {
    log(`清理警告: ${err.message}`, 'warning')
  }
}

// Generate test report
function generateReport() {
  testResults.endTime = new Date().toISOString()
  
  const totalDuration = testResults.total > 0 
    ? testResults.details.reduce((sum, d) => sum + d.duration, 0) 
    : 0
  const avgDuration = testResults.total > 0 
    ? (totalDuration / testResults.total).toFixed(2) 
    : 0
  const successRate = testResults.total > 0 
    ? ((testResults.passed / testResults.total) * 100).toFixed(1) 
    : 0

  const report = {
    metadata: {
      appName: '敏学App V3',
      testType: '综合功能测试',
      testDate: testResults.endTime,
      startTime: testResults.startTime,
      duration: totalDuration,
      totalDurationFormatted: `${(totalDuration / 1000).toFixed(2)}s`
    },
    summary: {
      total: testResults.total,
      passed: testResults.passed,
      failed: testResults.failed,
      skipped: testResults.skipped,
      successRate: `${successRate}%`,
      avgResponseTime: `${avgDuration}ms`
    },
    categories: {},
    details: testResults.details,
    recommendations: []
  }

  // Group by category
  testResults.details.forEach(detail => {
    if (!report.categories[detail.category]) {
      report.categories[detail.category] = {
        total: 0,
        passed: 0,
        failed: 0,
        tests: []
      }
    }
    report.categories[detail.category].total++
    if (detail.status === 'PASSED') {
      report.categories[detail.category].passed++
    } else {
      report.categories[detail.category].failed++
    }
    report.categories[detail.category].tests.push(detail)
  })

  // Generate recommendations
  if (testResults.failed > 0) {
    const failedTests = testResults.details.filter(d => d.status === 'FAILED')
    report.recommendations.push(`有 ${testResults.failed} 个测试失败，请检查相关接口`)
    
    const categories = [...new Set(failedTests.map(t => t.category))]
    if (categories.length > 0) {
      report.recommendations.push(`失败模块: ${categories.join(', ')}`)
    }
  }

  if (successRate >= 90) {
    report.recommendations.push('系统整体运行良好，核心功能正常')
  } else if (successRate >= 70) {
    report.recommendations.push('部分功能存在问题，建议优先修复')
  } else {
    report.recommendations.push('系统存在较多问题，需要全面检查和修复')
  }

  return report
}

// Print report to console
function printReport(report) {
  log('\n\n', 'info')
  log('╔═══════════════════════════════════════════════════════════╗', 'report')
  log('║           敏学App V3 功能性测试报告                       ║', 'report')
  log('╚═══════════════════════════════════════════════════════════╝', 'report')
  
  log(`\n测试时间: ${report.metadata.testDate}`, 'report')
  log(`测试时长: ${report.metadata.totalDurationFormatted}`, 'report')
  
  log('\n┌─────────────────────────────────────────────────────┐', 'report')
  log('│                  测试概要                             │', 'report')
  log('├─────────────────────────────────────────────────────┤', 'report')
  log(`│ 总测试数: ${String(report.summary.total).padEnd(36)}│`, 'report')
  log(`│ 通过数量: ${String(report.summary.passed).padEnd(36)}│`, 'report')
  log(`│ 失败数量: ${String(report.summary.failed).padEnd(36)}│`, 'report')
  log(`│ 成功率:   ${String(report.summary.successRate).padEnd(36)}│`, 'report')
  log(`│ 平均响应: ${String(report.summary.avgResponseTime).padEnd(36)}│`, 'report')
  log('└─────────────────────────────────────────────────────┘\n', 'report')

  // Category breakdown
  log('┌─────────────────────────────────────────────────────┐', 'report')
  log('│                  模块测试详情                         │', 'report')
  log('├─────────────────────────────────────────────────────┤', 'report')
  
  Object.entries(report.categories).forEach(([category, data]) => {
    const rate = ((data.passed / data.total) * 100).toFixed(0)
    log(`│ ${category.padEnd(47)}│`, 'report')
    log(`│   通过: ${data.passed}/${data.total} (${rate}%)${' '.repeat(27 - String(data.passed).length - String(data.total).length - String(rate).length)}│`, 'report')
    log('├─────────────────────────────────────────────────────┤', 'report')
  })

  // Failed tests details
  const failedTests = testResults.details.filter(d => d.status === 'FAILED')
  if (failedTests.length > 0) {
    log('\n┌─────────────────────────────────────────────────────┐', 'report')
    log('│                  失败测试详情                         │', 'report')
    log('├─────────────────────────────────────────────────────┤', 'report')
    failedTests.forEach((t, i) => {
      log(`│ ${i + 1}. ${t.name}`, 'report')
      log(`│    错误: ${t.error.substring(0, 40)}`, 'report')
      log('├─────────────────────────────────────────────────────┤', 'report')
    })
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    log('\n┌─────────────────────────────────────────────────────┐', 'report')
    log('│                  建议                                 │', 'report')
    log('├─────────────────────────────────────────────────────┤', 'report')
    report.recommendations.forEach(rec => {
      log(`│ • ${rec.substring(0, 49).padEnd(49)}│`, 'report')
    })
    log('└─────────────────────────────────────────────────────┘\n', 'report')
  }
}

// ==================== TEST CASES ====================

async function runTests() {
  testResults.startTime = new Date().toISOString()
  let serverInstance = null

  try {
    // Start server
    section('启动服务')
    log('正在启动后端服务...', 'info')
    serverInstance = await createServer(PORT)
    await delay(1500)
    log('后端服务启动成功', 'success')

    // Test 1: Health Check
    section('系统健康检查')
    await test('健康检查接口', async () => {
      const res = await fetch(`${BASE_URL}/health`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.status !== 'ok') throw new Error(`状态异常: ${data.status}`)
    }, 'system')

    // Test 2: Diagnostics
    await test('诊断接口', async () => {
      const res = await fetch(`${BASE_URL}/diagnostics/worker-status`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.success) throw new Error('诊断接口返回失败')
    }, 'system')

    await test('队列统计接口', async () => {
      const res = await fetch(`${BASE_URL}/queue/stats`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.success) throw new Error('队列统计返回失败')
    }, 'system')

    // Test 3: Students CRUD
    section('学生管理模块')
    await test('创建学生', async () => {
      const res = await fetch(`${BASE_URL}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `测试学生_${Date.now()}`,
          grade: '高三·1班',
          avatar: 'https://example.com/avatar.jpg'
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`HTTP ${res.status}: ${err.error}`)
      }
      const data = await res.json()
      testStudentId = data.student?.id || data.id
      if (!testStudentId) throw new Error('未返回学生ID')
      log(`创建学生成功, ID: ${testStudentId}`, 'success')
    }, 'students')

    await test('获取学生列表', async () => {
      const res = await fetch(`${BASE_URL}/students`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.students) throw new Error('未返回学生列表')
      if (!Array.isArray(data.students)) throw new Error('学生列表格式错误')
      log(`学生数量: ${data.students.length}`, 'success')
    }, 'students')

    await test('更新学生信息', async () => {
      const res = await fetch(`${BASE_URL}/students/${testStudentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '更新后的学生名',
          grade: '高二·2班'
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`HTTP ${res.status}: ${err.error}`)
      }
      const data = await res.json()
      if (data.student?.name !== '更新后的学生名') {
        throw new Error('学生名称未更新')
      }
    }, 'students')

    // Test 4: Tasks
    section('任务管理模块')
    await test('获取学生任务(空)', async () => {
      const res = await fetch(`${BASE_URL}/tasks/student/${testStudentId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.tasks) throw new Error('未返回任务列表')
      log(`任务数量: ${data.tasks.length}`, 'success')
    }, 'tasks')

    await test('创建任务(通过URL)', async () => {
      const res = await fetch(`${BASE_URL}/tasks/create-by-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: testStudentId,
          imageUrl: 'https://example.com/test-image.jpg',
          originalName: '测试试卷.jpg'
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`HTTP ${res.status}: ${err.error}`)
      }
      const data = await res.json()
      testTaskId = data.task?.id
      if (!testTaskId) throw new Error('未返回任务ID')
      log(`任务创建成功, ID: ${testTaskId}`, 'success')
    }, 'tasks')

    await test('获取单个任务', async () => {
      const res = await fetch(`${BASE_URL}/tasks/${testTaskId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.task) throw new Error('未返回任务数据')
      if (data.task.id !== testTaskId) throw new Error('任务ID不匹配')
    }, 'tasks')

    await test('获取学生任务列表(非空)', async () => {
      const res = await fetch(`${BASE_URL}/tasks/student/${testStudentId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.tasks || data.tasks.length === 0) throw new Error('任务列表为空')
      log(`任务数量: ${data.tasks.length}`, 'success')
    }, 'tasks')

    await test('重试任务', async () => {
      const res = await fetch(`${BASE_URL}/tasks/${testTaskId}/retry`, {
        method: 'POST'
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`HTTP ${res.status}: ${err.error}`)
      }
      const data = await res.json()
      if (!data.success) throw new Error('任务重试失败')
    }, 'tasks')

    // Test 5: Questions
    section('题目管理模块')
    await test('创建题目', async () => {
      const res = await fetch(`${BASE_URL}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: testTaskId,
          student_id: testStudentId,
          content: '已知三角形ABC中，∠A=30°，∠B=60°，求∠C的度数',
          answer: '90°',
          options: ['30°', '60°', '90°', '120°'],
          question_type: 'choice',
          subject: '数学',
          analysis: '三角形内角和为180°',
          status: 'pending'
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`HTTP ${res.status}: ${err.error}`)
      }
      const data = await res.json()
      testQuestionId = data.question?.id
      if (!testQuestionId) throw new Error('未返回题目ID')
      log(`题目创建成功, ID: ${testQuestionId}`, 'success')
    }, 'questions')

    await test('获取任务题目列表', async () => {
      const res = await fetch(`${BASE_URL}/questions/task/${testTaskId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.questions) throw new Error('未返回题目列表')
      if (data.questions.length === 0) throw new Error('题目列表为空')
      log(`题目数量: ${data.questions.length}`, 'success')
    }, 'questions')

    await test('更新题目', async () => {
      const res = await fetch(`${BASE_URL}/questions/${testQuestionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '更新后的题目内容',
          answer: '更新后的答案'
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`HTTP ${res.status}: ${err.error}`)
      }
      const data = await res.json()
      if (data.question?.content !== '更新后的题目内容') {
        throw new Error('题目内容未更新')
      }
    }, 'questions')

    await test('批量获取题目', async () => {
      const res = await fetch(`${BASE_URL}/questions/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: [testQuestionId]
        })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.questions) throw new Error('未返回题目列表')
      if (data.questions.length === 0) throw new Error('批量获取题目为空')
    }, 'questions')

    await test('批量更新标签(空操作)', async () => {
      const res = await fetch(`${BASE_URL}/questions/batch-update-tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: []
        })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.success) throw new Error('批量更新标签失败')
    }, 'questions')

    // Test 6: Wrong Questions
    section('错题本模块')
    await test('添加错题', async () => {
      const res = await fetch(`${BASE_URL}/wrong-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: testStudentId,
          questionIds: [testQuestionId]
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`HTTP ${res.status}: ${err.error}`)
      }
      const data = await res.json()
      if (!data.added) throw new Error('未返回添加结果')
      log(`添加错题成功, 数量: ${data.added.length}`, 'success')
    }, 'wrong-questions')

    await test('获取学生错题列表', async () => {
      const res = await fetch(`${BASE_URL}/wrong-questions/student/${testStudentId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.wrongQuestions) throw new Error('未返回错题列表')
      if (data.wrongQuestions.length === 0) throw new Error('错题列表为空')
      testWrongQuestionId = data.wrongQuestions[0]?.id
      log(`错题数量: ${data.wrongQuestions.length}`, 'success')
    }, 'wrong-questions')

    await test('更新错题状态', async () => {
      const res = await fetch(`${BASE_URL}/wrong-questions/${testWrongQuestionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'mastered'
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`HTTP ${res.status}: ${err.error}`)
      }
      const data = await res.json()
      if (!data.success) throw new Error('更新错题状态失败')
    }, 'wrong-questions')

    // Test 7: Generated Exams
    section('生成试卷模块')
    await test('创建试卷', async () => {
      const res = await fetch(`${BASE_URL}/generated-exams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: testStudentId,
          name: `测试错题卷_${Date.now()}`,
          questionIds: ['q-test-1', 'q-test-2', 'q-test-3']
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`HTTP ${res.status}: ${err.error}`)
      }
      const data = await res.json()
      testExamId = data.exam?.id
      if (!testExamId) throw new Error('未返回试卷ID')
      log(`试卷创建成功, ID: ${testExamId}`, 'success')
    }, 'exams')

    await test('获取学生试卷列表', async () => {
      const res = await fetch(`${BASE_URL}/generated-exams/student/${testStudentId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.generatedExams) throw new Error('未返回试卷列表')
      if (data.generatedExams.length === 0) throw new Error('试卷列表为空')
      log(`试卷数量: ${data.generatedExams.length}`, 'success')
    }, 'exams')

    await test('获取考试列表(兼容接口)', async () => {
      const res = await fetch(`${BASE_URL}/exams/student/${testStudentId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.exams) throw new Error('未返回考试列表')
      log(`考试数量: ${data.exams.length}`, 'success')
    }, 'exams')

    // Test 8: Delete Operations
    section('删除操作模块')
    await test('删除试卷', async () => {
      const res = await fetch(`${BASE_URL}/generated-exams/${testExamId}`, {
        method: 'DELETE'
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`HTTP ${res.status}: ${err.error}`)
      }
      const data = await res.json()
      if (!data.success) throw new Error('删除试卷失败')
    }, 'delete')

    await test('删除错题', async () => {
      const res = await fetch(`${BASE_URL}/wrong-questions/${testWrongQuestionId}`, {
        method: 'DELETE'
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`HTTP ${res.status}: ${err.error}`)
      }
      const data = await res.json()
      if (!data.success) throw new Error('删除错题失败')
    }, 'delete')

    await test('删除任务', async () => {
      const res = await fetch(`${BASE_URL}/tasks/${testTaskId}`, {
        method: 'DELETE'
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`HTTP ${res.status}: ${err.error}`)
      }
      const data = await res.json()
      if (!data.success) throw new Error('删除任务失败')
    }, 'delete')

    await test('删除学生', async () => {
      const res = await fetch(`${BASE_URL}/students/${testStudentId}`, {
        method: 'DELETE'
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(`HTTP ${res.status}: ${err.error}`)
      }
      const data = await res.json()
      if (!data.success) throw new Error('删除学生失败')
    }, 'delete')

    // Generate and print report
    const report = generateReport()
    printReport(report)
    
    // Save report to file
    try {
      const fs = await import('fs')
      const reportPath = resolve(__dirname, 'test_report.json')
      fs.default.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
      log(`\n📄 测试报告已保存至: ${reportPath}`, 'success')
      
      // Also save as HTML
      const htmlReport = generateHTMLReport(report)
      const htmlPath = resolve(__dirname, 'test_report.html')
      fs.default.writeFileSync(htmlPath, htmlReport, 'utf-8')
      log(`📄 HTML报告已保存至: ${htmlPath}`, 'success')
    } catch (err) {
      log(`保存报告失败: ${err.message}`, 'error')
    }

  } catch (err) {
    log(`\n❌ 测试套件执行失败: ${err.message}`, 'error')
    console.error(err.stack)
  } finally {
    // Cleanup
    await cleanupTestData(testStudentId)
    
    if (serverInstance) {
      serverInstance.close()
      log('\n🛑 后端服务已停止', 'info')
    }
  }

  process.exit(testResults.failed > 0 ? 1 : 0)
}

function generateHTMLReport(report) {
  const passedColor = '#22c55e'
  const failedColor = '#ef4444'
  const warningColor = '#f59e0b'
  
  const categoryRows = Object.entries(report.categories).map(([name, data]) => {
    const rate = ((data.passed / data.total) * 100).toFixed(0)
    const color = rate === '100' ? passedColor : rate >= '70' ? warningColor : failedColor
    return `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 12px 16px;">${name}</td>
        <td style="padding: 12px 16px; text-align: center;">${data.total}</td>
        <td style="padding: 12px 16px; text-align: center; color: ${passedColor};">${data.passed}</td>
        <td style="padding: 12px 16px; text-align: center; color: ${failedColor};">${data.failed}</td>
        <td style="padding: 12px 16px; text-align: center; color: ${color}; font-weight: bold;">${rate}%</td>
      </tr>
    `
  }).join('')

  const failedTests = report.details.filter(d => d.status === 'FAILED')
  const failedRows = failedTests.length > 0 ? failedTests.map((t, i) => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 12px 16px;">${i + 1}</td>
      <td style="padding: 12px 16px;">${t.name}</td>
      <td style="padding: 12px 16px;">${t.category}</td>
      <td style="padding: 12px 16px; color: ${failedColor};">${t.error || '未知错误'}</td>
      <td style="padding: 12px 16px; text-align: center;">${t.duration}ms</td>
    </tr>
  `).join('') : '<tr><td colspan="5" style="padding: 20px; text-align: center; color: #22c55e;">🎉 无失败测试</td></tr>'

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>敏学App V3 - 功能性测试报告</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 40px 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
      color: white;
      padding: 40px;
      text-align: center;
    }
    .header h1 {
      font-size: 32px;
      margin-bottom: 10px;
    }
    .header p {
      font-size: 16px;
      opacity: 0.9;
    }
    .content {
      padding: 40px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .stat-card {
      background: #f8fafc;
      border-radius: 12px;
      padding: 24px;
      text-align: center;
    }
    .stat-card .value {
      font-size: 36px;
      font-weight: bold;
      margin-bottom: 8px;
    }
    .stat-card .label {
      font-size: 14px;
      color: #64748b;
    }
    .passed { color: #22c55e; }
    .failed { color: #ef4444; }
    .success-rate { color: #3b82f6; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 40px;
    }
    th {
      background: #f8fafc;
      padding: 12px 16px;
      text-align: left;
      font-weight: 600;
      color: #1e293b;
      border-bottom: 2px solid #e2e8f0;
    }
    td {
      padding: 12px 16px;
      color: #334155;
    }
    h2 {
      font-size: 24px;
      color: #1e293b;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #e2e8f0;
    }
    .recommendations {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .recommendations ul {
      margin-left: 20px;
      margin-top: 10px;
    }
    .recommendations li {
      margin-bottom: 8px;
      color: #92400e;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 敏学App V3 功能性测试报告</h1>
      <p>生成时间: ${report.metadata.testDate}</p>
    </div>
    <div class="content">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="value">${report.summary.total}</div>
          <div class="label">总测试数</div>
        </div>
        <div class="stat-card">
          <div class="value passed">${report.summary.passed}</div>
          <div class="label">通过数量</div>
        </div>
        <div class="stat-card">
          <div class="value failed">${report.summary.failed}</div>
          <div class="label">失败数量</div>
        </div>
        <div class="stat-card">
          <div class="value success-rate">${report.summary.successRate}</div>
          <div class="label">成功率</div>
        </div>
        <div class="stat-card">
          <div class="value" style="color: #8b5cf6;">${report.summary.avgResponseTime}</div>
          <div class="label">平均响应时间</div>
        </div>
      </div>

      <h2>📋 模块测试详情</h2>
      <table>
        <thead>
          <tr>
            <th>模块名称</th>
            <th style="text-align: center;">总数</th>
            <th style="text-align: center;">通过</th>
            <th style="text-align: center;">失败</th>
            <th style="text-align: center;">成功率</th>
          </tr>
        </thead>
        <tbody>
          ${categoryRows}
        </tbody>
      </table>

      <h2>❌ 失败测试详情</h2>
      <table>
        <thead>
          <tr>
            <th>序号</th>
            <th>测试名称</th>
            <th>所属模块</th>
            <th>错误信息</th>
            <th style="text-align: center;">耗时</th>
          </tr>
        </thead>
        <tbody>
          ${failedRows}
        </tbody>
      </table>

      ${report.recommendations.length > 0 ? `
        <h2>💡 建议</h2>
        <div class="recommendations">
          <ul>
            ${report.recommendations.map(r => `<li>${r}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  </div>
</body>
</html>
  `.trim()
}

// Run tests
runTests().catch(err => {
  console.error('\n❌ 致命错误:', err.message)
  console.error(err.stack)
  process.exit(1)
})
