<template>
  <div class="glass-container">
    <!-- Full-screen Welcome (before entering chat mode) -->
    <template v-if="!chat.enteredChatMode && !chat.isEnteringChatMode">
      <WelcomeGlass class="full-welcome" @start="chat.enterChatMode()" />
    </template>

    <!-- Entering Chat Loading -->
    <template v-else-if="chat.isEnteringChatMode">
      <section class="entering-screen">
        <div class="entering-card">
          <h2 class="entering-title">Preparing your chat...</h2>
          <p class="entering-subtitle">Loading recent sessions and opening the latest conversation</p>
          <div class="dialog-scroll" aria-live="polite">
            <div class="dialog-track">
              <div v-for="(line, index) in loadingDialogs" :key="`line-a-${index}`" class="dialog-line">
                {{ line }}
              </div>
              <div v-for="(line, index) in loadingDialogs" :key="`line-b-${index}`" class="dialog-line">
                {{ line }}
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>

    <!-- Chat Interface (after entering chat mode) -->
    <template v-else>
      <!-- Sidebar / Agent List -->
      <aside class="sidebar" :class="{ collapsed: shouldCollapse }">
        <AgentStatusBar :collapsed="shouldCollapse" @toggle="toggleSidebar" />
      </aside>

      <!-- Main Chat Area -->
      <main class="chat-main">
        <ChatPanel v-if="chat.config.sessionId" @open-debug="showDebug = true" />
        <div v-else class="chat-inline-loading">
          Waiting for session...
        </div>
      </main>
    </template>

    <!-- Debug Drawers -->
    <a-drawer
      v-model:visible="showDebug"
      title="Debug Console"
      width="600"
      placement="right"
      unmount-on-close
    >
      <a-tabs default-active-key="connection">
        <a-tab-pane key="connection" title="Connection">
          <ConnectionPanel />
        </a-tab-pane>
        <a-tab-pane key="events" title="Events">
          <EventPanel />
        </a-tab-pane>
      </a-tabs>
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import AgentStatusBar from './components/AgentStatusBar.vue';
import ChatPanel from './components/ChatPanel.vue';
import WelcomeGlass from './components/WelcomeGlass.vue';
import ConnectionPanel from './components/ConnectionPanel.vue';
import EventPanel from './components/EventPanel.vue';
import { useChatStore } from './stores/chat';

const showDebug = ref(false);
const sidebarCollapsed = ref(false);
const isMobile = ref(false);
const chat = useChatStore();
const loadingDialogs = [
  'Connecting to chat gateway...',
  'Fetching conversation sessions...',
  'Selecting the latest session...',
  'Loading message history...',
];

// Check if we're on mobile viewport
const checkMobile = () => {
  isMobile.value = window.innerWidth <= 768;
  // Auto-expand sidebar when switching to desktop
  if (!isMobile.value && sidebarCollapsed.value) {
    sidebarCollapsed.value = false;
  }
};

const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value;
};

// Computed property that only applies collapse on mobile
const shouldCollapse = computed(() => {
  return isMobile.value && sidebarCollapsed.value;
});

onMounted(() => {
  checkMobile();
  window.addEventListener('resize', checkMobile);
  chat.connect();
});

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile);
  chat.disconnect();
});
</script>

<style scoped>
.glass-container {
  display: flex;
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

.full-welcome {
  width: 100%;
  height: 100%;
}

.entering-screen {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: linear-gradient(135deg, #f0f7ff 0%, #f7f4ff 48%, #eef7ff 100%);
}

.entering-card {
  width: min(520px, 100%);
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: 24px;
  box-shadow: 0 14px 42px rgba(79, 172, 254, 0.15);
  padding: 26px 24px;
  backdrop-filter: blur(16px);
}

.entering-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: #1f2937;
}

.entering-subtitle {
  margin: 8px 0 16px;
  color: #64748b;
  font-size: 14px;
}

.dialog-scroll {
  height: 140px;
  overflow: hidden;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.dialog-track {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  animation: scroll-dialog 5s linear infinite;
}

.dialog-line {
  align-self: flex-start;
  max-width: 90%;
  background: #ffffff;
  border: 1px solid rgba(226, 232, 240, 0.95);
  border-radius: 12px 12px 12px 4px;
  padding: 8px 12px;
  color: #334155;
  font-size: 13px;
}

@keyframes scroll-dialog {
  0% {
    transform: translateY(0);
  }
  100% {
    transform: translateY(-50%);
  }
}

.sidebar {
  width: 300px;
  min-width: 300px;
  border-right: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  flex-direction: column;
  transition: width 0.3s cubic-bezier(0.33, 1, 0.68, 1),
              min-width 0.3s cubic-bezier(0.33, 1, 0.68, 1);
}

/* On desktop, sidebar is always visible - collapse class is ignored */
.sidebar.collapsed {
  /* No effect on desktop - sidebar stays visible */
}

.chat-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
  overflow: hidden;
}

.chat-inline-loading {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  font-size: 14px;
}

/* Medium screens - reduce sidebar width but keep visible */
@media (max-width: 1100px) {
  .sidebar {
    width: 260px;
    min-width: 260px;
  }
}

/* Smaller screens - further reduce */
@media (max-width: 900px) {
  .sidebar {
    width: 240px;
    min-width: 240px;
  }
}

/* Mobile - overlay mode with collapse support */
@media (max-width: 768px) {
  .sidebar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 280px;
    min-width: 280px;
    z-index: 100;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.1);
    transition: transform 0.3s cubic-bezier(0.33, 1, 0.68, 1);
  }

  .sidebar.collapsed {
    transform: translateX(-100%);
  }
}
</style>
