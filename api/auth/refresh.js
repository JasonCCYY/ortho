// /api/auth/refresh  →  用 refresh_token cookie 換新 access_token + user info
const https = require('https');
const querystring = require('querystring');

function parseCookies(h) {
  const c = {};
  if (!h) return c;
  h.split(';').forEach(p => { const [k,...v]=p.trim().split('='); c[k.trim()]=v.join('='); });
  return c;
}

function post(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){reject(e)} }); });
    req.on('error', reject); req.write(body); req.end();
  });
}

function get(hostname, path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path,
      headers:{ Authorization:'Bearer '+token }
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){reject(e)} }); });
    req.on('error', reject); req.end();
  });
}

module.exports = async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const rt = cookies['ortho_rt'];
  if (!rt) return res.status(401).json({ ok:false, error:'no_refresh_token' });

  try {
    const tokens = await post('oauth2.googleapis.com', '/token', querystring.stringify({
      refresh_token: rt,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type:    'refresh_token',
    }));

    if (tokens.error) {
      res.setHeader('Set-Cookie', 'ortho_rt=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
      return res.status(401).json({ ok:false, error:tokens.error });
    }

    // 同時取 user info（不額外 round-trip，首次 refresh 才需要）
    let user = null;
    try { user = await get('www.googleapis.com', '/oauth2/v2/userinfo', tokens.access_token); } catch(_) {}

    res.json({
      ok:           true,
      access_token: tokens.access_token,
      expires_in:   tokens.expires_in,
      user:         user ? { name:user.name, picture:user.picture, email:user.email } : undefined,
    });
  } catch(e) {
    console.error('Refresh error:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
};
