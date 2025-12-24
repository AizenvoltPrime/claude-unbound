<script setup lang="ts">
import { Vue3Lottie } from 'vue3-lottie';
import loadingAnimation from '../assets/loading-spinner.json';

defineProps<{
  size?: number;
}>();
</script>

<template>
  <Vue3Lottie
    :animation-data="loadingAnimation"
    :height="size ?? 20"
    :width="size ?? 20"
    :loop="true"
    :auto-play="true"
  />
</template>
