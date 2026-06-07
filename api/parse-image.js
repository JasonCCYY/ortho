const https = require('https');

module.exports.config = { api: { bodyParser: { sizeLimit: '20mb' } } };

function geminiRequest(body) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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

    parts.push({ text: `這是台灣醫院手術排程系統截圖。
畫面中有黃色背景彈出框，每個代表一位病人。
只讀黃色框內文字，忽略其他。

擷取每個黃色框：
- 病患: 病歷號(純數字) 和 姓名
- 日期: 畫面頂部「手術日期」的民國年(如1150612)
- 手術批價碼: 「手術批價碼:」後的純數字(如64015)，多個用逗號或-分隔
- 備註: 「備註:」後的文字

只回傳JSON，不加說明：
{"patients":[{"mrn":"病歷號","name":"姓名","date_roc":"1150612","codes":["64015"],"note":"備註"}]}

無黃色框則回傳：{"patients":[]}` });

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
