<template>
  <div class="worksheet-mgr">
    <div class="page-header">
      <h2>练习册管理</h2>
      <div style="display:flex;gap:8px;">
        <el-button type="warning" plain @click="showFixDialog = true" :loading="fixing">
          <el-icon><Tools /></el-icon>
          修复试卷单元
        </el-button>
        <el-button type="danger" plain @click="showOrdinalFixDialog = true">
          <el-icon><Tools /></el-icon>
          修复堂堂练 ordinal
        </el-button>
        <el-button type="info" plain @click="showPageUnitDialog = true">
          <el-icon><Tools /></el-icon>
          手动修复任务单页
        </el-button>
        <el-button type="success" plain @click="showTypeFixDialog = true" :loading="typeFixLoading">
          <el-icon><MagicStick /></el-icon>
          修复题目类型
        </el-button>
        <el-button type="primary" @click="showCreateDialog = true">
          <el-icon><Plus /></el-icon>
          新建练习册
        </el-button>
      </div>
    </div>

    <el-table :data="worksheets" v-loading="loading" stripe style="width: 100%">
      <el-table-column prop="name" label="名称" min-width="180" />
      <el-table-column prop="grade" label="年级" width="100" />
      <el-table-column prop="subject" label="科目" width="100" />
      <el-table-column label="答案数" width="90">
        <template #default="{ row }">{{ row.answer_count || 0 }} 题</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">
            {{ statusLabel(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="160">
        <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="320" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="handleReview(row)" :disabled="row.answer_count === 0">
            审核答案
          </el-button>
          <el-button size="small" @click="handleUploadPdf(row)">上传 PDF</el-button>
          <el-button
            size="small"
            :type="row.status === 'published' ? 'warning' : 'success'"
            @click="handleToggleStatus(row)"
          >
            {{ row.status === 'published' ? '撤回' : '发布' }}
          </el-button>
          <el-button size="small" type="info" plain @click="handleFixSingle(row)">
            修复
          </el-button>
          <el-popconfirm title="确定删除？" @confirm="handleDelete(row)">
            <template #reference>
              <el-button size="small" type="danger">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && worksheets.length === 0" description="暂无练习册，点击右上角新建" />

    <el-dialog v-model="showCreateDialog" title="新建练习册" width="420px">
      <el-form :model="createForm" label-width="60px">
        <el-form-item label="名称">
          <el-input v-model="createForm.name" placeholder="如：六上数学小初衔接" />
        </el-form-item>
        <el-form-item label="科目">
          <el-select v-model="createForm.subject" placeholder="选择科目" style="width: 100%">
            <el-option label="数学" value="数学" />
            <el-option label="英语" value="英语" />
            <el-option label="语文" value="语文" />
          </el-select>
        </el-form-item>
        <el-form-item label="年级">
          <el-input v-model="createForm.grade" placeholder="如：六年级" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreate" :loading="creating">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showPdfDialog" title="上传练习册内容" width="580px" @close="onPdfDialogClose">
      <div v-if="parseStatus === 'idle'">
        <!-- 合并/分开模式切换 -->
        <div style="margin-bottom:16px;display:flex;align-items:center;gap:8px;">
          <el-checkbox v-model="isCombined" label="答案与题目在同一份PDF中" />
        </div>

        <!-- 题目PDF上传（分开模式） -->
        <div v-if="!isCombined" style="margin-bottom:16px;padding:12px;border:1px dashed var(--wb-border);border-radius: var(--wb-radius-xs);">
          <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--wb-text-secondary);">题目PDF（学生做题时看到的试卷）</div>
          <el-upload
            drag
            accept=".pdf"
            :auto-upload="false"
            @change="handleQuestionPdfSelect"
            :limit="1"
          >
            <el-icon class="el-icon--upload" :size="48"><UploadFilled /></el-icon>
            <div class="el-upload__text">拖拽题目 PDF 到此处，或 <em>点击选择</em></div>
          </el-upload>
          <div v-if="selectedQuestionPdf" class="pdf-info">
            <p>已选择题目: {{ selectedQuestionPdf.name }}</p>
          </div>
        </div>

        <el-tabs v-model="uploadTab">
          <el-tab-pane label="PDF上传" name="pdf">
            <el-upload
              drag
              accept=".pdf"
              :auto-upload="false"
              @change="handlePdfSelect"
              :limit="1"
            >
              <el-icon class="el-icon--upload" :size="48"><UploadFilled /></el-icon>
              <div class="el-upload__text">拖拽 PDF 到此处，或 <em>点击选择</em></div>
              <template #tip>
                <div class="el-upload__tip">请上传纯答案页 PDF（建议先裁掉题干页，解析更快更准）</div>
              </template>
            </el-upload>
            <div v-if="selectedPdf" class="pdf-info">
              <p>已选择答案: {{ selectedPdf.name }}</p>
              <el-button type="primary" @click="startParse" :loading="parsing" class="mt-3">
                {{ parsing ? '上传中...' : (isCombined ? '开始解析（题目+答案）' : '开始解析答案') }}
              </el-button>
            </div>
          </el-tab-pane>
          <el-tab-pane label="图片上传" name="image">
            <el-upload
              multiple
              accept="image/jpeg,image/png,image/webp"
              :auto-upload="false"
              @change="handleImageSelect"
              :limit="30"
              :file-list="[]"
            >
              <el-icon class="el-icon--upload" :size="48"><PictureFilled /></el-icon>
              <div class="el-upload__text">拖拽图片到此处，或 <em>点击选择</em></div>
              <template #tip>
                <div class="el-upload__tip">支持 JPEG/PNG/WebP，最多 30 张，每张最大 20MB（原图直传，无需裁剪）</div>
              </template>
            </el-upload>
            <div v-if="selectedImages.length > 0" class="image-previews">
              <div v-for="(img, i) in selectedImages" :key="i" class="img-thumb-item">
                <img :src="img.url" class="img-thumb" />
                <span class="img-name">{{ img.name }}</span>
                <el-button size="small" type="danger" circle @click="removeImage(i)" class="img-remove">×</el-button>
              </div>
              <div class="image-actions">
                <el-button type="primary" @click="startImageParse" :loading="parsing">
                  {{ parsing ? '上传中...' : `开始解析（${selectedImages.length} 张）` }}
                </el-button>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>
      <div v-else-if="parseStatus === 'parsing'" class="parse-result">
        <el-result icon="info" title="正在解析">
          <template #sub-title>
            <!-- 大文件分批解析：有页级进度时显示进度条（后端 parse_total_pages 非空） -->
            <template v-if="parseTotalPages > 0">
              <el-progress :percentage="parsePercent" :stroke-width="10" style="margin-bottom: 8px" />
              <p>{{ parseMessage }}</p>
              <p style="font-size: 12px; color: var(--wb-text-secondary)">
                已完成批次的答案已实时保存，无需守候，可稍后回来查看结果
              </p>
            </template>
            <template v-else>
              <p>{{ parseMessage }}</p>
              <el-icon class="is-loading" :size="32" style="margin-top:12px;color:var(--wb-primary)">
                <Loading />
              </el-icon>
            </template>
          </template>
        </el-result>
      </div>
      <div v-else-if="parseStatus === 'timed_out'" class="parse-result">
        <el-result icon="warning" title="解析仍未完成">
          <template #sub-title>
            <p>{{ parseError || '暂时无法确认解析是否完成，请稍后继续查询。' }}</p>
            <el-alert
              v-if="parsePollError"
              :title="parsePollError"
              type="warning"
              :closable="false"
              style="margin-top: 12px; text-align: left"
            />
          </template>
          <template #extra>
            <el-button type="primary" @click="continueParsePolling">继续查询</el-button>
            <el-button @click="resetPdfUpload">重新上传</el-button>
          </template>
        </el-result>
      </div>
      <div v-else-if="parseStatus === 'failed'" class="parse-result">
        <el-result icon="error" title="解析失败">
          <template #sub-title>
            <p>{{ parseError || '未能完成答案解析，请检查文件或稍后重试。' }}</p>
          </template>
          <template #extra>
            <el-button type="primary" @click="resetPdfUpload">重新上传</el-button>
          </template>
        </el-result>
      </div>
      <div v-else-if="parseStatus === 'done'" class="parse-result">
        <el-result :icon="parseWarning ? 'warning' : 'success'" title="解析完成">
          <template #sub-title>
            <p>共解析出 <strong>{{ parseCount }}</strong> 条答案</p>
          </template>
          <template #extra>
            <el-alert
              v-if="parseWarning"
              :title="parseWarning"
              type="warning"
              :closable="false"
              class="parse-warning"
            />
            <el-button type="primary" @click="gotoReview" :disabled="parseCount === 0">审核答案</el-button>
            <el-button @click="resetPdfUpload">重新上传</el-button>
          </template>
        </el-result>
      </div>
    </el-dialog>

    <!-- 修复试卷单元对话框 -->
    <el-dialog v-model="showFixDialog" title="修复『试卷①/②/③』错挂" width="780px" :close-on-click-modal="false">
      <el-alert
        type="warning" :closable="false" show-icon
        title="适用场景：已上传答案 PDF，但批改时发现答案错挂到『第十九章实数』等父章节，未正确归到『试卷①/②/③』下"
        style="margin-bottom:12px;"
      />
      <div style="margin-bottom:12px;">
        <el-button @click="loadFixSuspects" :loading="loadingSuspects">重新扫描嫌疑</el-button>
        <el-button type="success" :disabled="!suspectWorksheets.length" @click="confirmBatchFix">
          一键修复全部 ({{ suspectWorksheets.length }})
        </el-button>
        <el-button type="info" plain @click="showDebug = !showDebug">
          {{ showDebug ? '收起' : '查看所有 worksheet 分布' }}
        </el-button>
      </div>
      <el-table :data="suspectWorksheets" v-loading="loadingSuspects" max-height="300" empty-text="未发现需要修复的练习册 🎉">
        <el-table-column prop="name" label="名称" min-width="220" />
        <el-table-column prop="exam_units" label="试卷单元" width="100" />
        <el-table-column prop="orphan_ans_count" label="错挂答案数" width="120" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="confirmSingleFix(row)">修复</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="showDebug" style="margin-top:16px;border-top:1px solid var(--wb-border);padding-top:12px;">
        <div style="font-weight:600;margin-bottom:8px;">📊 所有 worksheet 详细分布（debug）：</div>
        <div v-loading="loadingDebug" style="max-height:400px;overflow-y:auto;">
          <div v-for="w in debugWorksheets" :key="w.id" class="debug-card">
            <div class="debug-head">
              <strong>{{ w.name }}</strong>
              <span class="debug-id">{{ w.id }}</span>
              <el-tag v-if="w.is_suspect" type="danger" size="small">嫌疑（错挂{{ w.orphan_ans_count }}）</el-tag>
              <el-tag v-else type="success" size="small">正常</el-tag>
            </div>
            <div class="debug-stats">
              试卷单元: {{ w.exam_units }}  |  章节答案: {{ w.chapter_ans_count }}  |  练习单元答案: {{ w.practice_ans_count }}  |  错挂答案: {{ w.orphan_ans_count }}  |  总: {{ w.total_ans_count }}
            </div>
            <div v-if="w.orphan_units && w.orphan_units.length" class="debug-orphan">
              <span style="color:var(--wb-warning);">⚠️ 错挂的父章节：</span>
              <span v-for="(u, i) in w.orphan_units" :key="u.unit_id" class="debug-orphan-item">
                {{ u.unit_key }} (ans={{ u.ans_count }})<span v-if="i < w.orphan_units.length - 1">, </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="fixLogs.length" style="margin-top:12px;">
        <div style="font-weight:600;margin-bottom:4px;">执行日志：</div>
        <pre class="fix-log">{{ fixLogs.join('\n') }}</pre>
      </div>
    </el-dialog>

    <!-- 手动修复任务单页单元对话框 -->
    <el-dialog v-model="showPageUnitDialog" title="手动修复任务单页单元归属" width="520px" :close-on-click-modal="false">
      <el-alert
        type="info" :closable="false" show-icon
        title="适用场景：单张/无标题页面被 OCR 错挂到其他单元，老师明确知道该页应归属哪个单元时，可手动指定并重跑该页批改。"
        style="margin-bottom: 16px;"
      />
      <el-form :model="pageUnitForm" label-width="110px">
        <el-form-item label="任务 ID">
          <el-input v-model="pageUnitForm.taskId" placeholder="如：a1b2c3d4..." />
        </el-form-item>
        <el-form-item label="页码">
          <el-input-number v-model="pageUnitForm.pageNumber" :min="1" :precision="0" style="width: 100%;" />
        </el-form-item>
        <el-form-item label="目标单元">
          <el-input v-model="pageUnitForm.unitKey" placeholder="如：试卷3|19.2 或 堂堂练①|19.1(1)" />
        </el-form-item>
      </el-form>
      <div v-if="pageUnitResult" style="margin-top: 12px;">
        <el-alert
          :type="pageUnitResult.success ? 'success' : 'error'"
          :closable="false"
          show-icon
          :title="pageUnitResult.success
            ? `修复完成：更新 ${pageUnitResult.updated} 题，跳过 ${pageUnitResult.skipped} 题`
            : `修复失败：${pageUnitResult.error || '未知错误'}`"
        />
      </div>
      <template #footer>
        <el-button @click="showPageUnitDialog = false">取消</el-button>
        <el-button type="primary" @click="handlePageUnitFix" :loading="pageUnitLoading">开始修复</el-button>
      </template>
    </el-dialog>

    <!-- 修复堂堂练 ordinal 对话框 -->
    <el-dialog v-model="showOrdinalFixDialog" title="修复堂堂练 ordinal 错位" width="900px" :close-on-click-modal="false">
      <el-alert
        type="info" :closable="false" show-icon
        title="适用场景：OCR 识别『堂堂练⑨』及之后圈序号漏识别、回退成前一个 ordinal，导致整本练习册答案挂错单元（如把『2×10^16』科学记数法答案挂到『绝对值』题下）。本工具按 lesson_code 顺序重派 ordinal 和 unit_key。"
        style="margin-bottom:12px;"
      />

      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
        <span style="font-size:13px;">练习册：</span>
        <el-select v-model="ordinalFixWorksheetId" placeholder="选择练习册" style="width:340px;" filterable>
          <el-option
            v-for="w in worksheets"
            :key="w.id"
            :label="`${w.name}（${w.id.slice(0, 8)}）`"
            :value="w.id"
          />
        </el-select>
        <el-button type="primary" :disabled="!ordinalFixWorksheetId || ordinalFixLoading" @click="runOrdinalPreview" :loading="ordinalFixLoading">
          扫描预览
        </el-button>
        <el-button type="success" :disabled="!ordinalFixPreview.length || ordinalFixApplying" @click="applyOrdinalFix" :loading="ordinalFixApplying">
          确认修复 ({{ ordinalFixPreview.filter(p => p.changed).length }})
        </el-button>
      </div>

      <el-table
        :data="ordinalFixPreview"
        v-loading="ordinalFixLoading"
        max-height="420"
        empty-text="先选练习册，点击『扫描预览』"
        border
        size="small"
      >
        <el-table-column prop="old_unit_key" label="原 unit_key" min-width="180" />
        <el-table-column prop="new_unit_key" label="新 unit_key" min-width="180">
          <template #default="{ row }">
            <span :style="{ color: row.changed ? 'var(--wb-success)' : 'var(--wb-text-tertiary)', fontWeight: row.changed ? 600 : 400 }">
              {{ row.new_unit_key }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="ordinal" width="100" align="center">
          <template #default="{ row }">
            <span :style="{ color: row.old_ordinal !== row.new_ordinal ? 'var(--wb-warning)' : 'var(--wb-text-tertiary)' }">
              {{ row.old_ordinal }} → {{ row.new_ordinal }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.changed" type="warning" size="small">改</el-tag>
            <el-tag v-else type="info" size="small">不变</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="ordinalFixResult" style="margin-top:12px;">
        <el-alert
          :type="ordinalFixResult.success ? 'success' : 'error'"
          :closable="false"
          show-icon
          :title="`执行完成：共 ${ordinalFixResult.total} 个单元，改 ${ordinalFixResult.changed} 个，不变 ${ordinalFixResult.unchanged || 0} 个${ordinalFixResult.errors?.length ? '，错误 ' + ordinalFixResult.errors.length + ' 个' : ''}`"
        />
        <pre v-if="ordinalFixResult.errors?.length" class="fix-log" style="margin-top:8px;">{{ ordinalFixResult.errors.map(e => `❌ ${e.old_unit_key} → ${e.new_unit_key} : ${e.error}`).join('\n') }}</pre>
      </div>
    </el-dialog>

    <!-- 修复题目类型脏数据对话框 -->
    <el-dialog v-model="showTypeFixDialog" title="修复『题目类型』脏数据" width="780px" :close-on-click-modal="false">
      <el-alert
        type="warning" :closable="false" show-icon
        title="适用场景：之前用老 prompt 上传过图片，question_type 被 AI 错误填写成『choice/fill/judge/answer』整个枚举串（题目列表显示『1.?』乱码）。按题目内容启发式归一：options 非空→选择题，含____→填空题，含对/错→判断题，其它→解答题。"
        style="margin-bottom:12px;"
      />

      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">
        <span style="font-size:13px;">范围：</span>
        <el-select v-model="typeFixScope" style="width:280px;">
          <el-option label="全部练习册" value="all" />
          <el-option
            v-for="w in worksheets"
            :key="w.id"
            :label="`${w.name}（${w.id.slice(0, 8)}）`"
            :value="w.id"
          />
        </el-select>
        <el-button @click="scanTypeFix" :loading="typeFixLoading" :disabled="typeFixApplying">
          扫描脏数据
        </el-button>
        <el-button
          type="success"
          :disabled="!typeFixScan || typeFixScan.total === 0 || typeFixApplying"
          :loading="typeFixApplying"
          @click="runTypeFix"
        >
          确认修复 ({{ typeFixScan?.total || 0 }})
        </el-button>
      </div>

      <el-alert
        v-if="typeFixScan"
        :type="typeFixScan.total === 0 ? 'success' : 'info'"
        :closable="false"
        :title="typeFixScan.total === 0
          ? '✅ 未发现脏数据'
          : `扫描到 ${typeFixScan.total} 条脏 question_type（最多展示前 20 条）`"
        style="margin-bottom:12px;text-align:left;"
      />

      <el-table
        v-if="typeFixScan && typeFixScan.sample.length"
        :data="typeFixScan.sample"
        max-height="300"
        border
        size="small"
      >
        <el-table-column prop="id" label="question_id" min-width="160">
          <template #default="{ row }">
            <code style="font-size:11px;">{{ row.id.slice(0, 8) }}…</code>
          </template>
        </el-table-column>
        <el-table-column prop="raw_type" label="原 question_type" min-width="180">
          <template #default="{ row }">
            <el-tag type="danger" size="small" effect="plain">{{ row.raw_type || '(空)' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="inferred" label="推断类型" width="100">
          <template #default="{ row }">
            <el-tag type="success" size="small">{{ row.inferred }}</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="typeFixResult" style="margin-top:12px;">
        <el-alert
          :type="typeFixResult.errors?.length ? 'warning' : 'success'"
          :closable="false"
          show-icon
          :title="`执行完成：扫描 ${typeFixResult.scanned} 条，修复 ${typeFixResult.fixed} 条（不变 ${typeFixResult.unchanged} 条）${typeFixResult.dryRun ? '（dryRun，未真实写入）' : ''}`"
        />
        <div v-if="typeFixResult.byTarget" style="margin-top:8px;font-size:13px;color:var(--wb-text-secondary);">
          <span style="margin-right:12px;">分布：</span>
          <el-tag v-for="(cnt, k) in typeFixResult.byTarget" :key="k" size="small" style="margin-right:6px;">
            {{ k }} × {{ cnt }}
          </el-tag>
        </div>
        <pre v-if="typeFixResult.errors?.length" class="fix-log" style="margin-top:8px;">{{ typeFixResult.errors.map(e => `❌ ${e.id}: ${e.error}`).join('\n') }}</pre>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, UploadFilled, Loading, PictureFilled, Tools, MagicStick } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getWorksheets,
  createWorksheet,
  deleteWorksheet,
  updateWorksheetStatus,
  uploadPdf,
  uploadImages,
  getWorksheet,
  uploadQuestionPdf,
  regradeTaskPageWithUnit,
} from '../../services/apiService.js'

const router = useRouter()
const worksheets = ref([])
const loading = ref(false)
const showCreateDialog = ref(false)
const creating = ref(false)
const createForm = ref({ name: '', subject: '', grade: '' })

const showPdfDialog = ref(false)
const selectedPdf = ref(null)
const selectedQuestionPdf = ref(null)
const isCombined = ref(true) // 默认同一份PDF包含答案和题目
const uploadTab = ref('pdf')
const selectedImages = ref([]) // { raw, name, url }
const parsing = ref(false)
const pdfUploaded = ref(false)
const parseCount = ref(0)
const parseWarning = ref(null)
const parseStatus = ref('idle')
const parseError = ref('')
const parseMessage = ref('')
const parsePollError = ref('')
let parsePollErrorCount = 0
// 大文件分批解析进度（后端 parse_total_pages/parse_done_pages，NULL = 无页级进度走转圈）
const OCR_BATCH_SIZE = 15 // 与后端 worksheets.js 的 OCR_BATCH_SIZE 保持一致，用于显示当前批次页码范围
const parseTotalPages = ref(0)
const parseDonePages = ref(0)
const parsePercent = ref(0)
let parsePollTimer = null
let parsePollStartTimer = null
let parseMessageTimer = null
// 轮询上限：略大于服务端 12 分钟的卡死判定（STALE_PARSING_MS），超时后提示重新上传，
// 此时服务端已允许绕过"正在解析中"的 409 拦截重新发起解析。
// 分批解析场景下语义是"无进度时长"：只要 parse_done_pages 有推进就重置计时，
// 大文件总时长可远超 12.5 分钟但不会被误判为卡死
const POLL_MAX_MS = 25 * 60 * 1000
let pollStartedAt = 0
const currentWorksheetId = ref(null)

const stopParsePolling = () => {
  if (parsePollTimer) {
    clearInterval(parsePollTimer)
    parsePollTimer = null
  }
  if (parsePollStartTimer) {
    clearTimeout(parsePollStartTimer)
    parsePollStartTimer = null
  }
}

const startParsePolling = () => {
  stopParsePolling()
  parsePollError.value = ''
  parsePollErrorCount = 0
  parsePollStartTimer = setTimeout(() => {
    parsePollStartTimer = null
    pollParseStatus()
    parsePollTimer = setInterval(pollParseStatus, 2000)
  }, 2000)
}

const continueParsePolling = () => {
  pollStartedAt = Date.now()
  parseStatus.value = 'parsing'
  parseError.value = ''
  parsePollError.value = ''
  parsePollErrorCount = 0
  parsing.value = true
  startParsePolling()
}

const loadData = async () => {
  loading.value = true
  try {
    worksheets.value = await getWorksheets()
  } catch (e) {
    ElMessage.error('加载练习册列表失败: ' + e.message)
  } finally {
    loading.value = false
  }
}

onMounted(loadData)

const statusType = (status) => {
  if (status === 'published') return 'success'
  if (status === 'reviewing') return 'warning'
  return 'info'
}

const statusLabel = (status) => {
  if (status === 'published') return '已发布'
  if (status === 'reviewing') return '审核中'
  return '草稿'
}

const formatDate = (value) => {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const handleCreate = async () => {
  if (!createForm.value.name) {
    ElMessage.warning('请输入练习册名称')
    return
  }

  creating.value = true
  try {
    await createWorksheet(createForm.value)
    ElMessage.success('创建成功')
    showCreateDialog.value = false
    createForm.value = { name: '', subject: '', grade: '' }
    await loadData()
  } catch (e) {
    ElMessage.error('创建失败: ' + e.message)
  } finally {
    creating.value = false
  }
}

const handleDelete = async (row) => {
  try {
    await deleteWorksheet(row.id)
    ElMessage.success('已删除')
    await loadData()
  } catch (e) {
    ElMessage.error('删除失败: ' + e.message)
  }
}

const handleToggleStatus = async (row) => {
  const newStatus = row.status === 'published' ? 'draft' : 'published'
  try {
    await updateWorksheetStatus(row.id, newStatus)
    ElMessage.success(newStatus === 'published' ? '已发布' : '已撤回')
    await loadData()
  } catch (e) {
    ElMessage.error('操作失败: ' + e.message)
  }
}

const handleReview = (row) => {
  router.push(`/worksheets/${row.id}/review`)
}

const handleUploadPdf = (row) => {
  currentWorksheetId.value = row.id
  showPdfDialog.value = true
  pdfUploaded.value = false
  selectedPdf.value = null
  selectedQuestionPdf.value = null
  isCombined.value = true
  clearSelectedImages()
  uploadTab.value = 'pdf'
  parseWarning.value = null
  parseCount.value = 0
  parseStatus.value = 'idle'
  parseError.value = ''
  parseMessage.value = ''
  parsePollError.value = ''
  parsePollErrorCount = 0
  stopParsePolling()
  if (parseMessageTimer) {
    clearTimeout(parseMessageTimer)
    parseMessageTimer = null
  }
}

const handlePdfSelect = (uploadFile) => {
  selectedPdf.value = uploadFile.raw
}

const handleQuestionPdfSelect = (uploadFile) => {
  selectedQuestionPdf.value = uploadFile.raw
}

const handleImageSelect = (uploadFile) => {
  const raw = uploadFile.raw
  if (!raw) return
  if (raw.size > 20 * 1024 * 1024) {
    ElMessage.warning(`${raw.name} 超过 20MB，已跳过`)
    return
  }
  if (selectedImages.value.length >= 30) {
    ElMessage.warning('最多选择 30 张图片')
    return
  }
  selectedImages.value.push({ raw, name: raw.name, url: URL.createObjectURL(raw) })
}

const removeImage = (i) => {
  const [removed] = selectedImages.value.splice(i, 1)
  if (removed) URL.revokeObjectURL(removed.url)
}

const clearSelectedImages = () => {
  selectedImages.value.forEach(img => URL.revokeObjectURL(img.url))
  selectedImages.value = []
}

const pollParseStatus = async () => {
  if (!currentWorksheetId.value) return
  // 后台解析进程若已中断（服务器重启/内存不足），parse_status 会一直停在 'parsing'，
  // 此前会无限转圈。超过上限则停止轮询并提示重新上传。
  if (pollStartedAt && Date.now() - pollStartedAt > POLL_MAX_MS) {
    parsing.value = false
    parseStatus.value = 'timed_out'
    parseError.value = '等待超时，后台处理可能尚未完成，您可以继续查询或重新上传'
    stopParsePolling()
    return
  }
  try {
    const ws = await getWorksheet(currentWorksheetId.value)
    if (!ws) return
    parseStatus.value = ws.parse_status || 'idle'

    if (ws.parse_status === 'parsing') {
      // 大文件分批解析：读取页级进度，构造"正在解析第 X-Y 页 / 共 N 页 (P%)"
      const total = ws.parse_total_pages || 0
      const done = ws.parse_done_pages || 0
      if (total > 0) {
        if (done > parseDonePages.value || total !== parseTotalPages.value) {
          // 进度有推进 → 重置停滞计时，大文件总时长可超过 POLL_MAX_MS 而不被误判卡死
          pollStartedAt = Date.now()
        }
        parseTotalPages.value = total
        parseDonePages.value = done
        parsePercent.value = Math.min(100, Math.round((done / total) * 100))
        const batchStart = Math.min(done + 1, total)
        const batchEnd = Math.min(done + OCR_BATCH_SIZE, total)
        parseMessage.value = done >= total
          ? `已解析完全部 ${total} 页，正在保存结果...`
          : `正在解析第 ${batchStart}-${batchEnd} 页 / 共 ${total} 页 (${parsePercent.value}%)`
      }
      // total 为空：文字版 PDF / 小文件单趟路径，沿用现有 parseMessage 转圈文案
      return
    }

    if (ws.parse_status === 'done') {
      parseCount.value = ws.parse_count || 0
      parseWarning.value = ws.parse_warning || null
      pdfUploaded.value = true
      parsing.value = false
      stopParsePolling()
      if (parseMessageTimer) {
        clearTimeout(parseMessageTimer)
        parseMessageTimer = null
      }
      if (ws.parse_warning) {
        ElMessage.warning(ws.parse_warning)
      } else {
        ElMessage.success(`解析完成，共 ${parseCount.value} 条答案`)
      }
      await loadData()
    } else if (ws.parse_status === 'failed') {
      parseCount.value = 0
      parseWarning.value = null
      parseError.value = ws.parse_error || '未知错误'
      pdfUploaded.value = false
      parsing.value = false
      stopParsePolling()
      if (parseMessageTimer) {
        clearTimeout(parseMessageTimer)
        parseMessageTimer = null
      }
      ElMessage.error('解析失败: ' + (ws.parse_error || '未知错误'))
      await loadData()
    }
    // 'parsing' — continue polling
  } catch (e) {
    // poll error, keep trying
  }
}

const startParse = async () => {
  if (!currentWorksheetId.value) return

  // 合并模式：必须上传答案PDF
  if (isCombined.value && !selectedPdf.value) {
    ElMessage.warning('请上传PDF文件')
    return
  }

  // 分开模式：必须上传题目PDF和答案PDF
  if (!isCombined.value && (!selectedQuestionPdf.value || !selectedPdf.value)) {
    ElMessage.warning('请上传题目PDF和答案PDF')
    return
  }

  parsing.value = true
  parseStatus.value = 'parsing'
  parseMessage.value = '正在上传 PDF...'
  parseTotalPages.value = 0
  parseDonePages.value = 0
  parsePercent.value = 0
  pollStartedAt = Date.now()

  // 如果超过 15 秒还没解析完，提示用户正在耗时的 OCR 识别中（分批进度出现后不再覆盖进度文案）
  parseMessageTimer = setTimeout(() => {
    if (parseStatus.value === 'parsing' && parseTotalPages.value === 0) {
      parseMessage.value = '正在逐页 OCR 识别中（扫描版 PDF 耗时较长，请耐心等待...）'
    }
  }, 15000)

  try {
    if (isCombined.value) {
      // 合并模式：一份PDF同时作为题目和答案源
      await uploadPdf(currentWorksheetId.value, selectedPdf.value, null, true)
    } else {
      // 分开模式：先上传题目PDF，再上传答案PDF并解析
      if (selectedQuestionPdf.value) {
        await uploadQuestionPdf(currentWorksheetId.value, selectedQuestionPdf.value)
      }
      await uploadPdf(currentWorksheetId.value, selectedPdf.value, null, false)
    }

    // 上传成功，立即给用户反馈
    parseMessage.value = '已上传 PDF，后台正在解析答案...'
    ElMessage.success('上传成功，开始解析...')

    // 使用统一轮询管理
    startParsePolling()
  } catch (e) {
    // 客户端超时/中断/网络错误不代表后端没收到：后端收到文件即返回并后台解析，
    // 先查一次真实状态，已在解析就转入轮询，避免误报"上传失败"
    if (e.name === 'TimeoutError' || /超时|abort|无法连接到服务器/i.test(e.message || '')) {
      try {
        const ws = await getWorksheet(currentWorksheetId.value)
        if (ws && (ws.parse_status === 'parsing' || ws.parse_status === 'done')) {
          ElMessage.info('文件已到达服务器，继续等待解析结果...')
          startParsePolling()
          return
        }
      } catch { /* 状态查询失败，按上传失败处理 */ }
    }
    parsing.value = false
    parseStatus.value = 'failed'
    parseError.value = e.message || '上传失败，请检查网络后重试'
    if (parseMessageTimer) {
      clearTimeout(parseMessageTimer)
      parseMessageTimer = null
    }
    ElMessage.error('上传失败: ' + e.message)
  }
}

const startImageParse = async () => {
  if (!currentWorksheetId.value) return
  if (selectedImages.value.length === 0) {
    ElMessage.warning('请选择图片')
    return
  }

  parsing.value = true
  parseStatus.value = 'parsing'
  parseMessage.value = '正在上传图片...'
  parseTotalPages.value = 0
  parseDonePages.value = 0
  parsePercent.value = 0
  pollStartedAt = Date.now()

  parseMessageTimer = setTimeout(() => {
    if (parseStatus.value === 'parsing') {
      parseMessage.value = '正在逐张 OCR 识别中，请耐心等待...'
    }
  }, 15000)

  try {
    await uploadImages(currentWorksheetId.value, selectedImages.value.map(img => img.raw))
    parseMessage.value = '已上传图片，后台正在识别答案...'
    ElMessage.success('上传成功，开始解析...')
    startParsePolling()
  } catch (e) {
    // 与 startParse 相同：客户端超时不代表后端没收到，先查真实状态再决定是否报错
    if (e.name === 'TimeoutError' || /超时|abort|无法连接到服务器/i.test(e.message || '')) {
      try {
        const ws = await getWorksheet(currentWorksheetId.value)
        if (ws && (ws.parse_status === 'parsing' || ws.parse_status === 'done')) {
          ElMessage.info('图片已到达服务器，继续等待解析结果...')
          startParsePolling()
          return
        }
      } catch { /* 状态查询失败，按上传失败处理 */ }
    }
    parsing.value = false
    parseStatus.value = 'failed'
    parseError.value = e.message || '上传失败，请检查网络后重试'
    if (parseMessageTimer) {
      clearTimeout(parseMessageTimer)
      parseMessageTimer = null
    }
    ElMessage.error('上传失败: ' + e.message)
  }
}

const resetPdfUpload = () => {
  pdfUploaded.value = false
  selectedPdf.value = null
  selectedQuestionPdf.value = null
  isCombined.value = true
  clearSelectedImages()
  uploadTab.value = 'pdf'
  parseWarning.value = null
  parseCount.value = 0
  parseStatus.value = 'idle'
  parseError.value = ''
  parseMessage.value = ''
  stopParsePolling()
  if (parseMessageTimer) {
    clearTimeout(parseMessageTimer)
    parseMessageTimer = null
  }
}

const onPdfDialogClose = () => {
  stopParsePolling()
  if (parseMessageTimer) {
    clearTimeout(parseMessageTimer)
    parseMessageTimer = null
  }
}

const gotoReview = () => {
  showPdfDialog.value = false
  router.push(`/worksheets/${currentWorksheetId.value}/review`)
}

// ────────── 修复『试卷①/②/③ 错挂到父章节』功能 ──────────
const showFixDialog = ref(false)
const loadingSuspects = ref(false)
const fixing = ref(false)
const suspectWorksheets = ref([])
const fixLogs = ref([])

const appendLog = (line) => {
  fixLogs.value.push(line)
  if (fixLogs.value.length > 500) fixLogs.value = fixLogs.value.slice(-500)
}

const fixApi = {
  listSuspects: () => fetch('/api/worksheets/fix-exam-units/suspects?limit=200').then(r => r.json()),
  listDebug: () => fetch('/api/worksheets/fix-exam-units/debug?limit=50').then(r => r.json()),
  startBatch: (limit = 20) => fetch('/api/worksheets/fix-exam-units', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit })
  }).then(r => r.json()),
  startOne: (worksheetId) => fetch('/api/worksheets/fix-one-async', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worksheetId })
  }).then(r => r.json()),
  pollJob: (jobId) => fetch(`/api/worksheets/fix-exam-units/job/${jobId}`).then(r => r.json()),
  cancelJob: (jobId) => fetch('/api/worksheets/fix-exam-units/cancel', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId })
  }).then(r => r.json()),
}

let pollTimer = null
const stopPolling = () => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}
const startPolling = (jobId) => {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const j = await fixApi.pollJob(jobId)
      if (j.success) {
        fixLogs.value = j.logs || []
        if (['completed', 'failed', 'cancelled'].includes(j.status)) {
          stopPolling()
          fixing.value = false
          if (j.status === 'completed') {
            const ok = (j.results || []).filter(x => x.ok).length
            const fail = (j.results || []).filter(x => !x.ok).length
            ElMessage.success(`修复完成: 成功 ${ok} / 失败 ${fail}`)
            await loadFixSuspects()
            await loadData()
          } else if (j.status === 'failed') {
            ElMessage.error('修复任务失败，请查看日志')
          } else if (j.status === 'cancelled') {
            ElMessage.warning('已取消')
          }
        }
      }
    } catch (e) { /* 忽略轮询错误 */ }
  }, 2000)
}

const loadFixSuspects = async () => {
  loadingSuspects.value = true
  fixLogs.value = []
  try {
    const data = await fixApi.listSuspects()
    if (!data.success) throw new Error(data.error || '扫描失败')
    suspectWorksheets.value = data.suspects
    appendLog(`📋 扫描完成: 发现 ${data.count} 个需要修复的练习册`)
    if (data.count === 0) {
      ElMessage.success('未发现需要修复的练习册')
    }
  } catch (e) {
    ElMessage.error('扫描失败: ' + e.message)
    appendLog(`❌ 扫描失败: ${e.message}`)
  } finally {
    loadingSuspects.value = false
  }
}

watch(showFixDialog, (v) => {
  if (v && suspectWorksheets.value.length === 0) loadFixSuspects()
})

const confirmSingleFix = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确认修复《${row.name}》？\n\n` +
      `• 试卷单元: ${row.exam_units}\n` +
      `• 错挂答案数: ${row.orphan_ans_count}\n\n` +
      `会清空当前答案并重跑 OCR（耗时 1-3 分钟），原答案会备份到 metadata.backup_unit_id。`,
      '修复确认',
      { confirmButtonText: '开始修复', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }
  fixing.value = true
  fixLogs.value = [`🚀 启动单 worksheet 修复《${row.name}》(${row.id})`]
  try {
    const r = await fixApi.startOne(row.id)
    if (!r.success) throw new Error(r.error || '启动失败')
    startPolling(r.jobId)
  } catch (e) {
    fixing.value = false
    ElMessage.error('启动失败: ' + e.message)
    appendLog(`❌ 启动失败: ${e.message}`)
  }
}

const handleFixSingle = (row) => {
  showFixDialog.value = true
  setTimeout(() => {
    suspectWorksheets.value = [{
      id: row.id, name: row.name, exam_units: 0, orphan_ans_count: row.answer_count || 0,
    }]
    appendLog(`ℹ️ 已选中《${row.name}》，建议先点"重新扫描嫌疑"确认`)
  }, 50)
}

const confirmBatchFix = async () => {
  try {
    await ElMessageBox.confirm(
      `将批量修复全部 ${suspectWorksheets.value.length} 个练习册，每个耗时 1-3 分钟。\n` +
      `原答案会备份到 metadata.backup_unit_id。\n\n` +
      `修复在后台进行，对话框可关，日志会持续更新。`,
      '批量修复确认',
      { confirmButtonText: '全部开始', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }
  fixing.value = true
  fixLogs.value = [`🚀 启动批量修复 ${suspectWorksheets.value.length} 个练习册`]
  try {
    const r = await fixApi.startBatch(suspectWorksheets.value.length)
    if (!r.success) throw new Error(r.error || '启动失败')
    startPolling(r.jobId)
  } catch (e) {
    fixing.value = false
    ElMessage.error('启动失败: ' + e.message)
    appendLog(`❌ 启动失败: ${e.message}`)
  }
}

// ────────── 修复『堂堂练 ordinal 错位』功能 ──────────
const showOrdinalFixDialog = ref(false)
const ordinalFixWorksheetId = ref(null)
const ordinalFixPreview = ref([])
const ordinalFixLoading = ref(false)
const ordinalFixApplying = ref(false)
const ordinalFixResult = ref(null)

// ────────── 手动修复任务单页单元归属 ──────────
const showPageUnitDialog = ref(false)
const pageUnitForm = ref({ taskId: '', pageNumber: 1, unitKey: '' })
const pageUnitLoading = ref(false)
const pageUnitResult = ref(null)

const handlePageUnitFix = async () => {
  const { taskId, pageNumber, unitKey } = pageUnitForm.value
  if (!taskId.trim() || !unitKey.trim()) {
    ElMessage.warning('请填写任务 ID 和目标单元')
    return
  }
  pageUnitLoading.value = true
  pageUnitResult.value = null
  try {
    const r = await regradeTaskPageWithUnit(taskId.trim(), pageNumber, unitKey.trim())
    pageUnitResult.value = r
    if (r.success) {
      ElMessage.success(`修复完成：更新 ${r.updated} 题`)
    } else {
      ElMessage.error(`修复失败：${r.error || '未知错误'}`)
    }
  } catch (e) {
    pageUnitResult.value = { success: false, error: e.message }
    ElMessage.error('请求失败: ' + e.message)
  } finally {
    pageUnitLoading.value = false
  }
}

const ordinalFixApi = {
  preview: (worksheetId) => fetch(`/api/worksheets/${worksheetId}/fix-tanglian-ordinals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun: true })
  }).then(r => r.json()),
  apply: (worksheetId) => fetch(`/api/worksheets/${worksheetId}/fix-tanglian-ordinals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun: false })
  }).then(r => r.json()),
}

const runOrdinalPreview = async () => {
  if (!ordinalFixWorksheetId.value) return
  ordinalFixLoading.value = true
  ordinalFixPreview.value = []
  ordinalFixResult.value = null
  try {
    const r = await ordinalFixApi.preview(ordinalFixWorksheetId.value)
    if (!r.success) throw new Error(r.error || '扫描失败')
    ordinalFixPreview.value = r.preview || []
    const changed = ordinalFixPreview.value.filter(p => p.changed).length
    if (r.total === 0) {
      ElMessage.info('该练习册没有『堂堂练』单元')
    } else if (changed === 0) {
      ElMessage.success(`扫描完成：${r.total} 个单元，无需修改`)
    } else {
      ElMessage.warning(`扫描完成：${r.total} 个单元，${changed} 个需修改`)
    }
  } catch (e) {
    ElMessage.error('扫描失败: ' + e.message)
  } finally {
    ordinalFixLoading.value = false
  }
}

const applyOrdinalFix = async () => {
  if (!ordinalFixWorksheetId.value) return
  const changed = ordinalFixPreview.value.filter(p => p.changed).length
  if (changed === 0) {
    ElMessage.info('没有需要修改的单元')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将修改《${worksheetName(ordinalFixWorksheetId.value)}》的 ${changed} 个『堂堂练』单元的 ordinal 和 unit_key。\n\n` +
      `• 答案通过 unit_id (UUID) 关联，不会被破坏\n` +
      `• 唯一约束冲突的单条会跳过，其它继续\n\n确认执行？`,
      '修复确认',
      { confirmButtonText: '执行修复', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }
  ordinalFixApplying.value = true
  try {
    const r = await ordinalFixApi.apply(ordinalFixWorksheetId.value)
    ordinalFixResult.value = r
    if (r.success) {
      ElMessage.success(`修复完成：改了 ${r.changed} 个单元`)
      // 重新扫描看实际结果
      await runOrdinalPreview()
    } else {
      ElMessage.error(`修复完成但有 ${r.errors?.length || 0} 条错误，查看下方详情`)
    }
  } catch (e) {
    ElMessage.error('修复失败: ' + e.message)
  } finally {
    ordinalFixApplying.value = false
  }
}

const worksheetName = (id) => {
  const w = worksheets.value.find(x => x.id === id)
  return w?.name || id
}

// ────────── 修复 question_type 脏数据 ──────────
const showTypeFixDialog = ref(false)
const typeFixScope = ref('all') // 'all' 或 worksheetId
const typeFixScan = ref(null)  // scanDirtyQuestionTypes 返回
const typeFixResult = ref(null) // fixDirtyQuestionTypes 返回
const typeFixLoading = ref(false) // 扫描中
const typeFixApplying = ref(false) // 修复中

const typeFixApi = {
  scan: (worksheetId) => fetch('/api/worksheets/fix-question-types/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(worksheetId ? { worksheetId } : {}),
  }).then(r => r.json()),
  fix: (worksheetId) => fetch('/api/worksheets/fix-question-types', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(worksheetId ? { worksheetId, limit: 5000 } : { limit: 5000 }),
  }).then(r => r.json()),
}

const scanTypeFix = async () => {
  typeFixLoading.value = true
  typeFixResult.value = null
  try {
    const worksheetId = typeFixScope.value === 'all' ? null : typeFixScope.value
    const data = await typeFixApi.scan(worksheetId)
    if (!data.success) throw new Error(data.error || '扫描失败')
    typeFixScan.value = data
    if (data.total === 0) {
      ElMessage.success('未发现脏数据 🎉')
    } else {
      ElMessage.warning(`扫描到 ${data.total} 条脏 question_type，请确认后修复`)
    }
  } catch (e) {
    ElMessage.error('扫描失败: ' + e.message)
  } finally {
    typeFixLoading.value = false
  }
}

const runTypeFix = async () => {
  if (!typeFixScan.value || typeFixScan.value.total === 0) return
  try {
    await ElMessageBox.confirm(
      `将根据题目内容启发式归一 question_type 字段：\n\n` +
      `• 扫描范围：${typeFixScope.value === 'all' ? '全部练习册' : worksheetName(typeFixScope.value)}\n` +
      `• 待修复条数：${typeFixScan.value.total}\n\n` +
      `归一规则：\n` +
      `  - options 非空 → choice\n` +
      `  - content 含 ____ / （）/ □ → fill\n` +
      `  - content 含 对/错/正确/错误/√/× → judge\n` +
      `  - 其它 → answer\n\n确认执行？`,
      '修复确认',
      { confirmButtonText: '开始修复', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }
  typeFixApplying.value = true
  try {
    const worksheetId = typeFixScope.value === 'all' ? null : typeFixScope.value
    const r = await typeFixApi.fix(worksheetId)
    if (!r.success) throw new Error(r.error || '修复失败')
    typeFixResult.value = r
    if (r.errors?.length) {
      ElMessage.warning(`修复完成：改了 ${r.fixed} 条，${r.errors.length} 条失败，查看详情`)
    } else {
      ElMessage.success(`修复完成：改了 ${r.fixed} 条 question_type`)
    }
    // 重新扫描一次，把脏数据清空提示
    await scanTypeFix()
  } catch (e) {
    ElMessage.error('修复失败: ' + e.message)
  } finally {
    typeFixApplying.value = false
  }
}

watch(showTypeFixDialog, (v) => {
  if (v) {
    typeFixScope.value = 'all'
    typeFixScan.value = null
    typeFixResult.value = null
  }
})
</script>

<style scoped>
.worksheet-mgr {
  padding: 24px;
  height: 100%;
  overflow-y: auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.pdf-info {
  margin-top: 16px;
}

.parse-result {
  padding: 8px 0;
}

.parse-warning {
  margin-bottom: 16px;
  text-align: left;
}

.fix-log {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 12px;
  border-radius: var(--wb-radius-xs);
  max-height: 300px;
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.debug-card {
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-xs);
  padding: 8px 12px;
  margin-bottom: 8px;
  background: var(--wb-bg-hover);
}
.debug-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.debug-id {
  font-family: monospace;
  font-size: 11px;
  color: var(--wb-text-tertiary);
}
.debug-stats {
  font-size: 12px;
  color: var(--wb-text-secondary);
  margin-bottom: 4px;
}
.debug-orphan {
  font-size: 12px;
  padding: 4px 8px;
  background: #fdf6ec;
  border-radius: var(--wb-radius-xs);
  margin-top: 4px;
}
.debug-orphan-item {
  font-family: monospace;
  font-size: 11px;
  color: #c45656;
}
</style>
