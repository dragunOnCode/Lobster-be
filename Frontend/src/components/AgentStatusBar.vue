<template>
  <div class="agent-sidebar">
    <!-- Toggle Button (Mobile) -->
    <button class="sidebar-toggle" @click="$emit('toggle')">
      <icon-menu-fold v-if="!collapsed" />
      <icon-menu-unfold v-else />
    </button>

    <!-- User Profile Header -->
    <div class="user-profile">
      <div class="avatar-wrapper">
        <a-avatar :size="48" class="user-avatar">
          <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Admin" alt="user" />
          <div class="status-dot online"></div>
        </a-avatar>
      </div>
      <div class="user-info">
        <span class="user-name">Administrator</span>
        <span class="online-label">online</span>
      </div>
    </div>

    <!-- Search Bar -->
    <div class="search-section">
      <a-input class="search-input" placeholder="Search" round>
        <template #prefix><icon-search /></template>
      </a-input>
    </div>

    <!-- History List -->
    <div class="agent-list-scroll">
      <TransitionGroup name="agent-list">
        <div
          v-for="(sessionInfo, index) in chat.sessionHistory"
          :key="sessionInfo.id"
          class="agent-item"
          :class="{ active: chat.config.sessionId === sessionInfo.id }"
          :style="{ animationDelay: `${index * 0.05}s` }"
          @click="chat.changeSession(sessionInfo.id)"
        >
          <div class="avatar-wrapper">
            <a-avatar :size="42" class="agent-avatar">
              <template #icon><icon-history /></template>
              <div class="status-dot" :class="{ online: chat.config.sessionId === sessionInfo.id }"></div>
            </a-avatar>
          </div>
          <div class="agent-info">
            <div class="agent-header" v-if="editingSessionId !== sessionInfo.id">
              <span class="agent-name">{{ sessionInfo.title || sessionInfo.id }}</span>
              <button class="edit-btn" @click.stop="startEdit(sessionInfo.id, sessionInfo.title)">
                <icon-edit />
              </button>
            </div>
            <div class="agent-header" v-else>
              <a-input
                size="small"
                v-model="editTitle"
                @press-enter="finishEdit"
                @blur="finishEdit"
                @click.stop
                auto-focus
              />
            </div>
            <div class="agent-preview">
              Conversation history...
            </div>
          </div>
        </div>
      </TransitionGroup>

      <!-- Empty State -->
      <div v-if="chat.sessionHistory.length === 0" class="empty-state">
        <div class="empty-icon">
          <icon-message />
        </div>
        <p>No conversation history</p>
      </div>
    </div>

    <!-- Bottom Actions -->
    <div class="sidebar-footer">
      <a-button type="primary" shape="round" long @click="chat.createNewSession">
        <template #icon><icon-plus /></template>
        New Conversation
      </a-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import {
  IconSearch,
  IconMenuFold,
  IconMenuUnfold,
  IconHistory,
  IconPlus,
  IconMessage,
  IconEdit
} from '@arco-design/web-vue/es/icon';
import { useChatStore } from '../stores/chat';

defineProps<{
  collapsed?: boolean;
}>();

defineEmits<{
  (e: 'toggle'): void;
}>();

const chat = useChatStore();

const editingSessionId = ref<string | null>(null);
const editTitle = ref('');

function startEdit(id: string, currentTitle: string) {
  editingSessionId.value = id;
  editTitle.value = currentTitle || id;
}

function finishEdit() {
  if (editingSessionId.value && editTitle.value.trim()) {
    chat.renameSession(editingSessionId.value, editTitle.value.trim());
  }
  editingSessionId.value = null;
}
</script>

<style scoped>
.agent-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px 0;
  position: relative;
}

.sidebar-footer {
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.sidebar-toggle {
  position: absolute;
  top: 16px;
  right: 12px;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: var(--text-main);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  font-size: 16px;
}

.sidebar-toggle:hover {
  background: rgba(255, 255, 255, 0.45);
  transform: scale(1.08);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
}

.sidebar-toggle:active {
  transform: scale(0.95);
}

@media (min-width: 901px) {
  .sidebar-toggle {
    display: none;
  }
}

.user-profile {
  display: flex;
  align-items: center;
  padding: 0 20px;
  margin-bottom: 20px;
}

.avatar-wrapper {
  position: relative;
  margin-right: 12px;
}

.user-avatar {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.user-avatar:hover {
  transform: scale(1.05) rotate(-3deg);
}

.status-dot {
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid white;
  background-color: #95a5a6;
  transition: background-color 0.3s ease, transform 0.2s ease;
}

.status-dot.online,
.status-dot.responding {
  background-color: #2ecc71;
  animation: pulse-dot 2s infinite;
}

.status-dot.thinking {
  background-color: #3498db;
  animation: pulse-dot 1s infinite;
}

.status-dot.error {
  background-color: #e74c3c;
}

@keyframes pulse-dot {
  0%, 100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.4);
  }
  50% {
    transform: scale(1.1);
    box-shadow: 0 0 0 4px rgba(46, 204, 113, 0);
  }
}

.user-info {
  display: flex;
  flex-direction: column;
}

.user-name {
  font-weight: 600;
  font-size: 16px;
  color: var(--text-main);
}

.online-label {
  font-size: 12px;
  color: var(--text-muted);
}

.search-section {
  padding: 0 20px;
  margin-bottom: 16px;
}

.search-input {
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.35) !important;
  color: var(--text-main);
  border-radius: 12px !important;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
}

.search-input:hover {
  background: rgba(255, 255, 255, 0.4);
  border-color: rgba(255, 255, 255, 0.5) !important;
}

.search-input:focus-within {
  background: rgba(255, 255, 255, 0.55);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  border-color: rgba(79, 172, 254, 0.3) !important;
}

.agent-list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px;
}

.agent-item {
  display: flex;
  align-items: center;
  padding: 12px;
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.33, 1, 0.68, 1);
  margin-bottom: 4px;
  animation: slideInLeft 0.3s cubic-bezier(0.33, 1, 0.68, 1) backwards;
  border: 1px solid transparent;
}

.agent-item:hover {
  background: rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-color: rgba(255, 255, 255, 0.4);
  transform: translateX(4px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.agent-item:active {
  transform: translateX(2px) scale(0.99);
}

.agent-item.active {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-color: rgba(255, 255, 255, 0.5);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.agent-avatar {
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.agent-item:hover .agent-avatar {
  transform: scale(1.05);
}

.agent-info {
  flex: 1;
  overflow: hidden;
  margin-left: 12px;
}

.agent-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 3px;
}

.agent-name {
  font-weight: 500;
  font-size: 15px;
  color: var(--text-main);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  opacity: 0;
}

.agent-item:hover .edit-btn {
  opacity: 1;
}

.edit-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: var(--text-main);
}

.activity-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--primary-gradient);
  opacity: 0.7;
  position: relative;
}

.activity-indicator.thinking {
  opacity: 1;
}

.activity-indicator.responding {
  animation: pulse 1.5s infinite;
}

.pulse-ring {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid rgba(52, 152, 219, 0.5);
  animation: pulse-ring 1.5s infinite;
}

@keyframes pulse-ring {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  100% {
    transform: scale(2);
    opacity: 0;
  }
}

.agent-preview {
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Agent list transitions */
.agent-list-enter-active {
  animation: slideInLeft 0.3s cubic-bezier(0.33, 1, 0.68, 1);
}

.agent-list-leave-active {
  animation: slideInLeft 0.2s ease reverse;
}

.agent-list-move {
  transition: transform 0.3s cubic-bezier(0.33, 1, 0.68, 1);
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-muted);
}

.empty-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  margin-bottom: 12px;
  opacity: 0.7;
}

.empty-state p {
  font-size: 14px;
  margin: 0;
  opacity: 0.8;
}

/* Responsive */
@media (max-width: 768px) {
  .agent-sidebar {
    padding: 16px 0;
  }

  .user-profile {
    padding: 0 16px;
  }

  .search-section {
    padding: 0 16px;
  }
}
</style>
