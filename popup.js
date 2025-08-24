class BookmarkSyncer {
  constructor() {
    this.selectedBookmarks = new Set();
    this.apiUrl = '';
    this.apiPassword = '';
    this.bookmarksData = [];
    this.init();
  }

  async init() {
    this.setupThemeListener();
    await this.loadConfig();
    await this.loadBookmarks();
    this.bindEvents();
    this.updateSendButton();
  }
  
  setupThemeListener() {
    // 检测系统主题变化
    if (window.matchMedia) {
      const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      // 初始检查
      this.updateThemeStatus(darkModeMediaQuery.matches);
      
      // 监听系统主题变化
      darkModeMediaQuery.addEventListener('change', (e) => {
        this.updateThemeStatus(e.matches);
      });
    }
  }
  
  updateThemeStatus(isDarkMode) {
    console.log(`系统主题切换: ${isDarkMode ? '暗黑模式' : '浅色模式'}`);
    // CSS变量会自动根据媒体查询切换，这里可以添加额外的主题相关逻辑
  }

  async loadConfig() {
    try {
      const result = await chrome.storage.local.get(['apiUrl', 'selectedBookmarks', 'apiPassword']);
      this.apiUrl = result.apiUrl || '';
      this.selectedBookmarks = new Set(result.selectedBookmarks || []);
      this.apiPassword = result.apiPassword || '';
      
      const apiUrlInput = document.getElementById('apiUrl');
      apiUrlInput.value = this.apiUrl;
      
      const apiPasswordInput = document.getElementById('apiPassword');
      if (apiPasswordInput) {
        apiPasswordInput.value = this.apiPassword;
      }
    } catch (error) {
      console.error('加载配置失败:', error);
    }
  }

  async saveConfig() {
    try {
      await chrome.storage.local.set({
        apiUrl: this.apiUrl,
        selectedBookmarks: Array.from(this.selectedBookmarks),
        apiPassword: this.apiPassword
      });
    } catch (error) {
      console.error('保存配置失败:', error);
    }
  }

  async loadBookmarks() {
    try {
      const bookmarks = await chrome.bookmarks.getTree();
      this.bookmarksData = bookmarks;
      this.renderBookmarks();
    } catch (error) {
      console.error('加载书签失败:', error);
      this.showToast('加载书签失败', 'error');
    }
  }

  renderBookmarks() {
    const container = document.getElementById('bookmarksTree');
    container.innerHTML = '';
    
    if (this.bookmarksData.length === 0) {
      container.innerHTML = '<div class="loading">暂无书签数据</div>';
      return;
    }

    // 渲染书签树，跳过根节点
    this.bookmarksData[0].children?.forEach(child => {
      const element = this.createBookmarkElement(child);
      container.appendChild(element);
    });
  }

  createBookmarkElement(bookmark, level = 0) {
    const div = document.createElement('div');
    div.className = 'bookmark-item';
    div.style.marginLeft = `${level * 16}px`;

    if (bookmark.children) {
      // 文件夹
      div.innerHTML = `
        <div class="bookmark-folder">
          <div class="folder-header" data-id="${bookmark.id}">
            <span class="folder-toggle">▶</span>
            <input type="checkbox" class="folder-checkbox" data-id="${bookmark.id}">
            <span class="folder-name">${this.escapeHtml(bookmark.title || '未命名文件夹')}</span>
          </div>
          <div class="folder-children"></div>
        </div>
      `;

      const folderHeader = div.querySelector('.folder-header');
      const folderToggle = div.querySelector('.folder-toggle');
      const folderChildren = div.querySelector('.folder-children');
      const folderCheckbox = div.querySelector('.folder-checkbox');

      // 设置初始选中状态
      if (this.selectedBookmarks.has(bookmark.id)) {
        folderCheckbox.checked = true;
      }

      // 文件夹展开/折叠
      folderHeader.addEventListener('click', (e) => {
        if (e.target === folderCheckbox) return;
        
        const isExpanded = folderChildren.classList.contains('expanded');
        if (isExpanded) {
          folderChildren.classList.remove('expanded');
          folderToggle.classList.remove('expanded');
          folderChildren.innerHTML = '';
        } else {
          folderChildren.classList.add('expanded');
          folderToggle.classList.add('expanded');
          
          // 渲染子项
          bookmark.children.forEach(child => {
            const childElement = this.createBookmarkElement(child, level + 1);
            folderChildren.appendChild(childElement);
          });
        }
      });

      // 文件夹选择
      folderCheckbox.addEventListener('change', (e) => {
        this.handleFolderSelection(bookmark, e.target.checked);
      });

    } else {
      // 书签链接
      div.innerHTML = `
        <div class="bookmark-link">
          <input type="checkbox" class="bookmark-checkbox" data-id="${bookmark.id}">
          <span class="bookmark-name" title="${this.escapeHtml(bookmark.url || '')}">${this.escapeHtml(bookmark.title || '未命名书签')}</span>
        </div>
      `;

      const checkbox = div.querySelector('.bookmark-checkbox');
      
      // 设置初始选中状态
      if (this.selectedBookmarks.has(bookmark.id)) {
        checkbox.checked = true;
      }

      // 书签选择
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.selectedBookmarks.add(bookmark.id);
        } else {
          this.selectedBookmarks.delete(bookmark.id);
        }
        this.updateSendButton();
        this.saveConfig();
      });
    }

    return div;
  }

  handleFolderSelection(folder, isSelected) {
    if (isSelected) {
      this.selectedBookmarks.add(folder.id);
      // 选中所有子项
      this.selectAllChildren(folder);
    } else {
      this.selectedBookmarks.delete(folder.id);
      // 取消选中所有子项
      this.deselectAllChildren(folder);
    }
    
    this.updateSendButton();
    this.saveConfig();
  }

  selectAllChildren(folder) {
    if (folder.children) {
      folder.children.forEach(child => {
        this.selectedBookmarks.add(child.id);
        if (child.children) {
          this.selectAllChildren(child);
        }
      });
    }
  }

  deselectAllChildren(folder) {
    if (folder.children) {
      folder.children.forEach(child => {
        this.selectedBookmarks.delete(child.id);
        if (child.children) {
          this.deselectAllChildren(child);
        }
      });
    }
  }

  bindEvents() {
    const apiUrlInput = document.getElementById('apiUrl');
    const apiPasswordInput = document.getElementById('apiPassword');
    const sendBtn = document.getElementById('sendBtn');

    apiUrlInput.addEventListener('input', (e) => {
      this.apiUrl = e.target.value.trim();
      this.updateSendButton();
      this.saveConfig();
    });
    
    if (apiPasswordInput) {
      apiPasswordInput.addEventListener('input', (e) => {
        this.apiPassword = e.target.value.trim();
        this.saveConfig();
      });
    }

    sendBtn.addEventListener('click', () => {
      this.sendBookmarks();
    });
  }

  updateSendButton() {
    const sendBtn = document.getElementById('sendBtn');
    const hasUrl = this.apiUrl && this.isValidUrl(this.apiUrl);
    const hasSelection = this.selectedBookmarks.size > 0;
    
    sendBtn.disabled = !hasUrl || !hasSelection;
  }

  isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  async sendBookmarks() {
    if (!this.apiUrl || this.selectedBookmarks.size === 0) {
      this.showToast('请输入API URL并选择书签', 'error');
      return;
    }

    const sendBtn = document.getElementById('sendBtn');
    const btnText = sendBtn.querySelector('.btn-text');
    const spinner = sendBtn.querySelector('.loading-spinner');

    // 显示加载状态
    sendBtn.disabled = true;
    btnText.textContent = '发送中...';
    spinner.style.display = 'block';

    try {
      const bookmarksJson = await this.buildBookmarksJson();
      
      // 准备要发送的数据
      const data = {
        bookmarks: bookmarksJson,
        timestamp: new Date().toISOString(),
        count: bookmarksJson.length
      };
      
      // 构建URL，如果有密码则添加password参数
      let requestUrl = this.apiUrl;
      if (this.apiPassword) {
        // 检查URL是否已经包含查询参数
        const separator = this.apiUrl.includes('?') ? '&' : '?';
        requestUrl = `${this.apiUrl}${separator}password=${encodeURIComponent(this.apiPassword)}`;
      }
      
      // 通过后台脚本发送请求
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            action: 'sendBookmarks',
            url: requestUrl,
            data: data
          },
          response => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            
            if (response && response.success) {
              resolve(response);
            } else {
              reject(new Error(response?.error || '未知错误'));
            }
          }
        );
      });

      this.showToast('数据发送成功！', 'success');
      console.log('发送成功:', response);
      
    } catch (error) {
      console.error('发送失败:', error);
      this.showToast(`发送失败: ${error.message}`, 'error');
    } finally {
      // 恢复按钮状态
      sendBtn.disabled = false;
      btnText.textContent = '发送数据';
      spinner.style.display = 'none';
      this.updateSendButton();
    }
  }

  async buildBookmarksJson() {
    const result = [];
    
    for (const bookmarkId of this.selectedBookmarks) {
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

  showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
  new BookmarkSyncer();
});