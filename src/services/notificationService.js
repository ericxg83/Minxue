import { LocalNotifications } from '@capacitor/local-notifications'
import { Capacitor } from '@capacitor/core'

const STORAGE_KEY = 'minxue_notified_task_ids'
const STORAGE_FAILED_COUNT = 'minxue_notified_failed_count'

const CHANNEL_DONE = 'grading_done'
const CHANNEL_FAILED = 'grading_failed'

const POLL_INTERVAL_MS = 30_000
const FAILED_NOTIF_ID = 99_999
const NOTIFIED_IDS_CAP = 200

let initialized = false
let pollTimer = null

function isNative() {
  return Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios'
}

function loadNotifiedIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

function saveNotifiedIds(set) {
  try {
    const arr = Array.from(set).slice(-NOTIFIED_IDS_CAP)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
  } catch { /* ignore quota */ }
}

function hashUuid(uuid) {
  let h = 0
  for (let i = 0; i < uuid.length; i++) {
    h = (h * 31 + uuid.charCodeAt(i)) | 0
  }
  return Math.abs(h) || 1
}

async function setupChannels() {
  if (Capacitor.getPlatform() !== 'android') return
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_DONE,
      name: '批改完成',
      description: '作业批改完成时通知',
      importance: 4,
      visibility: 1,
      sound: 'default'
    })
    await LocalNotifications.createChannel({
      id: CHANNEL_FAILED,
      name: '识别失败',
      description: '作业识别失败时通知',
      importance: 5,
      visibility: 1,
      sound: 'default'
    })
  } catch (e) {
    console.warn('[Notification] setup channels failed:', e)
  }
}

export async function initNotifications() {
  if (initialized || !isNative()) return
  initialized = true
  try {
    const perm = await LocalNotifications.checkPermissions()
    if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale') {
      await LocalNotifications.requestPermissions()
    }
  } catch (e) {
    console.warn('[Notification] permission check failed:', e)
  }
  await setupChannels()
}

export async function dispatchFromSummary(summary) {
  if (!summary || !isNative()) return

  const notified = loadNotifiedIds()
  const pendingTasks = Array.isArray(summary.pendingTasks) ? summary.pendingTasks : []
  const failedCount = summary.failedTasks || 0

  for (const t of pendingTasks) {
    if (!t.id || notified.has(t.id)) continue
    const name = t.studentName || ''
    const subject = name ? `${name}的作业` : '作业'
    const title = wrong > 0
      ? `${subject}批改完成`
      : `${subject}全部正确`
    const body = wrong > 0
      ? `本次作业有 ${wrong} 道错题，点此查看`
      : '本次作业全部做对，太棒了！'
    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: hashUuid(t.id),
          title,
          body,
          channelId: CHANNEL_DONE,
          extra: { taskId: t.id, type: 'done' },
          smallIcon: 'ic_launcher'
        }]
      })
      notified.add(t.id)
    } catch (e) {
      console.warn('[Notification] schedule done failed:', e)
    }
  }
  saveNotifiedIds(notified)

  const lastFailed = parseInt(localStorage.getItem(STORAGE_FAILED_COUNT) || '0', 10)
  if (failedCount > lastFailed) {
    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: FAILED_NOTIF_ID,
          title: '有作业识别失败',
          body: `当前有 ${failedCount} 个任务识别失败，点击查看`,
          channelId: CHANNEL_FAILED,
          extra: { type: 'failed' },
          smallIcon: 'ic_launcher'
        }]
      })
    } catch (e) {
      console.warn('[Notification] schedule failed-summary failed:', e)
    }
  } else if (failedCount < lastFailed) {
    try {
      await LocalNotifications.cancel({ notifications: [{ id: FAILED_NOTIF_ID }] })
    } catch { /* ignore */ }
  }
  try {
    localStorage.setItem(STORAGE_FAILED_COUNT, String(failedCount))
  } catch { /* ignore */ }
}

export function startNotificationPolling(onSummary) {
  if (!isNative()) return () => {}
  if (pollTimer) return () => {}

  const tick = async () => {
    try {
      const mod = await import('./apiService')
      const data = await mod.getTasksSummary(false)
      if (data?.success) {
        if (onSummary) onSummary(data.summary)
        await dispatchFromSummary(data.summary)
      }
    } catch (e) {
      console.warn('[Notification] poll tick failed:', e)
    }
  }

  tick()
  pollTimer = setInterval(tick, POLL_INTERVAL_MS)

  return () => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
}

export function onNotificationTap(handler) {
  if (!isNative()) return () => {}
  let listener
  LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const extra = action?.notification?.extra || {}
    handler(extra)
  }).then((l) => { listener = l }).catch(() => {})
  return () => {
    try {
      if (listener) listener.remove()
      else LocalNotifications.removeAllListeners()
    } catch { /* ignore */ }
  }
}