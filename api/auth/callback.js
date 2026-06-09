// /api/auth/callback  →  code → token 交換，設 httpOnly cookie
const https = require('https');
const querystring = require('querystring');

async function exchangeCode(code) {
  const body = querystring.stringify({
    code,
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri:  'https://ortho-nu.vercel.app/api/auth/callback',
    grant_type:    'authorization_code',
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchUserInfo(accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: '/oauth2/v2/userinfo',
      headers: { Authorization: 'Bearer ' + accessToken },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect('/?auth_error=' + (error || 'no_code'));
  }

  try {
    const tokens = await exchangeCode(code);
    if (tokens.error) {
      return res.redirect('/?auth_error=' + tokens.error);
    }

    // refresh_token → httpOnly cookie（瀏覽器 JS 讀不到）
    const isProd = process.env.NODE_ENV !== 'development';
    const cookieOpts = [
      `ortho_rt=${tokens.refresh_token || ''}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      isProd ? 'Secure' : '',
      'Max-Age=31536000',
    ].filter(Boolean).join('; ');
    res.setHeader('Set-Cookie', cookieOpts);

    res.redirect('/');

  } catch(e) {
    console.error('Auth callback error:', e);
    res.redirect('/?auth_error=server_error');
  }
};
