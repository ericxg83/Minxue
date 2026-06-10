<template>
  <div class="table-block">
    <table class="content-table">
      <tbody>
        <tr v-for="(row, i) in block.rows" :key="i">
          <td v-for="(cell, j) in row" :key="j">{{ cell }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
defineProps({
  block: { type: Object, required: true },
  pageNo: { type: Number, default: 1 },
  blockIndex: { type: Number, default: -1 }
})

defineEmits(['edit'])
</script>

<style scoped>
.table-block {
  margin: 12px 0;
  overflow-x: auto;
}

.content-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.content-table td {
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  text-align: center;
}

.content-table tr:nth-child(even) {
  background: #f9fafb;
}
</style>
