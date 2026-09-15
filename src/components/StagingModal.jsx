import { Camera, X, Upload, Loader2, Image as ImageIcon, Crop } from 'lucide-react'
import { useState } from 'react'
import { isNativeCameraAvailable } from '../services/nativeCamera'
import { motion } from 'motion/react'
import EmptyState from './EmptyState'
import ImageCropper from './ImageCropper'

// HEIC 预览格：浏览器解不开 HEIC 时 onError 切占位（不白屏）。
// HEIC 上传由后端 fixFileIfNeeded needsHeicTranscode 用 heic-decode 转 jpg。
// HEIC 不提供裁剪入口：WebView canvas 解不开 HEIC，裁剪必然失败，留给上传管线的转码环节。
function HeicPreviewCell({ p, onRemove, onCrop }) {
  const [errored, setErrored] = useState(false)
  const showPlaceholder = errored || !p.url
  return (
    <div className="relative rounded-lg overflow-hidden" style={{ aspectRatio: '1 / 1', background: 'var(--bg-secondary)' }}>
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
      {onCrop && !showPlaceholder && !p.isHeic && (
        <button
          onClick={onCrop}
          className="absolute top-1 left-1 w-5 h-5 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}
          aria-label="裁剪这张图片"
        >
          <Crop size={11} />
        </button>
      )}
      <button
        onClick={onRemove}
        className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 'var(--fs-12)' }}
      >x</button>
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
  onSubmit
}) {
  const title = stagingType === 'workbook' ? '练习册作业' : stagingType === 'homework' ? '日常作业' : stagingType === 'wrong_retry' ? '错题重练' : stagingType === 'retry_bound' ? '错题重练 · 上传答卷' : '普通试卷'
  // 原生平台走系统相机/相册，可以连拍；Web 端只有一次性的文件选择器。
  const native = isNativeCameraAvailable()

  // 2026-09-15 裁剪入口只对普通录入开放：
  // - workbook：练习册批改靠整页课时编号硬锚定，裁掉页眉会破坏答案锚定
  // - wrong_retry / retry_bound：重练卷靠卷面二维码绑 examId，裁掉二维码进不了重练批改
  const canCrop = !!onCropFile && (stagingType === 'regular' || stagingType === 'homework')
  const [croppingIdx, setCroppingIdx] = useState(null)
  const croppingPreview = canCrop && croppingIdx != null ? stagingFiles[croppingIdx] : null

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
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90"
              style={{ background: 'var(--bg-mist)' }}
              aria-label="关闭暂存区"
            >
              <X size={14} style={{ color: 'var(--text-secondary)' }} />
            </button>
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
                  onRemove={() => onRemoveFile(i)}
                  onCrop={canCrop ? () => setCroppingIdx(i) : undefined}
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

          {/* 提交按钮 */}
          {stagingFiles.length > 0 && (
            <button
              onClick={onSubmit}
              disabled={stagingUploading}
              className="w-full py-3 rounded-xl text-[14px] font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              style={{
                background: stagingUploading ? 'var(--bg-secondary)' : 'var(--primary-hover)',
                color: '#fff'
              }}
            >
              {stagingUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {stagingUploading ? '上传中...' : `上传 ${stagingFiles.length} 张图片${stagingFiles.length > 1 ? '（合并为一个任务）' : ''}`}
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
    </div>
  )
}
