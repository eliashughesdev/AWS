<script setup lang="ts" generic="Option extends { value: string; label: string }">
// Not in Figma: a dropdown's open list, drawn like the avatar's menu. It hangs under the nearest
// positioned ancestor, across that one's width. A choice or a click anywhere else asks to close it.
// The slot draws an option, which is its label otherwise. A long list scrolls.
defineProps<{ options: Option[] }>()
const chosen = defineModel<string>({ required: true })
const emit = defineEmits<{ close: [] }>()

function choose(value: string) {
  chosen.value = value
  emit('close')
}
</script>

<template>
  <div class="fixed inset-0 z-10" @click="emit('close')" />
  <ul role="listbox" class="no-scrollbar absolute inset-x-0 top-full z-20 mt-[8px] max-h-[270px] overflow-y-auto rounded-[10px] border border-card-line bg-card py-[5px]">
    <li v-for="option in options" :key="option.value">
      <button
        type="button"
        role="option"
        :aria-selected="option.value === chosen"
        class="flex h-[40px] w-full items-center px-[13px] text-[12px] font-semibold lg:text-[14px]"
        :class="option.value === chosen ? 'text-accent' : 'text-white'"
        @click="choose(option.value)"
      ><slot :option="option">{{ option.label }}</slot></button>
    </li>
  </ul>
</template>
