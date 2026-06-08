// ── Ortho Record App v3 ──
const APP = {
  tab: 'surgery',
  subMat: 'matRec',
  subSx: 'sxList',
  // material slide index: 0=matRec,1=selfPay,2=opCode,3=codeRec,4=estimate
  matSlideIdx: 0,
  MAT_SUBS: ['matRec','selfPay','opCode','codeRec','estimate'],
  _swipeStartX: 0, _swipeStartY: 0, _swiping: false,

  // ── Init ──
  async init() {
    console.log('[APP] init start');
    document.getElementById('loading').style.display = 'flex';
    try {
      await AUTH.init();
    } catch(e) {
      console.error('[APP] AUTH.init failed:', e);
    }
    console.log('[APP] AUTH done, ok:', AUTH.ok);
    try { this.bindTabs(); } catch(e) { console.error('[APP] bindTabs:', e); }
    try { this.bindSubTabs(); } catch(e) { console.error('[APP] bindSubTabs:', e); }
    try { this.bindMatSwipe(); } catch(e) { console.error('[APP] bindMatSwipe:', e); }
    try { this.bindTabSwipe(); } catch(e) { console.error('[APP] bindTabSwipe:', e); }
    try { this.bindModalSwipe(); } catch(e) { console.error('[APP] bindModalSwipe:', e); }
    document.getElementById('fab').addEventListener('click', () => this.fabClick());
    document.getElementById('loading').style.display = 'none';
    console.log('[APP] loading hidden, AUTH.ok:', AUTH.ok);
    if (!AUTH.ok) {
      console.log('[APP] showing auth screen');
      document.getElementById('auth-screen').style.display = 'flex';
      document.getElementById('app').style.display = 'none';
    } else {
      console.log('[APP] calling onAuthSuccess');
      try { this.onAuthSuccess(); } catch(e) { console.error('[APP] onAuthSuccess failed:', e); }
    }
    console.log('[APP] init complete');
  },


  onAuthSuccess() {
    console.log('[APP] onAuthSuccess start');
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    console.log('[APP] app display set to flex');
    try { SHEETS.loadCategories(); } catch(e) { console.error('[APP] loadCategories:', e); }
    try { this.switchTab('surgery', false); } catch(e) { console.error('[APP] switchTab:', e); }
    console.log('[APP] onAuthSuccess done');
    setTimeout(() => { if(AUTH.ok) SHEETS.loadTrackRecords().catch(()=>{}); }, 1500);
    setTimeout(() => { if(AUTH.ok) SHEETS.loadClinicRecords().catch(()=>{}); }, 2500);
    // After 3s, refresh current view from network
    setTimeout(() => { if(AUTH.ok && !AUTH._refreshing) this.refresh(); }, 3000);
  },

  // ── Helpers ──
  fmt(v) { return v ? Number(String(v).replace(/,/g,'')).toLocaleString() : ''; },
  fmtP(v) { const n = this.fmt(v); return n ? '$'+n : ''; },
  uid() { return Math.random().toString(36).substring(2,10); },
  nowMonth() { const n=new Date(); return `${n.getFullYear()}/${String(n.getMonth()+1).padStart(2,'0')}`; },
  today() { const n=new Date(); return `${n.getFullYear()}/${String(n.getMonth()+1).padStart(2,'0')}/${String(n.getDate()).padStart(2,'0')}`; },
  todayISO() { return new Date().toISOString().split('T')[0]; },

  loading() { return '<div class="load-msg">載入中...</div>'; },
  empty()   { return '<div class="empty-state"><div class="empty-icon">📋</div><div>尚無紀錄</div></div>'; },
  err(e)    { return `<div class="empty-state"><div class="empty-icon">⚠️</div><div>${e.message}</div></div>`; },

  dateNum(d) {
    const p = d.split('/');
    return p.length>=3 ? parseInt(p[0])*10000+parseInt(p[1])*100+parseInt(p[2]) : 0;
  },
  getMonth(d) {
    const p = d.split('/');
    return p.length>=2 ? p[0]+'/'+p[1].padStart(2,'0') : d.substring(0,7);
  },
  groupByMonth(recs) {
    const map = {};
    recs.forEach(r => { const m=this.getMonth(r.date); (map[m]=map[m]||[]).push(r); });
    return Object.entries(map).sort((a,b)=>b[0].localeCompare(a[0]));
  },
  sortBrands(a,b) {
    const eA=/^[A-Za-z0-9]/.test(a), eB=/^[A-Za-z0-9]/.test(b);
    if(eA&&!eB) return -1; if(!eA&&eB) return 1;
    return a.localeCompare(b,'zh-TW');
  },
  // Truncate text for display
  trunc(s, max) {
    if(!s) return '';
    return s.length > max ? s.substring(0, max) + '…' : s;
  },
  // ── Row store (avoids HTML encoding issues in onclick) ──
  _rowStore: [],
  _storeRow(r) { this._rowStore.push(r); return this._rowStore.length - 1; },
  _clearStore() { this._rowStore = []; },
  _getRow(i) { return this._rowStore[i]; },


  // ── Tab routing ──
  bindTabs() {
    document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => this.switchTab(b.dataset.tab)));
  },

  _TAB_IDX: {material:0, surgery:1, clinic:2},

  switchTab(tab, animate=true) {
    this.tab = tab;
    this._clearStore();
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab===tab));
    document.getElementById('sub-mat').style.display = tab==='material' ? 'flex' : 'none';
    document.getElementById('sub-sx').style.display  = tab==='surgery'  ? 'flex' : 'none';
    document.getElementById('fab').style.display = tab==='surgery' ? 'flex' : 'none';
    // hdr-add-btn removed from header
    // Slide animation
    const inner = document.getElementById('tab-swipe-inner');
    const idx = this._TAB_IDX[tab] ?? 1;
    if(inner) {
      if(!animate) inner.style.transition = 'none';
      inner.style.transform = `translateX(${-idx * 100/3}%)`;
      if(!animate) setTimeout(() => inner.style.transition = '', 0);
    }
    // Load content
    if(tab==='surgery')  this.switchSx(this.subSx);
    else if(tab==='material') this.switchMat(this.subMat);
    else if(tab==='clinic')   this.loadClinic();
  },

  bindSubTabs() {
    document.querySelectorAll('#sub-mat .sub-tab').forEach(b => b.addEventListener('click', ()=>this.switchMat(b.dataset.sub)));
    document.querySelectorAll('#sub-sx .sub-tab').forEach(b => b.addEventListener('click', ()=>this.switchSx(b.dataset.sub)));
  },

  switchMat(sub) {
    this.subMat = sub;
    this._clearStore();
    document.querySelectorAll('#sub-mat .sub-tab').forEach(b => b.classList.toggle('active', b.dataset.sub===sub));
    const idx = this.MAT_SUBS.indexOf(sub);
    if(idx >= 0) {
      this.matSlideIdx = idx;
      this._applySlide(idx);
    }
    document.getElementById('fab').style.display = 'none'; // FAB only for surgery
    // hdr-add-btn removed from header
    const loaders = { matRec:()=>this.loadMatRec(), selfPay:()=>this.loadSelfPay(), opCode:()=>this.loadOpCode(), codeRec:()=>this.loadCodeRec(), estimate:()=>this.loadEstimate() };
    loaders[sub]?.();
  },

  _applySlide(idx) {
    const inner = document.getElementById('mat-swipe-inner');
    if(inner) inner.style.transform = `translateX(${-idx * 20}%)`;
  },

  // ── Swipe gestures for material tabs ──
  bindMatSwipe() {
    const container = document.getElementById('mat-swipe-container');
    if(!container) return;
    let startX, startY, startIdx, dragging = false;

    container.addEventListener('touchstart', e => {
      if(e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startIdx = this.matSlideIdx;
      dragging = false;
    }, {passive: true});

    container.addEventListener('touchmove', e => {
      if(e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if(!dragging && Math.abs(dy) > Math.abs(dx) + 8) return; // vertical scroll
      if(!dragging && Math.abs(dx) > 8) dragging = true;
      if(!dragging) return;
      e.preventDefault();
      const pct = (dx / container.offsetWidth) * 100;
      const inner = document.getElementById('mat-swipe-inner');
      inner.style.transition = 'none';
      inner.style.transform = `translateX(${-startIdx * 20 + pct/5}%)`;
    }, {passive: false});

    container.addEventListener('touchend', e => {
      if(!dragging) return;
      const dx = e.changedTouches[0].clientX - startX;
      const inner = document.getElementById('mat-swipe-inner');
      inner.style.transition = '';
      if(Math.abs(dx) > 50) {
        const lastMatIdx = this.MAT_SUBS.length - 1;
        if(dx < 0) {
          // Left swipe (→ next)
          if(startIdx < lastMatIdx) {
            // Still within mat slides
            this.switchMat(this.MAT_SUBS[startIdx + 1]);
          } else {
            // At last sub-page: only switch big tab if edge swipe
            const EDGE = 30, sw = window.innerWidth;
            const isEdge = startX <= EDGE || startX >= sw - EDGE;
            if(isEdge) this.switchTab('surgery');
            else this._applySlide(startIdx);
          }
        } else {
          // Right swipe (→ prev)
          if(startIdx > 0) {
            // Still within mat slides
            this.switchMat(this.MAT_SUBS[startIdx - 1]);
          } else {
            // At first sub-page: only switch big tab if edge swipe
            const EDGE2 = 30, sw2 = window.innerWidth;
            const isEdge2 = startX <= EDGE2 || startX >= sw2 - EDGE2;
            if(isEdge2) this.switchTab('clinic');
            else this._applySlide(startIdx);
          }
        }
      } else {
        this._applySlide(startIdx);
      }
      dragging = false;
    }, {passive: true});
  },

  // ── Cross-tab swipe ──
  // surgery: edge-only (has horizontal scroll table)
  // clinic:  full-page swipe (no horizontal scroll)
  bindTabSwipe() {
    const TAB_ORDER = ['material', 'surgery', 'clinic'];
    const self = this;

    const makeSwipeHandler = (pgId, edgeOnly) => {
      const pg = document.getElementById(pgId);
      if(!pg) return;
      let startX = null, startY = 0, dragging = false;

      pg.addEventListener('touchstart', e => {
        if(e.touches.length !== 1) return;
        const x = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        dragging = false;
        if(edgeOnly) {
          const EDGE = 30;
          const sw = window.innerWidth;
          if(x > EDGE && x < sw - EDGE) { startX = null; return; }
        }
        startX = x;
      }, {passive: true});

      pg.addEventListener('touchmove', e => {
        if(e.touches.length !== 1 || startX === null) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        if(!dragging && Math.abs(dy) > Math.abs(dx) + 8) return;
        if(!dragging && Math.abs(dx) > 8) dragging = true;
        if(!dragging) return;
        const inner = document.getElementById('tab-swipe-inner');
        if(inner) {
          const curIdx = self._TAB_IDX[self.tab] ?? 1;
          const pct = (dx / pg.offsetWidth) * 100 / 3;
          inner.style.transition = 'none';
          inner.style.transform = `translateX(${-curIdx * 100/3 + pct}%)`;
        }
      }, {passive: true});

      pg.addEventListener('touchend', e => {
        if(!dragging || startX === null) return;
        const dx = e.changedTouches[0].clientX - startX;
        const inner = document.getElementById('tab-swipe-inner');
        if(inner) inner.style.transition = '';
        const curIdx = self._TAB_IDX[self.tab] ?? 1;
        if(Math.abs(dx) < 60) {
          if(inner) inner.style.transform = `translateX(${-curIdx * 100/3}%)`;
          dragging = false; return;
        }
        const curTab = self.tab;
        const TABS = ['material', 'surgery', 'clinic'];
        const ci = TABS.indexOf(curTab);
        if(dx < 0) {
          // Left swipe → next tab (circular)
          const nextTab = TABS[(ci + 1) % TABS.length];
          if(curTab === 'material') {
            self.switchTab('surgery');
          } else if(curTab === 'surgery') {
            self.switchTab('clinic');
          } else {
            // clinic → material (wrap)
            self.switchTab('material');
            setTimeout(() => self.switchMat('matRec'), 50);
          }
        } else {
          // Right swipe → prev tab (circular)
          if(curTab === 'material') {
            // material → clinic (wrap)
            self.switchTab('clinic');
          } else if(curTab === 'surgery') {
            self.switchTab('material');
            setTimeout(() => self.switchMat('estimate'), 50);
          } else {
            // clinic → surgery
            self.switchTab('surgery');
          }
        }
        dragging = false;
      }, {passive: true});
    };

    makeSwipeHandler('pg-surgery', true);  // edge-only: has horizontal scroll
    makeSwipeHandler('pg-clinic',  false); // full swipe: no horizontal scroll
  },





  // ── Swipe down to close any open modal ──
  bindModalSwipe() {
    // Only detail modal gets swipe-to-close
    document.querySelectorAll('.modal-sheet').forEach(sheet => {
      let startY = 0, dragging = false;
      const modal = sheet.closest('.modal-bd');
      if(!modal) return;
      const modalId = modal.id;
      if(modalId !== 'modal-detail') return; // only detail card

      // The scrollable content inside the sheet
      const scrollEl = sheet; // sheet itself is overflow-y:auto

      sheet.addEventListener('touchstart', e => {
        startY = e.touches[0].clientY;
        dragging = false;
      }, {passive: true});

      sheet.addEventListener('touchmove', e => {
        const dy = e.touches[0].clientY - startY;
        const scrollTop = sheet.scrollTop;
        // Only activate close-swipe when at top AND pulling down
        if(dy > 0 && scrollTop <= 2) {
          dragging = true;
          sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
          sheet.style.transition = 'none';
          // Don't prevent scroll since passive:true — sheet won't scroll further up
        }
        // If not at top: normal scroll, no close gesture
      }, {passive: true});

      sheet.addEventListener('touchend', e => {
        const dy = e.changedTouches[0].clientY - startY;
        sheet.style.transition = '';
        if(dragging && dy > 80) {
          sheet.style.transform = '';
          APP.closeModal(modalId);
        } else {
          sheet.style.transform = '';
        }
        dragging = false;
      }, {passive: true});
    });
  },

  switchSx(sub) {
    this.subSx = sub;
    this._clearStore();
    document.querySelectorAll('#sub-sx .sub-tab').forEach(b => b.classList.toggle('active', b.dataset.sub===sub));
    document.querySelectorAll('#pg-surgery .sub-page').forEach(p => p.style.display='none');
    document.getElementById(sub==='sxList'?'pg-sx-list':'pg-track').style.display = 'flex';
    document.getElementById('fab').style.display = 'flex';
    if(sub==='sxList') this.loadSurgery();
    else this.loadTrack();
  },

  fabClick() {
    if(this.tab==='surgery') {
      if(this.subSx==='sxList') {
        // 手術紀錄：顯示選單（掃描 or 手動）
        this.toggleFabMenu();
      } else {
        this.openModal('modal-track');
      }
    } else if(this.tab==='material') {
      if(this.subMat==='matRec') this.openModal('modal-mat');
      else if(this.subMat==='codeRec') this.openModal('modal-code');
    }
  },

  toggleFabMenu() {
    const menu = document.getElementById('fab-menu');
    const overlay = document.getElementById('fab-overlay');
    const isOpen = menu.style.display === 'block';
    menu.style.display = isOpen ? 'none' : 'block';
    overlay.style.display = isOpen ? 'none' : 'block';
  },

  closeFabMenu() {
    document.getElementById('fab-menu').style.display = 'none';
    document.getElementById('fab-overlay').style.display = 'none';
  },

  openManualInput() {
    this.openModal('modal-op');
  },

  openScan() {
    this.closeFabMenu();
    document.getElementById('scan-file-input').click();
  },

  async onScanFiles(input) {
    const files = Array.from(input.files);
    if(!files.length) return;
    input.value = ''; // reset

    // 顯示掃描 modal
    document.getElementById('scan-results').innerHTML = '';
    document.getElementById('scan-status').textContent = `處理中，請稍候...`;
    document.getElementById('modal-scan').classList.add('open');

    try {
      // 轉 base64，並壓縮至 1MB 以內
      const toBase64 = file => new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(url);
          const canvas = document.createElement('canvas');
          // 最大邊長 1600px
          const MAX = 1600;
          let w = img.width, h = img.height;
          if(w > MAX || h > MAX) {
            if(w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else { w = Math.round(w * MAX / h); h = MAX; }
          }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          // 壓縮品質 0.8
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = reject;
        img.src = url;
      });
      const images = await Promise.all(files.map(toBase64));
      console.log('[scan] images:', images.length, images.map(i => Math.round(i.length/1024)+'KB'));

      // 送後端解析
      const res = await fetch('/api/parse-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images }),
      });
      console.log('[scan] response status:', res.status);
      const data = await res.json();
      console.log('[scan] response data:', JSON.stringify(data).substring(0, 500));
      if(!data.ok) throw new Error(data.error || '解析失敗');

      const patients = data.patients;
      if(!patients.length) {
        document.getElementById('scan-status').textContent = '找不到黃色框資料，請確認圖片';
        return;
      }

      document.getElementById('scan-status').textContent = `找到 ${patients.length} 筆紀錄`;

      // 載入代碼表（用於比對批價碼）
      const opCodes = await SHEETS.loadOpCodes();
      // 只建立中正院區的代碼對照表
      const codeMap = {};
      opCodes.filter(c => c.area === '中正').forEach(c => {
        codeMap[String(c.code).trim()] = c;
      });

      // 渲染結果
      let html = '';
      patients.forEach((p, idx) => {
        // 找到對應的代碼資料
        const matchedCodes = (p.codes || []).map(code => {
          const found = codeMap[code];
          return found
            ? { code, name: found.name, price: found.price, area: found.area, type: found.type || '', found: true }
            : { code, name: '', price: '', area: '', type: '', found: false };
        });

        html += `<div class="scan-card" id="scan-card-${idx}">
          <div class="scan-card-hdr">
            <div>
              <span class="scan-name">${p.name || '（無姓名）'}</span>
              <span class="scan-mrn">${p.mrn ? ' · ' + p.mrn : ''}</span>
            </div>
            <span class="scan-date">${p.date}</span>
          </div>`;

        if(p.note) {
          html += `<div class="scan-note">備註：${p.note}</div>`;
        }

        if(matchedCodes.length) {
          html += `<div class="scan-codes">`;
          matchedCodes.forEach(c => {
            if(c.found) {
              html += `<div class="scan-code-row">
                <span class="scan-code-num">${c.code}</span>
                <span class="scan-code-name">${c.name}</span>
                <span class="scan-code-price">${c.price ? '$'+Number(String(c.price).replace(/,/g,'')).toLocaleString() : ''}</span>
              </div>`;
            } else {
              html += `<div class="scan-code-row scan-code-notfound">
                <span class="scan-code-num">${c.code}</span>
                <span class="scan-code-name" style="color:var(--muted)">（代碼表中找不到）</span>
              </div>`;
            }
          });
          html += `</div>`;
        }

        // 操作按鈕
        html += `<div class="scan-actions">
          <button class="scan-btn-save" onclick="APP.scanConfirm(${idx})">✓ 新增</button>
          <button class="scan-btn-edit" onclick="APP.scanEdit(${idx})">✏ 編輯</button>
          <button class="scan-btn-skip" onclick="APP.scanSkip(${idx})">略過</button>
        </div>
        </div>`;
      });

      document.getElementById('scan-results').innerHTML = html;

      // 儲存解析結果供後續操作
      this._scanPatients = patients.map(p => ({
        ...p,
        matchedCodes: (p.codes || []).map(code => {
          const found = codeMap[code];
          return found ? { code, name: found.name, price: found.price, area: found.area, type: found.type || '' } : null;
        }).filter(Boolean),
      }));

    } catch(e) {
      document.getElementById('scan-status').textContent = '❌ ' + e.message;
    }
  },

  async scanConfirm(idx) {
    const p = this._scanPatients?.[idx];
    if(!p) return;
    const card = document.getElementById(`scan-card-${idx}`);
    try {
      // 從代碼取類型（取第一個有 type 的代碼）
      const typeFromCode = (p.matchedCodes || []).map(c => c.type).find(t => t) || '';

      // 新增手術紀錄
      await SHEETS.addOp({
        date: p.date,
        area: '中正',
        mrn: p.mrn,
        clinicId: '',
        name: p.name,
        type: typeFromCode,
        opName: '',
        location: '',
        implant: '',
        note: p.note,
      });

      // 新增代碼紀錄（每個批價碼一筆）
      for(const c of (p.matchedCodes || [])) {
        await SHEETS.quickAddCode({ name: c.name, code: c.code, price: c.price, area: '中正' });
      }

      this.toast(`✅ ${p.name} 已新增`);
      card.style.opacity = '0.4';
      card.style.pointerEvents = 'none';
      card.querySelector('.scan-actions').innerHTML = '<span style="color:var(--green);font-size:.88rem">✓ 已新增</span>';
      this.loadSurgery();

    } catch(e) {
      this.toast('❌ ' + e.message);
    }
  },

  scanEdit(idx) {
    const p = this._scanPatients?.[idx];
    if(!p) return;
    this.closeModal('modal-scan');
    // 預填手術紀錄表單
    this.openModal('modal-op');
    setTimeout(() => {
      const dateISO = p.date.replace(/\//g, '-');
      document.getElementById('s-date').value = dateISO;
      document.getElementById('s-mrn').value = p.mrn || '';
      document.getElementById('s-name').value = p.name || '';
      document.getElementById('s-note').value = p.note || '';
      document.getElementById('s-area-val').value = '中正';
      document.querySelectorAll('#modal-op .chip.area').forEach(c => {
        c.classList.toggle('on', c.textContent.trim() === '中正');
      });
    }, 50);
  },

  scanSkip(idx) {
    const card = document.getElementById(`scan-card-${idx}`);
    if(card) {
      card.style.opacity = '0.3';
      card.style.pointerEvents = 'none';
      card.querySelector('.scan-actions').innerHTML = '<span style="color:var(--muted);font-size:.88rem">已略過</span>';
    }
  },

  // ── Search (Home Record style modal) ──
  openSearch() {
    document.getElementById('modal-search').classList.add('open');
    setTimeout(() => document.getElementById('search-input').focus(), 100);
    document.getElementById('search-results').innerHTML = '<div class="load-msg" style="color:var(--muted)">輸入關鍵字搜尋</div>';
    document.getElementById('search-input').value = '';
  },
  closeSearch() {
    document.getElementById('modal-search').classList.remove('open');
  },
  async doSearch(q) {
    const el = document.getElementById('search-results');
    q = q.trim();
    if(!q) { el.innerHTML = '<div class="load-msg" style="color:var(--muted)">輸入關鍵字搜尋</div>'; return; }
    el.innerHTML = '<div class="load-msg">搜尋中...</div>';
    try {
      const kw = q.toLowerCase();
      const results = [];
      // Search op records (surgery)
      const ops = await SHEETS.loadOpRecords();
      const opHits = ops.filter(r => [r.date,r.name,r.mrn,r.type,r.opName,r.location,r.implant,r.note].some(v=>String(v||'').toLowerCase().includes(kw))).slice(0,30);
      // Search mat records
      const mats = await SHEETS.loadMatRecords();
      const matHits = mats.filter(r => [r.brand,r.product,r.date].some(v=>String(v||'').toLowerCase().includes(kw))).slice(0,30);
      // Search code records
      const codes = await SHEETS.loadCodeRecords();
      const codeHits = codes.filter(r => [r.name,r.code,r.area,r.date].some(v=>String(v||'').toLowerCase().includes(kw))).slice(0,30);
      // Search clinic records
      const clinic = await SHEETS.loadClinicRecords();
      const clinicHits = clinic.filter(r => [r.product,r.date].some(v=>String(v||'').toLowerCase().includes(kw))).slice(0,30);
      // Search track records
      const tracks = await SHEETS.loadTrackRecords();
      const trackHits = tracks.filter(r => [r.name,r.mrn,r.type,r.opName,r.location,r.date,r.area].some(v=>String(v||'').toLowerCase().includes(kw))).slice(0,30);

      if(!opHits.length && !matHits.length && !codeHits.length && !clinicHits.length && !trackHits.length) {
        el.innerHTML = `<div class="load-msg">找不到「${q}」</div>`; return;
      }
      // Store search hits for click-to-detail
      this._clearStore();
      let html = '';
      if(opHits.length) {
        html += `<div class="list-month-hdr" style="top:0">手術紀錄（${opHits.length}筆）</div>`;
        opHits.forEach(r => {
          const _si = APP._storeRow(r);
          html += `<div class="list-row" onclick="APP._detailFromSearch=true;APP.openDetailS('sx',${_si})" style="cursor:pointer">
            <span class="dot-ph"></span>
            <span class="col-product">${r.name} <span style="color:var(--muted);font-size:.82rem">· ${r.opName||''}</span></span>
            <span class="col-price">${r.date.substring(5)||''}</span>
          </div>`;
        });
      }
      if(trackHits.length) {
        html += `<div class="list-month-hdr" style="top:0">追蹤（${trackHits.length}筆）</div>`;
        trackHits.forEach(r => {
          const _si = APP._storeRow(r);
          html += `<div class="list-row" onclick="APP._detailFromSearch=true;APP.openDetailS('track',${_si})" style="cursor:pointer">
            <span class="dot-ph"></span>
            <span class="col-product">${r.name} <span style="color:var(--muted);font-size:.82rem">· ${r.opName||''}</span></span>
            <span class="col-price" style="color:var(--txt2)">${r.date.substring(0,7)||''}</span>
          </div>`;
        });
      }
      if(matHits.length) {
        html += `<div class="list-month-hdr" style="top:0">醫材記錄（${matHits.length}筆）</div>`;
        matHits.forEach(r => {
          const _si = APP._storeRow(r);
          const p = parseFloat(String(r.price||0).replace(/,/g,''))||0;
          html += `<div class="list-row" onclick="APP._detailFromSearch=true;APP.openDetailS('mat',${_si})" style="cursor:pointer">
            <span class="col-brand">${r.brand}</span>
            <span class="col-product">${r.product}</span>
            <span class="col-price">${p?'$'+p.toLocaleString():''}</span>
          </div>`;
        });
      }
      if(codeHits.length) {
        html += `<div class="list-month-hdr" style="top:0">代碼紀錄（${codeHits.length}筆）</div>`;
        codeHits.forEach(r => {
          const _si = APP._storeRow(r);
          const p = parseFloat(String(r.price||0).replace(/,/g,''))||0;
          html += `<div class="list-row" onclick="APP._detailFromSearch=true;APP.openDetailS('coderec',${_si})" style="cursor:pointer">
            <span class="col-product">${r.name}</span>
            <span class="col-code">${r.code}</span>
            <span class="col-price">${p?'$'+p.toLocaleString():''}</span>
          </div>`;
        });
      }
      if(clinicHits.length) {
        html += `<div class="list-month-hdr" style="top:0">門診記錄（${clinicHits.length}筆）</div>`;
        clinicHits.forEach(r => {
          const _si = APP._storeRow(r);
          const p = parseFloat(String(r.price||0).replace(/,/g,''))||0;
          html += `<div class="list-row" onclick="APP._detailFromSearch=true;APP.openDetailS('clinic',${_si})" style="cursor:pointer">
            <span class="col-product">${r.product}</span>
            <span class="col-qty">${r.qty}</span>
            <span class="col-price">${p?'$'+p.toLocaleString():''}</span>
          </div>`;
        });
      }
      el.innerHTML = html;
    } catch(e) { el.innerHTML = '<div class="load-msg">搜尋失敗: '+e.message+'</div>'; }
  },

  // ── Refresh ──
  refresh() {
    const cacheMap = { sxList:'op', track:'track', matRec:'matRec', selfPay:'matProd', opCode:'opCode', codeRec:'codeRec', estimate:'estimate', clinic:'clinic' };
    const key = this.tab==='surgery' ? this.subSx : this.tab==='material' ? this.subMat : this.tab;
    const cacheKey = cacheMap[key];
    if(cacheKey) localStorage.removeItem('ortho_'+cacheKey);
    if(this.tab==='surgery') this.switchSx(this.subSx);
    else if(this.tab==='material') this.switchMat(this.subMat);
    else this.loadClinic();
  },



  // ── Surgery ──
  async loadSurgery() {
    const el = document.getElementById('sx-list-body');
    el.innerHTML = this.loading();
    try {
      let recs = await SHEETS.loadOpRecords();
      const sorted = [...recs].sort((a,b) => {
        const ma=this.getMonth(a.date), mb=this.getMonth(b.date);
        if(ma!==mb) return mb.localeCompare(ma);
        const aZ=a.area==='中正'?0:a.area==='右昌'?1:2;
        const bZ=b.area==='中正'?0:b.area==='右昌'?1:2;
        if(aZ!==bZ) return aZ-bZ;
        return this.dateNum(b.date)-this.dateNum(a.date);
      });
      if(!sorted.length) { el.innerHTML = `<tr><td colspan="8">${this.empty()}</td></tr>`; return; }
      let rows = '', lastM = '';
      sorted.forEach(r => {
        const m = this.getMonth(r.date);
        if(m!==lastM) {
          lastM=m;
          const ms=sorted.filter(x=>this.getMonth(x.date)===m);
          const zh=ms.filter(x=>x.area==='中正').length, yc=ms.filter(x=>x.area==='右昌').length;
          rows += `<tr class="sx-month-row"><td colspan="7">${m} <span class="month-badge">${ms.length}（${zh}/${yc}）</span></td></tr>`;
        }
        const p=r.date.split('/');
        const day=p.length>=3?p[1].padStart(2,'0')+'/'+p[2].padStart(2,'0'):r.date.substring(5);
        const _si=APP._storeRow(r);
        const isYC = r.area==='右昌';
        const missingData = !r.name || !r.mrn;
        const prefix = missingData ? '<span style="color:var(--red);font-weight:700">*</span>' : (isYC ? '<span style="color:var(--muted)">．</span>' : '');
        rows += `<tr class="sx-data-row" onclick="APP.openDetailS('sx',${_si})">
          <td class="sx-date">${day}</td>
          <td class="sx-name">${prefix}${r.name}</td>
          <td><span class="badge badge-${r.type}">${r.type||'-'}</span></td>
          <td class="sx-opname">${r.opName}</td>
          <td class="sx-loc" title="${r.location}">${r.location}</td>
          <td class="sx-implant">${r.implant}</td>
          <td class="sx-note">${r.note}</td>
        </tr>`;
      });
      el.innerHTML = rows;
    } catch(e) { el.innerHTML = `<tr><td colspan="8">${this.err(e)}</td></tr>`; }
  },

  // ── Track ──
  async loadTrack() {
    const el = document.getElementById('track-list-body');
    el.innerHTML = this.loading();
    try {
      let recs = await SHEETS.loadTrackRecords();
      if(!recs.length) { el.innerHTML = `<tr><td colspan="8">${this.empty()}</td></tr>`; return; }

      const areaOrder = ["中正","右昌","診所"];
      const groups = {};
      recs.forEach(r => { const a = r.area||"其他"; (groups[a]=groups[a]||[]).push(r); });

      // 每組內按日期降序（最新在上）—— 用數字比較避免補零不一致問題
      const toNum = d => {
        const p = d.split('/');
        return parseInt(p[0]||0)*10000 + parseInt(p[1]||0)*100 + parseInt(p[2]||0);
      };
      Object.keys(groups).forEach(a => {
        groups[a].sort((x, y) => toNum(y.date) - toNum(x.date));
      });

      // 院區排序：中正 → 右昌 → 診所 → 其他
      const sortedAreas = Object.keys(groups).sort((a, b) => {
        const ai = areaOrder.indexOf(a), bi = areaOrder.indexOf(b);
        return (ai<0?99:ai) - (bi<0?99:bi);
      });

      let rows = "";
      sortedAreas.forEach(area => {
        rows += `<tr class="sx-month-row"><td colspan="8">${area} <span class="month-badge">${groups[area].length}</span></td></tr>`;
        groups[area].forEach(r => {
          const _si = APP._storeRow(r);
          rows += `<tr class="sx-data-row" onclick="APP.openDetailS('track',${_si})">
            <td class="sx-date" style="font-size:.82rem">${r.date}</td>
            <td class="sx-name">${r.name}</td>
            <td><span class="badge badge-${r.type}">${r.type||"-"}</span></td>
            <td class="sx-opname">${r.opName}</td>
            <td class="sx-loc" title="${r.location}">${r.location}</td>
            <td class="sx-implant">${r.implant}</td>
            <td class="sx-note">${r.note}</td>
          </tr>`;
        });
      });
      el.innerHTML = rows;
    } catch(e) { el.innerHTML = `<tr><td colspan="8">${this.err(e)}</td></tr>`; }
  },

  // ── Material Records ──
  async loadMatRec() {
    const el = document.getElementById('mat-rec-list');
    el.innerHTML = this.loading();
    try {
      let recs = await SHEETS.loadMatRecords();
      if(!recs.length) { el.innerHTML = this.empty(); return; }
      let html = '';
      this.groupByMonth(recs).forEach(([m, rows]) => {
        const total = rows.reduce((s,r)=>s+(parseFloat(String(r.price).replace(/,/g,''))||0)*(parseInt(r.qty)||1),0);
        html += `<div class="list-month-hdr">${m} <span class="month-badge">$${total.toLocaleString()}</span></div>`;
        const sorted = [...rows].sort((a,b)=>{
          const aN=a.todayNew?.toString().toUpperCase()==='TRUE';
          const bN=b.todayNew?.toString().toUpperCase()==='TRUE';
          if(aN&&!bN) return -1; if(!aN&&bN) return 1;
          return this.sortBrands(a.brand||'',b.brand||'');
        });
        sorted.forEach(r => {
          const isNew=r.todayNew?.toString().toUpperCase()==='TRUE';
          const cleanP=parseFloat(String(r.price||0).replace(/,/g,''))||0;
          const qty=parseInt(r.qty)||1;
          const sub=cleanP&&qty>1?`<span class="sub-total">×${qty}=$${(cleanP*qty).toLocaleString()}</span>`:'';
          const _si=APP._storeRow(r);
          const isDone=r.done?.toLowerCase()==='true';
          html += `<div class="list-row${isNew?' row-new':''}" onclick="APP.openDetailS('mat',${_si})">
            ${isNew?'<span class="new-dot"></span>':'<span class="dot-ph"></span>'}
            <span class="col-brand">${r.brand}</span>
            <span class="col-product">${r.product}${sub}</span>
            <span class="col-qty">${r.qty}</span>
            <span class="col-price">${cleanP?'$'+cleanP.toLocaleString():''}</span>
            ${isDone ? '<span class="done-ph"></span>' : `<button class="done-btn" onclick="event.stopPropagation();APP.markDone(${r._row})" title="標記完成">☑</button>`}
          </div>`;
        });
      });
      el.innerHTML = html;
    } catch(e) { el.innerHTML = this.err(e); }
  },

  // ── Self-pay ──
  async loadSelfPay() {
    const el = document.getElementById('selfpay-list');
    el.innerHTML = this.loading();
    try {
      let items = await SHEETS.loadMatProducts();
      if(!items.length) { el.innerHTML = this.empty(); return; }

      // 分成中正（含空白）和右昌兩組
      const mainItems = items.filter(r => (r.hospital||'') !== '右昌');
      const ycItems   = items.filter(r => (r.hospital||'') === '右昌');

      const renderGroup = (list) => {
        const groups = {};
        list.forEach(r => { (groups[r.brand]=groups[r.brand]||[]).push(r); });
        let html = '';
        Object.entries(groups).sort((a,b)=>this.sortBrands(a[0],b[0])).forEach(([brand,rows]) => {
          html += `<div class="list-group-hdr">${brand}</div>`;
          rows.forEach(r => {
            const cleanP = String(r.price||'').replace(/,/g,'').trim();
            const _si = APP._storeRow(r);
            html += `<div class="list-row" style="gap:0;position:relative" onclick="APP.openDetailS('selfpay',${_si})">
              <span class="col-brand">${r.brand}</span>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1rem;font-weight:500;padding:0 4px">${r.product}</span>
              <button class="add-center-btn" onclick="event.stopPropagation();APP.qAddMat('${r.brand.replace(/'/g,"\\'")}','${r.product.replace(/'/g,"\\'")}','${cleanP}')" title="新增到骨材記錄" style="position:absolute;left:50%;transform:translateX(-50%);flex-shrink:0">＋</button>
              <span class="col-price">${cleanP?'$'+Number(cleanP).toLocaleString():'-'}</span>
              <span class="col-hosp">${r.hospital||''}</span>
            </div>`;
          });
        });
        return html;
      };

      let html = renderGroup(mainItems);
      if(ycItems.length) {
        html += `<div class="list-month-hdr" style="top:var(--col-hdr-h);background:var(--acc-lt);color:var(--accent);border-left:3px solid var(--accent)">右昌</div>`;
        html += renderGroup(ycItems);
      }
      el.innerHTML = html;
    } catch(e) { el.innerHTML = this.err(e); }
  },

  // ── OP Code ──
  async loadOpCode() {
    const el = document.getElementById('opcode-list');
    el.innerHTML = this.loading();
    try {
      let items = await SHEETS.loadOpCodes();
      if(!items.length) { el.innerHTML = this.empty(); return; }
      const areaOrder = ['中正','右昌'];
      const groups = {};
      items.forEach(r => { const a=r.area||'通用'; (groups[a]=groups[a]||[]).push(r); });
      const sortedAreas = Object.keys(groups).sort((a,b)=>{
        const ai=areaOrder.indexOf(a), bi=areaOrder.indexOf(b);
        if(ai>=0&&bi>=0) return ai-bi;
        if(ai>=0) return -1; if(bi>=0) return 1;
        return a.localeCompare(b,'zh-TW');
      });
      let html = '';
      sortedAreas.forEach(area => {
        const rows = groups[area].sort((a,b)=>parseInt(a.code||0)-parseInt(b.code||0));
        html += `<div class="list-group-hdr">${area}</div>`;
        rows.forEach(r => {
          const cleanP = parseFloat(String(r.price||0).replace(/,/g,''))||0;
          const _si=APP._storeRow(r);
          html += `<div class="list-row" style="gap:0;position:relative" onclick="APP.openDetailS('opcode',${_si})">
            <span class="col-code">${r.code}</span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1rem;font-weight:500;padding:0 4px" title="${r.name}">${r.name}</span>
            <button class="add-center-btn" onclick="event.stopPropagation();APP.qAddCode('${r.name.replace(/'/g,"\\'")}','${r.code}','${r.price}','${r.area}')" title="新增到代碼紀錄" style="position:absolute;left:50%;transform:translateX(-50%);flex-shrink:0">＋</button>
            <span class="col-price">${cleanP?'$'+cleanP.toLocaleString():''}</span>
          </div>`;
        });
      });
      el.innerHTML = html;
    } catch(e) { el.innerHTML = this.err(e); }
  },

  // ── Code Records ──
  async loadCodeRec() {
    const el = document.getElementById('code-rec-list');
    el.innerHTML = this.loading();
    try {
      let recs = await SHEETS.loadCodeRecords();
      if(!recs.length) { el.innerHTML = this.empty(); return; }
      let html = '';
      this.groupByMonth(recs).forEach(([m,rows]) => {
        const total = rows.reduce((s,r)=>s+(parseFloat(String(r.price).replace(/,/g,''))||0)*(parseInt(r.qty)||1),0);
        html += `<div class="list-month-hdr">${m} <span class="month-badge">$${total.toLocaleString()}</span></div>`;
        const areaOrd=['中正','右昌'];
        const sorted=[...rows].sort((a,b)=>{
          const aN=a.todayNew?.toString().toUpperCase()==='TRUE';
          const bN=b.todayNew?.toString().toUpperCase()==='TRUE';
          if(aN&&!bN) return -1; if(!aN&&bN) return 1;
          const ai=areaOrd.indexOf(a.area),bi=areaOrd.indexOf(b.area);
          if(ai>=0&&bi>=0&&ai!==bi) return ai-bi;
          return parseInt(a.code||0)-parseInt(b.code||0);
        });
        sorted.forEach(r => {
          const isNew=r.todayNew?.toString().toUpperCase()==='TRUE';
          const cleanP=parseFloat(String(r.price||0).replace(/,/g,''))||0;
          const _si=APP._storeRow(r);
          html += `<div class="list-row${isNew?' row-new':''}" onclick="APP.openDetailS('coderec',${_si})">
            ${isNew?'<span class="new-dot"></span>':'<span class="dot-ph"></span>'}
            <span class="col-product" title="${r.name}">${r.name}</span>
            <span class="col-code">${r.code}</span>
            <span class="col-price">${cleanP?'$'+cleanP.toLocaleString():''}</span>
            <span class="col-qty">${r.qty}</span>
            <span class="col-area">${r.area}</span>
          </div>`;
        });
      });
      el.innerHTML = html;
    } catch(e) { el.innerHTML = this.err(e); }
  },

  // ── Estimate — transposed: rows=labels, cols=months ──
  async loadEstimate() {
    const thead = document.getElementById('est-thead');
    const tbody = document.getElementById('est-tbody');
    tbody.innerHTML = `<tr><td colspan="10" class="load-msg">載入中...</td></tr>`;
    try {
      const recs = await SHEETS.loadEstimate();
      if(!recs.length) { tbody.innerHTML = `<tr><td>${this.empty()}</td></tr>`; return; }
      // Column order: next month first, this month second, rest ascending
      const now = new Date();
      const pad = n => String(n).padStart(2,'0');
      const thisYM = `${now.getFullYear()}/${pad(now.getMonth()+1)}`;
      const nxt = new Date(now.getFullYear(), now.getMonth()+1, 1);
      const nextYM = `${nxt.getFullYear()}/${pad(nxt.getMonth()+1)}`;
      const sorted = [...recs].sort((a,b) => {
        const score = m => m===nextYM ? 0 : m===thisYM ? 1 : 2;
        const s = score(a.month) - score(b.month);
        return s !== 0 ? s : a.month.localeCompare(b.month);
      });
      // Header: only MM, no year
      const mLabel = m => { const p=m.split('/'); return p.length>=2 ? p[1].replace(/^0/,'')+' 月' : m; };
      thead.innerHTML = '<tr><th>項目</th>' +
        sorted.map(r=>`<th>${mLabel(r.month)}</th>`).join('') + '</tr>';
      // Row labels
      const labels = [
        { key:'estimate', label:'預估' },
        { key:'material', label:'醫材' },
        { key:'zhongzheng', label:'中正' },
        { key:'clinic', label:'門診' },
        { key:'youchang', label:'右昌' },
      ];
      tbody.innerHTML = labels.map((lb,li) => {
        const isTotal = li===0;
        return `<tr class="${isTotal?'est-total-row':''}">
          <td>${lb.label}</td>
          ${sorted.map(r=>{
            const v=r[lb.key];
            return `<td>${v&&v!=='0'?Number(String(v).replace(/,/g,'')).toLocaleString():'-'}</td>`;
          }).join('')}
        </tr>`;
      }).join('');
    } catch(e) { tbody.innerHTML = `<tr><td>${this.err(e)}</td></tr>`; }
  },

  // ── Clinic — sorted by clinicProducts order ──
  async loadClinic() {
    const el = document.getElementById('clinic-content');
    el.innerHTML = this.loading();
    try {
      const [products, records] = await Promise.all([SHEETS.loadClinicProducts(), SHEETS.loadClinicRecords()]);
      this._clinicProds = products;
      // Build product order map for sorting records
      // Fixed sort order for clinic records display
      // Self-pay items use SELF_ORDER; records use REC_ORDER
      const REC_ORDER = ['外泌體','PRP','增生','玻尿酸','震波','門診護具'];
      const prodOrder = {};
      REC_ORDER.forEach((name,i) => { prodOrder[name] = i; });
      products.forEach((p) => { if(!(p.name in prodOrder)) prodOrder[p.name] = REC_ORDER.length + Object.keys(prodOrder).length; });

      let html = '';
      // Self-pay price list
      html += `<div class="clinic-section-hdr">自費項目</div>`;
      const SELF_ORDER = ['門診護具','外泌體','PRP','增生','玻尿酸','震波'];
      const sortedProds = [...products].sort((a,b) => {
        const ai = SELF_ORDER.indexOf(a.name), bi = SELF_ORDER.indexOf(b.name);
        const an = ai<0 ? 999+products.indexOf(a) : ai;
        const bn = bi<0 ? 999+products.indexOf(b) : bi;
        return an - bn;
      });
      sortedProds.forEach(r => {
        const cleanP = String(r.price||'').replace(/,/g,'').trim();
        html += `<div class="list-row" style="gap:0;position:relative">
          <span style="font-weight:600;font-size:1rem;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.name}</span>
          <button class="add-center-btn" onclick="APP.qAddClinic('${r.name.replace(/'/g,"\\'")}','${cleanP}')" title="快速新增門診記錄" style="position:absolute;left:50%;transform:translateX(-50%);flex-shrink:0">＋</button>
          <span class="col-price" style="flex:none">${cleanP?'$'+Number(cleanP).toLocaleString():'免費'}</span>
        </div>`;
      });

      // Records section
      html += `<div class="clinic-section-hdr">門診記錄</div>`;
      this.groupByMonth(records).forEach(([m,rows]) => {
        const mTotal = rows.reduce((s,r)=>{
          return s+(parseFloat(String(r.price||0).replace(/,/g,''))||0)*(parseInt(r.qty)||1);
        },0);
        html += `<div class="list-month-hdr" style="top:44px">${m} <span class="month-badge">$${mTotal.toLocaleString()}</span></div>`;
        // Sort by product order in self-pay list
        const sortedRows = [...rows].sort((a,b)=>{
          const oa = prodOrder[a.product]??999, ob = prodOrder[b.product]??999;
          return oa!==ob ? oa-ob : b.date.localeCompare(a.date);
        });
        sortedRows.forEach(r => {
          const isNew=r.todayNew?.toString().toUpperCase()==='TRUE';
          const _si=APP._storeRow(r);
          const cleanP=parseFloat(String(r.price||0).replace(/,/g,''))||0;
          const rowTotal=cleanP*(parseInt(r.qty)||1);
          html += `<div class="list-row${isNew?' row-new':''}" onclick="APP.openDetailS('clinic',${_si})">
            ${isNew?'<span class="new-dot"></span>':'<span class="dot-ph"></span>'}
            <span class="col-date">${r.date.substring(5)}</span>
            <span class="col-product">${r.product}</span>
            <span class="col-qty">${r.qty}</span>
            <span class="col-price">${rowTotal?'$'+rowTotal.toLocaleString():''}</span>
          </div>`;
        });
      });

      el.innerHTML = html;
    } catch(e) { el.innerHTML = this.err(e); }
  },

  // ── Quick adds ──
  async qAddMat(brand, product, price) {
    try { await SHEETS.quickAddMat(brand, product, price); this.toast(`✅ 已新增 ${product}`); }
    catch(e) { this.toast('❌ '+e.message); }
  },
  async qAddCode(name, code, price, area) {
    try { await SHEETS.quickAddCode({name,code,price,area}); this.toast(`✅ 已新增 ${name}`); }
    catch(e) { this.toast('❌ '+e.message); }
  },
  async qAddClinic(name, price) {
    try { await SHEETS.quickAddClinic(name, price); this.toast(`✅ 已新增 ${name}`); this.loadClinic(); }
    catch(e) { this.toast('❌ '+e.message); }
  },
  async markDone(row) {
    try { await SHEETS.setDone(row); this.toast('✅ 已標記完成'); this.loadMatRec(); }
    catch(e) { this.toast('❌ '+e.message); }
  },

  // ── Detail Modal via store index (avoids HTML encoding issues) ──
  openDetailS(type, idx) {
    const r = this._getRow(idx);
    if(!r) return;
    this._detailType = type;
    this._detailData = r;
    this._renderDetail(type, r);
  },

  // ── Detail Modal — hide _row / internal IDs ──
  openDetail(type, encoded) {
    const r = JSON.parse(decodeURIComponent(encoded));
    this._detailType = type;
    this._detailData = r;
    this._renderDetail(type, r);
  },

  _renderDetail(type, r) {    const titles = { sx:'手術紀錄', track:'追蹤', mat:'骨材記錄', selfpay:'自費醫材', opcode:'OP代碼', coderec:'代碼紀錄', clinic:'門診記錄' };
    document.getElementById('detail-title').textContent = titles[type] || '詳情';

    const field = (label, val) => val ? `<div class="detail-field"><div class="detail-label">${label}</div><div class="detail-val">${val}</div></div>` : '';

    let content = '';
    if(type==='sx'||type==='track') {
      content = field('日期',r.date)+field('院區',r.area)+field('病歷號',r.mrn)+(type==='track'?field('診所ID',r.clinicId):'')+field('姓名',r.name)+field('類型',r.type)+field('手術名稱',r.opName)+field('部位',r.location)+field('骨材',r.implant)+field('備註',r.note);
    } else if(type==='mat') {
      const cleanP=parseFloat(String(r.price||0).replace(/,/g,''))||0;
      const total=cleanP*(parseInt(r.qty)||1);
      content = field('廠牌',r.brand)+field('產品',r.product)+field('日期',r.date)+field('單價',cleanP?'$'+cleanP.toLocaleString():'')+field('數量',r.qty)+field('總價',total?'$'+total.toLocaleString():'')+field('狀態',r.done?.toLowerCase()==='true'?'已完成':'未完成');
    } else if(type==='selfpay') {
      content = field('廠牌',r.brand)+field('產品',r.product)+field('類型',r.type)+field('單價',r.price?'$'+Number(String(r.price).replace(/,/g,'')).toLocaleString():'')+field('醫院',r.hospital);
    } else if(type==='opcode') {
      content = field('代碼',r.code)+field('術式',r.name)+field('單價',r.price?'$'+Number(String(r.price).replace(/,/g,'')).toLocaleString():'')+field('院區',r.area);
    } else if(type==='coderec') {
      const cleanP=parseFloat(String(r.price||0).replace(/,/g,''))||0;
      content = field('術式',r.name)+field('代碼',r.code)+field('日期',r.date)+field('單價',cleanP?'$'+cleanP.toLocaleString():'')+field('數量',r.qty)+field('院區',r.area);
    } else if(type==='clinic') {
      const cleanP2=parseFloat(String(r.price||0).replace(/,/g,''))||0;
      const rowTot=cleanP2*(parseInt(r.qty)||1);
      content = field('日期',r.date)+field('產品',r.product)+field('單價',cleanP2?'$'+cleanP2.toLocaleString():'')+field('數量',r.qty)+field('總價',rowTot?'$'+rowTot.toLocaleString():'');
    }
    document.getElementById('detail-body').innerHTML = content;
    document.getElementById('detail-edit-btn').style.display = '';
    document.getElementById('modal-detail').classList.add('open');
  
  },
  openEdit() {
    const type = this._detailType, r = this._detailData;
    this._detailFromSearch = false; // 進入編輯不回到搜尋
    this.closeModal('modal-detail');
    try {
    const editModalMap = { sx:'modal-edit-sx', track:'modal-edit-track', mat:'modal-edit-mat', selfpay:'modal-edit-selfpay', opcode:'modal-edit-opcode', coderec:'modal-edit-coderec', clinic:'modal-edit-clinic' };
    const m = editModalMap[type];
    if(!m) return;
    if(type==='sx'||type==='track') {
      const pfx = type==='sx'?'es':'et';
      // Convert date to ISO for date input
      const dateISO = (r.date||'').replace(/\//g,'-').replace(/(\d{4})-(\d{1,2})-(\d{1,2})/,(_,y,m,d)=>`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
      document.getElementById(pfx+'-date').value = dateISO;
      // Area chips
      const areaVal = r.area||'中正';
      document.getElementById(pfx+'-area-val').value = areaVal;
      document.querySelectorAll(`#modal-edit-${type==='sx'?'sx':'track'} .chip.area`).forEach(c=>{
        c.classList.toggle('on', c.textContent.trim()===areaVal);
      });
      const cidWrap=document.getElementById(pfx+'-clinicid-wrap');
      if(cidWrap) cidWrap.style.display=(areaVal==='右昌'||areaVal==='診所')?'':'none';
      document.getElementById(pfx+'-mrn') && (document.getElementById(pfx+'-mrn').value=r.mrn||'');
      document.getElementById(pfx+'-clinicid') && (document.getElementById(pfx+'-clinicid').value=r.clinicId||'');
      document.getElementById(pfx+'-name').value   = r.name||'';
      document.getElementById(pfx+'-loc').value    = r.location||'';
      document.getElementById(pfx+'-note').value   = r.note||'';
      // Type chips
      const typeVal=r.type||'';
      document.getElementById(pfx+'-type-val').value=typeVal;
      document.querySelectorAll(`#${pfx}-type-chips .chip`).forEach(c=>{
        c.classList.toggle('on',c.textContent.trim()===typeVal);
      });
      if(type==='sx') {
        // opname select
        const names=(SHEETS.opCats||[]).filter(c=>c.type.trim()===typeVal).map(c=>c.name);
        const sel=document.getElementById('es-opname');
        sel.innerHTML='<option value="">選擇手術名稱</option>'+names.map(n=>`<option value="${n}"${n===r.opName?' selected':''}>${n}</option>`).join('');
        if(!names.includes(r.opName)&&r.opName){sel.innerHTML+=`<option value="${r.opName}" selected>${r.opName}</option>`;}
        // bone chips — init directly
        APP.initEsBoneChips(typeVal, r.implant||'');
      } else {
        // Populate et-opname select
        const etNames=(SHEETS.opCats||[]).filter(c=>c.type.trim()===typeVal).map(c=>c.name);
        const etSel=document.getElementById('et-opname');
        etSel.innerHTML='<option value="">選擇手術名稱</option>'+etNames.map(n=>`<option value="${n}"${n===r.opName?' selected':''}>${n}</option>`).join('');
        if(!etNames.includes(r.opName)&&r.opName){etSel.innerHTML+=`<option value="${r.opName}" selected>${r.opName}</option>`;}
        APP.initEtBoneChips(typeVal, r.implant||'');
      }
    } else if(type==='mat') {
      document.getElementById('em-brand').value   = r.brand||'';
      document.getElementById('em-product').value = r.product||'';
      document.getElementById('em-date').value    = r.date||'';
      document.getElementById('em-price').value   = String(r.price||'').replace(/,/g,'');
      document.getElementById('em-qty').value     = r.qty||'1';
      const isDone = r.done?.toLowerCase()==='true';
      document.getElementById('em-done-val').value = isDone?'true':'false';
      document.getElementById('em-done-y').classList.toggle('on',isDone);
      document.getElementById('em-done-n').classList.toggle('on',!isDone);
    } else if(type==='selfpay') {
      document.getElementById('esp-brand').value   = r.brand||'';
      document.getElementById('esp-product').value = r.product||'';
      document.getElementById('esp-price').value   = String(r.price||'').replace(/,/g,'');
      document.getElementById('esp-hosp').value    = r.hospital||'';
    } else if(type==='opcode') {
      document.getElementById('eoc-code').value  = r.code||'';
      document.getElementById('eoc-name').value  = r.name||'';
      document.getElementById('eoc-price').value = String(r.price||'').replace(/,/g,'');
      document.getElementById('eoc-area').value  = r.area||'';
    } else if(type==='coderec') {
      document.getElementById('ecr-name').value  = r.name||'';
      document.getElementById('ecr-code').value  = r.code||'';
      document.getElementById('ecr-date').value  = r.date||'';
      document.getElementById('ecr-price').value = String(r.price||'').replace(/,/g,'');
      document.getElementById('ecr-qty').value   = r.qty||'1';
      document.getElementById('ecr-area').value  = r.area||'';
    } else if(type==='clinic') {
      document.getElementById('ecl-date').value    = r.date||'';
      document.getElementById('ecl-product').value = r.product||'';
      document.getElementById('ecl-price').value   = String(r.price||'').replace(/,/g,'');
      document.getElementById('ecl-qty').value     = r.qty||'1';
    }
    this.openModal(m, true);
    } catch(e) { console.error('openEdit error:', e); this.toast('⚠️ 開啟修改失敗: '+e.message); }
  },

  async saveEdit() {
    const type=this._detailType, r=this._detailData;
    try {
      if(type==='sx') {
        const esDate=document.getElementById('es-date').value.replace(/-/g,'/');
        await SHEETS.updateSurgery(r._row,{date:esDate,area:document.getElementById('es-area-val').value,mrn:document.getElementById('es-mrn').value,clinicId:document.getElementById('es-clinicid')?.value||'',name:document.getElementById('es-name').value,type:document.getElementById('es-type-val').value,opName:document.getElementById('es-opname').value,location:document.getElementById('es-loc').value,implant:document.getElementById('es-bone-val').value||'',note:document.getElementById('es-note').value});
        this.closeModal('modal-edit-sx'); this.loadSurgery();
      } else if(type==='track') {
        const etDate=document.getElementById('et-date').value.replace(/-/g,'/');
        await SHEETS.updateTrack(r._row,{date:etDate,area:document.getElementById('et-area-val').value,mrn:document.getElementById('et-mrn').value,clinicId:document.getElementById('et-clinicid')?.value||'',name:document.getElementById('et-name').value,type:document.getElementById('et-type-val').value,opName:document.getElementById('et-opname').value,location:document.getElementById('et-loc').value,implant:document.getElementById('et-bone-val')?.value||'',note:document.getElementById('et-note').value});
        this.closeModal('modal-edit-track'); this.loadTrack();
      } else if(type==='mat') {
        await SHEETS.updateMatRow(r._row,{brand:document.getElementById('em-brand').value,product:document.getElementById('em-product').value,date:document.getElementById('em-date').value,price:document.getElementById('em-price').value,qty:document.getElementById('em-qty').value,done:document.getElementById('em-done-val').value});
        this.closeModal('modal-edit-mat'); this.loadMatRec();
      } else if(type==='selfpay') {
        await SHEETS.updateSelfPay(r._row,{brand:document.getElementById('esp-brand').value,product:document.getElementById('esp-product').value,price:document.getElementById('esp-price').value,hospital:document.getElementById('esp-hosp').value});
        this.closeModal('modal-edit-selfpay'); this.loadSelfPay();
      } else if(type==='opcode') {
        await SHEETS.updateOpCode(r._row,{code:document.getElementById('eoc-code').value,name:document.getElementById('eoc-name').value,price:document.getElementById('eoc-price').value,area:document.getElementById('eoc-area').value});
        this.closeModal('modal-edit-opcode'); this.loadOpCode();
      } else if(type==='coderec') {
        await SHEETS.updateCodeRec(r._row,{name:document.getElementById('ecr-name').value,code:document.getElementById('ecr-code').value,date:document.getElementById('ecr-date').value,price:document.getElementById('ecr-price').value,qty:document.getElementById('ecr-qty').value,area:document.getElementById('ecr-area').value});
        this.closeModal('modal-edit-coderec'); this.loadCodeRec();
      } else if(type==='clinic') {
        await SHEETS.updateClinicRec(r._row,{date:document.getElementById('ecl-date').value,product:document.getElementById('ecl-product').value,price:document.getElementById('ecl-price').value,qty:document.getElementById('ecl-qty').value});
        this.closeModal('modal-edit-clinic'); this.loadClinic();
      }
      this.toast('✅ 已更新');
    } catch(e) { this.toast('❌ '+e.message); }
  },

  async deleteDetail() {
    const type=this._detailType, r=this._detailData;
    if(!confirm('確定刪除？')) return;
    const tabMap={sx:'op',track:'track',mat:'matRec',selfpay:'matProd',opcode:'opCode',coderec:'codeRec',clinic:'clinic'};
    const colMap={sx:['A','H'],track:['A','K'],mat:['A','H'],selfpay:['A','F'],opcode:['A','E'],coderec:['A','H'],clinic:['A','F']};
    const cacheMap={sx:'op',track:'track',mat:'matRec',selfpay:'matProd',opcode:'opCode',coderec:'codeRec',clinic:'clinic'};
    try {
      const tab=SHEETS.T[tabMap[type]],cols=colMap[type];
      await SHEETS.deleteRow(tab,r._row,cols[0],cols[1],cacheMap[type]);
      this._detailFromSearch = false; // 刪除後不回到搜尋
      this.closeModal('modal-detail');
      this.toast('🗑 已刪除');
      this.refresh();
    } catch(e) { this.toast('❌ '+e.message); }
  },

  toggleDone(val) {
    document.getElementById('em-done-val').value=val;
    document.getElementById('em-done-y').classList.toggle('on',val==='true');
    document.getElementById('em-done-n').classList.toggle('on',val==='false');
  },

  // ── New record save ──
  async saveOp() {
    if(this._savingOp) return; // prevent double submit
    const d={date:document.getElementById('s-date').value.replace(/-/g,'/'),area:document.getElementById('s-area-val').value,mrn:document.getElementById('s-mrn').value.trim(),clinicId:document.getElementById('s-clinicid')?.value.trim()||'',name:document.getElementById('s-name').value.trim(),type:document.getElementById('s-type-val').value,opName:document.getElementById('s-opname').value,location:document.getElementById('s-location').value.trim(),implant:document.getElementById('s-bone-val').value,note:document.getElementById('s-note').value.trim()};
    if(!d.date||!d.name){this.toast('請填入日期和姓名');return;}
    this._savingOp = true;
    try{
      await SHEETS.addOp(d);
      this.closeModal('modal-op');
      this.toast('✅ 已儲存');
      this.loadSurgery();
      // Clear form fields for next entry
      document.getElementById('s-mrn').value='';
      if(document.getElementById('s-clinicid')) document.getElementById('s-clinicid').value='';
      document.getElementById('s-name').value='';
      document.getElementById('s-location').value='';
      document.getElementById('s-note').value='';
      document.getElementById('s-bone-val').value='';
      document.getElementById('s-bone-wrap').innerHTML='<div style="color:var(--muted);font-size:.88rem">請先選擇類型</div>';
      document.getElementById('s-opname').innerHTML='<option value="">請先選擇類型</option>';
      document.getElementById('s-type-val').value='Joint';
      document.querySelectorAll('#modal-op .chip:not(.area)').forEach(c=>{c.classList.remove('on');if(c.textContent.trim()==='Joint')c.classList.add('on');});
      document.querySelectorAll('#modal-op .chip.area').forEach(c=>{c.classList.toggle('on',c.textContent.trim()==='中正');});
      document.getElementById('s-area-val').value='中正';
      if(document.getElementById('s-clinicid-wrap')) document.getElementById('s-clinicid-wrap').style.display='none';
    }
    catch(e){this.toast('❌ '+e.message);}
    finally{this._savingOp = false;}
  },
  async saveTrack() {
    if(this._savingTrack) return; // prevent double submit
    const d={date:document.getElementById('tk-date').value.replace(/-/g,'/'),area:document.getElementById('tk-area-val').value,mrn:document.getElementById('tk-mrn').value.trim(),clinicId:document.getElementById('tk-clinicid')?.value.trim()||'',name:document.getElementById('tk-name').value.trim(),type:document.getElementById('tk-type-val').value,opName:document.getElementById('tk-opname').value.trim(),location:document.getElementById('tk-loc').value.trim(),implant:document.getElementById('tk-bone-val')?.value||'',note:document.getElementById('tk-note').value.trim()};
    if(!d.date||!d.name){this.toast('請填入日期和姓名');return;}
    this._savingTrack = true;
    try{
      await SHEETS.addTrack(d);
      this.closeModal('modal-track');
      this.toast('✅ 已儲存');
      this.loadTrack();
      // Clear form fields for next entry
      document.getElementById('tk-mrn').value='';
      if(document.getElementById('tk-clinicid')) document.getElementById('tk-clinicid').value='';
      document.getElementById('tk-name').value='';
      document.getElementById('tk-loc').value='';
      document.getElementById('tk-note').value='';
      if(document.getElementById('tk-bone-val')) document.getElementById('tk-bone-val').value='';
      if(document.getElementById('tk-bone-wrap')) document.getElementById('tk-bone-wrap').innerHTML='<div style="color:var(--muted);font-size:.88rem">請先選擇類型</div>';
      if(document.getElementById('tk-opname')) document.getElementById('tk-opname').innerHTML='<option value="">選擇手術名稱</option>';
      document.getElementById('tk-type-val').value='Joint';
      document.querySelectorAll('#modal-track .chip:not(.area)').forEach(c=>{c.classList.remove('on');if(c.textContent.trim()==='Joint')c.classList.add('on');});
      document.querySelectorAll('#modal-track .chip.area').forEach(c=>{c.classList.toggle('on',c.textContent.trim()==='中正');});
      document.getElementById('tk-area-val').value='中正';
      if(document.getElementById('tk-clinicid-wrap')) document.getElementById('tk-clinicid-wrap').style.display='none';
    }
    catch(e){this.toast('❌ '+e.message);}
    finally{this._savingTrack = false;}
  },
  async saveMat() {
    const d={date:document.getElementById('m-date').value.replace(/-/g,'/'),brand:document.getElementById('m-brand').value.trim(),product:document.getElementById('m-product').value.trim(),qty:document.getElementById('m-qty').value,price:document.getElementById('m-price').value};
    if(!d.date||!d.product){this.toast('請填入日期和產品');return;}
    try{await SHEETS.addMat(d);this.closeModal('modal-mat');this.toast('✅ 已儲存');this.loadMatRec();}
    catch(e){this.toast('❌ '+e.message);}
  },
  async saveCode() {
    const d={date:document.getElementById('c-date').value.replace(/-/g,'/'),name:document.getElementById('c-name').value.trim(),code:document.getElementById('c-code').value.trim(),price:document.getElementById('c-price').value,qty:document.getElementById('c-qty').value,area:document.getElementById('c-area').value};
    if(!d.date||!d.code){this.toast('請填入日期和代碼');return;}
    try{await SHEETS.addCode(d);this.closeModal('modal-code');this.toast('✅ 已儲存');this.loadCodeRec();}
    catch(e){this.toast('❌ '+e.message);}
  },
  async saveCli() {
    const d={date:document.getElementById('cl-date').value.replace(/-/g,'/'),product:document.getElementById('cl-product').value,price:document.getElementById('cl-price').value,qty:document.getElementById('cl-qty').value};
    if(!d.date||!d.product){this.toast('請填入日期和產品');return;}
    try{await SHEETS.addClinic(d);this.closeModal('modal-cli');this.toast('✅ 已儲存');this.loadClinic();}
    catch(e){this.toast('❌ '+e.message);}
  },


  // ── Edit modal area/type chips ──
  editSelectArea(el, v, pfx) {
    const wrap = el.closest('.chip-row');
    wrap.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
    el.classList.add('on');
    document.getElementById(pfx+'-area-val').value = v;
    const cidWrap = document.getElementById(pfx+'-clinicid-wrap');
    if(cidWrap) cidWrap.style.display = (v==='右昌'||v==='診所') ? '' : 'none';
    if(v!=='右昌'&&v!=='診所') { const f=document.getElementById(pfx+'-clinicid'); if(f) f.value=''; }
  },
  editSelectType(el, type, pfx) {
    const wrap = el.closest('.chip-row');
    wrap.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
    el.classList.add('on');
    document.getElementById(pfx+'-type-val').value = type;
    // For edit-sx also update bone/opname dropdowns
    if(pfx==='es') {
      const sel = document.getElementById('es-opname');
      const names = (SHEETS.opCats||[]).filter(c=>c.type.trim()===type).map(c=>c.name);
      sel.innerHTML = '<option value="">選擇手術名稱</option>'+names.map(n=>`<option value="${n}">${n}</option>`).join('');
      APP.initEsBoneChips(type, '');
    } else if(pfx==='et') {
      const etNames2=(SHEETS.opCats||[]).filter(c=>c.type.trim()===type).map(c=>c.name);
      const etSel2=document.getElementById('et-opname');
      if(etSel2) etSel2.innerHTML='<option value="">選擇手術名稱</option>'+etNames2.map(n=>`<option value="${n}">${n}</option>`).join('');
      APP.initEtBoneChips(type, '');
    }
  },
  toggleEsBoneChip(btn){ btn.classList.toggle('on'); document.getElementById('es-bone-val').value=[...document.querySelectorAll('#es-bone-wrap .bone-toggle.on')].map(c=>c.dataset.val).join(' , '); },
  initEsBoneChips(type, implant) {
    const bwrap = document.getElementById('es-bone-wrap');
    const main = (SHEETS.boneCats||[]).filter(c=>c.type.trim()===type).map(c=>c.bone);
    const growth = (SHEETS.growthFactors&&SHEETS.growthFactors.length)?SHEETS.growthFactors:['漢森柏0.5','PRP 15K','PRP 36K','羊膜22S','瑟若美'];
    const selected = implant ? implant.split(' , ').map(s=>s.trim()) : [];
    let h = '';
    if(main.length) {
      h += `<div class="bone-section">骨材</div><div class="chip-row wrap" style="margin-top:6px">`;
      h += main.map(b=>`<button type="button" class="chip bone-toggle${selected.includes(b)?' on':''}" data-val="${b}" onclick="APP.toggleEsBoneChip(this)">${b}</button>`).join('');
      h += `</div>`;
    }
    h += `<div class="bone-section" style="margin-top:10px">生長因子</div><div class="chip-row wrap" style="margin-top:6px">`;
    h += growth.map(b=>`<button type="button" class="chip bone-toggle${selected.includes(b)?' on':''}" data-val="${b}" onclick="APP.toggleEsBoneChip(this)">${b}</button>`).join('');
    h += `</div>`;
    bwrap.innerHTML = h;
    document.getElementById('es-bone-val').value = implant;
  },
  toggleEtBoneChip(btn){ btn.classList.toggle('on'); document.getElementById('et-bone-val').value=[...document.querySelectorAll('#et-bone-wrap .bone-toggle.on')].map(c=>c.dataset.val).join(' , '); },
  initEtBoneChips(type, implant) {
    const bwrap = document.getElementById('et-bone-wrap');
    const main = (SHEETS.boneCats||[]).filter(c=>c.type.trim()===type).map(c=>c.bone);
    const growth = (SHEETS.growthFactors&&SHEETS.growthFactors.length)?SHEETS.growthFactors:['漢森柏0.5','PRP 15K','PRP 36K','羊膜22S','瑟若美'];
    const selected = implant ? implant.split(' , ').map(s=>s.trim()) : [];
    let h = '';
    if(main.length) {
      h += `<div class="bone-section">骨材</div><div class="chip-row wrap" style="margin-top:6px">`;
      h += main.map(b=>`<button type="button" class="chip bone-toggle${selected.includes(b)?' on':''}" data-val="${b}" onclick="APP.toggleEtBoneChip(this)">${b}</button>`).join('');
      h += `</div>`;
    }
    h += `<div class="bone-section" style="margin-top:10px">生長因子</div><div class="chip-row wrap" style="margin-top:6px">`;
    h += growth.map(b=>`<button type="button" class="chip bone-toggle${selected.includes(b)?' on':''}" data-val="${b}" onclick="APP.toggleEtBoneChip(this)">${b}</button>`).join('');
    h += `</div>`;
    bwrap.innerHTML = h;
    document.getElementById('et-bone-val').value = implant;
  },


  // New track area/type chips
  tkSelectArea(el, v) {
    el.closest('.chip-row').querySelectorAll('.chip').forEach(c=>c.classList.remove('on'));
    el.classList.add('on');
    document.getElementById('tk-area-val').value = v;
    const cidWrap = document.getElementById('tk-clinicid-wrap');
    if(cidWrap) cidWrap.style.display = (v==='診所') ? '' : 'none';
    if(v!=='診所') { const f=document.getElementById('tk-clinicid'); if(f) f.value=''; }
  },
  tkSelectType(el, type) {
    el.closest('.chip-row').querySelectorAll('.chip').forEach(c=>c.classList.remove('on'));
    el.classList.add('on');
    document.getElementById('tk-type-val').value = type;
    // Update opname select
    const sel = document.getElementById('tk-opname');
    if(sel) {
      const names = (SHEETS.opCats||[]).filter(c=>c.type.trim()===type).map(c=>c.name);
      sel.innerHTML = '<option value="">選擇手術名稱</option>'+names.map(n=>`<option value="${n}">${n}</option>`).join('');
    }
    // Update bone chips
    APP.initTkBoneChips(type, '');
  },
  toggleTkBoneChip(btn){ btn.classList.toggle('on'); document.getElementById('tk-bone-val').value=[...document.querySelectorAll('#tk-bone-wrap .bone-toggle.on')].map(c=>c.dataset.val).join(' , '); },
  initTkBoneChips(type, implant) {
    const bwrap = document.getElementById('tk-bone-wrap');
    if(!bwrap) return;
    const main = (SHEETS.boneCats||[]).filter(c=>c.type.trim()===type).map(c=>c.bone);
    const growth = (SHEETS.growthFactors&&SHEETS.growthFactors.length)?SHEETS.growthFactors:['漢森柏0.5','PRP 15K','PRP 36K','羊膜22S','瑟若美'];
    const selected = implant ? implant.split(' , ').map(s=>s.trim()) : [];
    let h = '';
    if(main.length) {
      h += `<div class="bone-section">骨材</div><div class="chip-row wrap" style="margin-top:6px">`;
      h += main.map(b=>`<button type="button" class="chip bone-toggle${selected.includes(b)?' on':''}" data-val="${b}" onclick="APP.toggleTkBoneChip(this)">${b}</button>`).join('');
      h += `</div>`;
    }
    h += `<div class="bone-section" style="margin-top:10px">生長因子</div><div class="chip-row wrap" style="margin-top:6px">`;
    h += growth.map(b=>`<button type="button" class="chip bone-toggle${selected.includes(b)?' on':''}" data-val="${b}" onclick="APP.toggleTkBoneChip(this)">${b}</button>`).join('');
    h += `</div>`;
    bwrap.innerHTML = h;
    if(document.getElementById('tk-bone-val')) document.getElementById('tk-bone-val').value = implant;
  },

  // Surgery modal chips
  selectArea(el,v){
    document.querySelectorAll('[onclick*="selectArea"]').forEach(c=>c.classList.remove('on'));
    el.classList.add('on');
    document.getElementById('s-area-val').value=v;
    const wrap=document.getElementById('s-clinicid-wrap');
    if(wrap) wrap.style.display = v==='右昌' ? '' : 'none';
    if(v!=='右昌') { const f=document.getElementById('s-clinicid'); if(f) f.value=''; }
  },
  selectType(el,type){
    document.querySelectorAll('[onclick*="selectType"]').forEach(c=>c.classList.remove('on'));el.classList.add('on');
    document.getElementById('s-type-val').value=type;
    this.updateOpDropdowns(type);
  },
  updateOpDropdowns(type){
    const sel=document.getElementById('s-opname');
    const names=(SHEETS.opCats||[]).filter(c=>c.type.trim()===type).map(c=>c.name);
    sel.innerHTML='<option value="">選擇手術名稱</option>'+names.map(n=>`<option value="${n}">${n}</option>`).join('');
    const wrap=document.getElementById('s-bone-wrap');
    const main=(SHEETS.boneCats||[]).filter(c=>c.type.trim()===type).map(c=>c.bone);
    const growth=(SHEETS.growthFactors&&SHEETS.growthFactors.length)?SHEETS.growthFactors:['漢森柏0.5','PRP 15K','PRP 36K','羊膜22S','瑟若美'];
    // Render as toggle chips instead of checkboxes
    let h='';
    if(main.length) {
      h+=`<div class="bone-section">骨材</div><div class="chip-row wrap" style="margin-top:6px">`;
      h+=main.map(b=>`<button type="button" class="chip bone-toggle" data-val="${b}" onclick="APP.toggleBoneChip(this)">${b}</button>`).join('');
      h+=`</div>`;
    }
    h+=`<div class="bone-section" style="margin-top:10px">生長因子</div><div class="chip-row wrap" style="margin-top:6px">`;
    h+=growth.map(b=>`<button type="button" class="chip bone-toggle" data-val="${b}" onclick="APP.toggleBoneChip(this)">${b}</button>`).join('');
    h+=`</div>`;
    wrap.innerHTML=h; this.updateBoneVal();
  },
  toggleBoneChip(btn){
    btn.classList.toggle('on');
    this.updateBoneVal();
  },
  updateBoneVal(){document.getElementById('s-bone-val').value=[...document.querySelectorAll('#s-bone-wrap .bone-toggle.on')].map(c=>c.dataset.val).join(' , ');},

  openModal(id, skipDateReset){
    const el = document.getElementById(id);
    if(!el) { console.error('Modal not found:', id); return; }
    el.classList.add('open');
    // Only reset dates for NEW record modals, not edit modals
    if(!skipDateReset && !id.startsWith('modal-edit-')) {
      document.querySelectorAll(`#${id} input[type="date"]`).forEach(el=>el.value=this.todayISO());
    }
  },
  closeModal(id){
    document.getElementById(id).classList.remove('open');
    // 若詳細卡片是從搜尋開啟的，關閉後自動重開搜尋
    if(id==='modal-detail' && this._detailFromSearch) {
      this._detailFromSearch = false;
      document.getElementById('modal-search').classList.add('open');
    }
  },

  toast(msg){
    const el=document.getElementById('toast');
    el.textContent=msg; el.classList.add('show');
    setTimeout(()=>el.classList.remove('show'),2600);
  },
};

document.addEventListener('DOMContentLoaded',()=>{
  APP.init();
  if('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(e => console.warn('[SW] register failed:', e));
  }
});
