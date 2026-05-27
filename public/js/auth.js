// ── Google OAuth（與原 ortho app 相同架構）──
const AUTH = {
  CLIENT_ID: '819164879021-10qcb700t7vpt5l1qhff7id63pkfve9e.apps.googleusercontent.com',
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.profile',
  tokenClient: null,
  accessToken: null,
  userInfo: null,
  _refreshing: false,
  _lastExpired: 0,

  async init() {
    return new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = () => {
        this.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: this.CLIENT_ID,
          scope: this.SCOPES,
          callback: async resp => {
            if (resp.error) { console.error(resp); return; }
            const isFirst = !this.accessToken;
            this.accessToken = resp.access_token;
            this._save(resp);
            this._scheduleRefresh(resp.expires_in * 1000);
            if (isFirst) {
              await this._fetchUserInfo();
              APP.onAuthSuccess();
            } else {
              APP.refresh();
            }
            this._refreshing = false;
          }
        });
        this._bindVisibility();
        const saved = this._load();
        if (saved) {
          this.accessToken = saved.token;
          this.userInfo = saved.user;
          const d = JSON.parse(localStorage.getItem('ortho_clinic_tok') || 'null');
          if (d) this._scheduleRefresh(d.exp - Date.now());
          APP.onAuthSuccess();
        }
        resolve();
      };
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  },

  async _fetchUserInfo() {
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: 'Bearer ' + this.accessToken }
      });
      this.userInfo = await r.json();
      const d = JSON.parse(localStorage.getItem('ortho_clinic_tok') || 'null');
      if (d) { d.user = this.userInfo; localStorage.setItem('ortho_clinic_tok', JSON.stringify(d)); }
    } catch(e) {}
  },

  _scheduleRefresh(ms) {
    const delay = Math.max(ms - 5 * 60 * 1000, 10000);
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this.tokenClient?.requestAccessToken({ prompt: '' });
    }, delay);
  },

  handleExpired() {
    const now = Date.now();
    if (this._refreshing || now - this._lastExpired < 15000) return;
    this._refreshing = true;
    this._lastExpired = now;
    this.accessToken = null;
    localStorage.removeItem('ortho_clinic_tok');
    this.tokenClient?.requestAccessToken({ prompt: '' });
  },

  signIn() { this.tokenClient?.requestAccessToken({ prompt: 'select_account' }); },

  signOut() {
    if (this.accessToken) google.accounts.oauth2.revoke(this.accessToken);
    this.accessToken = null;
    this.userInfo = null;
    localStorage.removeItem('ortho_clinic_tok');
    location.reload();
  },

  _bindVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || this._refreshing) return;
      if (this.accessToken) {
        const d = JSON.parse(localStorage.getItem('ortho_clinic_tok') || 'null');
        if (d && d.exp - Date.now() < 5 * 60 * 1000) {
          this.tokenClient?.requestAccessToken({ prompt: '' });
        }
      } else {
        this.tokenClient?.requestAccessToken({ prompt: '' });
      }
    });
  },

  _save(resp) {
    const d = { token: resp.access_token, exp: Date.now() + resp.expires_in * 1000, user: this.userInfo, sv: 2 };
    localStorage.setItem('ortho_clinic_tok', JSON.stringify(d));
  },

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem('ortho_clinic_tok') || 'null');
      // sv:2 = has spreadsheets scope; force re-login if old token
      if (!d || Date.now() > d.exp - 60000 || d.sv !== 2) { localStorage.removeItem('ortho_clinic_tok'); return null; }
      return d;
    } catch { return null; }
  },

  get ok() { return !!this.accessToken; }
};
