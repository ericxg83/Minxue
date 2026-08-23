<template>
  <el-button
    class="ds-action-button"
    :type="variant === 'primary' ? 'primary' : variant === 'danger' ? 'danger' : ''"
    :plain="variant !== 'primary'"
    v-bind="$attrs"
  >
    <slot />
  </el-button>
</template>

<script setup>
defineOptions({ inheritAttrs: false })
defineProps({ variant: { type: String, default: 'secondary' } })
</script>

<style scoped>
.ds-action-button{min-height:34px;border-radius:8px;font-weight:550}
</style>
