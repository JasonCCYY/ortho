// ── Google Sheets API + LocalStorage Cache ──
const SHEETS = {
  ID: '1g_nw2_rzJfrzu0KEOPaW3lSDNxxaDweN2FeWzONqCbg',
  BASE: 'https://sheets.googleapis.com/v4/spreadsheets',
  T: {
    op:       '手術',
    matRec:   '骨材記錄',
    matProd:  '骨材產品',
    opCode:   'OP代碼',
    codeRec:  'OP代碼記錄',
    estimate: '預估',
    clinic:   '門診記錄',
    clinicP:  '門診產品',
    opCat:    'OP分類',
    boneCat:  '骨材分類',
    track:    '追蹤',
  },

  hdrs() { return { Authorization: `Bearer ${AUTH.accessToken}` }; },

  // ── Cache helpers ──
  _STALE_TTL: 30 * 60 * 1000,  // 30 分鐘：超過視為 stale，返回快取並強制背景刷新
  saveCache(key, data) {
    try { localStorage.setItem('ortho_' + key, JSON.stringify({ t: Date.now(), d: data })); } catch(e) {}
  },
  loadCacheRaw(key) {
    try {
      const raw = localStorage.getItem('ortho_' + key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      const age = Date.now() - obj.t;
      if (age > 24 * 60 * 60 * 1000) { localStorage.removeItem('ortho_' + key); return null; } // 24hr 強制過期
      return { data: obj.d, stale: age > this._STALE_TTL };
    } catch(e) { return null; }
  },
  loadCache(key) {
    const r = this.loadCacheRaw(key);
    return r ? r.data : null;
  },

  // ── Core read/write ──
  async read(tab, range) {
    const url = `${this.BASE}/${this.ID}/values/${encodeURIComponent(tab + '!' + range)}`;
    const r = await fetch(url, { headers: this.hdrs() });
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) { AUTH.handleExpired(); throw new Error(`登入過期，重新驗證中`); }
      throw new Error(`讀取失敗(${r.status}): ${tab}`);
    }
    return (await r.json()).values || [];
  },

  async append(tab, rows) {
    const url = `${this.BASE}/${this.ID}/values/${encodeURIComponent(tab + '!A1')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const r = await fetch(url, { method: 'POST', headers: { ...this.hdrs(), 'Content-Type': 'application/json' }, body: JSON.stringify({ values: rows }) });
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) { AUTH.handleExpired(); throw new Error(`登入過期，重新驗證中`); }
      throw new Error(`寫入失敗(${r.status}): ${tab}`);
    }
    return r.json();
  },

  async put(range, values) {
    const url = `${this.BASE}/${this.ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const r = await fetch(url, { method: 'PUT', headers: { ...this.hdrs(), 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) { AUTH.handleExpired(); throw new Error(`登入過期，重新驗證中`); }
      throw new Error(`更新失敗(${r.status})`);
    }
    return r.json();
  },

  async clearRow(tab, row, c1, c2) {
    const url = `${this.BASE}/${this.ID}/values/${encodeURIComponent(tab+'!'+c1+row+':'+c2+row)}:clear`;
    const r = await fetch(url, { method: 'POST', headers: { ...this.hdrs(), 'Content-Type': 'application/json' } });
    if (!r.ok) throw new Error(`刪除失敗(${r.status})`);
    return r.json();
  },

  uid() { return Math.random().toString(36).substring(2, 10); },
  nowMonth() {
    const n = new Date();
    return `${n.getFullYear()}/${String(n.getMonth()+1).padStart(2,'0')}`;
  },

  // ── Cached loaders ──
  async cached(key, loader) {
    const entry = this.loadCacheRaw(key);
    if (entry) {
      if (entry.stale) {
        // Stale（超過30分鐘）：立即回傳舊資料 + 背景強制刷新
        loader().then(d => this.saveCache(key, d)).catch(() => {});
      }
      // Fresh（30分鐘內）：直接回傳快取，不發網路請求
      return entry.data;
    }
    // 無快取：等待網路
    const data = await loader();
    this.saveCache(key, data);
    return data;
  },

  // ── Loaders ──
  async loadOpRecords() {
    const load = async () => {
      const hRow = await this.read(this.T.op, 'A1:K1');
      const h = (hRow[0] || []).map(x => (x||'').trim());
      const ci = (names, fb) => { for (const n of names) { const i = h.indexOf(n); if (i>=0) return i; } return fb; };
      const iD=ci(['日期'],0), iA=ci(['院區'],1), iMR=ci(['病歷號'],2),
            iCL=ci(['診所ID'],3), iN=ci(['姓名'],4),
            iT=ci(['類型'],5), iON=ci(['名稱','術式'],6),
            iL=ci(['部位'],7), iI=ci(['骨材'],8), iNt=ci(['備註'],9), iUID=ci(['UsageID'],10);
      const rows = await this.read(this.T.op, 'A2:K500');
      return rows.filter(r=>r[iD]||r[iN]).map((r,i)=>({
        _row:i+2, date:r[iD]||'', area:r[iA]||'', mrn:r[iMR]||'',
        clinicId:r[iCL]||'', name:r[iN]||'',
        type:r[iT]||'', opName:r[iON]||'', location:r[iL]||'',
        implant:r[iI]||'', note:r[iNt]||'', usageId:r[iUID]||''
      }));
    };
    return this.cached('op', load);
  },

  async loadTrackRecords() {
    const load = async () => {
      const hRow = await this.read(this.T.track, 'A1:K1');
      const h = (hRow[0]||[]).map(x=>(x||'').trim());
      const ci = (names, fb) => { for(const n of names){const i=h.indexOf(n);if(i>=0)return i;} return fb; };
      const iD=ci(['日期'],0),iA=ci(['院區'],1),iMR=ci(['病歷號'],2),
            iClinic=ci(['診所ID'],3),iN=ci(['姓名'],4),iT=ci(['類型'],5),
            iON=ci(['名稱','術式'],6),iL=ci(['部位'],7),iI=ci(['骨材'],8),
            iNt=ci(['備註'],9),iUID=ci(['UsageID'],10);
      const rows = await this.read(this.T.track, 'A2:K500');
      return rows.filter(r=>r[iD]||r[iN]).map((r,i)=>({
        _row:i+2, date:r[iD]||'', area:r[iA]||'', mrn:r[iMR]||'',
        clinicId:r[iClinic]||'', name:r[iN]||'', type:r[iT]||'',
        opName:r[iON]||'', location:r[iL]||'', implant:r[iI]||'',
        note:r[iNt]||'', usageId:r[iUID]||''
      }));
    };
    return this.cached('track', load);
  },

  async loadMatRecords() {
    const load = async () => {
      const rows = await this.read(this.T.matRec, 'A2:H500');
      return rows.filter(r=>r[0]).map((r,i)=>({
        _row:i+2, date:r[0]||'', brand:r[1]||'', product:r[2]||'',
        price:r[3]||'', qty:r[4]||'', usageId:r[5]||'', done:r[6]||'', todayNew:r[7]||''
      })).sort((a,b)=>b.date.localeCompare(a.date));
    };
    return this.cached('matRec', load);
  },

  async loadMatProducts() {
    const load = async () => {
      const rows = await this.read(this.T.matProd, 'A2:F300');
      if (!rows.length) return [];
      // 自動偵測：A欄若是 itemId 格式（如 A1、Ru1）則有 id 欄，否則直接從廠牌開始
      const hasId = /^[A-Za-z]\d+$/.test(String(rows.find(r=>r[0])?.[0]||'').trim());
      return rows.filter(r => hasId ? r[1] : r[0]).map((r, i) => hasId
        ? { _row:i+2, itemId:r[0]||'', brand:r[1]||'', product:r[2]||'', type:r[3]||'', price:r[4]||'', hospital:r[5]||'' }
        : { _row:i+2, itemId:'',       brand:r[0]||'', product:r[1]||'', type:r[2]||'', price:r[3]||'', hospital:r[4]||'' }
      );
    };
    return this.cached('matProd', load);
  },

  async loadOpCodes() {
    const load = async () => {
      const rows = await this.read(this.T.opCode, 'A2:F200');
      return rows.filter(r=>r[0]).map((r,i)=>({
        _row:i+2, code:r[0]||'', name:r[1]||'', price:r[2]||'', area:r[3]||'', type:r[4]||'', itemId:r[5]||''
      }));
    };
    return this.cached('opCode', load);
  },

  async loadCodeRecords() {
    const load = async () => {
      const rows = await this.read(this.T.codeRec, 'A2:H500');
      return rows.filter(r=>r[0]).map((r,i)=>({
        _row:i+2, date:r[0]||'', name:r[1]||'', price:r[2]||'', code:r[3]||'',
        area:r[4]||'', qty:r[5]||'', usageId:r[6]||'', todayNew:r[7]||''
      })).sort((a,b)=>b.date.localeCompare(a.date));
    };
    return this.cached('codeRec', load);
  },

  async loadEstimate() {
    const load = async () => {
      // A=月份,B=醫材,C=中正,D=門診,E=右昌,F=預估
      const rows = await this.read(this.T.estimate, 'A2:F50');
      return rows.filter(r=>r[0]).map((r,i)=>({
        _row:i+2, month:r[0]||'', material:r[1]||'', zhongzheng:r[2]||'',
        clinic:r[3]||'', youchang:r[4]||'', estimate:r[5]||''
      }));
    };
    return this.cached('estimate', load);
  },

  async loadClinicProducts() {
    const load = async () => {
      const rows = await this.read(this.T.clinicP, 'A2:C20');
      if (!rows.length) return [];
      // A欄若是 itemId 格式則跳過，否則直接讀產品名
      const hasId = /^[A-Za-z]\d+$/.test(String(rows.find(r=>r[0])?.[0]||'').trim());
      return rows.filter(r => hasId ? r[1] : r[0]).map((r, i) => hasId
        ? { _row:i+2, itemId:r[0]||'', name:r[1]||'', price:r[2]||'' }
        : { _row:i+2, itemId:'',       name:r[0]||'', price:r[1]||'' }
      );
    };
    return this.cached('clinicP', load);
  },

  async loadClinicRecords() {
    // 門診: A=日期,B=產品,C=單價,D=數量,E=UsageID,F=今日新增
    const load = async () => {
      const rows = await this.read(this.T.clinic, 'A2:F500');
      return rows.filter(r=>r[0]).map((r,i)=>({
        _row:i+2, date:r[0]||'', product:r[1]||'',
        price:r[2]||'', qty:r[3]||'', usageId:r[4]||'', todayNew:r[5]||''
      })).sort((a,b)=>b.date.localeCompare(a.date));
    };
    return this.cached('clinic', load);
  },

  async loadCategories() {
    try {
      const [opRows, boneRows] = await Promise.all([
        this.read(this.T.opCat, 'A2:B200'),
        this.read(this.T.boneCat, 'A2:B200')
      ]);
      this.opCats = opRows.filter(r=>r[0]).map(r=>({type:(r[0]||'').trim(), name:(r[1]||'').trim()}));
      const allBone = boneRows.filter(r=>r[0]).map(r=>({type:(r[0]||'').trim(), bone:(r[1]||'').trim()}));
      this.growthFactors = allBone.filter(r=>r.type==='生長因子').map(r=>r.bone);
      this.boneCats = allBone.filter(r=>r.type!=='生長因子');
    } catch(e) { console.warn('Category load failed:', e); }
  },

  // ── 用 usageId 搜尋正確行號 ──
  async findRowByUid(tab, range, uidCol, uid) {
    if (!uid) return null;
    const rows = await this.read(tab, range);
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i][uidCol]||'').trim() === uid.trim()) return i + 2;
    }
    return null;
  },

  // ── Writers ──
  async updateSurgery(row, d, usageId) {
    if (usageId) {
      const r = await this.findRowByUid(this.T.op, 'A2:K500', 10, usageId);
      if (r) row = r;
    }
    await this.put(this.T.op+'!A'+row+':J'+row, [[d.date,d.area,d.mrn||'',d.clinicId||'',d.name,d.type,d.opName,d.location,d.implant,d.note]]);
    localStorage.removeItem('ortho_op');
  },

  async updateTrack(row, d, usageId) {
    if (usageId) {
      const r = await this.findRowByUid(this.T.track, 'A2:K500', 10, usageId);
      if (r) row = r;
    }
    await this.put(this.T.track+'!A'+row+':J'+row, [[d.date,d.area,d.mrn,d.clinicId,d.name,d.type,d.opName,d.location,d.implant,d.note]]);
    localStorage.removeItem('ortho_track');
  },

  async updateMatRow(row, d, usageId) {
    if (usageId) {
      const r = await this.findRowByUid(this.T.matRec, 'A2:H500', 5, usageId);
      if (r) row = r;
    }
    await this.put(this.T.matRec+'!A'+row+':E'+row, [[d.date,d.brand,d.product,d.price,d.qty]]);
    if (d.done !== undefined) await this.put(this.T.matRec+'!G'+row, [[d.done]]);
    localStorage.removeItem('ortho_matRec');
  },

  async setDone(row, usageId) {
    if (usageId) {
      const r = await this.findRowByUid(this.T.matRec, 'A2:H500', 5, usageId);
      if (r) row = r;
    }
    await this.put(this.T.matRec+'!G'+row, [['true']]);
    localStorage.removeItem('ortho_matRec');
  },

  // OP代碼更新 + 同步代碼紀錄
  async updateOpCode(row, d, syncPrices) {
    await this.put(this.T.opCode+'!A'+row+':E'+row, [[d.code,d.name,d.price,d.area,d.type||'']]);
    localStorage.removeItem('ortho_opCode');
    // 同步更新代碼紀錄中相同代碼的價格
    if (syncPrices && d.code && d.price) {
      const cleanP = String(d.price).replace(/,/g,'');
      const recs = await this.read(this.T.codeRec, 'A2:H500');
      const updates = [];
      for (let i = 0; i < recs.length; i++) {
        if ((recs[i][3]||'').trim() === String(d.code).trim()) {
          updates.push({ row: i+2, price: cleanP });
        }
      }
      for (const u of updates) {
        await this.put(this.T.codeRec+'!C'+u.row, [[u.price]]);
      }
      localStorage.removeItem('ortho_codeRec');
    }
  },

  // 自費醫材更新 + 同步骨材記錄（廠商+產品+院區）
  async updateSelfPay(row, d, syncPrices) {
    await this.put(this.T.matProd+'!B'+row+':C'+row, [[d.brand,d.product]]);
    await this.put(this.T.matProd+'!E'+row+':F'+row, [[d.price,d.hospital]]);
    localStorage.removeItem('ortho_matProd');
    // 同步骨材記錄中相同廠商+產品的價格
    if (syncPrices && d.brand && d.product && d.price) {
      const cleanP = String(d.price).replace(/,/g,'');
      const recs = await this.read(this.T.matRec, 'A2:H500');
      const updates = [];
      for (let i = 0; i < recs.length; i++) {
        const brand = (recs[i][1]||'').trim();
        const prod  = (recs[i][2]||'').trim();
        if (brand === d.brand.trim() && prod === d.product.trim()) {
          updates.push({ row: i+2 });
        }
      }
      for (const u of updates) {
        await this.put(this.T.matRec+'!D'+u.row, [[cleanP]]);
      }
      localStorage.removeItem('ortho_matRec');
    }
  },

  async updateCodeRec(row, d, usageId) {
    if (usageId) {
      const r = await this.findRowByUid(this.T.codeRec, 'A2:H500', 6, usageId);
      if (r) row = r;
    }
    await this.put(this.T.codeRec+'!A'+row+':F'+row, [[d.date,d.name,d.price,d.code,d.area,d.qty]]);
    localStorage.removeItem('ortho_codeRec');
  },

  async updateClinicRec(row, d, usageId) {
    if (usageId) {
      const r = await this.findRowByUid(this.T.clinic, 'A2:F500', 4, usageId);
      if (r) row = r;
    }
    await this.put(this.T.clinic+'!A'+row+':D'+row, [[d.date,d.product,d.price||d.total,d.qty]]);
    localStorage.removeItem('ortho_clinic');
  },

  async addOp(d) {
    const r = await this.append(this.T.op, [[d.date,d.area,d.mrn||'',d.clinicId||'',d.name,d.type,d.opName,d.location,d.implant,d.note,this.uid()]]);
    localStorage.removeItem('ortho_op'); return r;
  },

  async addTrack(d) {
    const r = await this.append(this.T.track, [[d.date,d.area,d.mrn||'',d.clinicId||'',d.name,d.type,d.opName,d.location,d.implant,d.note,this.uid()]]);
    localStorage.removeItem('ortho_track'); return r;
  },

  async addMat(d) {
    const row = [d.date,d.brand,d.product,d.price,d.qty,this.uid(),'false','TRUE'];
    const r = await this.append(this.T.matRec, [row]);
    localStorage.removeItem('ortho_matRec'); return r;
  },

  async quickAddMat(brand, product, price) {
    const row = [this.nowMonth(),brand,product,price,'1',this.uid(),'false','TRUE'];
    const r = await this.append(this.T.matRec, [row]);
    localStorage.removeItem('ortho_matRec'); return r;
  },

  async addCode(d) {
    const r = await this.append(this.T.codeRec, [[d.date,d.name,d.price,d.code,d.area,d.qty,this.uid(),'']]);
    localStorage.removeItem('ortho_codeRec'); return r;
  },

  async quickAddCode(d) {
    const r = await this.append(this.T.codeRec, [[this.nowMonth(),d.name,d.price,d.code,d.area,'1',this.uid(),'TRUE']]);
    localStorage.removeItem('ortho_codeRec'); return r;
  },

  async quickAddClinic(name, price) {
    const cleanP = parseFloat(String(price).replace(/,/g,'')) || 0;
    const r = await this.append(this.T.clinic, [[this.nowMonth(),name,cleanP,'1',this.uid(),'TRUE']]);
    localStorage.removeItem('ortho_clinic'); return r;
  },

  async addClinic(d) {
    const r = await this.append(this.T.clinic, [[d.date,d.product,d.price||'',d.qty,this.uid(),'']]);
    localStorage.removeItem('ortho_clinic'); return r;
  },

  async deleteRow(tab, row, c1, c2, cacheKey, usageId, uidRange, uidCol) {
    if (usageId && uidRange !== undefined && uidCol !== undefined) {
      const r = await this.findRowByUid(tab, uidRange, uidCol, usageId);
      if (r) row = r;
    }
    await this.clearRow(tab, row, c1, c2);
    if (cacheKey) localStorage.removeItem('ortho_' + cacheKey);
  },
};
