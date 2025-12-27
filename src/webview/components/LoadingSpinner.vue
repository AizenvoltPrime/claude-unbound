<script setup lang="ts">
defineProps<{
  size?: number;
  borderWidth?: number;
}>();
</script>

<template>
  <span
    class="inline-block border-solid border-current border-b-transparent rounded-full box-border animate-spinner"
    :style="{
      width: `${(size ?? 16) / 16}rem`,
      height: `${(size ?? 16) / 16}rem`,
      borderWidth: `${(borderWidth ?? 2) / 16}rem`,
    }"
  />
</template>
