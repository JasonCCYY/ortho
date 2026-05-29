// ── Auth：Authorization Code Flow + httpOnly Refresh Token ──
const AUTH = {
  accessToken: null,
  userInfo:    null,
  _expAt:      0,
  _timer:      null,
  _refreshing: false,

  async init() {
    // 1. 處理 auth_error（Google 拒絕授權等）
    const url = new URL(location.href);
    if (url.searchParams.get('auth_error')) {
      url.searchParams.delete('auth_error');
      history.replaceState({}, '', url.pathname);
    }

    // 2. 嘗試從 localStorage 恢復（頁面重整，token 還沒過期）
    const saved = this._loadLocal();
    if (saved) {
      this.accessToken = saved.token;
      this.userInfo    = saved.user;
      this._expAt      = saved.exp;
      this._scheduleRefresh(saved.exp - Date.now());
    }

    // 3. 沒有有效 access_token → 呼叫後端 refresh（有 httpOnly cookie 就能換）
    if (!this.accessToken) {
      await this._doRefresh();
    }

    // 4. 綁定背景切回前景自動 refresh
    this._bindVisibility();
  },

  // 登入 → 導向 Google 授權頁
  async signIn() {
    const r = await fetch('/api/auth/url');
    const { url } = await r.json();
    location.href = url;
  },

  // 登出
  async signOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    this.accessToken = null;
    this.userInfo    = null;
    localStorage.removeItem('ortho_tok_v3');
    clearTimeout(this._timer);
    location.reload();
  },

  // 後端換新 access_token
  async _doRefresh() {
    if (this._refreshing) return false;
    this._refreshing = true;
    try {
      const r = await fetch('/api/auth/refresh', { method: 'POST' });
      if (!r.ok) return false;
      const d = await r.json();
      if (!d.ok) return false;

      this.accessToken = d.access_token;
      this._expAt      = Date.now() + d.expires_in * 1000;
      if (d.user) this.userInfo = d.user;  // 首次 refresh 才有 user
      this._saveLocal();
      this._scheduleRefresh(d.expires_in * 1000);
      return true;
    } catch(e) {
      return false;
    } finally {
      this._refreshing = false;
    }
  },

  _scheduleRefresh(ms) {
    clearTimeout(this._timer);
    const delay = Math.max(ms - 5 * 60 * 1000, 30 * 1000);
    this._timer = setTimeout(async () => {
      const ok = await this._doRefresh();
      if (ok && APP?.refresh) APP.refresh();
    }, delay);
  },

  // Sheets API 回傳 401/403 時呼叫
  async handleExpired() {
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
        await this._doRefresh();
      }
    });
  },

  // localStorage：只存短效 access_token（1小時）
  // refresh_token 永遠在 httpOnly cookie，JS 讀不到
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
