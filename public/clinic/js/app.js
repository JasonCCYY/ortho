const APP = {
  onAuthSuccess() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'flex';
    this.loadAll();
  },

  refresh() {
    this.loadAll();
    APP_TOAST('更新中...');
  },

  async loadAll() {
    this.loadAppts();
    this.loadAppts2();
  },

  async loadAppts() {
    const el = document.getElementById('appt-body');
    el.innerHTML = `<div class="list-row" style="justify-content:center"><div class="spinner" style="margin:0 8px 0 0"></div><span style="color:var(--muted);font-size:.9rem">爬取掛號系統...</span></div>`;
    document.getElementById('appt-note').style.display = 'none';
    try {
      const res = await fetch('/api/appointments');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'error');
      const rows = data.results;
      if (!rows.length) {
        el.innerHTML = `<div class="list-row"><span style="color:var(--muted);font-size:.9rem">近兩週無排班資料</span></div>`;
        return;
      }
      el.innerHTML = rows.map(r => `
        <div class="list-row" style="gap:0;padding:11px 16px">
          <span style="width:96px;font-size:.9rem;color:var(--txt);white-space:nowrap;flex-shrink:0">${r.date}</span>
          <span style="width:52px;flex-shrink:0"><span class="s-tag s-tag-${r.cls}">${r.session}</span></span>
          <span style="flex:1;font-size:.85rem;color:var(--txt2)">${r.room}</span>
          <span style="width:52px;text-align:right;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;font-weight:700;font-size:1rem" class="${r.numCls === 'hi' ? 'num-hi' : r.numCls === 'mid' ? 'num-mid' : 'num-lo'}">${r.num}</span>
        </div>`).join('');
      document.getElementById('appt-note').style.display = 'block';
    } catch(e) {
      el.innerHTML = `<div class="list-row"><span style="color:#dc2626;font-size:.9rem">⚠️ ${e.message}</span></div>`;
    }
  },

  async loadAppts2() {
    const el = document.getElementById('appt2-body');
    el.innerHTML = `<div class="list-row" style="justify-content:center"><div class="spinner" style="margin:0 8px 0 0"></div><span style="color:var(--muted);font-size:.9rem">爬取掛號系統...</span></div>`;
    document.getElementById('appt2-note').style.display = 'none';
    try {
      const res = await fetch('/api/appointments/doctor2');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'error');
      const rows = data.results;
      if (!rows.length) {
        el.innerHTML = `<div class="list-row"><span style="color:var(--muted);font-size:.9rem">近兩週無排班資料</span></div>`;
        return;
      }
      el.innerHTML = rows.map(r => `
        <div class="list-row" style="gap:0;padding:11px 16px">
          <span style="width:96px;font-size:.9rem;color:var(--txt);white-space:nowrap;flex-shrink:0">${r.date}</span>
          <span style="width:52px;font-size:.82rem;color:var(--txt2);flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.doctor}</span>
          <span style="width:52px;flex-shrink:0"><span class="s-tag s-tag-${r.cls}">${r.session}</span></span>
          <span style="flex:1;font-size:.85rem;color:var(--txt2)">${r.room}</span>
          <span style="width:52px;text-align:right;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;font-weight:700;font-size:1rem" class="${r.numCls === 'hi' ? 'num-hi' : r.numCls === 'mid' ? 'num-mid' : 'num-lo'}">${r.num}</span>
        </div>`).join('');
      document.getElementById('appt2-note').style.display = 'block';
    } catch(e) {
      el.innerHTML = `<div class="list-row"><span style="color:#dc2626;font-size:.9rem">⚠️ ${e.message}</span></div>`;
    }
  },
};

function APP_TOAST(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

window.addEventListener('load', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(e => console.warn('[SW] register failed:', e));
  }
  await AUTH.init();
  if (!AUTH.ok) {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('main-app').style.display   = 'none';
  } else {
    APP.onAuthSuccess();
  }
});
