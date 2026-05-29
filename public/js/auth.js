// ── Auth：Authorization Code Flow + httpOnly Refresh Token ──
const AUTH = {
  accessToken: null,
  userInfo:    null,
  _expAt:      0,
  _timer:      null,
  _refreshing: null,   // Promise | null，防止並發

  async init() {
    // 1. 處理 auth_error
    const url = new URL(location.href);
    if (url.searchParams.get('auth_error')) {
      console.warn('[AUTH] auth_error:', url.searchParams.get('auth_error'));
      url.searchParams.delete('auth_error');
      history.replaceState({}, '', url.pathname);
    }

    // 2. 從 localStorage 恢復（頁面重整，token 未過期）
    const saved = this._loadLocal();
    if (saved) {
      this.accessToken = saved.token;
      this.userInfo    = saved.user;
      this._expAt      = saved.exp;
      console.log('[AUTH] restored from localStorage, exp in', Math.round((saved.exp - Date.now()) / 1000), 's');
      this._scheduleRefresh(saved.exp - Date.now());
    }

    // 3. 沒有有效 token → 後端 refresh
    if (!this.accessToken) {
      console.log('[AUTH] no local token, trying backend refresh...');
      const ok = await this._doRefresh();
      console.log('[AUTH] backend refresh result:', ok, '| accessToken:', !!this.accessToken);
    }

    // 4. 綁定 visibility change
    this._bindVisibility();

    console.log('[AUTH] init done, ok:', this.ok);
  },

  async signIn() {
    const r = await fetch('/api/auth/url');
    const { url } = await r.json();
    location.href = url;
  },

  async signOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    this.accessToken = null;
    this.userInfo    = null;
    localStorage.removeItem('ortho_tok_v3');
    clearTimeout(this._timer);
    location.reload();
  },

  // 用 Promise 去重，防止並發呼叫
  _doRefresh() {
    if (this._refreshing) return this._refreshing;
    this._refreshing = this._execRefresh().finally(() => {
      this._refreshing = null;
    });
    return this._refreshing;
  },

  async _execRefresh() {
    try {
      const needUser = !this.userInfo;
      const url = '/api/auth/refresh' + (needUser ? '?with_user=1' : '');
      console.log('[AUTH] calling', url);
      const r = await fetch(url, { method: 'POST' });
      console.log('[AUTH] refresh status:', r.status);
      if (!r.ok) return false;
      const d = await r.json();
      if (!d.ok) { console.warn('[AUTH] refresh not ok:', d.error); return false; }

      this.accessToken = d.access_token;
      this._expAt      = Date.now() + d.expires_in * 1000;
      if (d.user) this.userInfo = d.user;
      this._saveLocal();
      this._scheduleRefresh(d.expires_in * 1000);
      console.log('[AUTH] refresh success, expires_in:', d.expires_in);
      return true;
    } catch(e) {
      console.error('[AUTH] refresh error:', e);
      return false;
    }
  },

  _scheduleRefresh(ms) {
    clearTimeout(this._timer);
    const delay = Math.max(ms - 5 * 60 * 1000, 30 * 1000);
    console.log('[AUTH] next refresh in', Math.round(delay / 1000), 's');
    this._timer = setTimeout(async () => {
      const ok = await this._doRefresh();
      if (ok && typeof APP !== 'undefined' && APP.refresh) APP.refresh();
    }, delay);
  },

  async handleExpired() {
    console.warn('[AUTH] handleExpired called');
    const ok = await this._doRefresh();
    if (!ok) {
      localStorage.removeItem('ortho_tok_v3');
      location.reload();
    }
  },

  _bindVisibility() {
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible') return;
      if (!this.accessToken || this._expAt - Date.now() < 5 * 60 * 1000) {
        console.log('[AUTH] visibility: refreshing token');
        await this._doRefresh();
      }
    });
  },

  _saveLocal() {
    localStorage.setItem('ortho_tok_v3', JSON.stringify({
      token: this.accessToken,
      exp:   this._expAt,
      user:  this.userInfo,
    }));
  },

  _loadLocal() {
    try {
      const d = JSON.parse(localStorage.getItem('ortho_tok_v3') || 'null');
      if (!d || Date.now() > d.exp - 60000) {
        localStorage.removeItem('ortho_tok_v3');
        return null;
      }
      return d;
    } catch { return null; }
  },

  get ok() { return !!this.accessToken; },
};
