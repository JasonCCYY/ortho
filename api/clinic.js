const axios = require('axios');
const iconv = require('iconv-lite');

async function fetchClinicHtml(dateStr) {
  // dateStr 格式：YYYYMMDD（無橫線）
  const url = dateStr
    ? `http://register.jjoh.org/Main/Clinic100?date=${dateStr}&sec_no=06&emp_no=`
    : 'http://register.jjoh.org/Main/Clinic100';
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-TW,zh;q=0.9',
      'Referer': 'http://register.jjoh.org/',
    },
    timeout: 12000,
  });
  let html = iconv.decode(Buffer.from(data), 'utf8');
  const charsetMatch = html.match(/charset=["']?([\w-]+)/i);
  const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'big5';
  if (charset !== 'utf-8' && charset !== 'utf8') {
    html = iconv.decode(Buffer.from(data), charset);
  }
  return html;
}

function parseChiang(html) {
  const results = [];
  const shiftMap = {
    '早上': { label: '早上', cls: 'tag-am' },
    '下午': { label: '下午', cls: 'tag-pm' },
    '晚上': { label: '夜診', cls: 'tag-night' },
  };
  const linkRegex = /<a[^>]*data-doctor=蔣元鈞[^>]*>/g;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const tag = match[0];
    const visitdt = (tag.match(/data-visitdt=([^\s>]+)/) || [])[1] || '';
    const shift   = (tag.match(/data-shiftname=([^\s>]+)/) || [])[1] || '';
    const room    = (tag.match(/data-roname=([^\s>]+)/) || [])[1] || '–';
    const visitno = (tag.match(/data-visitno=(\d+)/) || [])[1] || '–';
    const dateMatch = visitdt.match(/(\d{4})年(\d{2})月(\d{2})日\(星期(.)\)/);
    if (!dateMatch) continue;
    const [, yyyy, mm, dd, dow] = dateMatch;
    const shiftInfo = shiftMap[shift] || { label: shift, cls: '' };
    results.push({
      dateKey: `${yyyy}${mm}${dd}`,
      date:    `${mm}/${dd}(${dow})`,
      session: shiftInfo.label,
      cls:     shiftInfo.cls,
      room, num: visitno, numCls: '',
    });
  }
  return results;
}

function formatDateCompact(d) {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

module.exports = async (req, res) => {
  try {
    const today = new Date();
    const todayKey = formatDateCompact(today);
    const endDate  = new Date(today); endDate.setDate(today.getDate() + 14);
    const endKey   = formatDateCompact(endDate);

    // 抓兩頁：本週 + 下一週（用 date=今天+7天 跳到下週）
    const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7);

    const [h1, h2] = await Promise.all([
      fetchClinicHtml(null),                           // 本週（首頁）
      fetchClinicHtml(formatDateCompact(nextWeek)),    // 下週
    ]);

    let results = [...parseChiang(h1), ...parseChiang(h2)];

    // 去重
    const seen = new Set();
    results = results.filter(r => {
      const key = r.dateKey + r.session;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 只保留今天起14天內
    results = results.filter(r => r.dateKey >= todayKey && r.dateKey <= endKey);

    // 按日期排序
    results.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
