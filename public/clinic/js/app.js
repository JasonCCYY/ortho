const WEEKDAY = ['日','一','二','三','四','五','六'];

let apptsLoaded  = false;
let appts2Loaded = false;
let currentTab   = 'appts';

const APP = {
  onAuthSuccess() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('main-app').style.display   = 'flex';
    switchTab('appts');
  },
};

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('pg-' + tab).classList.add('active');
  if (tab === 'appts'  && !apptsLoaded)  loadAppointments();
  if (tab === 'appts2' && !appts2Loaded) loadAppointments2();
}

function refreshCurrent() {
  if (currentTab === 'appts')  { apptsLoaded  = false; loadAppointments();  }
  else                          { appts2Loaded = false; loadAppointments2(); }
  showToast('更新中...');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ── 蔣元鈞 ──
async function loadAppointments() {
  apptsLoaded = true;
  const tbody = document.getElementById('appt-body');
  tbody.innerHTML = '<tr><td colspan="4" class="loading"><div class="spinner" style="margin:0 auto 8px"></div>爬取掛號系統...</td></tr>';
  document.getElementById('appt-note').style.display = 'none';
  try {
    const res = await fetch('/api/clinic');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'error');
    const rows = data.results;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--muted)">近兩週無排班資料</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td style="white-space:nowrap">${r.date}</td>
        <td><span class="session-tag ${r.cls}">${r.session}</span></td>
        <td style="color:var(--txt2);font-size:.82rem">${r.room}</td>
        <td class="appt-num ${r.numCls}">${r.num}</td>
      </tr>`).join('');
    document.getElementById('appt-note').style.display = 'block';
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--red)">⚠️ ${e.message}</td></tr>`;
  }
}

// ── 蘇皇儒 & 程俊傑 ──
async function loadAppointments2() {
  appts2Loaded = true;
  const tbody = document.getElementById('appt2-body');
  tbody.innerHTML = '<tr><td colspan="5" class="loading"><div class="spinner" style="margin:0 auto 8px"></div>爬取掛號系統...</td></tr>';
  document.getElementById('appt2-note').style.display = 'none';
  try {
    const res = await fetch('/api/clinic2');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'error');
    const rows = data.results;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--muted)">近兩週無排班資料</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td style="white-space:nowrap">${r.date}</td>
        <td style="font-size:.82rem;color:var(--txt)">${r.doctor}</td>
        <td><span class="session-tag ${r.cls}">${r.session}</span></td>
        <td style="color:var(--txt2);font-size:.82rem">${r.room}</td>
        <td class="appt-num ${r.numCls}">${r.num}</td>
      </tr>`).join('');
    document.getElementById('appt2-note').style.display = 'block';
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--red)">⚠️ ${e.message}</td></tr>`;
  }
}

window.addEventListener('load', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  await AUTH.init();
  if (!AUTH.ok) {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('main-app').style.display   = 'none';
  }
});
