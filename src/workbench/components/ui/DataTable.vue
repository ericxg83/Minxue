<template><el-table class="ds-data-table" v-bind="$attrs"><slot /></el-table></template>
<script setup>defineOptions({inheritAttrs:false})</script>
<style scoped>.ds-data-table{--el-table-header-bg-color:var(--wb-bg-elevated);--el-table-row-hover-bg-color:#f8faff;--el-table-border-color:var(--wb-border-light);width:100%}.ds-data-table :deep(th.el-table__cell){height:42px;color:var(--wb-text-tertiary);font-size:11px;font-weight:600}.ds-data-table :deep(td.el-table__cell){height:58px;color:var(--wb-text-secondary);font-size:12px}.ds-data-table :deep(.cell){padding:0 16px}</style>
