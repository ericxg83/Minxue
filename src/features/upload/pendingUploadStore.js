// ── 上传流程模块级兜底存储 ──
// 解决 React 18 setState 批处理 + re-render 时序问题：
// 当 handleUploadAsWorkbook 同 tick 内 setState + await handleFileSelect 时，
// 第一次 re-render 期间 selectedWorksheetIdRef 会被 React 同步回 state 旧值（null）。
// 此兜底不受 React 渲染影响，ref 失效时仍能取到 worksheetId。
// 由 App.jsx 与 useUploadFlow hook 共享同一个模块实例。
export const __pendingUploadStore = {
  worksheetId: null,
  examResourceId: null,
  subject: '数学'
}
