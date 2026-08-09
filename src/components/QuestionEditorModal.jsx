import { X } from 'lucide-react'
import RectCropper from './RectCropper'

export default function QuestionEditorModal({
  editingQuestionItem,
  editTab,
  onTabChange,
  editForm,
  onUpdateForm,
  onAddOption,
  onRemoveOption,
  onUpdateOption,
  onFileSelected,
  onOpenSourcePicker,
  onRemoveImage,
  editTags,
  onRemoveTag,
  editNewTag,
  onNewTagChange,
  onAddTag,
  onCancel,
  onSave,
  showEditSourcePicker,
  onCloseSourcePicker,
  onCropFromTask,
  onCropFromUpload,
  loadingTaskImage,
  showImageCrop,
  cropImage,
  onCropConfirm,
  onCropCancel
}) {
  return (
    <>
      {showEditSourcePicker && (
        <div className="absolute inset-0 z-[30000] flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div onClick={onCloseSourcePicker} style={{ flex: 1 }} />
          <div style={{
            background: '#fff', borderRadius: 'var(--radius-16) var(--radius-16) 0 0',
            padding: '24px 20px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))'
          }}>
            <div style={{ fontSize: 'var(--fs-16)', fontWeight: 600, color: 'var(--text)', textAlign: 'center', marginBottom: '20px' }}>
              选择配图来源
            </div>
            {(editingQuestionItem?.question || editingQuestionItem)?.task_id && (
              <div
                onClick={onCropFromTask}
                style={{
                  display: 'flex', alignItems: 'center', gap: '16px',
                  padding: '16px', borderRadius: 'var(--radius-12)',
                  background: 'var(--bg)', marginBottom: '12px',
                  cursor: 'pointer', transition: 'background 0.2s'
                }}
              >
                <div style={{
                  width: '48px', height: '48px', borderRadius: 'var(--radius-12)',
                  background: 'var(--primary-mist)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', flexShrink: 0
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary-hover)" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--fs-15)', fontWeight: 600, color: 'var(--text)' }}>从原试卷裁剪</div>
                  <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-secondary)', marginTop: '2px' }}>从原试卷图片中截取本题区域</div>
                </div>
                {loadingTaskImage && (
                  <div style={{ fontSize: 'var(--fs-12)', color: 'var(--primary-hover)' }}>加载中...</div>
                )}
              </div>
            )}
            <div
              onClick={onCropFromUpload}
              style={{
                display: 'flex', alignItems: 'center', gap: '16px',
                padding: '16px', borderRadius: 'var(--radius-12)',
                background: 'var(--bg)', marginBottom: '8px',
                cursor: 'pointer', transition: 'background 0.2s'
              }}
            >
              <div style={{
                width: '48px', height: '48px', borderRadius: 'var(--radius-12)',
                background: 'var(--danger-soft)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', flexShrink: 0
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="1.5">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--fs-15)', fontWeight: 600, color: 'var(--text)' }}>拍摄或上传裁剪</div>
                <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-secondary)', marginTop: '2px' }}>拍照或从相册选择图片进行裁剪</div>
              </div>
            </div>
            <div style={{ textAlign: 'center', marginTop: '12px' }}>
              <span
                onClick={onCloseSourcePicker}
                style={{ fontSize: 'var(--fs-14)', color: 'var(--text-secondary)', cursor: 'pointer', padding: '8px 16px' }}
              >
                取消
              </span>
            </div>
          </div>
        </div>
      )}

      {showImageCrop && (
        <RectCropper
          image={cropImage}
          onConfirm={onCropConfirm}
          onCancel={onCropCancel}
          theme="light"
        />
      )}

      <div className="absolute inset-0 z-[20000] flex flex-col">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
        <div className="relative mt-auto bg-white rounded-t-3xl max-h-[85vh] min-h-[60vh] flex flex-col shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <h3 style={{ fontSize: 'var(--fs-16)', fontWeight: 700, color: 'var(--text)' }}>编辑题目</h3>
            <button onClick={onCancel} className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'var(--bg-secondary)' }}>
              <X size={16} style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b" style={{ borderColor: 'var(--border-light)' }}>
            {[
              { key: 'stem', label: '题干' },
              { key: 'answer', label: '答案' },
              { key: 'tags', label: '标签' }
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => onTabChange(tab.key)}
                className="flex-1 py-2.5 text-[13px] font-medium relative transition-colors"
                style={{ color: editTab === tab.key ? 'var(--primary)' : 'var(--text-secondary)' }}
              >
                {tab.label}
                {editTab === tab.key && (
                  <div className="absolute bottom-0 left-1/3 right-1/3 h-0.5 rounded-full" style={{ background: 'var(--primary)' }} />
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Stem Tab */}
            {editTab === 'stem' && (
              <>
                <div className="card" style={{ padding: '14px' }}>
                  <label style={{ fontSize: 'var(--fs-12)', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>题目内容</label>
                  <textarea
                    value={editForm.content}
                    onChange={e => onUpdateForm('content', e.target.value)}
                    placeholder="请输入题目内容"
                    className="w-full rounded-xl p-3 text-[13px] resize-none focus:outline-none transition-all"
                    style={{ border: '1px solid var(--border)', color: 'var(--text)', minHeight: '80px', background: 'var(--bg-mist)' }}
                  />
                </div>

                {editForm.question_type === 'choice' && (
                  <div className="card" style={{ padding: '14px' }}>
                    <div className="flex items-center justify-between mb-2">
                      <label style={{ fontSize: 'var(--fs-12)', fontWeight: 600, color: 'var(--text-secondary)' }}>选项</label>
                      <button onClick={onAddOption} style={{ fontSize: 'var(--fs-12)', color: 'var(--primary)', fontWeight: 500 }}>
                        + 添加选项
                      </button>
                    </div>
                    <div className="space-y-2">
                      {editForm.options.map((opt, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
                            {String.fromCharCode(65 + idx)}
                          </span>
                          <input
                            value={opt}
                            onChange={e => onUpdateOption(idx, e.target.value)}
                            placeholder={`选项 ${String.fromCharCode(65 + idx)}`}
                            className="flex-1 rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none"
                            style={{ border: '1px solid var(--border-light)' }}
                          />
                          <button onClick={() => onRemoveOption(idx)} className="p-0.5">
                            <X size={13} style={{ color: 'var(--danger)' }} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Image upload area with cropping */}
                <input
                  id="edit-image-file-input"
                  type="file"
                  accept="image/*"
                  onChange={onFileSelected}
                  style={{ display: 'none' }}
                />
                <div style={{
                  border: `2px dashed ${editForm.image_url ? 'var(--primary-hover)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-12)',
                  padding: editForm.image_url ? '12px' : '20px',
                  textAlign: 'center',
                  background: editForm.image_url ? 'var(--primary-mist)' : 'var(--bg-mist)',
                  transition: 'all 0.2s'
                }}>
                  {editForm.image_url ? (
                    <div style={{ width: '100%' }}>
                      <img
                        src={editForm.image_url}
                        alt="题目配图"
                        style={{
                          width: '100%',
                          maxHeight: '200px',
                          objectFit: 'contain',
                          borderRadius: 'var(--radius-8)',
                          display: 'block',
                          background: 'var(--bg)'
                        }}
                      />
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <span
                          onClick={onOpenSourcePicker}
                          style={{ fontSize: 'var(--fs-12)', color: 'var(--primary-hover)', cursor: 'pointer', padding: '4px 12px', borderRadius: 'var(--radius-6)', background: 'var(--primary-mist)', fontWeight: 500 }}
                        >
                          裁剪替换
                        </span>
                        <span
                          onClick={onRemoveImage}
                          style={{ fontSize: 'var(--fs-12)', color: 'var(--danger)', cursor: 'pointer', padding: '4px 12px', borderRadius: 'var(--radius-6)', background: 'var(--danger-soft)', fontWeight: 500 }}
                        >
                          删除配图
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={onOpenSourcePicker}
                      style={{ cursor: 'pointer', padding: '8px 0' }}
                    >
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" style={{ margin: '0 auto 8px', display: 'block' }}>
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                      <div style={{ fontSize: 'var(--fs-14)', fontWeight: 500, color: 'var(--primary-hover)' }}>添加配图</div>
                      <div style={{ fontSize: 'var(--fs-11)', color: 'var(--text-secondary)', marginTop: '4px' }}>支持裁剪上传，可选</div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Answer Tab */}
            {editTab === 'answer' && (
              <>
                <div className="card" style={{ padding: '12px', background: 'var(--bg-mist)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span style={{ fontSize: 'var(--fs-11)', color: 'var(--text-secondary)' }}>学生答案</span>
                    <span className="badge" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>错误记录</span>
                  </div>
                  <p style={{ fontSize: 'var(--fs-13)', color: 'var(--text)', marginTop: '4px' }}>{editForm.student_answer || '未作答'}</p>
                </div>

                <div className="card" style={{ padding: '12px' }}>
                  <label style={{ fontSize: 'var(--fs-12)', fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>正确答案</label>
                  <input
                    value={editForm.answer}
                    onChange={e => onUpdateForm('answer', e.target.value)}
                    placeholder="请输入正确答案"
                    className="w-full rounded-lg px-3 py-2 text-[13px] focus:outline-none"
                    style={{ border: '1px solid var(--border-light)' }}
                  />
                </div>

                <div className="card" style={{ padding: '12px' }}>
                  <label style={{ fontSize: 'var(--fs-12)', fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>题目解析</label>
                  <textarea
                    value={editForm.analysis}
                    onChange={e => onUpdateForm('analysis', e.target.value)}
                    placeholder="请输入解析内容..."
                    className="w-full rounded-lg p-2.5 text-[13px] resize-none focus:outline-none"
                    style={{ border: '1px solid var(--border-light)', color: 'var(--text)', minHeight: '100px' }}
                  />
                </div>
              </>
            )}

            {/* Tags Tab */}
            {editTab === 'tags' && (
              <div className="card" style={{ padding: '12px' }}>
                <label style={{ fontSize: 'var(--fs-12)', fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>知识点标签</label>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {editTags.length === 0 ? (
                    <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-secondary)' }}>暂无标签</span>
                  ) : (
                    editTags.map((tag, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                        {tag}
                        <button onClick={() => onRemoveTag(tag)}><X size={9} /></button>
                      </span>
                    ))
                  )}
                </div>
                <div className="flex gap-1.5">
                  <input
                    value={editNewTag}
                    onChange={e => onNewTagChange(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAddTag() } }}
                    placeholder="输入标签后按回车"
                    className="flex-1 rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none"
                    style={{ border: '1px solid var(--border-light)' }}
                  />
                  <button onClick={onAddTag} disabled={!editNewTag.trim()} className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-white" style={{ background: editNewTag.trim() ? 'var(--primary-hover)' : 'var(--border)' }}>
                    添加
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-2.5 px-4 py-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
            <button
              onClick={onCancel}
              className="flex-1 py-2 rounded-lg text-[13px] font-medium"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
            >
              取消
            </button>
            <button
              onClick={onSave}
              className="flex-1 py-2 rounded-lg text-[13px] font-medium text-white"
              style={{ background: 'var(--primary-hover)' }}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
