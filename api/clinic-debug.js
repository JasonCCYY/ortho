const axios = require('axios');
const iconv = require('iconv-lite');

module.exports = async (req, res) => {
  const date = req.query.date || null;
  try {
    const url = date
      ? `http://register.jjoh.org/Main/Clinic100?date=${date}`
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

    // 找所有 data-visitdt 的日期值
    const dates = [...html.matchAll(/data-visitdt=(\d{4}年\d{2}月\d{2}日[^\s>]+)/g)]
      .map(m => m[1]);
    const unique = [...new Set(dates)];

    // 找蔣元鈞的資料
    const chiang = [...html.matchAll(/<a[^>]*data-doctor=蔣元鈞[^>]*>/g)]
      .map(m => {
        const tag = m[0];
        return {
          date: (tag.match(/data-visitdt=([^\s>]+)/) || [])[1],
          shift: (tag.match(/data-shiftname=([^\s>]+)/) || [])[1],
          room: (tag.match(/data-roname=([^\s>]+)/) || [])[1],
          num: (tag.match(/data-visitno=(\d+)/) || [])[1],
        };
      });

    res.json({ url, uniqueDates: unique, chiang });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
