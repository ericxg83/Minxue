<template>
  <div class="student-switcher">
    <!-- Current student display -->
    <div class="current-student" @click="showDialog = true">
      <div class="avatar-wrapper">
        <img
          v-if="currentStudent?.avatar"
          :src="currentStudent.avatar"
          alt=""
          class="avatar-img"
        />
        <el-icon v-else class="avatar-icon"><UserFilled /></el-icon>
      </div>
      <div class="student-info">
        <div class="student-name">{{ currentStudent?.name || '请选择学生' }}</div>
        <div class="student-class">{{ currentStudent?.class || '暂无班级' }}</div>
      </div>
      <div class="switch-arrow">
        <el-badge :value="pendingCount" :hidden="pendingCount <= 0" type="danger">
          <el-icon><ArrowRight /></el-icon>
        </el-badge>
      </div>
    </div>

    <!-- Student selection dialog -->
    <el-dialog
      v-model="showDialog"
      title="切换学生"
      width="400px"
      align-center
    >
      <div class="student-list">
        <div
          v-for="student in studentList"
          :key="student.id"
          class="student-item"
          :class="{ active: currentStudent?.id === student.id }"
          @click="handleSwitchStudent(student)"
        >
          <div class="avatar-wrapper small">
            <img
              v-if="student.avatar"
              :src="student.avatar"
              alt=""
              class="avatar-img"
            />
            <el-icon v-else class="avatar-icon"><UserFilled /></el-icon>
          </div>
          <div class="student-info">
            <div class="student-name">{{ student.name }}</div>
            <div class="student-class">{{ student.class || '暂无班级' }}</div>
          </div>
          <el-icon v-if="currentStudent?.id === student.id" class="check-icon"><Check /></el-icon>
        </div>
      </div>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { UserFilled, ArrowRight, Check } from '@element-plus/icons-vue'

const props = defineProps({
  currentStudent: {
    type: Object,
    default: null
  },
  visible: {
    type: Boolean,
    default: false
  },
  studentList: {
    type: Array,
    default: () => []
  },
  pendingCount: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits(['update:visible', 'change-student'])

const showDialog = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

function handleSwitchStudent(student) {
  emit('change-student', student)
  showDialog.value = false
}
</script>

<style scoped>
.student-switcher {
  background: #fff;
  padding: 16px;
  border-bottom: 1px solid #e5e5ea;
}

.current-student {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  padding: 4px 0;
}

.avatar-wrapper {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #e8f4fd 0%, #d6ebfa 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 122, 255, 0.15);
  flex-shrink: 0;
}

.avatar-wrapper.small {
  width: 40px;
  height: 40px;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-icon {
  font-size: 28px;
  color: #007aff;
}

.avatar-wrapper.small .avatar-icon {
  font-size: 22px;
}

.student-info {
  flex: 1;
  margin: 0 12px;
}

.student-name {
  font-size: 17px;
  font-weight: 600;
  color: #1c1c1e;
}

.student-class {
  font-size: 13px;
  color: #8e8e93;
  margin-top: 2px;
}

.switch-arrow .el-icon {
  font-size: 20px;
  color: #007aff;
}

.student-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
}

.student-item {
  display: flex;
  align-items: center;
  padding: 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.student-item:hover {
  background: #f2f2f7;
}

.student-item.active {
  background: #e8f4fd;
}

.check-icon {
  font-size: 20px;
  color: #007aff;
}
</style>
