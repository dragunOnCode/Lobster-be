<template>
  <a-card title="连接配置" class="full-height">
    <a-form layout="vertical" :model="localConfig">
      <a-form-item label="Base URL">
        <a-input v-model="localConfig.baseUrl" placeholder="http://localhost:3000" />
      </a-form-item>
      <a-form-item label="Namespace">
        <a-input v-model="localConfig.namespace" placeholder="/chat" />
      </a-form-item>
      <a-form-item label="Session ID">
        <a-input v-model="localConfig.sessionId" placeholder="demo-session" />
      </a-form-item>
      <a-form-item label="User ID">
        <a-input v-model="localConfig.userId" placeholder="demo-user" />
      </a-form-item>
      <a-form-item label="JWT Token（可选）">
        <a-input-password v-model="localConfig.token" placeholder="Bearer token" />
      </a-form-item>
    </a-form>
    <a-space>
      <a-button type="primary" @click="handleConnect">连接</a-button>
      <a-button status="warning" @click="chat.disconnect">断开</a-button>
      <a-tag :color="statusColor">{{ chat.connectionStatus }}</a-tag>
    </a-space>
    <p v-if="chat.connectionError" class="error-text">{{ chat.connectionError }}</p>
  </a-card>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';
import { useChatStore } from '../stores/chat';

const chat = useChatStore();

const localConfig = reactive({ ...chat.config });

const statusColor = computed(() => {
  const map: Record<string, string> = {
    connected: 'green',
    connecting: 'arcoblue',
    reconnecting: 'orangered',
    disconnected: 'gray',
    error: 'red',
  };
  return map[chat.connectionStatus] ?? 'gray';
});

function handleConnect() {
  chat.updateConfig(localConfig);
  chat.connect();
}
</script>
