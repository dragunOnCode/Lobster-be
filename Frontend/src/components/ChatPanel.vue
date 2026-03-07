<template>
  <div class="chat-container">
    <!-- Chat Header -->
    <header class="chat-header">
      <div class="header-left">
        <div class="header-info">
          <span class="header-name">{{ currentSessionTitle }}</span>
          <span class="header-status">
            <span class="status-indicator"></span>
            {{ chat.connectionStatus === 'connected' ? 'Connected' : 'Connecting...' }}
          </span>
        </div>
      </div>
      <div class="header-actions">
        <a-tooltip content="Voice Call" :mouse-enter-delay="0.5">
          <button class="glass-icon-btn">
            <icon-phone />
          </button>
        </a-tooltip>
        <a-tooltip content="Settings" :mouse-enter-delay="0.5">
          <button class="glass-icon-btn" @click="$emit('open-debug')">
            <icon-settings />
          </button>
        </a-tooltip>
      </div>
    </header>

    <!-- Chat Messages -->
    <div class="messages-area" ref="scrollContainer">
      <TransitionGroup name="message">
        <div
          v-for="(message, index) in chat.messages"
          :key="message.id"
          class="message-wrapper"
          :class="message.role"
          :style="{ animationDelay: `${Math.min(index * 0.03, 0.3)}s` }"
        >
          <div class="message-label">
            <span>{{ message.role === 'user' ? 'Sent' : 'Received' }}</span>
            <span class="message-time">{{ formatTime(message.createdAt) }}</span>
            <span v-if="message.role === 'user' && chat.errorMessageIds.has(message.id)" class="message-error-badge">
              <icon-exclamation-circle-fill class="error-icon" />
              <span>发送失败</span>
            </span>
          </div>
          <div class="message-content-box">
            <div v-if="message.role !== 'user'" class="message-avatar">
              <a-avatar :size="36">
                <img :src="getAvatar(message.agentName || 'System')" alt="avatar" />
              </a-avatar>
            </div>
            <div
              class="bubble markdown-body"
              :class="{ 'bubble-error': message.role === 'user' && chat.errorMessageIds.has(message.id) }"
              v-html="renderMarkdown(message.content)"
            ></div>
          </div>
          <div v-if="message.role === 'user' && chat.errorMessageIds.has(message.id)" class="retry-action">
            <button class="retry-btn" @click="handleRetry(message.id)">
              <icon-refresh />
              <span>重试</span>
            </button>
          </div>
        </div>
      </TransitionGroup>

      <!-- Streaming Drafts -->
      <TransitionGroup name="message">
        <div v-for="item in streamDrafts" :key="item.key" class="message-wrapper assistant streaming">
          <div class="message-label">Received</div>
          <div class="message-content-box">
            <div class="message-avatar">
              <a-avatar :size="36">
                <img :src="getAvatar(item.agentName)" alt="avatar" />
              </a-avatar>
            </div>
            <div class="bubble markdown-body streaming-bubble">
              <div v-html="renderMarkdown(item.content)"></div>
              <span class="stream-caret" />
            </div>
          </div>
        </div>
      </TransitionGroup>

      <!-- Scroll to bottom button -->
      <Transition name="fade">
        <button v-show="showScrollBtn" class="scroll-bottom-btn" @click="scrollToBottom(true)">
          <icon-down />
        </button>
      </Transition>
    </div>

    <!-- Input Area -->
    <footer class="input-area">
      <div class="input-pill" :class="{ focused: inputFocused, 'has-content': draft.length > 0 }">
        <a-input
          v-model="draft"
          placeholder="Text message (Markdown supported)"
          :border="false"
          @keydown.enter.exact.prevent="handleSend"
          @focus="inputFocused = true"
          @blur="inputFocused = false"
        />
        <div class="input-actions">
          <a-tooltip content="Emoji" :mouse-enter-delay="0.5">
            <button class="glass-icon-btn sm">
              <icon-face-smile-fill />
            </button>
          </a-tooltip>
          <a-tooltip content="Attachment" :mouse-enter-delay="0.5">
            <button class="glass-icon-btn sm">
              <icon-attachment />
            </button>
          </a-tooltip>
          <button class="glass-send-btn" :class="{ ready: draft.trim().length > 0 }" @click="handleSend">
            <span class="send-text">Send</span>
            <icon-arrow-right class="send-icon" />
          </button>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onUpdated, nextTick, watch, onMounted } from 'vue';
import MarkdownIt from 'markdown-it';
import { Message } from '@arco-design/web-vue';
import {
  IconPhone,
  IconSettings,
  IconArrowRight,
  IconFaceSmileFill,
  IconAttachment,
  IconDown,
  IconRefresh,
  IconExclamationCircleFill,
} from '@arco-design/web-vue/es/icon';
import { useChatStore } from '../stores/chat';

const chat = useChatStore();

const currentSessionTitle = computed(() => {
  const session = chat.sessionHistory.find((s) => s.id === chat.config.sessionId);
  return session?.title || chat.config.sessionId;
});

const draft = ref('');
const scrollContainer = ref<HTMLElement | null>(null);
const inputFocused = ref(false);
const showScrollBtn = ref(false);
const isAutoScrolling = ref(false);

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

const streamDrafts = computed(() =>
  Object.values(chat.streamBuffer).sort(
    (left, right) => new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime(),
  ),
);

function renderMarkdown(content: string) {
  return md.render(content);
}

function getAvatar(name: string) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`;
}

function formatTime(timestamp: string | Date) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function handleSend() {
  if (!draft.value.trim()) return;
  const sent = chat.sendMessage(draft.value);
  if (!sent) {
    Message.warning(chat.connectionError || 'Chat service is not connected');
    return;
  }
  draft.value = '';
  scrollToBottom(true);
}

function handleRetry(messageId: string) {
  const ok = chat.retryMessage(messageId);
  if (!ok) {
    Message.warning(chat.connectionError || 'Chat service is not connected');
  }
}

function scrollToBottom(smooth: boolean = false) {
  if (scrollContainer.value) {
    isAutoScrolling.value = true;
    scrollContainer.value.scrollTo({
      top: scrollContainer.value.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
    setTimeout(() => {
      isAutoScrolling.value = false;
    }, 500);
  }
}

function checkScrollPosition() {
  if (scrollContainer.value && !isAutoScrolling.value) {
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    showScrollBtn.value = !isNearBottom;
  }
}

onMounted(() => {
  if (scrollContainer.value) {
    scrollContainer.value.addEventListener('scroll', checkScrollPosition);
  }
});

onUpdated(() => {
  nextTick(() => {
    scrollToBottom();
  });
});

watch(
  streamDrafts,
  () => {
    nextTick(() => {
      scrollToBottom();
    });
  },
  { deep: true },
);

defineEmits(['open-debug']);
</script>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 20px 20px;
  min-width: 0;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 10px 16px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
}

.header-avatar {
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.header-avatar:hover {
  transform: scale(1.05);
}

.header-info {
  margin-left: 12px;
  display: flex;
  flex-direction: column;
}

.header-name {
  font-weight: 600;
  font-size: 18px;
  color: var(--text-main);
}

.header-status {
  font-size: 13px;
  color: #2ecc71;
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2ecc71;
  animation: pulse 2s infinite;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.glass-icon-btn {
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 50%;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  color: var(--text-main);
  font-size: 16px;
}

.glass-icon-btn:hover {
  background: rgba(255, 255, 255, 0.5);
  transform: scale(1.08);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
}

.glass-icon-btn:active {
  transform: scale(0.95);
}

.glass-icon-btn.sm {
  width: 34px;
  height: 34px;
  font-size: 14px;
}

.messages-area {
  flex: 1;
  overflow-y: auto;
  padding: 16px 10px;
  position: relative;
}

.message-wrapper {
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  width: 100%;
  animation: fadeInUp 0.35s cubic-bezier(0.33, 1, 0.68, 1) backwards;
}

/* Message transition animations */
.message-enter-active {
  animation: fadeInUp 0.35s cubic-bezier(0.33, 1, 0.68, 1);
}

.message-leave-active {
  animation: fadeIn 0.2s ease reverse;
}

.message-move {
  transition: transform 0.3s cubic-bezier(0.33, 1, 0.68, 1);
}

.message-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.message-time {
  font-size: 11px;
  opacity: 0.7;
}

.message-content-box {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  width: 100%;
}

.message-avatar {
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.message-avatar:hover {
  transform: scale(1.08);
}

.bubble {
  width: fit-content;
  max-width: min(85%, 680px);
  padding: 12px 18px;
  border-radius: 18px;
  font-size: 15px;
  line-height: 1.55;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.bubble:hover {
  transform: translateY(-1px);
}

/* User / Sent Style */
.user.message-wrapper {
  align-items: flex-end;
}

.user .message-label,
.user .message-content-box {
  justify-content: flex-end;
}

.user .bubble {
  background: var(--primary-gradient);
  color: white;
  border-bottom-right-radius: 6px;
  box-shadow: 0 2px 8px rgba(79, 172, 254, 0.25);
}

.user .bubble:hover {
  box-shadow: 0 4px 16px rgba(79, 172, 254, 0.35);
}

/* Assistant / Received Style */
.assistant.message-wrapper,
.system.message-wrapper {
  align-items: flex-start;
}

.assistant .message-label,
.assistant .message-content-box,
.system .message-label,
.system .message-content-box {
  justify-content: flex-start;
}

.assistant .bubble,
.system .bubble {
  background: var(--received-bg);
  color: var(--text-main);
  border-bottom-left-radius: 6px;
  backdrop-filter: blur(8px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.assistant .bubble:hover,
.system .bubble:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

/* Streaming bubble */
.streaming-bubble {
  position: relative;
}

.stream-caret {
  display: inline-block;
  width: 2px;
  height: 16px;
  background: linear-gradient(180deg, #4facfe 0%, #904efc 100%);
  margin-left: 4px;
  vertical-align: middle;
  animation: blink 0.8s infinite;
  border-radius: 2px;
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

/* Scroll to bottom button */
.scroll-bottom-btn {
  position: sticky;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-main);
  transition: all 0.2s ease;
  z-index: 10;
}

.scroll-bottom-btn:hover {
  transform: translateX(-50%) scale(1.1);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
}

.scroll-bottom-btn:active {
  transform: translateX(-50%) scale(0.95);
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

/* Input Area */
.input-area {
  padding-top: 16px;
  flex-shrink: 0;
}

.input-pill {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(12px);
  border-radius: 28px;
  padding: 6px 6px 6px 20px;
  display: flex;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.4);
  transition: all 0.25s cubic-bezier(0.33, 1, 0.68, 1);
}

.input-pill.focused {
  background: rgba(255, 255, 255, 0.7);
  border-color: rgba(79, 172, 254, 0.4);
  box-shadow: 0 4px 20px rgba(79, 172, 254, 0.15);
}

.input-pill.has-content {
  background: rgba(255, 255, 255, 0.65);
}

.input-pill :deep(.arco-input-wrapper) {
  background: transparent !important;
  border: none !important;
  flex: 1;
}

.input-pill :deep(.arco-input) {
  font-size: 15px;
}

.input-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.glass-send-btn {
  height: 40px;
  padding: 0 20px;
  font-weight: 500;
  margin-left: 8px;
  overflow: hidden;
  border-radius: 20px;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-gradient);
  color: white;
  box-shadow: 0 4px 16px rgba(79, 172, 254, 0.3);
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.glass-send-btn:not(.ready) {
  opacity: 0.7;
}

.glass-send-btn.ready {
  box-shadow: 0 6px 20px rgba(79, 172, 254, 0.4);
}

.glass-send-btn .send-icon {
  margin-left: 6px;
  transition: transform 0.2s ease;
}

.glass-send-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 28px rgba(79, 172, 254, 0.45);
}

.glass-send-btn:hover .send-icon {
  transform: translateX(3px);
}

.glass-send-btn:active {
  transform: translateY(0) scale(0.97);
}

/* Error state */
.message-error-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #ff4d4f;
  font-size: 12px;
  font-weight: 500;
}

.error-icon {
  font-size: 13px;
}

.bubble-error {
  border: 1.5px solid rgba(255, 77, 79, 0.45) !important;
  box-shadow: 0 2px 8px rgba(255, 77, 79, 0.18) !important;
}

.retry-action {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
  padding-right: 2px;
}

.retry-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 14px;
  border-radius: 14px;
  border: 1px solid rgba(255, 77, 79, 0.4);
  background: rgba(255, 77, 79, 0.06);
  color: #ff4d4f;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.retry-btn:hover {
  background: rgba(255, 77, 79, 0.12);
  border-color: rgba(255, 77, 79, 0.65);
  transform: scale(1.04);
}

.retry-btn:active {
  transform: scale(0.97);
}

.retry-btn :deep(svg) {
  font-size: 14px;
}

/* Handle overflow in markdown content */
:deep(.markdown-body) {
  overflow-wrap: break-word;
}
:deep(.markdown-body pre) {
  max-width: 100%;
}

/* Responsive */
@media (max-width: 600px) {
  .chat-container {
    padding: 12px 14px 16px;
  }

  .bubble {
    max-width: 90%;
    padding: 10px 14px;
    font-size: 14px;
  }

  .input-pill {
    padding: 4px 4px 4px 16px;
  }

  .send-btn {
    padding: 0 16px;
    height: 36px;
  }

  .send-text {
    display: none;
  }
}
</style>
