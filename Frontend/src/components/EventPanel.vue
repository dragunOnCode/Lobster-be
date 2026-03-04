<template>
  <a-card title="事件调试面板" class="full-height">
    <a-space direction="vertical" fill>
      <a-space fill>
        <a-select v-model="chat.eventTypeFilter" :options="chat.eventTypeOptions" />
        <a-input v-model="chat.eventKeyword" placeholder="按事件名或内容搜索" />
        <a-button @click="copyEvents">复制日志</a-button>
      </a-space>

      <a-table
        :columns="columns"
        :data="chat.filteredEvents"
        :pagination="{ pageSize: 8 }"
        size="small"
        row-key="id"
      >
        <template #direction="{ record }">
          <a-tag :color="record.direction === 'inbound' ? 'green' : 'arcoblue'">
            {{ record.direction }}
          </a-tag>
        </template>
        <template #payload="{ record }">
          <pre class="payload">{{ stringifyPayload(record.payload) }}</pre>
        </template>
      </a-table>
    </a-space>
  </a-card>
</template>

<script setup lang="ts">
import { Message } from '@arco-design/web-vue';
import { useChatStore } from '../stores/chat';

const chat = useChatStore();

const columns = [
  { title: '方向', dataIndex: 'direction', slotName: 'direction', width: 90 },
  { title: '事件', dataIndex: 'event', width: 160 },
  { title: '时间', dataIndex: 'timestamp', width: 170 },
  { title: 'Payload', dataIndex: 'payload', slotName: 'payload' },
];

function stringifyPayload(payload: unknown) {
  return JSON.stringify(payload, null, 2);
}

async function copyEvents() {
  await navigator.clipboard.writeText(chat.exportEvents());
  Message.success('事件日志已复制到剪贴板');
}
</script>
