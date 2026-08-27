/**
 * DustNote Web Clipper - Popup Script
 *
 * 从当前页面提取内容，发送到 DustNote 服务器创建笔记。
 */

const $ = (id) => document.getElementById(id);

async function init() {
  const { serverUrl, token } = await chrome.storage.local.get(['serverUrl', 'token']);

  if (!serverUrl || !token) {
    $('config-section').style.display = 'block';
    $('clip-section').style.display = 'none';
    return;
  }

  $('config-section').style.display = 'none';
  $('clip-section').style.display = 'block';

  // 获取当前页面信息
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    $('title').value = tab.title || '';
    $('url').value = tab.url || '';
  }

  // 提取页面内容
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // 提取正文文本（简单实现：取最大的文本块）
        const article = document.querySelector('article, main, .content, .post, .entry');
        const el = article || document.body;
        const text = el.innerText.trim().slice(0, 50000); // 限制 50KB
        return text;
      },
    });
    $('content').value = result || '';
  } catch {
    $('content').value = '(Could not extract page content)';
  }
}

// 保存配置
$('save-config').addEventListener('click', async () => {
  const serverUrl = $('server-url').value.replace(/\/+$/, '');
  const token = $('token').value;
  if (!serverUrl || !token) return;

  await chrome.storage.local.set({ serverUrl, token });
  showStatus('Connected!', 'ok');
  setTimeout(init, 500);
});

// 剪藏
$('clip-btn').addEventListener('click', async () => {
  const { serverUrl, token } = await chrome.storage.local.get(['serverUrl', 'token']);
  if (!serverUrl || !token) return;

  const title = $('title').value;
  const content = $('content').value;
  const url = $('url').value;

  const btn = $('clip-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    // 构造笔记内容（Markdown 格式，带来源链接）
    const noteContent = `# ${title}\n\n${content}\n\n---\n*Clipped from: ${url}*`;

    // 使用 DustNote API 创建笔记
    const res = await fetch(`${serverUrl}/api/v1/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        ciphertext: noteContent, // 注意：实际应该加密，这里简化处理
        keyVersion: 1,
        isPinned: false,
        isFavorite: false,
        clientUpdatedAt: new Date().toISOString(),
      }),
    });

    if (res.ok) {
      showStatus('Saved to DustNote!', 'ok');
    } else {
      const err = await res.json().catch(() => ({}));
      showStatus(`Error: ${err.error || res.statusText}`, 'err');
    }
  } catch (e) {
    showStatus(`Network error: ${e.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save to DustNote';
  }
});

function showStatus(msg, type) {
  const el = $('status');
  el.textContent = msg;
  el.className = `status ${type}`;
}

init();
