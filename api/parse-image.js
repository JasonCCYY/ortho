const https = require('https');

module.exports.config = { api: { bodyParser: { sizeLimit: '20mb' } } };

function geminiRequest(body) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Gemini JSON parse failed: ' + data.substring(0, 300))); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function rocToAD(s) {
  s = String(s).replace(/\D/g, '');
  if (s.length === 7) return `${parseInt(s.slice(0,3))+1911}/${s.slice(3,5)}/${s.slice(5,7)}`;
  if (s.length === 8) return `${s.slice(0,4)}/${s.slice(4,6)}/${s.slice(6,8)}`;
  return null;
}
function stripZeros(s) { return s ? String(s).replace(/^0+/,'') || '0' : ''; }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

  try {
    const { images, opCatsByType, boneItems, abbrevList, brandProducts } = req.body || {};
    console.log('[parse-image] images count:', images?.length);
    if (!images?.length) return res.status(400).json({ ok:false, error:'No images provided' });

    // 驗證圖片格式
    const parts = [];
    for (const img of images) {
      const match = img.match(/^data:([^;]+);base64,(.+)$/s);
      if (!match) {
        console.log('[parse-image] invalid image format, prefix:', img.substring(0,30));
        return res.status(400).json({ ok:false, error:'Invalid image format' });
      }
      console.log('[parse-image] image mime:', match[1], 'size:', match[2].length);
      parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
    }

    parts.push({ text: `台灣醫院手術排程系統（ORRZ301）截圖。

【重要】所有資料只從黃色彈出框內讀取，背景白色欄位一律忽略。
背景白色欄位格式為「病歷號 醫師名 _病患名」，醫師名在底線前，病患名在底線後——這整行都要忽略，不可讀取。
唯一例外：左上方「手術日期」欄位可讀取。

每個黃色框回傳一筆資料；若不確定某欄位是否來自黃色框，填null或[]，不要猜測。

擷取每個黃色框的資料：

1. mrn: 黃色框內「病患:」後的純數字病歷號（非背景欄位）
2. name: 黃色框內「病患:」後的姓名（2-4個中文字，逐字讀取勿遺漏；非背景欄位的醫師名或病患名）
3. date_roc: 左上方「手術日期」民國年數字（如1151118）
4. codes: 「手術批價碼:」代碼陣列，每組只取開頭純數字（64087-64087C→64087），多組以-/、/,分隔；無則[]
5. note: 「備註:」後的完整文字
6. opName: ${opCatsByType && Object.keys(opCatsByType).length ? `從術式說明推斷手術類別，從清單選最接近名稱；查無則從圖片自行填入（VP=vertebroplasty, KP=kyphoplasty）
   類別→名稱清單:
${Object.entries(opCatsByType).map(([t,ns]) => `   ${t}: ${ns.join('、')}`).join('\n')}` : '從術式說明填入手術名稱，VP=vertebroplasty, KP=kyphoplasty；無法辨識則null'}
7. location: 手術部位。四肢/關節→Rt/Lt/Bilateral；脊椎手術→椎節（如 L3、T12、L3-L4）；無法辨識→null
8. implants: 從備註辨識骨材/生長因子，對應完整名稱後回傳陣列；無則[]${boneItems && boneItems.length ? `
   「縮寫*N」→「完整名 ×N」${abbrevList && abbrevList.length ? `；縮寫: ${abbrevList.join('、')}` : ''}
   清單: ${boneItems.join('、')}` : ''}${brandProducts && Object.keys(brandProducts).length ? `
   若備註只寫廠牌（如「AO」），結合手術context推斷產品（AO+Radius→「AO Radius」），加入implants；查無則只用廠牌名
   廠牌對照: ${JSON.stringify(brandProducts)}` : ''}

只回傳JSON，不加說明：
{"patients":[{"mrn":"純數字","name":"姓名","date_roc":"1150612","codes":["64087"],"note":"備註","opName":"名稱或null","location":"Rt或null","implants":[]}]}
若無黃色框：{"patients":[]}` });

    console.log('[parse-image] calling Gemini, parts:', parts.length);
    const result = await geminiRequest({ contents:[{ parts }], generationConfig:{ temperature:0.1 } });
    console.log('[parse-image] Gemini status:', result?.candidates?.[0]?.finishReason);

    if (result.error) {
      console.error('[parse-image] Gemini API error:', result.error);
      return res.status(500).json({ ok:false, error:result.error.message });
    }

    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('[parse-image] Gemini text:', text.substring(0, 500));

    if (!text) return res.status(500).json({ ok:false, error:'Gemini 無回應' });

    // 從文字中抽取 JSON
    const clean = text.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
    const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
    if (s === -1 || e === -1) return res.status(500).json({ ok:false, error:'找不到JSON: '+clean.substring(0,200) });

    let parsed;
    try { parsed = JSON.parse(clean.substring(s, e+1)); }
    catch(err) { return res.status(500).json({ ok:false, error:'JSON解析失敗: '+clean.substring(s,s+200) }); }

    const today = todayStr();
    const patients = (parsed.patients||[]).map(p => ({
      mrn:   stripZeros(p.mrn),
      name:  p.name||'',
      date:  (() => { const d = (p.date_roc ? rocToAD(p.date_roc) : null) || today; return d < today ? today : d; })(),
      codes: [...new Set((p.codes||[]).map(c=>String(c).trim()).filter(c=>/^\d+$/.test(c)))],
      note:  p.note||'',
      opName:   p.opName   && p.opName   !== 'null' ? p.opName   : '',
      location: p.location && p.location !== 'null' ? p.location : '',
      implants: Array.isArray(p.implants) ? p.implants.filter(x => x && x !== 'null') : [],
    }));

    // 去除重複（同病歷號+日期+代碼組合）
    const seen = new Set();
    const unique = patients.filter(p => {
      const key = `${p.mrn}|${p.date}|${p.codes.sort().join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log('[parse-image] success, patients:', unique.length, '(deduped from', patients.length, ')');
    res.json({ ok:true, patients: unique });

  } catch(e) {
    console.error('[parse-image] exception:', e.message);
    res.status(500).json({ ok:false, error: e.message });
  }
};
