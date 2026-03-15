import { test, expect } from '@playwright/test';

test('capture session creation and send flow screenshots', async ({ page }) => {
  await page.goto('http://127.0.0.1:5175/');

  await page.getByText('开始探索').click({ force: true });
  await page.waitForTimeout(1200);

  const newConversationBtn = page.getByRole('button', { name: /New Conversation/i });
  await expect(newConversationBtn).toBeVisible({ timeout: 10000 });

  await newConversationBtn.click();
  const sidebarSessionTitle = page.locator('.agent-name', { hasText: '新对话' }).first();
  await expect(sidebarSessionTitle).toBeVisible({ timeout: 5000 });

  await page.screenshot({
    path: 'step1-new-conversation.png',
    fullPage: true,
  });

  const input = page.getByPlaceholder('Text message (Markdown supported)');
  await input.fill('这是一条用于验证新会话入列的测试消息');
  await page.getByRole('button', { name: /Send/i }).click();

  await expect(sidebarSessionTitle).toBeVisible({ timeout: 5000 });

  await page.screenshot({
    path: 'step2-send-add-session.png',
    fullPage: true,
  });
});
