<script setup lang="ts">
import { computed } from 'vue'
import QRCode from 'qrcode'

const props = defineProps<{ value: string }>()

// One square per dark module, in module units.
const code = computed(() => {
  const modules = QRCode.create(props.value, { errorCorrectionLevel: 'M' }).modules
  let path = ''
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) if (modules.get(row, col)) path += `M${col} ${row}h1v1h-1z`
  }
  return { size: modules.size, path }
})
</script>

<template>
  <svg :viewBox="`0 0 ${code.size} ${code.size}`" shape-rendering="crispEdges" role="img" aria-label="QR code">
    <path :d="code.path" fill="#121214" />
  </svg>
</template>
