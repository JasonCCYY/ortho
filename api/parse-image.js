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
    const { images } = req.body || {};
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

    parts.push({ text: `這是台灣醫院手術排程系統（ORRZ301）截圖。
畫面中有黃色背景彈出框，每個代表一位病人的手術資料。
只讀黃色框內文字，完全忽略框外的其他內容。

從黃色框擷取以下資料：

1. 病患: 「病患:」後面的內容，格式為「病歷號 姓名」，病歷號是純數字

2. 日期: 畫面最上方「手術日期」欄位的民國年數字（如1150612代表民國115年6月12日）

3. 手術批價碼: 「手術批價碼:」後面的代碼
   - 代碼格式範例：「64087-64087C 腱鞘囊腫摘出術」→ 只取「64087」（開頭的純數字部分）
   - 多組代碼用「-」或「、」或「,」分隔，例如「64015-64032」→ 取「64015」和「64032」
   - 每組只取開頭的純數字，忽略後面的英文字母和中文說明
   - 若無批價碼則回傳空陣列

4. 備註: 「備註:」後面的完整文字（不包含「備註:」本身）

只回傳JSON，不加任何說明文字：
{"patients":[{"mrn":"病歷號純數字","name":"姓名","date_roc":"1150612","codes":["64087","64015"],"note":"備註文字"}]}

若無黃色框則回傳：{"patients":[]}` });

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
      date:  (p.date_roc ? rocToAD(p.date_roc) : null) || today,
      codes: (p.codes||[]).map(c=>String(c).trim()).filter(c=>/^\d+$/.test(c)),
      note:  p.note||'',
    }));

    console.log('[parse-image] success, patients:', patients.length);
    res.json({ ok:true, patients });

  } catch(e) {
    console.error('[parse-image] exception:', e.message);
    res.status(500).json({ ok:false, error: e.message });
  }
};
