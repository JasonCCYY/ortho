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

function rocToAD(value) {
  const text = String(value ?? '').normalize('NFKC').trim();
  const compact = text.match(/^(\d{3,4})(\d{2})(\d{2})$/);
  const separated = text.match(/^(?:民國\s*)?(\d{2,4})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})$/);
  const parts = compact || separated;
  if (!parts) return null;
  const [, yearText, monthText, dayText] = parts;
  const year = Number(yearText) + (yearText.length < 4 ? 1911 : 0);
  const month = Number(monthText);
  const day = Number(dayText);
  if (Number(yearText) === 0 || year < 1912 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('/');
}
function stripZeros(s) { return s ? String(s).replace(/^0+/,'') || '0' : ''; }
function todayStr(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('/');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

  try {
    const { images, opCatsByType, codeTypes, boneItems, abbrevList, brandProducts } = req.body || {};
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

黃色彈出框的固定格式（第一行必為「狀態:已排程」）：
  狀態:已排程
  病患:＜病歷號＞ ＜姓名＞
  來源:...
  時間:...
  麻醉方式:...
  手術診斷:...
  手術批價碼:...
  備註:...

【重要】每張圖片含一個黃色彈出框，每張圖片回傳一筆資料（3張圖片→3筆）。
背景白色欄位（格式「病歷號 醫師名 _病患名」）一律忽略，即使內容與黃色框相似也不可讀取。
【手術日期先讀】每張圖片先獨立檢查左上方黃色「手術室設定」區，再讀黃色彈出框。
「手術日期」常分兩行顯示為「手術」和「日期」，日期在它右側的灰白輸入框，通常在查詢和列印按鈕左側。例如若示意值為 1160314，date_roc 回傳 "1160314"。
即使標籤被裁切，若仍能從位置和輸入框確定它是手術日期，且所有數字清楚可讀，亦可擷取。輸入框未入鏡、數字不完整或無法確認時回傳 null。禁止用病歷號、手術單號或其他圖片的日期補值。

擷取該黃色框的以下欄位（不確定來源則填null/[]）：

1. mrn: 「病患:」標籤後的純數字（通常 7–10 位，保留前導零）
2. name: 「病患:」標籤後的姓名（2-4個中文字，逐字讀取勿遺漏）
3. date_roc: 此張圖左上方手術日期輸入框的完整數字（民國 YYYMMDD 或西元 YYYYMMDD），看不到或無法確認則填 null
4. codes: 「手術批價碼:」標籤後的代碼陣列。手術代碼固定5位純數字（如64286、64087），每組只取開頭5位數字（64286-關節鏡下旋轉肌→64286）；多組以-/、/,分隔；病歷號不是代碼；無則[]
5. note: 「備註:」標籤後的完整文字
6. opName: 查表流程：手術批價碼（5位數）→ 以下代碼對照表查出類型 → 從類型清單選最接近名稱；若代碼查無類型或清單無符合，再從「手術批價碼:」的說明文字推斷（VP=vertebroplasty, KP=kyphoplasty）；不可用背景欄位文字；完全無法判斷則null${codeTypes && Object.keys(codeTypes).length ? `
   代碼→類型: ${JSON.stringify(codeTypes)}` : ''}${opCatsByType && Object.keys(opCatsByType).length ? `
   類型→名稱清單:
${Object.entries(opCatsByType).map(([t,ns]) => `   ${t}: ${ns.join('、')}`).join('\n')}` : ''}
7. location: 手術部位。脊椎手術→椎節（如L3、T12、L3-L4）；四肢/關節→Rt/Lt/Bilateral；無法辨識→null
8. implants: 從黃色框備註辨識骨材，依序使用以下規則：
   先比對已登記的縮寫。「縮寫*N」回傳「廠牌 產品 ×N」，忽略縮寫前的分隔符（例如 ;*I*2）。
   沒有符合的縮寫時，用可見的品名片段、可辨認的廠牌、規格和手術上下文，從清單選出最可能的產品。只有廠牌或只有手術名稱時，若清單上仍有多個合理候選，省略該品項；規格矛盾也省略。
   一律回傳清單中的原始廠牌與品名，不新增品項或改寫規格；沒有可靠候選則回傳 []。${abbrevList && abbrevList.length ? `
   辨識縮寫對照（縮寫=廠牌 產品）: ${abbrevList.join('、')}` : ''}${brandProducts && Object.keys(brandProducts).length ? `
   骨材清單（廠牌→產品）: ${JSON.stringify(brandProducts)}` : boneItems && boneItems.length ? `
   骨材清單: ${boneItems.join('、')}` : ''}

備註解析範例：
  「L3 VP; depuy (PASS)」→ location=L3、opName=vertebroplasty、implants=[]
  「Rt radius; AO」→ location=Rt、opName=Forearm、implants=[]

只回傳JSON，不加說明：
{"patients":[{"mrn":"純數字","name":"姓名","date_roc":"1150612","codes":["64087"],"note":"備註","opName":"名稱或null","location":"L3或Rt或null","implants":[]}]}
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
      date:  rocToAD(p.date_roc) || today,
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
