import { Camera, X, Upload, Loader2, Image as ImageIcon, Crop, RotateCw, Check } from 'lucide-react'
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { isNativeCameraAvailable } from '../services/nativeCamera'
import { useStudentStore } from '../store'
import EmptyState from './EmptyState'
import ImageCropper from './ImageCropper'

// HEIC 预览格：浏览器解不开 HEIC 时 onError 切占位（不白屏）。
// HEIC 上传由后端 fixFileIfNeeded needsHeicTranscode 用 heic-decode 转 jpg。
// HEIC 不提供裁剪入口：WebView canvas 解不开 HEIC，裁剪必然失败，留给上传管线的转码环节。
//
// B1 多学生标注（2026-10-29）：每张图左下挂学生名章（未指定为虚线「+ 学生」）；
// 多选模式下整格点击勾选、右上角显勾选圈，批量归给学生由底部浮条完成。
function HeicPreviewCell({ p, studentName, onRemove, onCrop, onRotate, multiSelect, checked, onToggle, onOpenPicker }) {
  const [errored, setErrored] = useState(false)
  const showPlaceholder = errored || !p.url
  return (
    <div
      onClick={multiSelect ? onToggle : undefined}
      className="relative rounded-lg overflow-hidden"
      style={{
        aspectRatio: '1 / 1',
        background: 'var(--bg-secondary)',
        cursor: multiSelect ? 'pointer' : 'default',
        outline: multiSelect && checked ? '2px solid var(--primary)' : 'none',
        outlineOffset: '-2px'
      }}
    >
      {showPlaceholder ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ color: 'var(--text-secondary)' }}>
          <ImageIcon size={20} />
          {p.isHeic && <span style={{ fontSize: 'var(--fs-10)' }}>HEIC</span>}
        </div>
      ) : (
        <img
          src={p.url}
          alt={p.name}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
        />
      )}
      {multiSelect ? (
        <div
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center"
          style={{
            background: checked ? 'var(--primary)' : 'rgba(255,255,255,0.9)',
            border: checked ? 'none' : '1px solid var(--border)',
            color: '#fff'
          }}
          aria-label={checked ? '取消勾选这张图片' : '勾选这张图片'}
        >
          {checked && <Check size={12} />}
        </div>
      ) : (
        <>
          {onCrop && !showPlaceholder && !p.isHeic && (
            <button
              onClick={(e) => { e.stopPropagation(); onCrop() }}
              className="absolute top-1 left-1 w-5 h-5 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}
              aria-label="裁剪这张图片"
            >
              <Crop size={11} />
            </button>
          )}
          {onRotate && !showPlaceholder && !p.isHeic && (
            <button
              onClick={(e) => { e.stopPropagation(); onRotate() }}
              className="absolute bottom-1 right-1 w-5 h-5 rounded-full flex items-center justify-center active:scale-90 transition-transform"
              style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}
              aria-label="旋转摆正这张图片（每次顺时针90°）"
              title="旋转摆正"
            >
              <RotateCw size={11} />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 'var(--fs-12)' }}
            aria-label="移除这张图片"
          >x</button>
          {onOpenPicker && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenPicker() }}
              className="absolute bottom-1 left-1 px-1.5 h-[18px] rounded-full flex items-center active:scale-95 transition-transform"
              style={studentName
                ? { background: 'rgba(15,110,86,0.88)', color: '#fff', fontSize: 'var(--fs-10)' }
                : { background: 'rgba(255,255,255,0.92)', color: 'var(--warning)', border: '1px dashed var(--warning)', fontSize: 'var(--fs-10)' }}
              aria-label={studentName ? `已归给 ${studentName}，点击更换` : '指定学生'}
            >
              {studentName || '+ 学生'}
            </button>
          )}
        </>
      )}
    </div>
  )
}

export default function StagingModal({
  stagingType,
  stagingFiles,
  stagingUploading,
  cameraInputRef,
  albumInputRef,
  onBackdrop,
  onClose,
  onCamera,
  onAlbum,
  cameraBusy = false,
  onFilesSelected,
  onRemoveFile,
  onCropFile,
  onRotateFile,
  onAssignStudent,
  onSubmit
}) {
  const title = stagingType === 'homework' ? '日常作业' : '错题重练 · 上传答卷'
  // 原生平台走系统相机/相册，可以连拍；Web 端只有一次性的文件选择器。
  const native = isNativeCameraAvailable()

  // 2026-09-15 裁剪入口只对普通录入开放：
  // - workbook：练习册批改靠整页课时编号硬锚定，裁掉页眉会破坏答案锚定
  // - wrong_retry / retry_bound：重练卷靠卷面二维码绑 examId，裁掉二维码进不了重练批改
  // 2026-10-18：「普通试卷」(regular) 路线已随 exam 答案库批改路线一并下线，只剩 homework。
  const canCrop = !!onCropFile && stagingType === 'homework'
  const [croppingIdx, setCroppingIdx] = useState(null)
  const croppingPreview = canCrop && croppingIdx != null ? stagingFiles[croppingIdx] : null

  // B1 多学生标注：picking=待指定学生的图片 idx 数组；multiSelect 时点图入 selected，浮条批量归组。
  // 学生数据自取 store（与首页切换器同源），停课生不可标注，但已标注的停课生名字仍可显示。
  const { students, currentStudent } = useStudentStore()
  const [picking, setPicking] = useState(null)
  const [multiSelect, setMultiSelect] = useState(false)
  const [selected, setSelected] = useState(() => new Set())

  const allStudents = Array.isArray(students) ? students : []
  const assignable = allStudents.filter((s) => s.enrollment_status !== 'paused')
  const nameOf = (sid) => allStudents.find((s) => s.id === sid)?.name

  // 提交三态：部分指定 → 禁用并提示剩余数；全指定 ≥2 人 → 拆任务；其余沿用现状文案
  const assignedCount = stagingFiles.filter((p) => p.studentId).length
  const distinctIds = [...new Set(stagingFiles.filter((p) => p.studentId).map((p) => p.studentId))]
  const hasUnassigned = assignedCount > 0 && assignedCount < stagingFiles.length
  const submitDisabled = stagingUploading || hasUnassigned
  const submitLabel = stagingUploading
    ? '上传中...'
    : hasUnassigned
      ? `还有 ${stagingFiles.length - assignedCount} 张未指定学生`
      : distinctIds.length >= 2
        ? `提交 · 拆成 ${distinctIds.length} 个学生任务`
        : `上传 ${stagingFiles.length} 张图片${stagingFiles.length > 1 ? '（合并为一个任务）' : ''}`

  const exitMultiSelect = () => { setMultiSelect(false); setSelected(new Set()) }
  const toggleMulti = () => { if (multiSelect) exitMultiSelect(); else setMultiSelect(true) }
  const toggleSelect = (idx) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }
  const confirmAssign = (studentId) => {
    if (picking) onAssignStudent?.(picking, studentId)
    setPicking(null)
    exitMultiSelect()
  }

  return (
    <div className="absolute inset-0 z-[25000] flex items-end justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onBackdrop}
      />
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="relative bg-white rounded-t-3xl w-full max-w-lg mx-auto shadow-xl"
        style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
      >
        <input ref={cameraInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" multiple style={{ display: 'none' }} onChange={onFilesSelected} />
        <input ref={albumInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple style={{ display: 'none' }} onChange={onFilesSelected} />

        <div className="flex justify-center pt-3 pb-1">
          <div className="w-8 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>
        <div className="px-6 pt-2 pb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[17px] font-semibold" style={{ color: 'var(--text)' }}>
              {title}
            </h3>
            <div className="flex items-center gap-2">
              {stagingType === 'homework' && stagingFiles.length > 0 && assignable.length > 0 && (
                <button
                  onClick={toggleMulti}
                  className="px-2.5 py-1 rounded-full text-[12px] font-medium active:scale-95 transition-transform"
                  style={multiSelect
                    ? { background: 'var(--primary)', color: '#fff' }
                    : { background: 'var(--bg-mist)', color: 'var(--text-secondary)' }}
                >
                  {multiSelect ? '完成' : '多选'}
                </button>
              )}
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90"
                style={{ background: 'var(--bg-mist)' }}
                aria-label="关闭暂存区"
              >
                <X size={14} style={{ color: 'var(--text-secondary)' }} />
              </button>
            </div>
          </div>

          {/* 拍照 + 相册按钮 */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={onCamera}
              disabled={cameraBusy}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-60"
              style={{ background: 'var(--primary)', color: '#fff' }}
            >
              {cameraBusy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
              拍照
            </button>
            <button
              onClick={onAlbum}
              disabled={cameraBusy}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-60"
              style={{ background: 'var(--bg-mist)', color: 'var(--text)' }}
            >
              <ImageIcon size={16} />
              相册
            </button>
          </div>

          {/* 预览网格 */}
          {stagingFiles.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-4">
              {stagingFiles.map((p, i) => (
                <HeicPreviewCell
                  key={i}
                  p={p}
                  studentName={p.studentId ? (nameOf(p.studentId) || '已指定') : null}
                  onRemove={() => onRemoveFile(i)}
                  onCrop={canCrop ? () => setCroppingIdx(i) : undefined}
                  onRotate={onRotateFile ? () => onRotateFile(i) : undefined}
                  multiSelect={multiSelect}
                  checked={selected.has(i)}
                  onToggle={() => toggleSelect(i)}
                  onOpenPicker={stagingType === 'homework' && assignable.length > 0 ? () => setPicking([i]) : undefined}
                />
              ))}
            </div>
          )}

          {stagingFiles.length === 0 && (
            <EmptyState
              icon={ImageIcon}
              iconSize={32}
              title="点击上方按钮拍摄或选择照片"
              description={native ? '拍照可连续拍摄，相册支持一次选多张' : '支持相册多选'}
              className="py-8"
              iconStyle={{ marginBottom: '8px', color: 'var(--text-secondary)' }}
              titleStyle={{ fontSize: 'var(--fs-13)', color: 'var(--text-secondary)' }}
              descriptionStyle={{ fontSize: 'var(--fs-11)', marginTop: '4px', color: 'var(--text-secondary)' }}
            />
          )}

          {/* 多选浮条：勾选若干张 → 点学生名一次归组 */}
          {multiSelect && stagingFiles.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-medium" style={{ color: 'var(--text)' }}>已选 {selected.size} 张</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelected(new Set(stagingFiles.map((_, i) => i)))}
                    className="text-[12px] px-2 py-1 rounded-lg active:opacity-70"
                    style={{ color: 'var(--primary)' }}
                  >全选</button>
                  <button
                    onClick={exitMultiSelect}
                    className="text-[12px] px-2 py-1 rounded-lg active:opacity-70"
                    style={{ color: 'var(--text-secondary)' }}
                  >取消</button>
                </div>
              </div>
              {selected.size > 0 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                  {assignable.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { onAssignStudent?.([...selected], s.id); exitMultiSelect() }}
                      className="flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold active:scale-95 transition-transform"
                      style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                    >
                      归给 {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 提交按钮 */}
          {stagingFiles.length > 0 && (
            <button
              onClick={onSubmit}
              disabled={submitDisabled}
              className="w-full py-3 rounded-xl text-[14px] font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:cursor-not-allowed"
              style={{
                background: stagingUploading
                  ? 'var(--bg-secondary)'
                  : hasUnassigned
                    ? 'var(--warning-soft)'
                    : 'var(--primary-hover)',
                color: stagingUploading
                  ? 'var(--text-tertiary)'
                  : hasUnassigned
                    ? 'var(--warning)'
                    : '#fff'
              }}
            >
              {stagingUploading ? <Loader2 size={16} className="animate-spin" /> : hasUnassigned ? null : <Upload size={16} />}
              {submitLabel}
            </button>
          )}
        </div>
      </motion.div>

      {/* 裁剪全屏层：z-[30000] 盖住暂存弹窗（z-[25000]）。
          必须放在 motion.div 外面——sheet 带 transform 动画，
          fixed 后代会退化成相对 sheet 定位而不是视口。 */}
      {croppingPreview && (
        <ImageCropper
          image={croppingPreview.url}
          title="裁剪图片"
          onCropComplete={(dataUrl) => {
            const idx = croppingIdx
            setCroppingIdx(null)
            onCropFile(idx, dataUrl)
          }}
          onCancel={() => setCroppingIdx(null)}
        />
      )}

      {/* 学生标注浮层：z-[26000]，盖住暂存区（25000）、低于裁剪层（30000） */}
      <AnimatePresence>
        {picking && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPicking(null)}
              className="absolute inset-0 bg-black/50 z-[26000]"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl z-[26001]"
            >
              <div className="px-5 pt-4 pb-6" style={{ paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))' }}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>
                    {picking.length > 1 ? `归给哪个学生（${picking.length} 张）` : '归给哪个学生'}
                  </h4>
                  <button
                    onClick={() => setPicking(null)}
                    className="w-7 h-7 rounded-full flex items-center justify-center"
                    style={{ background: 'var(--bg-mist)' }}
                    aria-label="关闭学生列表"
                  >
                    <X size={14} style={{ color: 'var(--text-secondary)' }} />
                  </button>
                </div>
                {assignable.length === 0 ? (
                  <p className="text-[13px] text-center py-6" style={{ color: 'var(--text-secondary)' }}>暂无可标注的学生，请先在首页添加学生</p>
                ) : (
                  <div className="overflow-y-auto max-h-[46vh] space-y-1.5">
                    {assignable.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => confirmAssign(s.id)}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl text-left active:opacity-70 transition-opacity"
                        style={{ background: 'var(--bg-secondary)' }}
                      >
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-[14px] flex-shrink-0"
                          style={{ background: 'var(--primary)' }}
                        >
                          {s.name?.charAt(0) || '学'}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[14px] font-medium truncate" style={{ color: 'var(--text)' }}>{s.name}</div>
                          {s.class && <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{s.class}</div>}
                        </div>
                        {currentStudent?.id === s.id && (
                          <span className="ml-auto text-[11px] flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>当前学生</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {picking.some((i) => stagingFiles[i]?.studentId) && (
                  <button
                    onClick={() => confirmAssign(null)}
                    className="w-full mt-2 py-2.5 rounded-xl text-[13px] font-medium active:opacity-70"
                    style={{ color: 'var(--danger)' }}
                  >清除已选图片的学生标注</button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
