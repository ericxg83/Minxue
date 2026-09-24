<template>
  <div class="ops-panel">
    <!-- 空状态 -->
    <div v-if="!q" class="ops-empty">
      <el-icon size="40"><DocumentChecked /></el-icon>
      <span>请从左侧选择题目</span>
    </div>

    <template v-else>
      <!-- ═══ 顶栏 ═══ -->
      <div class="ops-header">
        <div class="ops-header__left">
          <span class="ops-mode-title">{{ store.reviewConfig.detailTitle }}</span>
          <el-tag :type="typeTagType" size="small" effect="dark" class="ops-type-tag">
            {{ typeLabel }}
          </el-tag>
          <span class="ops-qnum">#{{ store.currentReviewIndex + 1 }}</span>
          <el-tag v-if="difficultyLabel" :type="difficultyTagType" size="small" effect="plain" class="ops-difficulty-badge">
            {{ difficultyLabel }}
          </el-tag>
          <el-tag v-if="q.review_status" :type="reviewStatusTagType" size="small" effect="dark" class="ops-review-badge">
            {{ reviewStatusLabel }}
          </el-tag>
        </div>
        <div class="ops-header__right">
          <span v-if="q.confidence != null" class="ops-confidence"
            :class="{ 'conf-low': q.confidence < store.confidenceThreshold }">
            {{ Math.round(q.confidence * 100) }}%
          </span>
          <!-- AI 重解析（2026-09-23 临时按钮）：参考答案缺失时点一下，
               调答案引擎重算这一题的标准答案并写库。答案已存在时弹确认。
               替代原来的「识别」tag——那个 tag 只是 answer_source 状态标签（学生答案 OCR 识别），
               与参考答案无关，老师根本不知道它干嘛用。
               实测端到端 5~35s（DB 首次建连 + 答案引擎），loading 文案要明确，
               否则老师对着一个不动的转圈会以为卡死。 -->
          <el-button size="small" type="primary" plain :loading="recomputeAnswerLoading"
            @click="handleRecomputeAnswer">
            <el-icon v-if="!recomputeAnswerLoading"><MagicStick /></el-icon>
            {{ recomputeAnswerLoading ? `AI 计算中 ${recomputeAnswerElapsed}s…` : 'AI 重解析' }}
          </el-button>
          <template v-if="!editing">
            <el-button size="small" type="primary" plain @click="handleEnterEdit">
              <el-icon><EditPen /></el-icon> 编辑
            </el-button>
          </template>
          <template v-else>
            <el-button size="small" @click="handleCancelEdit">
              <el-icon><RefreshLeft /></el-icon> 取消
            </el-button>
            <el-button size="small" type="success" @click="handleSave">
              <el-icon><DocumentChecked /></el-icon> 保存
            </el-button>
          </template>
        </div>
      </div>

      <!-- ═══ 答案对照（紧凑） ═══ -->
      <div class="ops-compare-bar">
        <div class="ops-compare-item">
          <div class="ops-cmp-label-row">
            <span class="ops-cmp-label">学生答案</span>
            <el-button v-if="!quickStudentAnswerEditing && !editing" size="small" plain class="ops-ans-edit-btn"
              @click="startQuickStudentAnswerEdit">
              <el-icon><EditPen /></el-icon>
              {{ q.student_answer ? '编辑' : '手动输入' }}
            </el-button>
          </div>
          <div v-if="quickStudentAnswerEditing" class="quick-answer-edit">
            <el-input v-model="quickStudentAnswerText" type="textarea"
              :autosize="{ minRows: 1, maxRows: 4 }"
              placeholder="学生答案（支持 √、²、a/b 等数学符号，也可写 $x^2+1$）" ref="quickStudentInputRef" />
            <div class="quick-answer-actions">
              <el-button size="small" type="primary" :loading="quickStudentAnswerSaving"
                @click="saveQuickStudentAnswer">保存</el-button>
              <el-button size="small" @click="cancelQuickStudentAnswerEdit">取消</el-button>
            </div>
          </div>
          <span v-else class="ops-cmp-value student-val">
            <MathRender :content="q.student_answer || '—'" autoDetect tag="span" />
          </span>
        </div>
        <div class="ops-cmp-divider"></div>
        <div class="ops-compare-item">
          <div class="ops-cmp-label-row">
            <span class="ops-cmp-label">
              参考答案
              <span v-if="editing" style="color:var(--wb-warning);font-weight:400;"> 编辑</span>
            </span>
            <!-- 截图/拍照 → 后端视觉模型识别 → 弹窗预览 → 一键填入。
                 老师手敲 \frac、\sqrt 等 KaTeX 命令极易出错，这个按钮直接解决。
                 入口改为「读剪贴板」：老师从别的 AI 截好图 → 切回此对话框 → Ctrl+V / 长按粘贴
                 即可识别，不再要求去本地文件夹找图（很多老师压根没保存截图）。
                 兼容兜底：dialog 里仍保留「选择本地图片」入口。 -->
            <el-button v-if="editing" type="default" :loading="recognizeLoading"
              class="ops-ans-recognize-btn" @click="openAnswerPasteDialog">
              <el-icon><Camera /></el-icon> 📷 截图识别答案
            </el-button>
          </div>
          <!-- 参考答案来源（答案库 / AI 解答，两档）。卷面只印题目不印答案，
               老师看不出来源时会把 AI 算错的参考答案当成"学生答错"，事故里就是这样
               反复怀疑批改逻辑的。AI 解答那档带悬停说明，措辞只提示不施压。 -->
          <span v-if="refAnswerOrigin" class="ops-ref-origin"
                :class="`origin-${refAnswerOrigin.tone}`"
                :title="refAnswerOrigin.hint">
            {{ refAnswerOrigin.label }}
          </span>
          <!-- AI 解析自检未通过时标红 + 给老师"答案可能错"的红色横幅。
               数据来自 worker.js 调 aiParseSelfCheck 写入 questions.ai_self_check_issues。
               移动端 Grading\index.jsx:538 已对齐相同 UX，避免老师改题无据可依。 -->
          <span v-if="q.ai_self_check_passed === false"
                class="ops-self-check-tag"
                :title="`AI 解析可能不准确：${(q.ai_self_check_issues || []).join(' / ')}`">
            ⚠ AI 不可信
          </span>
          <div v-if="editing">
            <el-input v-model="form.answer" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" placeholder="标准答案（支持从 AI 解答页面粘贴特殊字符 ± √ 等）" />
          </div>
          <span v-else-if="q.answer" class="ops-cmp-value correct-val">
            <MathRender :content="q.answer" autoDetect tag="span" />
          </span>
          <!-- q.answer 为空时统一走「点击填写」入口（2026-09-24 二次调整）：
               ① 绝不再把 q.analysis（解题过程）顶到参考答案位 —— 旧逻辑用 correct-val 绿字渲染，
                  老师误以为有答案，判分侧却因 q.answer 空报「缺少参考答案」（「看得到判不出」事故）；
               ② 原文案「⚠ 未提取到参考答案（AI 仅有解析，见题干行『解析』）」有两处毛病：
                  措辞绕（老师读完不知道要干什么），且**这个分支根本没有填写入口**
                  （老师看到缺答案却无处下手，只能去别处找）。现改为一句人话 + 点击即填。
               解析的查看入口仍统一在题干行「解析」按钮（AnalysisSource.vue），此处不重复。 -->
          <div v-else class="quick-answer-wrap">
            <div v-if="!quickAnswerEditing" class="ops-cmp-value missing-val" @click="startQuickAnswerEdit">
              <template v-if="q.analysis">
                ⚠ AI 没算出答案（题目可能缺配图或条件），<span class="quick-edit-hint">点击填写</span>
              </template>
              <template v-else>— <span class="quick-edit-hint">点击填写</span></template>
            </div>
            <div v-else class="quick-answer-edit">
              <el-input v-model="quickAnswerText" size="small" placeholder="输入标准答案" @keyup.enter="saveQuickAnswer" ref="quickInputRef" />
              <div class="quick-answer-actions">
                <el-button size="small" type="primary" :loading="quickAnswerSaving" @click="saveQuickAnswer">保存</el-button>
                <el-button size="small" @click="cancelQuickAnswerEdit">取消</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 解析入口已统一到题干行的「解析」按钮（AnalysisSource，2026-09-21）：
           原先这里是折叠区，长解析限高 280px 读起来要来回滚，且与编辑表单里的
           「AI 解析」字段重复。现改为题干旁小入口 + 弹窗看完整解析，入口唯一。 -->

      <!-- AI 判定 -->
      <div class="ops-ai-row" v-if="q.is_correct != null || q.review_status || getAiState(q) === 'exception' || getAiState(q) === 'blank'">
        <span class="ops-ai-icon" :class="getAiStateClass(q)">{{ getAiStateIcon(q) }}</span>
        <span class="ops-ai-text">{{ getAiStateText(q) }}</span>
        <!-- 判不出的原因：让老师知道为什么这题要自己定，而不是以为系统坏了 -->
        <span v-if="unjudgedReason" class="ops-ai-reason">{{ unjudgedReason }}</span>
        <el-progress v-if="q.confidence != null && getAiState(q) === 'pending'" :percentage="Math.round(q.confidence * 100)"
          :stroke-width="8" :color="q.confidence >= store.confidenceThreshold ? 'var(--wb-success)' : 'var(--wb-warning)'"
          style="width:100px;margin-left:auto;" />
      </div>

      <!-- 图题风险提示：客观题 + 配图（geometry/chart）时 AI 视觉推理不擅长，
           软提示老师核对参考答案。wrong/correct 状态都展示，避免把"AI 错误"信以为真。 -->
      <el-alert
        v-if="aiAnswerRiskReason"
        :title="aiAnswerRiskReason"
        type="warning"
        show-icon
        :closable="false"
        class="ops-image-risk"
      />

      <!-- 「AI 重解析」的上次结论（2026-09-24）。常驻而非只弹 toast：
           老师点完按钮常去别处转一圈再回来，3 秒的 toast 早没了，页面又回到
           「什么都没变」的样子。这里把结论留在页面上，尤其「AI 明确说不会」
           这种终态，避免老师反复点、每次白等十几秒还烧额度。 -->
      <el-alert
        v-if="recomputeAnswerNotice"
        :title="recomputeAnswerNotice.text"
        :type="recomputeAnswerNotice.type"
        show-icon
        closable
        class="ops-recompute-notice"
        @close="recomputeAnswerNotice = null"
      />

      <!-- ═══ 完整题目内容（始终可见，不折叠） ═══ -->
      <div class="ops-question-body">
        <!-- 题型 & 学科（仅在编辑时显示） -->
        <div v-if="editing" class="ops-q-section">
          <div class="ops-q-label">题型 · 学科</div>
          <div class="ops-type-subject-row">
            <el-select v-model="form.question_type" style="flex:1">
              <el-option label="选择题" value="choice" />
              <el-option label="填空题" value="fill" />
              <el-option label="判断题" value="judge" />
              <el-option label="解答题" value="answer" />
            </el-select>
            <el-select v-model="form.subject" style="flex:1" allow-create filterable placeholder="学科">
              <el-option label="数学" value="数学" />
              <el-option label="物理" value="物理" />
              <el-option label="化学" value="化学" />
              <el-option label="英语" value="英语" />
              <el-option label="语文" value="语文" />
            </el-select>
          </div>
        </div>

        <!-- ═══ 编辑模式：共享编辑表单 ═══ -->
        <div v-if="editing" class="ops-edit-form-wrapper">
          <QuestionEditForm
            v-model:form="form"
            :display-image-url="displayImageUrl"
            :show-crop="true"
            :show-recognize-question="true"
            @image-upload="handleImageUpload"
            @image-crop="handleCropFromPaper"
            @image-delete="deleteImage"
            @open-tag-selector="showTagSelector = true"
            @question-recognize="handleRecognizeQuestionFromPaper"
          />
        </div>

        <!-- ═══ 预览模式：题干 + 配图 + 选项（统一卡片） ═══ -->
        <div v-else class="ops-content-card">
          <!-- 题干标签行挂「原卷」+「解析」两个小入口（重练卷才有原卷；作业批改中间栏
               就是原卷，会自隐；无解析时解析入口自隐）。
               本节刻意不以 q.content 为渲染条件：OCR 题干残缺时老师恰恰最需要点它看原卷，
               若跟着空文本一起消失，入口就白做了。空文本给一句中性占位。 -->
          <div class="ops-q-section">
            <div class="ops-q-label-row">
              <span class="ops-q-label">题干</span>
              <OriginalPaperSource :question="q" />
              <AnalysisSource :question="q" />
            </div>
            <!-- 多小问大题的公共题干（迁移 057 parent_stem）：题目被拆成小问后，
                 公共条件挂在这一列。批改页不显示它，老师看到的就是无条件的残缺题
                 （重练卷引用的原题尤其明显）。 -->
            <div v-if="parentStem" class="ops-q-stem"><MathRender :content="parentStem" autoDetect /></div>
            <div v-if="q.content" class="ops-q-text"><MathRender :content="q.content" autoDetect /></div>
            <div v-else class="ops-q-text ops-q-text--empty">未识别到题干文本</div>
          </div>
          <div class="ops-q-section ops-image-section" v-if="displayImageUrl">
    <div class="ops-q-label">配图</div>
    <div class="ops-image-wrap">
      <!-- 干净 SVG 源码（几何重建）→ 直接内联渲染 -->
      <div v-if="displayType === 'svg_code'" class="tikz-svg-container"
           v-html="displayImageUrl" @click="openFullscreen"></div>
      <!-- TikZ 代码 → tikzToSvg 转换后内联 SVG -->
      <div v-else-if="displayType === 'tikz_code'" class="tikz-svg-container"
           v-html="renderTikzSvg(displayImageUrl)" @click="openFullscreen"></div>
      <!-- URL → <img> 标签 -->
      <img v-else :src="displayImageUrl" class="ops-image" @click="fullscreenImage = displayImageUrl" />
      <div style="display:flex; gap:6px; margin-top:4px;">
        <template v-if="tikzStatus === 'done'">
          <el-button v-if="!showOriginal && q.geometry_image_url" size="small" plain @click="showOriginal = true">
            显示原图
          </el-button>
          <el-button v-else-if="showOriginal" size="small" type="primary" plain @click="showOriginal = false">
            采用TikZ图
          </el-button>
        </template>
        <el-tag v-else-if="tikzStatus === 'pending'" size="small" type="warning" effect="dark">
          几何图重建中...
        </el-tag>
        <el-tag v-else-if="tikzStatus === 'processing'" size="small" type="info" effect="dark">
          几何图重建中...
        </el-tag>
        <template v-else-if="tikzStatus === 'failed'">
          <el-tag size="small" type="danger" effect="dark">重建失败</el-tag>
          <el-button size="small" type="warning" plain :loading="retryGeometryLoading" @click="handleRetryGeometry">
            重新生成
          </el-button>
        </template>
        <el-tag v-else-if="tikzStatus === 'none'" size="small" type="info" effect="plain"
                :title="q.asset_last_error || '视觉模型判定此图无法重建，已回退到裁剪原图'">
          使用原图
        </el-tag>
        <el-tag v-if="geometryConsistency && !geometryConsistency.skipped" size="small" :type="geometryConsistency.pass ? 'success' : 'danger'" effect="dark">
          几何自洽{{ geometryConsistency.pass ? '通过' : '存疑' }}
        </el-tag>
        <el-tag v-else-if="geometryConsistency && geometryConsistency.skipped" size="small" type="info" effect="plain">
          几何无需校验
        </el-tag>
      </div>
    </div>
  </div>
          <div class="ops-q-section" v-if="optionsList.length > 0">
            <div class="ops-q-label">选项</div>
            <div v-for="(opt, idx) in optionsList" :key="idx" class="ops-option-row"
              :class="{ 'option-highlight': opt === q.answer }">
              <span class="ops-opt-letter">{{ String.fromCharCode(65 + idx) }}.</span>
              <span class="ops-opt-text"><MathRender :content="opt" autoDetect tag="span" :force-inline="true" /></span>
            </div>
          </div>
          <!-- 选择题但选项为空：整页 OCR 漏识别选项的典型形态。
               旧版这里整块隐藏，老师只看到题干、既不知道缺了什么，也不知道下一步做什么，
               点「标错」被完整性门禁拦下后才回头找原因。这里直接给出原因 + 出口。 -->
          <div class="ops-q-section" v-else-if="normalizeType(q) === 'choice'">
            <div class="ops-q-label">选项</div>
            <div class="ops-options-missing">
              <span>未识别到选项，这道题暂时无法加入错题本</span>
              <el-button text size="small" type="primary" @click="handleEnterEdit">
                去编辑里「重新识别本题」
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ 底部操作区（固定） ═══ -->
      <div class="ops-actions">
        <template v-if="!editing">
          <!-- [P5] 几何自洽性审计 → 复核结论提示 -->
          <el-alert
            v-if="geometryReviewHint"
            :title="geometryReviewHint.text"
            :type="geometryReviewHint.level"
            show-icon
            :closable="false"
            class="ops-geom-hint"
          />
          <div class="ops-buttons-primary">
            <button class="ops-btn ops-btn-correct"
              :class="{ 'ops-btn-active': q.review_status === 'correct', 'animate': animatingBtn === 'correct' }"
              @click="handleReview('correct')">
              <span class="ops-btn-icon">✓</span>
              <span>{{ store.reviewConfig.buttons.correct }}</span>
            </button>
            <button class="ops-btn ops-btn-wrong"
              :class="{ 'ops-btn-active': q.review_status === 'wrong', 'animate': animatingBtn === 'wrong' }"
              @click="handleReview('wrong')">
              <span class="ops-btn-icon">✗</span>
              <span>{{ store.reviewConfig.buttons.wrong }}</span>
            </button>
            <button v-if="store.reviewConfig.showExclude" class="ops-btn ops-btn-exclude"
              :class="{ 'ops-btn-active': q.review_status === 'exclude', 'animate': animatingBtn === 'exclude' }"
              @click="handleReview('exclude')">
              <span class="ops-btn-icon">✕</span>
              <span>删除</span>
            </button>
          </div>
          <div class="ops-buttons-secondary">
            <el-button size="default" @click="prevQ" :disabled="store.currentReviewIndex === 0">
              <el-icon><ArrowLeft /></el-icon> 上一题
            </el-button>
            <el-button size="default" type="primary" @click="handleEnterEdit">
              <el-icon><EditPen /></el-icon> 编辑
            </el-button>
            <el-button size="default" @click="nextQ" :disabled="store.currentReviewIndex >= store.allQuestions.length - 1">
              下一题 <el-icon><ArrowRight /></el-icon>
            </el-button>
          </div>
        </template>
        <template v-else>
          <div class="ops-buttons-primary">
            <el-button size="large" @click="handleCancelEdit" style="flex:1">
              <el-icon><RefreshLeft /></el-icon> 取消
            </el-button>
            <el-button size="large" type="success" @click="handleSave" style="flex:1">
              <el-icon><DocumentChecked /></el-icon> 保存
            </el-button>
          </div>
        </template>
      </div>
    </template>

    <!-- ═══ 原卷裁剪对话框（双模式）═══
         figure    → 裁剪结果作为「配图」上传（白底化/去手写），沿用原行为
         recognize → 裁剪结果直接送视觉模型重识别题干/选项/答案，补全残缺题目 -->
    <el-dialog v-model="cropDialogVisible"
      :title="cropMode === 'recognize' ? '框选这道题所在的区域' : '从原卷截图'"
      width="auto"
      :close-on-click-modal="false" destroy-on-close append-to-body>
      <div class="crop-container" ref="cropContainerRef">
        <img :src="cropImageSource" class="crop-image" ref="cropImageRef"
          @load="cropImageLoaded"
          @error="cropImageError"
          @mousedown="onCropMouseDown" @mousemove="onCropMouseMove" @mouseup="onCropMouseUp"
          @mouseleave="onCropMouseUp" draggable="false" />
        <div v-if="cropSelection" class="crop-selection"
          :style="{
            left: cropSelection.x + 'px', top: cropSelection.y + 'px',
            width: cropSelection.w + 'px', height: cropSelection.h + 'px'
          }"></div>
        <div v-if="cropSizeLabel" class="crop-size-label">{{ cropSizeLabel }}</div>
      </div>
      <div v-if="cropMode === 'recognize'" class="crop-mode-hint">
        把这道题的<b>题干和选项一起</b>框进来（默认已按题目位置预选，可直接调整）。
      </div>
      <div v-if="cropPreviewUrl" class="crop-preview-bar">
        <span class="crop-preview-label">预览</span>
        <img :src="cropPreviewUrl" class="crop-preview-img" />
      </div>
      <template #footer>
        <el-button @click="cropDialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!cropPreviewUrl" :loading="cropLoading" @click="confirmCrop">
          {{ cropMode === 'recognize' ? '开始识别' : '确认裁剪' }}
        </el-button>
      </template>
    </el-dialog>

    <el-image-viewer v-if="fullscreenImage" :url-list="[fullscreenImage]" @close="fullscreenImage = ''" />
    <el-dialog v-model="showFullscreenSvg" title="几何矢量图" width="480px" :close-on-click-modal="true" @close="fullscreenSvg = ''">
      <div class="tikz-fullscreen-svg" v-html="fullscreenSvg" style="display:flex;justify-content:center;"></div>
    </el-dialog>
    <el-dialog v-model="showTagSelector" title="选择知识点" width="380px">
      <div class="tag-grid">
        <div v-for="tag in allKnowledgeTags" :key="tag" class="tag-option"
          :class="{ 'tag-selected': form.tags.includes(tag) }" @click="toggleTag(tag)">{{ tag }}</div>
      </div>
      <template #footer><el-button @click="showTagSelector = false">关闭</el-button></template>
    </el-dialog>

    <!-- 答案 OCR 识别弹窗：识别结果预览，确认后一键填入答案框 -->
    <AnswerRecognizeDialog v-model="recognizeDialogVisible"
      :result="recognizeResult"
      :preview-url="recognizePreviewUrl"
      @apply="handleApplyRecognized" />

    <!-- 重新识别本题：整页 OCR 漏识别选项时框选原卷区域重识别，
         预览逐字段确认后回填编辑表单（默认只补空字段，不覆盖已有内容） -->
    <QuestionRecognizeDialog v-model="questionRecognizeDialogVisible"
      :result="questionRecognizeResult"
      :preview-url="questionRecognizePreviewUrl"
      :current="{ content: form.content, options: form.options, answer: form.answer }"
      @apply="handleApplyRecognizedQuestion" />

    <!-- 截图粘贴对话框：
         - 主路径：在「粘贴区」里 Ctrl+V（桌面）/ 长按图片粘贴（手机）→ 直接 OCR
         - 兜底：点「选择本地图片」仍可走文件选择器（部分老师保存了截图）
         onPaste 监听挂在该 div 上，保证 paste 事件不会冒到别处。 -->
    <el-dialog v-model="answerPasteDialogVisible"
      title="粘贴截图识别答案"
      width="420px"
      :close-on-click-modal="false"
      :show-close="true"
      @opened="focusPasteTarget">
      <div class="ops-paste-hint">
        <div class="ops-paste-step">
            <span class="ops-paste-num">1</span>
            去别的 AI（如 DeepSeek/通义/豆包）拿到结果，截图
          </div>
          <div class="ops-paste-step">
            <span class="ops-paste-num">2</span>
            切回本对话框，按 <b>Ctrl + V</b>（电脑）或<b>长按图片</b>选择「粘贴」（手机）
          </div>
          <div class="ops-paste-step">
            <span class="ops-paste-num">3</span>
            后端自动 OCR 并弹预览，确认后一键填入
          </div>
      </div>
      <div ref="answerPasteTargetRef"
        class="ops-paste-drop"
        tabindex="0"
        @paste="handleAnswerPaste"
        @click="focusPasteTarget">
        <div class="ops-paste-drop-inner">
          <div class="ops-paste-icon">📋</div>
          <div class="ops-paste-text">点击此处，按 Ctrl+V 粘贴截图</div>
          <div class="ops-paste-sub">支持 PNG / JPG / WebP，手机端长按图片 → 粘贴</div>
        </div>
      </div>
      <div class="ops-paste-fallback">
        <span class="ops-paste-fallback-tip">截图没在剪贴板？</span>
        <el-upload :show-file-list="false"
          :before-upload="handleRecognizeAnswerBeforeUpload"
          accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif">
          <el-button size="small" link type="primary">
            <el-icon><Picture /></el-icon> 选择本地图片
          </el-button>
        </el-upload>
      </div>
      <template #footer>
        <el-button @click="answerPasteDialogVisible = false">取消</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useReviewStore } from '../../stores/reviewStore'
import { updateQuestion, rejudgeQuestion, recomputeQuestionAnswer, retryGeometry, clearStudentCaches, uploadImage, getQuestionAssets } from '../../../services/apiService'
import { recognizeAnswer, recognizeQuestion } from '../../../api/answerOCR'
import { processExamImage } from '../../../utils/imageProcessor'
import { getGeometryDisplayUrl, getTikzStatus } from '../../../utils/geometryDisplay'
import { tikzToSvg } from '../../../utils/tikzGenerator'
import { normalizeOptions } from '../../../utils/optionText'
// 多小问（题组）共享题干展示口径：与错题卡片、重练卷共用同一套实现
import { resolveQuestionDisplayStem } from '../../../utils/questionStem'
import { getReviewStateLabel, getUnjudgedReasonText, getAiAnswerRiskText, getReferenceAnswerOrigin } from '../../../utils/reviewDecision'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
// bbox 判据统一走共享实现（2026-09-18）：本文件原先自带一份 parseBbox/unionBbox，
// 是**有意**不拒绝越界框的 —— 因为这里解析出的框只用于「原卷裁剪弹窗的自动预选」，
// 下游 cropImageLoaded 会把框夹紧到图片可见区内（Math.min(rect.width - x, ...)），
// 越界只会被裁掉，不会画到图外。因此这里传 allowOutOfRange:true 保留原行为，
// 但实现与解析口径不再各留一份（原先全仓 4 份副本，两份拒绝、两份不拒绝）。
import { parseBbox, unionBbox } from '../../../utils/questionBbox'
import { DocumentChecked, Delete, Plus, Upload, Picture, EditPen, ArrowLeft, ArrowRight, RefreshLeft, Crop, Camera, MagicStick } from '@element-plus/icons-vue'
import MathRender from '../MathRender.vue'
import QuestionEditForm from './QuestionEditForm.vue'
import AnswerRecognizeDialog from './AnswerRecognizeDialog.vue'
import QuestionRecognizeDialog from './QuestionRecognizeDialog.vue'
import OriginalPaperSource from './OriginalPaperSource.vue'
// 解析入口（题干行小按钮 + 弹窗看完整解析），与 OriginalPaperSource 同构
import AnalysisSource from './AnalysisSource.vue'

const store = useReviewStore()
const q = computed(() => store.currentReviewQuestion)

// 多小问（题组）共享题干展示口径（2026-09-23 修复）：
// 模板 ops-q-stem 那一行用的是 parentStem，但脚本里**从未定义过**（只 import 了
// resolveQuestionDisplayStem 没用），v-if 恒为 undefined ⇒ 批改页永远不显示
// questions.parent_stem。于是被拆行的大题在老师眼里就是「无条件的残缺题」
//（重练卷引用的原题尤其明显）。这里按唯一口径补上定义：content 已自带
// parent_stem 的历史数据不重复渲染，与错题卡片 / 重练卷 / 移动端完全同源。
const displayStem = computed(() => resolveQuestionDisplayStem(q.value))
const parentStem = computed(() => displayStem.value.parentStem)

// 题型中文映射表（question_type 字段合法值）
const TYPE_MAP = { choice: '选择题', fill: '填空题', answer: '解答题', judge: '判断题' }

// 归一题型：把"choice/fill/judge/answer"这种枚举字符串或非法值按题目内容兜底
//   有 options → choice；含"对/错/√/×"或判断题标记 → judge；含"____"空格 → fill；其它 → answer
const normalizeType = (q) => {
  const t = String(q?.question_type || '').trim().toLowerCase()
  if (TYPE_MAP[t]) return t
  const isEnumString = t.includes('/') || t.includes('|') || t.includes(',')
  if (isEnumString || !t) {
    if (Array.isArray(q?.options) && q.options.length > 0) return 'choice'
    const content = String(q?.content || '')
    if (/_{2,}|（\s*）|\(\s*\)|□/.test(content)) return 'fill'
    if (/(对|错|正确|错误|√|×|✓|✗)/.test(content) && content.length < 60) return 'judge'
    return 'answer'
  }
  return t
}

const typeLabel = computed(() => {
  if (!q.value) return ''
  return TYPE_MAP[normalizeType(q.value)] || '未知题型'
})
const typeTagType = computed(() => {
  const map = { choice: '', fill: 'success', answer: 'warning', judge: 'primary' }
  return map[normalizeType(q.value)] || 'info'
})
const optionsList = computed(() => normalizeOptions(q.value?.options || []))

// 参考答案来源（答案库 / AI 解答，两档）。纯展示，帮助老师判断该不该相信这个答案 ——
// 事故里老师反复怀疑批改逻辑，实际是 AI 补的参考答案错了。见 utils/reviewDecision.js 注释。
const refAnswerOrigin = computed(() => getReferenceAnswerOrigin(q.value))

// 难度系数（1-5）显示
const difficultyLabel = computed(() => {
  const d = q.value?.difficulty
  if (d == null) return ''
  const map = { 1: '基础', 2: '简单', 3: '中等', 4: '较难', 5: '难题' }
  return `难度${d}·${map[d] || ''}`
})
const difficultyTagType = computed(() => {
  const map = { 1: 'success', 2: 'success', 3: 'warning', 4: 'danger', 5: 'danger' }
  return map[q.value?.difficulty] || 'info'
})

const reviewStatusLabel = computed(() => {
  if (!q.value?.review_status) return ''
  const map = { correct: '已标记正确', wrong: '已标记错误', wrong_no_book: '错误，本次不入册', exclude: '已删除' }
  return map[q.value.review_status] || ''
})
const reviewStatusTagType = computed(() => {
  const map = { correct: 'success', wrong: 'danger', wrong_no_book: 'warning', exclude: 'info' }
  return map[q.value?.review_status] || 'info'
})

// AI 状态判定不在本组件重复实现：直接用 store.getAiState（内部即 src/utils/reviewDecision.js）。
// 此前本地抄了一份同样的分支，两处一改一漏就会出现"左栏与详情说法不一致"。
const getAiState = (q) => store.getAiState(q)

const getAiStateClass = (q) => {
  const state = getAiState(q)
  const map = {
    correct: 'ai-ok',
    wrong: 'ai-fail',
    pending: 'ai-pending',
    exception: 'ai-exception',
    processing: 'ai-processing'
  }
  return map[state] || 'ai-pending'
}

const getAiStateIcon = (q) => {
  const state = getAiState(q)
  const map = {
    correct: '✓',
    wrong: '✗',
    pending: '!',
    exception: '!',
    processing: '…'
  }
  return map[state] || '!'
}

// 文案同源：exception 桶按 answer_source 细分为「未作答」/「AI未判定」
const getAiStateText = (q) => getReviewStateLabel(q, store.confidenceThreshold)
// 「AI未判定」的原因（缺参考答案 / 参考答案无法核对）。纯展示，不参与判定。
const unjudgedReason = computed(() => getUnjudgedReasonText(q.value, store.confidenceThreshold))

// 「AI 答案存疑」原因 —— AI 已给出正误，但参考本身可能不可靠（图题视觉推理）。
// 即使在 wrong 状态也展示，避免老师把"AI 错误"信以为真。纯展示，不参与判定。
const aiAnswerRiskReason = computed(() => getAiAnswerRiskText(q.value))

// 用户手动覆盖：默认 false → 显示 TikZ（AI 重画的 clean_geometry_svg）；
// true → 显示原图（geometry_image_url 裁剪原图）。这是临时 UI 状态，
// 不写回 DB；切换题目自动重置。
const showOriginal = ref(false)
watch(() => q.value?.id, () => {
  showOriginal.value = false
  // 切题时清掉上一题的重解析结论，避免把 A 题的结果挂在 B 题下面
  recomputeAnswerNotice.value = null
})

const displayImageUrl = computed(() => {
  if (showOriginal.value && q.value?.geometry_image_url) {
    return q.value.geometry_image_url
  }
  return getGeometryDisplayUrl(q.value).url
})
const displayType = computed(() => {
  if (showOriginal.value && q.value?.geometry_image_url) {
    return 'raw'
  }
  return getGeometryDisplayUrl(q.value).type
})
const tikzStatus = computed(() => getTikzStatus(q.value))
const fullscreenImage = ref('')
const fullscreenSvg = ref('')
const showFullscreenSvg = ref(false)

// [P4 影子模式] 几何自洽性审计字段展示：拉取该题的几何资产生成记录，读取 tikz_json.consistency
const geometryConsistency = ref(null)
watch(
  () => q.value?.id,
  async (id) => {
    geometryConsistency.value = null
    if (!id) return
    try {
      const assets = await getQuestionAssets(id, 'geometry_image')
      const hit = (assets || []).find((a) => a && a.tikz_json && a.tikz_json.consistency)
      geometryConsistency.value = hit ? hit.tikz_json.consistency : null
    } catch (e) {
      geometryConsistency.value = null
    }
  },
  { immediate: true }
)

// [P5] 把几何自洽性审计信号接到「复核结论提示」：在复核操作区给出结论性提示，提示人工核对而非自动拦截
const geometryReviewHint = computed(() => {
  const c = geometryConsistency.value
  if (!c || c.skipped) return null
  // 求解后仍不自洽：图与题设存在不可调和的矛盾，强提示
  if (!c.pass) {
    return { level: 'error', text: '图与题设不符，建议人工核对图形及标注' }
  }
  // 原图不自洽但可解出自洽解：原图标注可能有误，求解已校正
  if (c.rawPass === false) {
    return { level: 'warning', text: '原图与题设存在偏差，求解已校正，建议核对图形标注' }
  }
  // 退化几何（共线/重合等）
  if (c.degenerate) {
    return { level: 'warning', text: '检测到退化几何（共线/重合等），建议人工核对' }
  }
  return null
})

/** 将 TikZ 代码渲染为 SVG 字符串 */
const renderTikzSvg = (code) => {
  if (!code) return ''
  return tikzToSvg(code) || ''
}

/** 点击 SVG 全屏查看 */
const openFullscreen = () => {
  // svg_code 已是 SVG 源码，直接用；tikz_code 需转换
  const svg = displayType.value === 'svg_code'
    ? displayImageUrl.value
    : renderTikzSvg(displayImageUrl.value)
  if (svg) {
    fullscreenSvg.value = svg
    showFullscreenSvg.value = true
  }
}

const editing = ref(false)
const animatingBtn = ref('')
// 错题拦截弹窗「去编辑」触发：监听 store.pendingEditQuestionId 自动打开编辑面板
const editMode = ref(false)
const expandEditPanel = ref(false)
watch(() => store.pendingEditQuestionId, async (id) => {
  if (id && q.value && q.value.id === id) {
    await nextTick()
    handleEnterEdit()
    store.pendingEditQuestionId = null
  }
})
const quickAnswerEditing = ref(false)
const quickAnswerText = ref('')
const quickAnswerSaving = ref(false)
const quickInputRef = ref(null)
// 学生答案 quick edit：识别不到/识别错时老师手敲，支持 √/²/a/b 等 Unicode 符号与 $...$ LaTeX。
const quickStudentAnswerEditing = ref(false)
const quickStudentAnswerText = ref('')
const quickStudentAnswerSaving = ref(false)
const quickStudentInputRef = ref(null)
// 解析已移到题干行「解析」按钮（AnalysisSource），不再有展开态状态
const form = ref({ content: '', options: [], answer: '', analysis: '', tags: [], question_type: 'choice', subject: '' })
const originalData = ref(null)
const localImageUrl = ref('')
const showTagSelector = ref(false)
const allKnowledgeTags = ref(['全等三角形判定', '角的关系推导', '线段等式证明', '平行线的性质', '角平分线定义', '三角形内角和定理', '等式性质', '勾股定理', '相似三角形', '圆的性质', '函数与图像', '概率统计'])

// 答案 OCR 识别：弹窗状态 + 识别中锁 + 原图预览 + 识别结果
const recognizeDialogVisible = ref(false)
const recognizeLoading = ref(false)
const recognizeResult = ref(null)
const recognizePreviewUrl = ref('')
let recognizePreviewUrlToRevoke = ''

// 「AI 重解析」按钮（2026-09-23）：调答案引擎重算这一题参考答案
const recomputeAnswerLoading = ref(false)
// 已用秒数：等待期间显示在按钮上。最坏情况（kimi-k3 限流重试 + 付费通道慢）要等
// 一分多钟，只给一个不动的「AI 计算中…」老师会以为卡死。
const recomputeAnswerElapsed = ref(0)
let recomputeAnswerTimer = null
// 上一次重解析的结论，常驻在参考答案下方（可手动关掉）。
// 为什么必须常驻（2026-09-24）：原先只弹一条 3 秒的 ElMessage，老师点完去别处转一圈
// 回来，toast 早没了、页面上一点痕迹都没有 —— 表现就是「点了没用 / 什么都没变 /
// 不知道发生了啥」。尤其是「AI 明确说不会」（ai-declined）这种终态，更要说清楚，
// 否则老师会反复点，每次白等十几秒还烧额度。
const recomputeAnswerNotice = ref(null)

// 单题「重新识别」：吃原卷框选裁剪图，重识别题干/选项/答案（整页 OCR 漏选项时的补全手段）
const questionRecognizeDialogVisible = ref(false)
const questionRecognizeResult = ref(null)
const questionRecognizePreviewUrl = ref('')
let questionRecognizePreviewToRevoke = ''

// 截图粘贴对话框：用于接收 Ctrl+V / 长按粘贴到剪贴板的图片
const answerPasteDialogVisible = ref(false)
const answerPasteTargetRef = ref(null)

// 打开粘贴对话框 + 自动聚焦到粘贴 div（让 Ctrl+V 立即生效）
const openAnswerPasteDialog = () => {
  if (!q.value?.id) {
    ElMessage.warning('当前题目未选中')
    return
  }
  if (recognizeLoading.value) return
  answerPasteDialogVisible.value = true
  // nextTick 等 dialog 渲染完再聚焦
  nextTick(() => focusPasteTarget())
}

// 让粘贴 div 拿到焦点（电脑 Ctrl+V 才能触发 / 手机端长按粘贴也需要焦点）
const focusPasteTarget = () => {
  const el = answerPasteTargetRef.value
  if (el && typeof el.focus === 'function') el.focus()
}

// 从 paste 事件里挑出第一张图，转成 File 走原有识别链路
const handleAnswerPaste = (e) => {
  if (!e || !e.clipboardData) return
  // 阻止默认行为（避免 contenteditable 里塞进 base64 文本）
  e.preventDefault()
  const items = e.clipboardData.items
  if (!items || !items.length) {
    ElMessage.warning('剪贴板为空，请先到别的 AI 截图')
    return
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    // 跳过 file:// 拖文件之类的情况
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (!file) continue
    if (!file.type || !file.type.startsWith('image/')) {
      ElMessage.warning('剪贴板里不是图片，请粘贴截图')
      continue
    }
    // 后端 recognizer_answer 强依赖 file.name 非空，便于 fixFileIfNeeded 判断 HEIC
    if (!file.name) {
      const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
      file.name = `pasted-${Date.now()}.${ext}`
    }
    answerPasteDialogVisible.value = false
    handleRecognizeAnswerBeforeUpload(file)
    return
  }
  ElMessage.warning('剪贴板里没有图片，请粘贴截图')
}

// ═══ 原卷裁剪相关 ═══
const cropDialogVisible = ref(false)
const cropImageSource = ref('')
const cropContainerRef = ref(null)
const cropImageRef = ref(null)
const cropSelection = ref(null)
const cropStart = ref(null)
const cropMaxWidth = ref(800)
const cropSizeLabel = ref('')
const cropPreviewUrl = ref('')
const cropLoading = ref(false)
// 'figure'   = 裁剪结果当配图（原有行为）
// 'recognize' = 裁剪结果送视觉模型重识别题干/选项/答案（整页 OCR 漏选项时的补全手段）
const cropMode = ref('figure')

// 打开原卷裁剪弹窗。mode 决定「确认」后走哪条链路。
const openCropDialog = (mode) => {
  const task = store.currentTask
  if (!task) {
    ElMessage.warning('当前试卷无原图')
    return
  }
  // 多页试卷：按当前题目的 page_number 找到对应页的原图；
  // 单页/找不到页图时兜底用首页或 task.image_url。
  const question = store.currentReviewQuestion
  const pageNum = question?.page_number
  const pages = store.currentPaperPages
  let pageImage = ''
  if (pageNum != null && pages.length > 0) {
    const page = pages.find(p => p.page_number === pageNum)
    pageImage = page?.image_url || ''
  }
  if (!pageImage) pageImage = pages[0]?.image_url || task.image_url || ''
  if (!pageImage) {
    ElMessage.warning('当前试卷无原图')
    return
  }
  cropMode.value = mode
  cropImageSource.value = pageImage
  cropSelection.value = null
  cropPreviewUrl.value = ''
  cropSizeLabel.value = ''
  cropDialogVisible.value = true
}

const handleCropFromPaper = () => openCropDialog('figure')

// 「重新识别本题」入口。原卷页图取不到时由 openCropDialog 统一提示（不在这里重复判断）。
const handleRecognizeQuestionFromPaper = () => {
  if (!q.value?.id) {
    ElMessage.warning('当前题目未选中')
    return
  }
  openCropDialog('recognize')
}

// parseBbox / unionBbox 已改为 import 共享实现（见文件顶部注释），此处不再各留一份。

const generateCropPreview = () => {
  const sel = cropSelection.value
  if (!sel || sel.w < 5 || sel.h < 5) return
  const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(cropImageSource.value)}`
  const loadImg = new Image()
  loadImg.crossOrigin = 'anonymous'
  loadImg.onload = () => {
    const cr = getCropRect()
    if (!cr) return
    const canvas = document.createElement('canvas')
    canvas.width = cr.sw
    canvas.height = cr.sh
    const ctx = canvas.getContext('2d')
    // 先填充白色背景，确保裁剪图在试卷上完美融合
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(loadImg, cr.sx, cr.sy, cr.sw, cr.sh, 0, 0, cr.sw, cr.sh)
    cropPreviewUrl.value = canvas.toDataURL('image/png')
  }
  loadImg.onerror = () => {
    console.error('代理加载原图失败')
    ElMessage.warning('裁剪预览生成失败（原图加载异常）')
  }
  loadImg.src = proxyUrl
}

const cropImageLoaded = () => {
  // 按题目 bbox（text_bbox ∪ image_bbox）自动预选裁剪框，省去老师手动框
  const img = cropImageRef.value
  if (!img) return
  const rect = img.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  // allowOutOfRange：这里只做「自动预选」，越界部分稍后由下方 Math.min 夹到图片内，
  // 所以不按绘制路径那样丢弃越界框（否则 11.9% 的题会连预选框都没有）。
  const box = unionBbox(
    parseBbox(q.value?.text_bbox, { allowOutOfRange: true }),
    parseBbox(q.value?.image_bbox, { allowOutOfRange: true })
  )
  if (!box) return
  // 归一化 0-1000 坐标 → 显示像素
  let x = (box.x / 1000) * rect.width
  let y = (box.y / 1000) * rect.height
  let w = (box.width / 1000) * rect.width
  let h = (box.height / 1000) * rect.height
  // 外扩一圈 padding（8px），让裁出来的图比 bbox 略大（保住题号/解题过程）
  const PAD = 8
  x = Math.max(0, x - PAD)
  y = Math.max(0, y - PAD)
  w = Math.min(rect.width - x, w + 2 * PAD)
  h = Math.min(rect.height - y, h + 2 * PAD)
  if (w < 20 || h < 20) return // bbox 太小或缺数据则不强预选
  cropSelection.value = { x, y, w, h }
  cropSizeLabel.value = `${Math.round(w)} × ${Math.round(h)}`
  generateCropPreview()
}
const cropImageError = () => {
  console.error('原卷图片加载失败:', cropImageSource.value)
  ElMessage.error('原卷图片加载失败，请检查试卷图片是否存在')
}

const getCropRect = () => {
  const img = cropImageRef.value
  if (!img || !cropSelection.value) return null
  const rect = img.getBoundingClientRect()
  const scaleX = img.naturalWidth / rect.width
  const scaleY = img.naturalHeight / rect.height
  const sel = cropSelection.value
  return { sx: sel.x * scaleX, sy: sel.y * scaleY, sw: sel.w * scaleX, sh: sel.h * scaleY }
}

const onCropMouseDown = (e) => {
  const img = cropImageRef.value
  if (!img) return
  const rect = img.getBoundingClientRect()
  const x = Math.max(0, e.clientX - rect.left)
  const y = Math.max(0, e.clientY - rect.top)
  cropStart.value = { x, y }
  cropSelection.value = { x, y, w: 0, h: 0 }
  cropPreviewUrl.value = ''
}

const onCropMouseMove = (e) => {
  if (!cropStart.value) return
  const img = cropImageRef.value
  if (!img) return
  const rect = img.getBoundingClientRect()
  const curX = Math.min(Math.max(0, e.clientX - rect.left), rect.width)
  const curY = Math.min(Math.max(0, e.clientY - rect.top), rect.height)
  const x = Math.min(cropStart.value.x, curX)
  const y = Math.min(cropStart.value.y, curY)
  const w = Math.abs(curX - cropStart.value.x)
  const h = Math.abs(curY - cropStart.value.y)
  cropSelection.value = { x, y, w, h }
  cropSizeLabel.value = `${Math.round(w)} × ${Math.round(h)}`
}

const onCropMouseUp = () => {
  if (!cropStart.value || !cropSelection.value) return
  cropStart.value = null
  const sel = cropSelection.value
  if (sel.w < 5 || sel.h < 5) {
    cropSelection.value = null
    cropPreviewUrl.value = ''
    cropSizeLabel.value = ''
    return
  }
  generateCropPreview()
}

// 裁剪弹窗确认：按 cropMode 分流。
// 两条链路对同一张裁剪图的处理方式**故意不同**：
//   配图链路要做白底化/去手写/增强（让图好看）；
//   识别链路必须用原始裁剪图 —— 那些增强为「配图可读性」服务，会改变笔画粗细与灰度，
//   反而可能吃掉印刷小字或细笔划，让 OCR 更差。
const confirmCrop = async () => {
  if (!cropPreviewUrl.value || !q.value?.id) return
  cropLoading.value = true
  try {
    if (cropMode.value === 'recognize') {
      await runQuestionRecognize(cropPreviewUrl.value)
    } else {
      await uploadCroppedFigure(cropPreviewUrl.value)
    }
  } finally {
    cropLoading.value = false
  }
}

const dataUrlToFile = async (dataUrl, filename) => {
  const blob = await (await fetch(dataUrl)).blob()
  return new File([blob], filename, { type: blob.type || 'image/png' })
}

// 链路一（原有行为）：白底化 + 去脏边 + 去手写 + 增强 → 上传 OSS → 写 geometry_image_url
const uploadCroppedFigure = async (dataUrl) => {
  try {
    const processedDataUrl = await processExamImage(dataUrl, {
      autoEnhance: true,
      removeHandwriting: true,
      padding: 5
    })

    const blob = await (await fetch(processedDataUrl)).blob()
    const file = new File([blob], 'crop.png', { type: 'image/png' })
    const url = await uploadImage(file, store.currentTask?.student_id || store.currentStudent?.id)
    if (!url) throw new Error('上传返回无 URL')
    localImageUrl.value = url
    if (q.value) {
      q.value.geometry_image_url = url
      // 老师手动裁剪 = 人工背书这张图，标记 override，保存后落库；
      // 即使该题被视觉模型判为"无可重绘"（数轴/实物/统计图），前端也不再屏蔽。
      q.value.geometry_manual_override = true
    }
    // 绕过当前会话内的几何图显示闸门，立刻看到刚裁的图
    showOriginal.value = true
    cropDialogVisible.value = false
    ElMessage.success('裁剪图片已上传并处理')
  } catch (err) {
    console.error('裁剪上传失败:', err)
    ElMessage.error('裁剪图片上传失败')
  }
}

// 链路二（新增）：原始裁剪图直传后端重识别 → 弹预览，老师逐字段勾选后才回填
const runQuestionRecognize = async (dataUrl) => {
  const file = await dataUrlToFile(dataUrl, 'question-crop.png')
  if (questionRecognizePreviewToRevoke) {
    URL.revokeObjectURL(questionRecognizePreviewToRevoke)
    questionRecognizePreviewToRevoke = ''
  }
  questionRecognizePreviewUrl.value = URL.createObjectURL(file)
  questionRecognizePreviewToRevoke = questionRecognizePreviewUrl.value
  try {
    questionRecognizeResult.value = await recognizeQuestion(q.value.id, file)
    cropDialogVisible.value = false
    questionRecognizeDialogVisible.value = true
  } catch (err) {
    console.error('重新识别失败:', err)
    ElMessage.error(`识别失败：${err?.message || err}`)
  }
}

watch(q, (newQ) => {
  if (newQ) {
    form.value = {
      content: newQ.content || '',
      options: normalizeOptions(JSON.parse(JSON.stringify(newQ.options || []))),
      answer: newQ.answer || '',
      analysis: newQ.analysis || '',
      tags: JSON.parse(JSON.stringify(newQ.ai_tags || newQ.knowledge_points || [])),
      question_type: newQ.question_type || 'choice',
      subject: newQ.subject || ''
    }
    // 配图仅取题干裁剪图；image_url 是整页试卷图，不能作为配图展示
    localImageUrl.value = newQ.geometry_image_url || ''
    originalData.value = JSON.parse(JSON.stringify(form.value))
    originalData.value.geometryImageUrl = localImageUrl.value
  } else {
    form.value = { content: '', options: [], answer: '', analysis: '', tags: [] }
    localImageUrl.value = ''
  }
  editing.value = false
  quickAnswerEditing.value = false
  quickAnswerText.value = ''
  quickStudentAnswerEditing.value = false
  quickStudentAnswerText.value = ''
  // 换题时收掉上一题的识别结果与临时预览 URL，避免对象 URL 泄漏 + 串题
  questionRecognizeDialogVisible.value = false
  questionRecognizeResult.value = null
  if (questionRecognizePreviewToRevoke) {
    URL.revokeObjectURL(questionRecognizePreviewToRevoke)
    questionRecognizePreviewToRevoke = ''
    questionRecognizePreviewUrl.value = ''
  }
}, { immediate: true })

const startQuickAnswerEdit = () => {
  quickAnswerText.value = q.value?.answer || ''
  quickAnswerEditing.value = true
  nextTick(() => {
    quickInputRef.value?.focus()
  })
}
const cancelQuickAnswerEdit = () => {
  quickAnswerEditing.value = false
  quickAnswerText.value = ''
}
const startQuickStudentAnswerEdit = () => {
  quickStudentAnswerText.value = q.value?.student_answer || ''
  quickStudentAnswerEditing.value = true
  nextTick(() => {
    quickStudentInputRef.value?.focus()
  })
}
const cancelQuickStudentAnswerEdit = () => {
  quickStudentAnswerEditing.value = false
  quickStudentAnswerText.value = ''
}
// 「AI 重解析」按钮 handler：调答案引擎重算当前题的标准答案。
// 已存在答案 → 弹确认框（force=true 强制覆盖）；不存在 → 直接跑。
const handleRecomputeAnswer = async () => {
  const question = q.value
  if (!question?.id) return
  if (recomputeAnswerLoading.value) return
  let force = false
  if (question.answer && String(question.answer).trim()) {
    try {
      await ElMessageBox.confirm(
        '此题已有参考答案（' + String(question.answer).slice(0, 24) + '…），继续会覆盖现有答案，确定吗？',
        'AI 重解析',
        { confirmButtonText: '覆盖重算', cancelButtonText: '取消', type: 'warning' }
      )
      force = true
    } catch (_) {
      return
    }
  }
  recomputeAnswerLoading.value = true
  recomputeAnswerElapsed.value = 0
  recomputeAnswerNotice.value = null
  // 计时器：按钮上显示已用秒数，让老师知道请求还活着（不是卡死）
  clearInterval(recomputeAnswerTimer)
  recomputeAnswerTimer = setInterval(() => { recomputeAnswerElapsed.value += 1 }, 1000)
  try {
    const resp = await recomputeQuestionAnswer(question.id, { force })
    if (resp?.answer) {
      question.answer = resp.answer
      if (resp.analysis) question.analysis = resp.analysis
      if (typeof resp.is_correct !== 'undefined') question.is_correct = resp.is_correct
      // 标记来源为 AI，让老师后续能看到「参考答案由 AI 重算」
      question.answer_source = 'ai'
      // 同步入册风险标签
      const studentId = store.currentStudent?.id
      if (studentId) clearStudentCaches(studentId)
      if (resp.degraded) {
        // 主模型不可用、答案来自降级通道：绝不给绿色「完成」，否则老师会把它当标准答案
        // 照单全收。后端已同步写入 ai_answer_risk_reason，这里用黄色长提示让老师核一遍。
        recomputeAnswerNotice.value = {
          type: 'warning',
          text: `主模型此时不可用，已用降级通道${resp.engine ? '（' + resp.engine + '）' : ''}算出答案，请核对后再用：${String(resp.answer).slice(0, 40)}`
        }
        ElMessage({
          type: 'warning',
          duration: 6000,
          message: recomputeAnswerNotice.value.text
        })
      } else {
        recomputeAnswerNotice.value = {
          type: 'success',
          text: `AI 重算完成${resp.engine ? '（' + resp.engine + '）' : ''}：${String(resp.answer).slice(0, 40)}`
        }
        ElMessage.success(recomputeAnswerNotice.value.text)
      }
    } else {
      recomputeAnswerNotice.value = { type: 'warning', text: 'AI 未返回有效答案' }
      ElMessage.warning('AI 未返回有效答案')
    }
  } catch (err) {
    console.error('AI 重解析失败:', err)
    // 后端把「数据库连不上」和「引擎算不出来」分成了两个错误码，可读文案在
    // payload.message 里（httpCore 的 err.message 优先取 error 字段=错误码，
    // 直接展示会变成 "AI 重解析失败：db-unavailable" 这种看不懂的字符串）。
    const readable = err?.payload?.message || err?.message || err
    // ai-declined = AI 明确说「这题我给不了确定答案」（无图题缺条件 / 带图题读完图仍判不了 /
    // 作图题（答案需画在图上）直接预判跳过视觉求解），是**终态**：
    // 再点多少次都一样（带图题已走视觉读图求解，见后端 recompute-answer）。用 warning 而不是
    // error 呈现 —— 这不是系统故障，别让老师以为是坏了、反复重试烧额度。其余错误码
    // （timeout / primary-model-unavailable / db-unavailable）都是「这次没成」，用 error，可稍后重试。
    const declined = err?.payload?.error === 'ai-declined'
    recomputeAnswerNotice.value = { type: declined ? 'warning' : 'error', text: readable }
    ElMessage({ type: declined ? 'warning' : 'error', duration: 8000, message: `AI 重解析：${readable}` })
  } finally {
    clearInterval(recomputeAnswerTimer)
    recomputeAnswerTimer = null
    recomputeAnswerLoading.value = false
  }
}
const saveQuickStudentAnswer = async () => {
  const question = q.value
  if (!question?.id) return
  const text = quickStudentAnswerText.value?.trim()
  if (!text) {
    ElMessage.warning('请输入学生答案')
    return
  }
  quickStudentAnswerSaving.value = true
  try {
    // 同步把 answer_source 改为 'teacher_input'，让右上角标签从"未作答"切到"手动录入"，
    // 否则 OCR 留下的 answer_source='blank' 会持续误导老师。
    const resp = await updateQuestion(question.id, { student_answer: text, answer_source: 'teacher_input' })
    question.student_answer = text
    question.answer_source = 'teacher_input'
    // 同步后端算的最新入册风险（⚠ tag 实时消失/出现）
    if (Array.isArray(resp?.question?.wrong_book_risks)) question.wrong_book_risks = resp.question.wrong_book_risks
    // 答案变更后自动重判，否则 AI 判定会跟学生答案对不上
    try {
      const rejudgeResult = await rejudgeQuestion(question.id)
      if (rejudgeResult?.success) {
        question.is_correct = rejudgeResult.is_correct
      }
    } catch (rejudgeErr) {
      console.warn('重判学生答案失败（不影响保存）:', rejudgeErr.message)
    }
    const studentId = store.currentStudent?.id
    if (studentId) clearStudentCaches(studentId)
    quickStudentAnswerEditing.value = false
    quickStudentAnswerText.value = ''
    ElMessage.success('学生答案已保存')
  } catch (err) {
    console.error('保存学生答案失败:', err)
    // 把后端返回的具体原因（如"题目不存在"/"网络中断"/HTTP 状态码）冒出来，
    // 避免只看到"保存失败，请重试"却无从判断是接口挂了、被 CORS 拦了还是本地状态问题。
    ElMessage.error(`保存失败：${err?.message || err || '未知错误'}`)
  } finally {
    quickStudentAnswerSaving.value = false
  }
}
const saveQuickAnswer = async () => {
  const question = q.value
  if (!question?.id) return
  const text = quickAnswerText.value?.trim()
  if (!text) {
    ElMessage.warning('请输入标准答案')
    return
  }
  quickAnswerSaving.value = true
  try {
    const resp = await updateQuestion(question.id, { answer: text })
    question.answer = text
    if (Array.isArray(resp?.question?.wrong_book_risks)) question.wrong_book_risks = resp.question.wrong_book_risks
    quickAnswerEditing.value = false
    quickAnswerText.value = ''
    ElMessage.success('标准答案已保存')
  } catch (err) {
    console.error('保存标准答案失败:', err)
    ElMessage.error(`保存失败：${err?.message || err || '未知错误'}`)
  } finally {
    quickAnswerSaving.value = false
  }
}

const handleEnterEdit = () => {
  originalData.value = JSON.parse(JSON.stringify(form.value))
  originalData.value.geometryImageUrl = localImageUrl.value
  editing.value = true
}
const handleCancelEdit = () => {
  if (originalData.value) {
    form.value = JSON.parse(JSON.stringify(originalData.value))
    localImageUrl.value = originalData.value.geometryImageUrl || ''
  }
  editing.value = false
}

// el-upload before-upload：拦截文件 → 调识别接口 → 弹预览弹窗
const handleRecognizeAnswerBeforeUpload = async (file) => {
  if (!q.value?.id) {
    ElMessage.warning('当前题目未选中')
    return false
  }
  if (recognizeLoading.value) return false

  if (recognizePreviewUrlToRevoke) {
    URL.revokeObjectURL(recognizePreviewUrlToRevoke)
    recognizePreviewUrlToRevoke = ''
  }
  // 直接走原生 URL.createObjectURL 给预览；HEIC 由后端 fixFileIfNeeded 转码，
  // 前端 heicPreview 依赖 heic-decode 包会拖垮批改中心 bundle（vite 解析失败）。
  recognizePreviewUrl.value = URL.createObjectURL(file)
  recognizePreviewUrlToRevoke = recognizePreviewUrl.value

  recognizeLoading.value = true
  try {
    recognizeResult.value = await recognizeAnswer(q.value.id, file)
    recognizeDialogVisible.value = true
  } catch (err) {
    ElMessage.error(`识别失败：${err.message || err}`)
  } finally {
    recognizeLoading.value = false
  }
  return false  // 阻止 el-upload 自行上传
}

const handleApplyRecognized = (answer) => {
  form.value = { ...form.value, answer }
  ElMessage.success('已填入答案，点「保存」即可入库')
}

// 应用「重新识别本题」结果：只写老师勾选的字段。
// 默认策略（空字段默认勾选、非空默认不勾）在 QuestionRecognizeDialog 内实现，
// 这里只负责把选中的值填进表单 —— 真正落库仍要老师点「保存」走 PUT /api/questions/:id，
// 从而自动联动 is_complete / wrong_book_risks / 重判。
const handleApplyRecognizedQuestion = (payload) => {
  const applied = []
  if (payload?.content) {
    form.value.content = payload.content
    applied.push('题干')
  }
  if (Array.isArray(payload?.options) && payload.options.length > 0) {
    form.value.options = [...payload.options]
    // 选项只属于选择题：采用选项即把题型定为 choice。
    // 否则编辑表单的「选项」区块（v-if question_type === 'choice'）不渲染，
    // 老师会以为补了个寂寞；checkQuestionCompleteness 的缺选项规则也只对 choice 生效。
    form.value.question_type = 'choice'
    applied.push(`${payload.options.length} 个选项`)
  }
  if (payload?.answer) {
    form.value.answer = payload.answer
    applied.push('参考答案')
  }
  if (payload?.analysis) {
    form.value.analysis = payload.analysis
    applied.push('解析')
  }
  if (applied.length === 0) return
  ElMessage.success(`已填入${applied.join('、')}，点「保存」即可入库`)
}
const addOption = () => { form.value.options.push('') }
const removeOption = (idx) => { form.value.options.splice(idx, 1) }
const removeTag = (tag) => { form.value.tags = form.value.tags.filter(t => t !== tag) }
const toggleTag = (tag) => {
  const idx = form.value.tags.indexOf(tag)
  if (idx === -1) form.value.tags.push(tag)
  else form.value.tags.splice(idx, 1)
}

const handleSave = async () => {
  const question = q.value
  if (!question?.id) return
  const loading = ElLoading.service({ lock: true, text: '保存中...', background: 'rgba(0,0,0,0.7)' })
  try {
    const resp = await updateQuestion(question.id, {
      content: form.value.content, options: form.value.options, answer: form.value.answer,
      analysis: form.value.analysis, student_answer: question.student_answer,
      geometry_image_url: localImageUrl.value || question.geometry_image_url,
      geometry_manual_override: !!question.geometry_manual_override,
      ai_tags: form.value.tags,
      question_type: form.value.question_type, subject: form.value.subject
    })
    Object.assign(question, { content: form.value.content, options: form.value.options, answer: form.value.answer, analysis: form.value.analysis, ai_tags: form.value.tags, geometry_image_url: localImageUrl.value, geometry_manual_override: !!question.geometry_manual_override, question_type: form.value.question_type, subject: form.value.subject })
    // 同步后端算的最新入册风险（⚠ 缺图 / ⚠ 缺选项 / ⚠ 题型缺失 / ⚠ 低置信 tag 实时消失/出现）
    if (Array.isArray(resp?.question?.wrong_book_risks)) question.wrong_book_risks = resp.question.wrong_book_risks
    // 保存后自动重批改
    try {
      const rejudgeResult = await rejudgeQuestion(question.id)
      if (rejudgeResult.success) {
        question.is_correct = rejudgeResult.is_correct
      }
    } catch (rejudgeErr) {
      console.warn('重批改失败（不影响保存）:', rejudgeErr.message)
    }
    const studentId = store.currentStudent?.id
    if (studentId) clearStudentCaches(studentId)
    editing.value = false
    loading.close()
    ElMessage.success('修改已保存')
  } catch (err) {
    loading.close()
    console.error('保存失败:', err)
    ElMessage.error(`保存失败：${err?.message || err || '未知错误'}`)
  }
}

const handleReview = async (result) => {
  const question = q.value
  if (!question) return
  const btn = store.reviewConfig.buttons
  const resultText = {
    correct: `已标记为${btn.correct}`,
    wrong: `已标记为${btn.wrong}`,
    exclude: '已删除本题'
  }
  // [2026-09-15] 「删除」必须二次确认，避免误点误删。
  // 该动作是软删除：review_status='exclude' 落库后前端立即从列表移除，
  // 后端 getQuestionsByTask 也会永久过滤 → 本页面再也看不到、点不到这题；
  // 而「撤销上一笔」(undoLastReview) 只回退内存状态、不会把题插回列表，
  // 即删除在本页面不可挽回，因此必须挡住误触。
  if (result === 'exclude') {
    try {
      await ElMessageBox.confirm(
        '删除后本题将从本份试卷中移除、不再计入复核进度，且本页面无法找回。<br><span style="color:var(--wb-text-tertiary)">适用场景：OCR 把一行识别成两行、两道题识别成同一道、识别失败的残段等。</span>',
        '确认删除本题？',
        {
          confirmButtonText: '删除',
          cancelButtonText: '取消',
          type: 'warning',
          confirmButtonClass: 'el-button--danger',
          dangerouslyUseHTMLString: true,
        }
      )
    } catch {
      // 老师取消 → 不做任何变更（不写库、不动列表、不弹成功提示）
      return
    }
  }
  // 标记"错误"需完整性检查（错误题要入错题本）
  if (result === 'wrong') {
    const blocked = store.reviewQuestion(question.id, result)
    if (blocked?.blocked) {
      ElMessageBox.confirm(
        `题目不完整，无法加入错题本：<br><span style="color:var(--wb-warning)">${blocked.issues.map(i => '• ' + i).join('<br>')}</span><br><br>去编辑面板补全即可：选择题缺选项时点「<b>重新识别本题</b>」，在原卷上框一下就能自动补出来。`,
        '题目不完整',
        { confirmButtonText: '去编辑', cancelButtonText: '取消', type: 'warning', dangerouslyUseHTMLString: true }
      ).then(() => {
        handleEnterEdit()
      }).catch(() => {})
      return
    }
  } else {
    // wrong→correct 时弹"误判类型"下拉，便于事后统计 AI 误判归因（2026-09-01 上线问题 6）
    // 老师可跳过；跳过则 misjudgeType 留空，admin 统计归为 'unset'。
    if (result === 'correct' && question.is_correct === false) {
      try {
        const { value } = await ElMessageBox({
          title: '这是什么类型的误判？',
          message: 'AI 把这题判错了。请选择原因（帮助我们改进判题规则）：',
          showInput: true,
          inputOptions: [
            { value: 'equivalent_form', label: '等价形式（如 x²、分数顺序、约分）' },
            { value: 'parse_error', label: 'AI 提取学生答案错误' },
            { value: 'typo', label: '学生笔误/小计算错误' },
            { value: 'wrong_rule', label: '判题规则本身有误' },
            { value: 'other', label: '其他' }
          ],
          inputPlaceholder: '请选择',
          showCancelButton: true,
          confirmButtonText: '确定',
          cancelButtonText: '跳过',
          inputValidator: (val) => !!val || '请选择一项'
        })
        store.reviewQuestion(question.id, result, { misjudgeType: value })
      } catch {
        // 老师跳过，照常标 correct
        store.reviewQuestion(question.id, result)
      }
    } else {
      store.reviewQuestion(question.id, result)
    }
  }
  // 按钮动画反馈
  animatingBtn.value = result
  setTimeout(() => { animatingBtn.value = '' }, 400)
  ElMessage.success(resultText[result])
}
const nextQ = () => { store.nextQuestion() }
const prevQ = () => { store.prevQuestion() }

const handleImageUpload = async (file) => {
  const question = q.value
  if (!question?.id) { ElMessage.error('题目ID不存在'); return false }
  const reader = new FileReader()
  reader.onload = (e) => { localImageUrl.value = e.target?.result || '' }
  reader.readAsDataURL(file)
  try {
    const formData = new FormData()
    formData.append('files', file)
    const response = await fetch('/api/upload', { method: 'POST', body: formData })
    if (!response.ok) throw new Error('上传失败')
    const result = await response.json()
    localImageUrl.value = result.url
    question.geometry_image_url = result.url
    question.geometry_manual_override = true
    showOriginal.value = true
    ElMessage.success('配图上传成功')
  } catch (err) {
    console.error('图片上传失败:', err)
    ElMessage.error('图片上传失败')
  }
  return false
}
const deleteImage = () => {
  localImageUrl.value = ''
  if (q.value) {
    q.value.geometry_image_url = ''
    q.value.geometry_manual_override = false
  }
  showOriginal.value = false
  ElMessage.success('配图已删除')
}

const retryGeometryLoading = ref(false)

const handleRetryGeometry = async () => {
  const question = q.value
  if (!question?.id) return
  retryGeometryLoading.value = true
  try {
    const result = await retryGeometry(question.id)
    if (result.success) {
      question.tikz_status = 'pending'
      ElMessage.success('已重新提交几何图重建任务')
    } else {
      ElMessage.error(result.error || '重新提交失败')
    }
  } catch (err) {
    console.error('几何图重试失败:', err)
    ElMessage.error('重新提交失败，请稍后重试')
  } finally {
    retryGeometryLoading.value = false
  }
}
</script>

<style scoped>
/* ── 容器 ── */
.ops-panel {
  width: 520px;
  display: flex;
  flex-direction: column;
  background: var(--wb-bg);
  border-left: 1px solid var(--wb-border);
  flex-shrink: 0;
  overflow: hidden;
}
.ops-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--wb-text-tertiary);
  font-size: 14px;
}

/* ── 顶栏 ── */
.ops-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid var(--wb-border);
  flex-shrink: 0;
}
.ops-header__left, .ops-header__right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ops-type-tag { font-weight: 600; }
.ops-qnum {
  font-size: 16px;
  font-weight: 700;
  color: var(--wb-text);
}
.ops-confidence {
  font-size: 12px;
  font-weight: 600;
  color: var(--wb-success);
  background: var(--wb-success-soft);
  padding: 2px 10px;
  border-radius: var(--wb-radius-md);
}
.ops-confidence.conf-low { color: var(--wb-warning); background: var(--wb-warning-soft); }

/* AI 自检未通过红色标签（题 14 案：answer 写 √5，分析算 11/5） */
.ops-self-check-tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: var(--fs-10);
  font-weight: 600;
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fca5a5;
  cursor: help;
}

/* 参考答案来源标签（答案库 / AI 解答，两档）。
   中性信息用灰，AI 解答用琥珀 —— 不是报错，是"别无条件信它"，所以刻意不用红色：
   红色留给上面那个真正表示"解析自检没过"的 ⚠ AI 不可信。 */
.ops-ref-origin {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: var(--fs-10);
  font-weight: 600;
  cursor: help;
  white-space: nowrap;
}
.ops-ref-origin.origin-info {
  color: #475569;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
}
.ops-ref-origin.origin-warning {
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fcd34d;
}

/* ── 答案对照条 ── */
.ops-compare-bar {
  display: flex;
  align-items: stretch;
  background: #fff;
  margin: 8px 10px 0;
  padding: 10px 14px;
  border-radius: var(--wb-radius-xs);
  box-shadow: var(--wb-shadow-sm);
  flex: 0 1 auto;
  min-height: 0;
  max-height: 38vh;
}
.ops-compare-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  min-height: 0;
}
.ops-cmp-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--wb-text-tertiary);
  letter-spacing: 0.5px;
}
.ops-cmp-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ops-ans-recognize-btn {
  font-size: 12px !important;
  padding: 5px 12px !important;
  height: 30px !important;
}
.ops-ans-edit-btn {
  font-size: 12px !important;
  padding: 3px 10px !important;
  height: 26px !important;
}

.ops-cmp-value {
  display: block;
  font-size: 16px;
  font-weight: 600;
  padding: 5px 8px;
  border-radius: var(--wb-radius-xs);
  line-height: 1.4;
  word-break: break-word;
  overflow-wrap: anywhere;
  flex: 1 1 auto;
  min-height: 0;
  max-height: 30vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.ops-cmp-value::-webkit-scrollbar { width: 8px; }
.ops-cmp-value::-webkit-scrollbar-thumb {
  background: #B6C2D2;
  border-radius: var(--wb-radius-xs);
}
.ops-cmp-value::-webkit-scrollbar-thumb:hover { background: #8E9DB2; }
.student-val { background: var(--wb-bg); color: var(--wb-text); }
.correct-val { color: var(--wb-success); }
.ref-answer-val {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.6;
  word-break: normal;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.ops-cmp-divider {
  width: 1px;
  background: var(--wb-border);
  margin: 0 12px;
  flex-shrink: 0;
}

/* ── 快速填写标准答案 ── */
.quick-answer-wrap { min-height: 32px; display: flex; align-items: center; }
.missing-val {
  color: var(--wb-text-tertiary); cursor: pointer; transition: color 0.15s;
  display: inline-flex; align-items: center; gap: 6px; font-size: 18px;
}
.missing-val:hover { color: var(--wb-primary); }
.quick-edit-hint { font-size: 12px; font-weight: 400; color: var(--wb-primary); }
.quick-answer-edit {
  display: flex; flex-direction: column; gap: 6px;
}
.quick-answer-actions { display: flex; gap: 4px; }

/* ── AI 判定 ── */
.ops-ai-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff;
  margin: 0 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--wb-bg-hover);
  flex-shrink: 0;
}

/* ── 顶栏模式标题 ── */
.ops-mode-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--wb-text);
  margin-right: 4px;
}
.ops-ai-icon {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: #fff; flex-shrink: 0;
}
.ai-ok { background: var(--wb-success); }
.ai-fail { background: var(--wb-danger); }
.ai-pending { background: var(--wb-warning); }
.ai-exception { background: var(--wb-accent); }
.ai-processing { background: var(--wb-processing); }
.ops-ai-text { font-size: 13px; color: var(--wb-text-secondary); }
.ops-ai-reason { font-size: 12px; color: var(--wb-warning); }

/* 图题风险提示：客观题 + 几何/图表配图时，软提示老师核对参考答案 */
.ops-image-risk {
  flex-shrink: 0;
  margin: 8px 10px 0;
  padding: 6px 10px;
}
.ops-image-risk :deep(.el-alert__title) {
  font-size: 12px;
  font-weight: 500;
  color: var(--wb-warning);
}

/* 「AI 重解析」上次结论：常驻在参考答案下方，可关闭 */
.ops-recompute-notice {
  flex-shrink: 0;
  margin: 8px 10px 0;
  padding: 6px 10px;
}
.ops-recompute-notice :deep(.el-alert__title) {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
}

/* ═══ 完整题目内容区（可滚动） ═══ */
.ops-question-body {
  flex: 1 1 auto;
  overflow-y: auto;
  min-height: 120px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ops-q-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ops-q-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--wb-text-tertiary);
  letter-spacing: 0.5px;
  flex-shrink: 0;
}
/* 题干标签行：标签 + 右侧「原卷」小入口 */
.ops-q-label-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ops-q-text--empty {
  color: var(--wb-text-tertiary);
  font-style: italic;
}
.ops-q-text {
  font-size: 15px;
  line-height: 1.7;
  color: var(--wb-text);
  white-space: pre-wrap;
  word-break: break-word;
}
/* 多小问大题公共题干：弱化呈现（灰色 + 左侧竖线），与本题题干区分 */
.ops-q-stem {
  font-size: 14px;
  line-height: 1.7;
  color: var(--wb-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  padding-left: 8px;
  border-left: 3px solid var(--wb-border, #e5e6eb);
  margin-bottom: 4px;
}

/* 选项 */
.ops-option-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 0;
}
.ops-opt-letter {
  font-weight: 700;
  color: var(--wb-text-tertiary);
  min-width: 20px;
  font-size: 14px;
  flex-shrink: 0;
  padding-top: 2px;
}
.ops-opt-text {
  font-size: 15px;
  color: var(--wb-text);
  line-height: 1.6;
}
.option-highlight .ops-opt-letter,
.option-highlight .ops-opt-text { color: var(--wb-success); font-weight: 600; }

/* 选择题选项缺失（整页 OCR 漏识别）：给原因 + 出口，而不是静默隐藏整块 */
.ops-options-missing {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding: 8px 10px;
  border: 1px dashed var(--wb-warning, #e6a23c);
  border-radius: var(--wb-radius-xs, 4px);
  background: var(--wb-warning-light, #fdf6ec);
  font-size: 13px;
  line-height: 1.6;
  color: var(--wb-text-secondary);
}

/* 配图 */
.ops-image-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ops-image {
  max-width: 100%;
  max-height: 240px;
  border-radius: var(--wb-radius-xs);
  cursor: zoom-in;
  border: 1px solid var(--wb-border);
  object-fit: contain;
}
.tikz-svg-container {
  max-width: 100%;
  max-height: 280px;
  border-radius: var(--wb-radius-xs);
  cursor: zoom-in;
  border: 1px solid var(--wb-border);
  background: #fff;
  padding: 8px;
  display: flex;
  justify-content: center;
  align-items: center;
}
.tikz-svg-container :deep(svg) {
  max-width: 100%;
  height: auto;
}
.ops-no-image {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--wb-text-tertiary);
  font-size: 13px;
  padding: 12px 0;
}
.ops-image-actions { display: flex; gap: 6px; }

/* 标签 */
.ops-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

/* ═══ 底部操作区（固定） ═══ */
.ops-actions {
  flex-shrink: 0;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--wb-border);
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ops-geom-hint { margin: 0; }
.ops-buttons-primary {
  display: flex;
  gap: 8px;
}
.ops-buttons-secondary {
  display: flex;
  gap: 8px;
}
.ops-buttons-secondary .el-button { flex: 1; }

.ops-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 44px;
  border-radius: var(--wb-radius-sm);
  border: 2px solid;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
  background: #fff;
}
.ops-btn-icon { font-size: 18px; }

.ops-btn-correct { color: var(--wb-success); border-color: var(--wb-success-soft); background: var(--wb-success-soft); }
.ops-btn-correct:hover { background: var(--wb-success-soft); border-color: var(--wb-success); }
.ops-btn-wrong { color: var(--wb-danger); border-color: var(--wb-danger-soft); background: var(--wb-danger-soft); }
.ops-btn-wrong:hover { background: var(--wb-danger-soft); border-color: var(--wb-danger); }
.ops-btn-exclude { color: var(--wb-text-tertiary); border-color: var(--wb-border); background: var(--wb-bg-hover); }
.ops-btn-exclude:hover { background: var(--wb-bg-mist); border-color: var(--wb-border); }

/* 复审状态标记 */
.ops-review-badge { margin-left: 4px; }

/* 复审按钮激活状态 */
.ops-btn-active {
  transform: scale(1.05);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.3);
  border-color: var(--wb-primary) !important;
}
.ops-btn-active.ops-btn-correct { border-color: var(--wb-success) !important; box-shadow: 0 0 0 3px rgba(22,163,74,0.3); }
.ops-btn-active.ops-btn-wrong { border-color: var(--wb-danger) !important; box-shadow: 0 0 0 3px rgba(220,38,38,0.3); }
.ops-btn-active.ops-btn-exclude { border-color: var(--wb-text-tertiary) !important; box-shadow: 0 0 0 3px rgba(148,163,184,0.3); }

/* 按钮点击脉冲动画 */
.ops-btn.animate {
  animation: btn-pulse 0.4s ease;
}
@keyframes btn-pulse {
  0% { transform: scale(1); }
  25% { transform: scale(1.08); }
  50% { transform: scale(0.96); }
  70% { transform: scale(1.03); }
  100% { transform: scale(1); }
}

.tag-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.tag-option {
  padding: 6px 14px; border: 1px solid var(--wb-border); border-radius: var(--wb-radius-lg);
  font-size: 13px; color: var(--wb-text-secondary); cursor: pointer; transition: all 0.2s; user-select: none;
}
.tag-option:hover { border-color: var(--wb-primary); color: var(--wb-primary); }
.tag-selected { background: var(--wb-primary-mist); border-color: var(--wb-primary); color: var(--wb-primary); font-weight: 500; }

/* ═══ 题干+配图+选项 统一卡片 ═══ */
.ops-content-card {
  background: #fff;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-sm);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ops-image-section {
  border-top: 1px dashed var(--wb-border);
  border-bottom: 1px dashed var(--wb-border);
  padding: 10px 0;
  margin: 2px 0;
}

/* ═══ 题型 · 学科 ═══ */
.ops-type-subject-row {
  display: flex;
  gap: 8px;
}

/* ═══ 原卷裁剪 ═══ */
.crop-container {
  position: relative;
  display: inline-block;
  cursor: crosshair;
  user-select: none;
  line-height: 0;
}
.crop-image {
  max-width: 780px;
  max-height: 70vh;
  display: block;
}
.crop-selection {
  position: absolute;
  border: 2px dashed var(--wb-primary);
  background: rgba(99, 102, 241, 0.12);
  pointer-events: none;
  z-index: 10;
}
.crop-size-label {
  position: absolute;
  bottom: -26px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 13px;
  color: var(--wb-primary);
  font-weight: 600;
  background: rgba(255,255,255,0.9);
  padding: 2px 10px;
  border-radius: var(--wb-radius-xs);
  white-space: nowrap;
  pointer-events: none;
  z-index: 11;
}
.crop-preview-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 32px;
  padding-top: 12px;
  border-top: 1px solid var(--wb-border);
}
.crop-preview-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--wb-text-tertiary);
  flex-shrink: 0;
}
.crop-preview-img {
  max-height: 100px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-xs);
  object-fit: contain;
}
/* 「重新识别」模式下框选区域的操作提示 */
.crop-mode-hint {
  margin-top: 32px;
  padding: 8px 12px;
  border-radius: var(--wb-radius-xs);
  background: var(--wb-primary-light, #ecf5ff);
  color: var(--wb-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

/* ── 截图粘贴对话框（OCR 答案入口）── */
.ops-paste-hint {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
  font-size: 13px;
  color: var(--wb-text-secondary);
  line-height: 1.5;
}
.ops-paste-step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.ops-paste-num {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--wb-primary-soft, rgba(64, 158, 255, 0.12));
  color: var(--wb-primary, #409eff);
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ops-paste-drop {
  border: 2px dashed var(--wb-border);
  border-radius: var(--wb-radius-md);
  background: var(--wb-bg-soft, rgba(0, 0, 0, 0.02));
  padding: 24px 16px;
  text-align: center;
  cursor: text;
  outline: none;
  transition: border-color 0.18s, background 0.18s;
}
.ops-paste-drop:focus,
.ops-paste-drop:hover {
  border-color: var(--wb-primary, #409eff);
  background: var(--wb-primary-soft, rgba(64, 158, 255, 0.06));
}
.ops-paste-drop-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none;
}
.ops-paste-icon {
  font-size: 32px;
  line-height: 1;
}
.ops-paste-text {
  font-size: 14px;
  color: var(--wb-text);
  font-weight: 500;
}
.ops-paste-sub {
  font-size: 12px;
  color: var(--wb-text-tertiary);
}
.ops-paste-fallback {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 12px;
  font-size: 12px;
  color: var(--wb-text-tertiary);
}
</style>
