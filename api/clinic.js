const http  = require('http');
const iconv = require('iconv-lite');

const DOCTOR = '\u8523\u5143\u921e'; // 蔣元鈞

module.exports = async (req, res) => {
  function fetchHtml(dateStr) {
    const urlPath = dateStr
      ? `/Main/Clinic100?date=${dateStr}&sec_no=06&emp_no=`
      : '/Main/Clinic100';
    return new Promise((resolve, reject) => {
      const r = http.request({
        hostname: 'register.jjoh.org',
        path: urlPath,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-TW,zh;q=0.9',
          'Referer': 'http://register.jjoh.org/',
        },
      }, resp => {
        const chunks = [];
        resp.on('data', c => chunks.push(c));
        resp.on('end', () => {
          const buf = Buffer.concat(chunks);
          let html = iconv.decode(buf, 'utf8');
          const m = html.match(/charset=["']?([\w-]+)/i);
          const cs = m ? m[1].toLowerCase() : 'big5';
          if (cs !== 'utf-8' && cs !== 'utf8') html = iconv.decode(buf, cs);
          resolve(html);
        });
      });
      r.setTimeout(12000, () => { r.destroy(); reject(new Error('timeout')); });
      r.on('error', reject);
      r.end();
    });
  }

  function parse(html) {
    const shiftMap = {
      '\u65e9\u4e0a': { label: '\u65e9\u4e0a', cls: 'tag-am' },
      '\u4e0b\u5348': { label: '\u4e0b\u5348', cls: 'tag-pm' },
      '\u665a\u4e0a': { label: '\u591c\u8a3a', cls: 'tag-night' },
    };
    const results = [];
    const re = new RegExp('<a[^>]*data-doctor=' + DOCTOR + '[^>]*>', 'g');
    let m;
    while ((m = re.exec(html)) !== null) {
      const tag = m[0];
      const visitdt = (tag.match(/data-visitdt=([^\s>]+)/) || [])[1] || '';
      const shift   = (tag.match(/data-shiftname=([^\s>]+)/) || [])[1] || '';
      const room    = (tag.match(/data-roname=([^\s>]+)/)    || [])[1] || '-';
      const num     = (tag.match(/data-visitno=(\d+)/)       || [])[1] || '-';
      const dm = visitdt.match(/(\d{4})\u5e74(\d{2})\u6708(\d{2})\u65e5\(\u661f\u671f(.)\)/);
      if (!dm) continue;
      const [, yyyy, mm, dd, dow] = dm;
      const si = shiftMap[shift] || { label: shift, cls: '' };
      results.push({ dateKey: `${yyyy}${mm}${dd}`, date: `${mm}/${dd}(${dow})`, session: si.label, cls: si.cls, room, num, numCls: '' });
    }
    return results;
  }

  function fmtDate(d) {
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  }

  try {
    const today    = new Date();
    const todayKey = fmtDate(today);
    const endKey   = fmtDate(new Date(today.getTime() + 14 * 86400000));
    const nextWeek = fmtDate(new Date(today.getTime() +  7 * 86400000));

    const [h1, h2] = await Promise.all([fetchHtml(null), fetchHtml(nextWeek)]);
    const seen = new Set();
    const results = [...parse(h1), ...parse(h2)]
      .filter(r => { const k = r.dateKey + r.session; return seen.has(k) ? false : seen.add(k); })
      .filter(r => r.dateKey >= todayKey && r.dateKey <= endKey)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
