/** Vercel Serverless Function：服务状态（供页面左下角/顶栏显示） */
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const configured = Boolean(process.env.WEBHOOK_URL && process.env.AIRSCRIPT_TOKEN);
  return res.status(200).json({ mock: false, configured });
};
