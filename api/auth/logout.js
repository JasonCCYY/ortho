// /api/auth/logout  →  清除 refresh_token cookie
module.exports = (req, res) => {
  res.setHeader('Set-Cookie', 'ortho_rt=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
  res.json({ ok: true });
};
