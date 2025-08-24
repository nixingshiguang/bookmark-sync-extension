// 后台脚本，用于处理网络请求和记录日志
console.log('书签同步器后台脚本已启动');

// 全局变量，用于存储延迟发送的计时器
let bookmarkChangeTimer = null;
// 存储API URL、选中的书签和密码
let apiUrl = '';
let selectedBookmarks = new Set();
let apiPassword = '';

// 加载配置
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get(['apiUrl', 'selectedBookmarks', 'apiPassword']);
    apiUrl = result.apiUrl || '';
    selectedBookmarks = new Set(result.selectedBookmarks || []);
    apiPassword = result.apiPassword || '';
    console.log('配置已加载:', { apiUrl, selectedBookmarksCount: selectedBookmarks.size, hasPassword: !!apiPassword });
  } catch (error) {
    console.error('加载配置失败:', error);
  }
}

// 初始加载配置
loadConfig();

// 监听存储变化，更新配置
chrome.storage.onChanged.addListener((changes) => {
  if (changes.apiUrl) {
    apiUrl = changes.apiUrl.newValue;
  }
  if (changes.selectedBookmarks) {
    selectedBookmarks = new Set(changes.selectedBookmarks.newValue || []);
  }
  if (changes.apiPassword) {
    apiPassword = changes.apiPassword.newValue;
  }
});

// 监听书签变化
chrome.bookmarks.onCreated.addListener(handleBookmarkChange);
chrome.bookmarks.onChanged.addListener(handleBookmarkChange);
chrome.bookmarks.onMoved.addListener(handleBookmarkChange);
chrome.bookmarks.onChildrenReordered.addListener(handleBookmarkChange);

// 特别处理书签删除事件
chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
  // 如果删除的书签在选中列表中，将其移除
  if (selectedBookmarks.has(id)) {
    selectedBookmarks.delete(id);
    // 保存更新后的书签列表
    chrome.storage.local.set({ selectedBookmarks: Array.from(selectedBookmarks) });
    console.log(`书签 ${id} 已被删除并从同步列表中移除`);
  }
  
  // 继续处理常规的书签变化
  handleBookmarkChange();
});

// 处理书签变化的函数
function handleBookmarkChange() {
  console.log('检测到书签变化，准备延迟发送数据');
  
  // 如果已经有一个计时器在运行，清除它
  if (bookmarkChangeTimer) {
    clearTimeout(bookmarkChangeTimer);
  }
  
  // 设置新的计时器，30秒后发送数据
  bookmarkChangeTimer = setTimeout(async () => {
    await sendBookmarksData();
    bookmarkChangeTimer = null;
  }, 30000); // 30秒延迟
}

// 发送书签数据到API
async function sendBookmarksData() {
  // 检查是否有API URL和选中的书签
  if (!apiUrl || selectedBookmarks.size === 0) {
    console.log('没有配置API URL或未选择书签，跳过发送');
    return;
  }
  
  try {
    console.log('准备发送书签数据到API');
    const bookmarksJson = await buildBookmarksJson();
    
    // 准备要发送的数据
    const data = {
      bookmarks: bookmarksJson,
      timestamp: new Date().toISOString(),
      count: bookmarksJson.length,
      source: 'auto_sync'
    };
    
    // 构建URL，如果有密码则添加password参数
    let requestUrl = apiUrl;
    if (apiPassword) {
      // 检查URL是否已经包含查询参数
      const separator = apiUrl.includes('?') ? '&' : '?';
      requestUrl = `${apiUrl}${separator}password=${encodeURIComponent(apiPassword)}`;
    }
    
    // 发送请求
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const responseData = await response.json();
    console.log('自动同步成功:', responseData);
  } catch (error) {
    console.error('自动同步失败:', error);
  }
}

// 构建书签JSON数据
async function buildBookmarksJson() {
  const result = [];
  
  for (const bookmarkId of selectedBookmarks) {
    try {
      const bookmarks = await chrome.bookmarks.get(bookmarkId);
      if (bookmarks && bookmarks.length > 0) {
        const bookmark = bookmarks[0];
        result.push({
          id: bookmark.id,
          name: bookmark.title || '',
          url: bookmark.url || null,
          parentId: bookmark.parentId || null,
          index: bookmark.index || 0,
          dateAdded: bookmark.dateAdded || null,
          dateGroupModified: bookmark.dateGroupModified || null,
          isFolder: !bookmark.url
        });
      }
    } catch (error) {
      console.error(`获取书签 ${bookmarkId} 失败:`, error);
    }
  }
  
  return result;
}

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'sendBookmarks') {
    console.log('接收到发送书签请求:', message.url);
    console.log('书签数据:', message.data);
    
    // 使用后台脚本发送网络请求
    fetch(message.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message.data)
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      console.log('请求成功:', data);
      sendResponse({ success: true, data });
    })
    .catch(error => {
      console.error('请求失败:', error);
      sendResponse({ success: false, error: error.message });
    });
    
    // 返回true表示将异步发送响应
    return true;
  }
});