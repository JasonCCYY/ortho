// /api/parse-image  →  送圖片給 Gemini，回傳解析結果
const https = require('https');

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
        catch(e) { reject(e); }
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
    const ad  = roc + 1911;
    return `${ad}/${mm}/${dd}`;
  }
  // 已是西元格式 (e.g. 20260612)
  if (s.length === 8) {
    return `${s.substring(0,4)}/${s.substring(4,6)}/${s.substring(6,8)}`;
  }
  return null;
}

// 去前導零
function stripLeadingZeros(mrn) {
  if (!mrn) return '';
  return String(mrn).replace(/^0+/, '') || '0';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { images } = req.body; // Array of base64 strings (with data: prefix)
    if (!images || !images.length) return res.status(400).json({ ok: false, error: 'No images' });

    // 組合 Gemini 請求：所有圖片 + prompt
    const parts = [];

    // 加入所有圖片
    images.forEach((img, i) => {
      const match = img.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return;
      parts.push({
        inline_data: {
          mime_type: match[1],
          data: match[2],
        }
      });
    });

    // Prompt：指示 Gemini 只讀黃色框
    parts.push({
      text: `這些是台灣醫院手術排程系統的截圖。
畫面中可能有黃色背景的彈出框（tooltip），每個黃色框代表一位病人的資料。
請只讀取黃色框內的資料，忽略背景其他內容。

每個黃色框請擷取以下資料：
1. 病患欄位：包含病歷號（純數字）和姓名
2. 日期：從畫面頂部的「手術日期」欄位（格式為民國年如1150612）
3. 手術批價碼：「手術批價碼:」後面的純數字部分（如64015、64247），可能有多個用-或逗號分隔，只取純數字代碼
4. 備註：「備註:」後面的完整文字

請以 JSON 格式回傳，不要加任何說明文字：
{
  "patients": [
    {
      "mrn": "病歷號純數字去掉前導零",
      "name": "姓名",
      "date_roc": "民國日期數字如1150612，若無法辨識則填null",
      "codes": ["64015", "64247"],
      "note": "備註文字"
    }
  ]
}

若圖中沒有黃色框，回傳 { "patients": [] }`
    });

    const result = await geminiRequest({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: 'application/json',
      },
    });

    // 解析 Gemini 回傳
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let parsed;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch(e) {
      return res.status(500).json({ ok: false, error: 'Gemini parse failed', raw: text });
    }

    // 後處理：民國轉西元、去前導零
    const today = new Date();
    const todayStr = `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,'0')}/${String(today.getDate()).padStart(2,'0')}`;

    const patients = (parsed.patients || []).map(p => ({
      mrn:   stripLeadingZeros(p.mrn),
      name:  p.name || '',
      date:  (p.date_roc ? rocToAD(p.date_roc) : null) || todayStr,
      codes: (p.codes || []).filter(c => /^\d+$/.test(c)),
      note:  p.note || '',
    }));

    res.json({ ok: true, patients });

  } catch(e) {
    console.error('parse-image error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
