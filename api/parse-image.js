// /api/parse-image  →  送圖片給 Gemini，回傳解析結果
const https = require('https');

// Vercel：關閉預設 body parser，改手動處理（避免大圖片被截斷）
module.exports.config = { api: { bodyParser: { sizeLimit: '20mb' } } };

function geminiRequest(body) {
  const apiKey = process.env.GEMINI_API_KEY;
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
        catch(e) { reject(new Error('Gemini response parse failed: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// 民國年轉西元：1150612 → 2026/06/12
function rocToAD(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).replace(/\D/g, '');
  if (s.length === 7) {
    const roc = parseInt(s.substring(0, 3));
    const mm  = s.substring(3, 5);
    const dd  = s.substring(5, 7);
    return `${roc + 1911}/${mm}/${dd}`;
  }
  if (s.length === 8) {
    return `${s.substring(0,4)}/${s.substring(4,6)}/${s.substring(6,8)}`;
  }
  return null;
}

function stripLeadingZeros(mrn) {
  if (!mrn) return '';
  return String(mrn).replace(/^0+/, '') || '0';
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { images } = req.body;
    if (!images || !images.length) return res.status(400).json({ ok: false, error: 'No images' });

    const parts = [];

    // 加入所有圖片
    images.forEach(img => {
      const match = img.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return;
      parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
    });

    // Prompt
    parts.push({
      text: `這些是台灣醫院手術排程系統（ORRZ301）的截圖。
畫面中有黃色背景的彈出框，每個黃色框代表一位病人。
請只讀取黃色框內的文字，忽略其他背景內容。

從每個黃色框擷取：
1. 病患：「病患:」後的病歷號（純數字）和姓名（空格隔開）
2. 日期：畫面最上方「手術日期」欄位的民國年數字（如1150612）
3. 手術批價碼：「手術批價碼:」後的純數字代碼（如64015、64247），多個代碼用-或逗號分隔，只取數字部分
4. 備註：「備註:」後的文字

嚴格以此 JSON 格式回傳，不加任何說明：
{"patients":[{"mrn":"病歷號","name":"姓名","date_roc":"民國日期如1150612","codes":["64015","64247"],"note":"備註"}]}

若無黃色框回傳：{"patients":[]}`
    });

    const result = await geminiRequest({
      contents: [{ parts }],
      generationConfig: { temperature: 0.1 },
    });

    // 檢查 Gemini 錯誤
    if (result.error) {
      return res.status(500).json({ ok: false, error: result.error.message || 'Gemini error' });
    }

    // 取出文字
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      const reason = result?.candidates?.[0]?.finishReason || 'unknown';
      return res.status(500).json({ ok: false, error: `Gemini 無回應 (${reason})` });
    }

    // 解析 JSON（去掉可能的 markdown 包裝）
    let parsed;
    try {
      const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      // 找第一個 { 到最後一個 }
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON found');
      parsed = JSON.parse(clean.substring(start, end + 1));
    } catch(e) {
      return res.status(500).json({ ok: false, error: 'JSON 解析失敗', raw: text.substring(0, 300) });
    }

    const today = todayStr();
    const patients = (parsed.patients || []).map(p => ({
      mrn:   stripLeadingZeros(p.mrn),
      name:  p.name || '',
      date:  (p.date_roc ? rocToAD(p.date_roc) : null) || today,
      codes: (p.codes || []).map(c => String(c).trim()).filter(c => /^\d+$/.test(c)),
      note:  p.note || '',
    }));

    res.json({ ok: true, patients });

  } catch(e) {
    console.error('parse-image error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
