<template>
  <span
    v-if="nodeId"
    class="wss-relay-badge"
    :title="`已配置远端 WSS 拉取 · 节点：${nodeId}（不代表在线状态）`"
    :aria-label="`已配置远端 WSS 拉取，节点 ${nodeId}，不代表在线状态`"
  >远端 WS</span>
</template>

<script setup lang="ts">
defineProps<{ nodeId: string }>();
</script>

<style scoped>
.wss-relay-badge {
  position: absolute;
  top: 3px;
  right: 10px;
  z-index: 2;
  padding: 0 4px;
  border: 1px solid var(--comment-text-color);
  border-radius: 4px;
  color: var(--comment-text-color);
  background: var(--card-color);
  font-size: 9px;
  font-weight: normal;
  line-height: 12px;
  white-space: nowrap;
}
</style>
