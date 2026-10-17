<script setup lang="ts">
// The footer of every page, signed in or not: the site's own domain and this year, e.g. "my.noda.money©2026".
const notice = `${window.location.hostname}©${new Date().getFullYear()}`
</script>

<template>
  <footer class="px-[10px] py-[21px] text-[10px] leading-none font-semibold text-faint lg:px-[30px] lg:pb-[23px] lg:pt-[31px]">
    {{ notice }}
  </footer>
</template>
