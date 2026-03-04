<template>
  <div class="welcome-container">
    <!-- Animated gradient orbs -->
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>

    <!-- Frosted glass card -->
    <div class="welcome-card">
      <div class="logo-ring">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="20" stroke="url(#grad)" stroke-width="2.5" fill="none" />
          <path
            d="M16 24C16 19.58 19.58 16 24 16C28.42 16 32 19.58 32 24"
            stroke="url(#grad)"
            stroke-width="2.5"
            stroke-linecap="round"
          />
          <circle cx="24" cy="30" r="4" fill="url(#grad)" />
          <defs>
            <linearGradient id="grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
              <stop stop-color="#4facfe" />
              <stop offset="1" stop-color="#904efc" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <h1 class="welcome-title">Welcome to Lobster</h1>
      <p class="welcome-subtitle">Select a conversation from the left, or start a new one</p>
      <div class="action-row">
        <div class="action-btn primary" @click="$emit('start')">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          开始探索
        </div>
      </div>
      <div class="stats-row">
        <div class="stat-chip">
          <span class="stat-dot green"></span>
          AI Connected
        </div>
        <div class="stat-chip">
          <span class="stat-dot blue"></span>
          Real-time Stream
        </div>
        <div class="stat-chip">
          <span class="stat-dot purple"></span>
          Multi-Agent
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineEmits<{
  (e: 'start'): void;
}>();
</script>

<style scoped>
.welcome-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #e8f4fd 0%, #f0ebff 40%, #fce4ff 70%, #e0f2fe 100%);
}

/* Animated gradient orbs */
.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.55;
  animation: drift 12s ease-in-out infinite;
}

.orb-1 {
  width: 420px;
  height: 420px;
  background: radial-gradient(circle, #a5c8fe 0%, #4facfe44 100%);
  top: -80px;
  left: -80px;
  animation-duration: 14s;
}

.orb-2 {
  width: 360px;
  height: 360px;
  background: radial-gradient(circle, #d8b4fe 0%, #904efc44 100%);
  bottom: -60px;
  right: -60px;
  animation-duration: 18s;
  animation-delay: -4s;
}

.orb-3 {
  width: 280px;
  height: 280px;
  background: radial-gradient(circle, #fbcfe8 0%, #f472b644 100%);
  top: 40%;
  left: 60%;
  animation-duration: 11s;
  animation-delay: -7s;
}

@keyframes drift {
  0%,
  100% {
    transform: translate(0, 0) scale(1);
  }
  33% {
    transform: translate(30px, -20px) scale(1.05);
  }
  66% {
    transform: translate(-20px, 30px) scale(0.97);
  }
}

/* Frosted glass card */
.welcome-card {
  position: relative;
  z-index: 2;
  text-align: center;
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.75);
  padding: 48px 60px 40px;
  border-radius: 28px;
  box-shadow:
    0 8px 40px rgba(79, 172, 254, 0.12),
    0 2px 8px rgba(0, 0, 0, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  animation: float 7s ease-in-out infinite;
  max-width: 440px;
  width: 90%;
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

.logo-ring {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 4px 20px rgba(79, 172, 254, 0.18);
  margin: 0 auto 24px;
}

.welcome-title {
  font-size: 2.2rem;
  font-weight: 700;
  margin-bottom: 12px;
  background: linear-gradient(120deg, #3b82f6, #7c3aed, #ec4899);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: -0.5px;
}

.welcome-subtitle {
  font-size: 1rem;
  color: #64748b;
  margin-bottom: 32px;
  line-height: 1.6;
}

.action-row {
  display: flex;
  justify-content: center;
  margin-bottom: 28px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 28px;
  font-size: 1rem;
  font-weight: 600;
  border-radius: 24px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.action-btn.primary {
  color: #fff;
  background: linear-gradient(90deg, #4facfe, #904efc);
  box-shadow: 0 4px 18px rgba(79, 172, 254, 0.38);
}

.action-btn.primary:hover {
  transform: translateY(-2px) scale(1.04);
  box-shadow: 0 8px 28px rgba(79, 172, 254, 0.5);
}

.action-btn.primary:active {
  transform: translateY(0) scale(0.98);
}

.stats-row {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}

.stat-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  color: #475569;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 20px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.stat-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  animation: pulse-dot 2s ease-in-out infinite;
}

.stat-dot.green {
  background: #22c55e;
}
.stat-dot.blue {
  background: #3b82f6;
}
.stat-dot.purple {
  background: #8b5cf6;
}

@keyframes pulse-dot {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(0.85);
  }
}

/* Responsive */
@media (max-width: 600px) {
  .welcome-card {
    padding: 36px 28px 32px;
  }
  .welcome-title {
    font-size: 1.7rem;
  }
}
</style>
