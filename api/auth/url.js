// /api/auth/url  →  回傳 Google OAuth 授權網址
module.exports = (req, res) => {
  const base = 'https://accounts.google.com/o/oauth2/v2/auth';
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  'https://ortho-nu.vercel.app/api/auth/callback',
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    access_type:   'offline',   // 取得 refresh_token
    prompt:        'consent',   // 強制每次都給 refresh_token
  });
  res.json({ url: `${base}?${params}` });
};
