<template>
  <div class="glass-container">
    <!-- Sidebar / Agent List -->
    <aside class="sidebar" :class="{ collapsed: shouldCollapse }">
      <AgentStatusBar :collapsed="shouldCollapse" @toggle="toggleSidebar" />
    </aside>

    <!-- Main Chat Area -->
    <main class="chat-main">
      <ChatPanel @open-debug="showDebug = true" />
    </main>

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
import ConnectionPanel from './components/ConnectionPanel.vue';
import EventPanel from './components/EventPanel.vue';
import { useChatStore } from './stores/chat';

const showDebug = ref(false);
const sidebarCollapsed = ref(false);
const isMobile = ref(false);
const chat = useChatStore();

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
