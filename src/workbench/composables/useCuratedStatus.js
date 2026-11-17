import { ref } from 'vue'
import { queryCuratedStatus } from '../../services/apiService'

/**
 * useCuratedStatus — 批量查收藏状态（五处星标页面共用）
 *
 * 用法：
 *   const { statusMap, loadStatus, isCurated } = useCuratedStatus('question')
 *   await loadStatus([id1, id2, ...])   // 一次请求查全部
 *   模板：:curated="isCurated(q.id)"
 *
 * ⛔ 同一次渲染只发一次请求；页面切题/翻页后重新 loadStatus。
 */
export function useCuratedStatus(sourceType) {
  const statusMap = ref({})

  async function loadStatus(ids) {
    const list = (Array.isArray(ids) ? ids : []).filter(Boolean)
    if (!list.length) { statusMap.value = {}; return }
    try {
      statusMap.value = await queryCuratedStatus(sourceType, list) || {}
    } catch (e) {
      console.error('[useCuratedStatus] 查询失败:', e?.message || e)
      statusMap.value = {}
    }
  }

  function isCurated(id) {
    return !!(statusMap.value?.[id]?.curated)
  }

  function markLocal(id, curated, tags) {
    const next = { ...statusMap.value }
    if (curated) next[id] = { curated: true, tags: tags || [] }
    else delete next[id]
    statusMap.value = next
  }

  return { statusMap, loadStatus, isCurated, markLocal }
}
