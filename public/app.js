class LincatApp {
  constructor() {
    this.currentView = 'search';
    this.categories = [];
    this.searchResults = [];
    this.currentLinkId = null;
    this.currentCategoryId = null;
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadCategories();
  }

  bindEvents() {
    document.getElementById('categorize-btn').addEventListener('click', () => this.categorizeContent());
    document.getElementById('view-categories-btn').addEventListener('click', () => this.showCategoriesView());
    document.getElementById('back-to-home').addEventListener('click', () => this.showSearchView());
    document.getElementById('add-first-link').addEventListener('click', () => this.showSearchView());
    document.getElementById('view-result-btn').addEventListener('click', () => this.showCategoriesView());
    
    document.getElementById('search-toggle').addEventListener('click', () => this.toggleSearch());
    document.getElementById('search-categories-input').addEventListener('input', (e) => this.searchContent(e.target.value));
    
    document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('modal-backdrop').addEventListener('click', () => this.closeModal());
    document.getElementById('delete-link-btn').addEventListener('click', () => this.confirmDeleteLink());
    
    document.getElementById('confirm-cancel').addEventListener('click', () => this.closeConfirmModal());
    document.getElementById('confirm-modal-backdrop').addEventListener('click', () => this.closeConfirmModal());
    document.getElementById('confirm-delete').addEventListener('click', () => this.executeDelete());
    
    document.getElementById('search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.categorizeContent();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
      }
    });
  }

  async categorizeContent() {
    const input = document.getElementById('search-input').value.trim();
    if (!input) return;

    const btn = document.getElementById('categorize-btn');
    const btnText = btn.querySelector('.categorize-text');
    const spinner = btn.querySelector('.loading-spinner');

    btn.disabled = true;
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await fetch('/api/categorize', {
        method: 'POST',
        headers,
        body: JSON.stringify({ input }),
      });

      const result = await response.json();
      
      if (result.success) {
        document.getElementById('search-input').value = '';
        this.showSuccessMessage();
        await this.loadCategories();
      } else {
        this.showError('Failed to categorize content');
      }
    } catch (error) {
      console.error('Error:', error);
      this.showError('Network error occurred');
    } finally {
      btn.disabled = false;
      btnText.classList.remove('hidden');
      spinner.classList.add('hidden');
    }
  }

  async loadCategories() {
    try {
      const headers = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await fetch('/api/categories', {
        headers
      });
      
      this.categories = await response.json();
      this.renderCategories();
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  }

  async searchContent(query) {
    if (!query.trim()) {
      this.renderCategories();
      return;
    }

    try {
      const headers = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        headers
      });
      this.searchResults = await response.json();
      this.renderSearchResults();
    } catch (error) {
      console.error('Error searching:', error);
    }
  }

  renderCategories() {
    const container = document.getElementById('categories-container');
    const emptyState = document.getElementById('empty-state');

    if (this.categories.length === 0) {
      container.classList.add('hidden');
      emptyState.classList.remove('hidden');
      return;
    }

    container.classList.remove('hidden');
    emptyState.classList.add('hidden');

    container.innerHTML = this.categories.map(category => `
      <div class="glass-effect rounded-3xl p-10 card-hover group min-h-[400px] w-full">
        <div class="flex items-start justify-between mb-8">
          <div class="flex-1">
            <h3 class="text-2xl font-bold text-slate-900 mb-3">${category.name}</h3>
            <div class="flex items-center space-x-3">
              <span class="text-sm text-slate-600 bg-slate-200/60 px-4 py-2 rounded-full font-medium whitespace-nowrap">
                ${category.link_count} item${category.link_count !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <button onclick="app.confirmDeleteCategory('${category.id}', '${category.name}')" 
                  class="text-red-400 hover:text-red-600 transition-all duration-200 p-2 opacity-0 group-hover:opacity-100 scale-90 hover:scale-100 rounded-full hover:bg-red-50"
                  title="Delete category and all its links">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </button>
        </div>
        <div class="space-y-4 max-h-72 overflow-y-auto pr-2">
          ${category.links.map(link => `
            <div class="bg-white/80 rounded-2xl p-6 cursor-pointer hover:bg-white/95 transition-all duration-300 border border-white/50 shadow-sm hover:shadow-xl hover:scale-[1.01] group min-h-[100px] flex flex-col justify-between"
                 onclick="app.openModal('${link.id}')">
              <div class="flex items-start justify-between mb-3">
                <h4 class="font-semibold text-slate-900 flex-1 text-lg leading-tight pr-3">
                  ${link.title || 'Untitled'}
                </h4>
                ${link.url ? `
                  <span class="text-xs text-indigo-600 bg-indigo-100/80 px-3 py-1.5 rounded-full font-medium whitespace-nowrap">
                    🔗 Link
                  </span>
                ` : `
                  <span class="text-xs text-emerald-600 bg-emerald-100/80 px-3 py-1.5 rounded-full font-medium whitespace-nowrap">
                    📝 Note
                  </span>
                `}
              </div>
              <p class="text-sm text-slate-600 leading-relaxed line-clamp-3">
                ${link.ai_description || link.description || ''}
              </p>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  renderSearchResults() {
    const container = document.getElementById('categories-container');
    
    if (this.searchResults.length === 0) {
      container.innerHTML = `
        <div class="col-span-full text-center py-20">
          <div class="max-w-md mx-auto">
            <div class="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg class="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
              </svg>
            </div>
            <h3 class="text-xl font-semibold text-slate-900 mb-2">No results found</h3>
            <p class="text-slate-600">Try different keywords or browse all categories.</p>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="col-span-full mb-6">
        <h2 class="text-2xl font-bold text-slate-900 mb-2">Search Results</h2>
        <p class="text-slate-600">${this.searchResults.length} item${this.searchResults.length !== 1 ? 's' : ''} found</p>
      </div>
      ${this.searchResults.map(link => `
        <div class="glass-effect rounded-3xl p-8 card-hover cursor-pointer min-h-[200px] flex flex-col justify-between"
             onclick="app.openModal('${link.id}')">
          <div>
            <div class="flex items-center justify-between mb-4">
              <span class="text-sm text-indigo-600 bg-indigo-100/80 px-4 py-2 rounded-full font-medium">
                ${link.category_name}
              </span>
              <span class="text-xs text-slate-500 font-medium">
                ${new Date(link.created_at).toLocaleDateString()}
              </span>
            </div>
            <h3 class="text-xl font-bold text-slate-900 mb-3 leading-tight">
              ${link.title || 'Untitled'}
            </h3>
            <p class="text-slate-600 text-sm mb-4 line-clamp-3 leading-relaxed">
              ${link.ai_description || link.description || ''}
            </p>
          </div>
          ${link.url ? `
            <div class="flex items-center text-indigo-600 text-sm font-medium">
              <span class="text-xs text-indigo-600 bg-indigo-100/80 px-3 py-1.5 rounded-full">
                🔗 Link
              </span>
            </div>
          ` : `
            <div class="flex items-center text-emerald-600 text-sm font-medium">
              <span class="text-xs text-emerald-600 bg-emerald-100/80 px-3 py-1.5 rounded-full">
                📝 Note
              </span>
            </div>
          `}
        </div>
      `).join('')}
    `;
  }

  openModal(linkId) {
    const link = this.findLinkById(linkId);
    if (!link) return;

    this.currentLinkId = linkId;
    this.currentCategoryId = link.category_id;

    document.getElementById('modal-title').textContent = link.title || 'Untitled';
    document.getElementById('modal-category').textContent = link.category_name || this.getCategoryName(link.category_id);
    document.getElementById('modal-date').textContent = new Date(link.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    document.getElementById('modal-ai-description').textContent = link.ai_description || 'No description available';
    document.getElementById('modal-original-content').textContent = link.original_input;

    if (link.url) {
      document.getElementById('modal-url-section').classList.remove('hidden');
      document.getElementById('modal-url').href = link.url;
      document.getElementById('modal-url').textContent = link.url;
    } else {
      document.getElementById('modal-url-section').classList.add('hidden');
    }

    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('modal').classList.add('flex');
  }

  closeModal() {
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('modal').classList.remove('flex');
  }

  findLinkById(linkId) {
    if (this.searchResults.length > 0) {
      return this.searchResults.find(link => link.id === linkId);
    }
    
    for (const category of this.categories) {
      const link = category.links.find(link => link.id === linkId);
      if (link) {
        return { ...link, category_name: category.name };
      }
    }
    return null;
  }

  getCategoryName(categoryId) {
    const category = this.categories.find(cat => cat.id === categoryId);
    return category ? category.name : 'Unknown';
  }

  showSearchView() {
    this.currentView = 'search';
    document.getElementById('search-view').classList.remove('hidden');
    document.getElementById('categories-view').classList.add('hidden');
    document.getElementById('success-message').classList.add('hidden');
  }

  showCategoriesView() {
    this.currentView = 'categories';
    document.getElementById('search-view').classList.add('hidden');
    document.getElementById('categories-view').classList.remove('hidden');
    this.loadCategories();
  }

  showSuccessMessage() {
    document.getElementById('success-message').classList.remove('hidden');
    setTimeout(() => {
      document.getElementById('success-message').classList.add('hidden');
    }, 3000);
  }

  toggleSearch() {
    const searchBar = document.getElementById('search-bar-collapsed');
    const isHidden = searchBar.classList.contains('hidden');
    
    if (isHidden) {
      searchBar.classList.remove('hidden');
      document.getElementById('search-categories-input').focus();
    } else {
      searchBar.classList.add('hidden');
      document.getElementById('search-categories-input').value = '';
      this.renderCategories();
    }
  }

  showError(message) {
    alert(message);
  }

  confirmDeleteCategory(categoryId, categoryName) {
    this.currentCategoryId = categoryId;
    this.deleteType = 'category';
    
    const category = this.categories.find(cat => cat.id === categoryId);
    const linkCount = category ? category.link_count : 0;
    
    document.getElementById('confirm-message').textContent = 
      `This will permanently delete the "${categoryName}" category and all ${linkCount} item${linkCount !== 1 ? 's' : ''} inside it.`;
    
    this.showConfirmModal();
  }

  confirmDeleteLink() {
    if (!this.currentLinkId) return;
    
    this.deleteType = 'link';
    const link = this.findLinkById(this.currentLinkId);
    const title = link?.title || 'this item';
    
    document.getElementById('confirm-message').textContent = 
      `This will permanently delete "${title}".`;
    
    this.showConfirmModal();
  }

  showConfirmModal() {
    document.getElementById('confirm-modal').classList.remove('hidden');
    document.getElementById('confirm-modal').classList.add('flex');
  }

  closeConfirmModal() {
    document.getElementById('confirm-modal').classList.add('hidden');
    document.getElementById('confirm-modal').classList.remove('flex');
  }

  async executeDelete() {
    try {
      if (this.deleteType === 'category') {
        await this.deleteCategory();
      } else if (this.deleteType === 'link') {
        await this.deleteLink();
      }
    } catch (error) {
      console.error('Delete failed:', error);
      this.showError('Failed to delete. Please try again.');
    }
  }

  async deleteCategory() {
    const headers = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const response = await fetch(`/api/categories/${this.currentCategoryId}`, {
      method: 'DELETE',
      headers
    });

    if (response.ok) {
      this.closeConfirmModal();
      await this.loadCategories();
      this.showSuccess('Category and all its links deleted successfully');
    } else {
      throw new Error('Failed to delete category');
    }
  }

  async deleteLink() {
    const headers = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const response = await fetch(`/api/links/${this.currentLinkId}`, {
      method: 'DELETE',
      headers
    });

    if (response.ok) {
      this.closeConfirmModal();
      this.closeModal();
      await this.loadCategories();
      this.showSuccess('Link deleted successfully');
    } else {
      throw new Error('Failed to delete link');
    }
  }

  showSuccess(message) {
    // Create a temporary success notification
    const notification = document.createElement('div');
    notification.className = 'fixed top-4 right-4 z-50 glass-effect rounded-xl p-4 text-green-800 animate-slide-up';
    notification.innerHTML = `
      <div class="flex items-center space-x-2">
        <svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
        </svg>
        <span>${message}</span>
      </div>
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }
}

const app = new LincatApp();