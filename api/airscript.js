/**
 * Vercel Serverless Function：代理转发到 WPS 多维表格 AirScript Webhook
 * 环境变量（Vercel 项目 Settings -> Environment Variables 配置）：
 *   WEBHOOK_URL     脚本 webhook 地址（https://www.kdocs.cn/api/v3/ide/file/xxx/script/xxx/sync_task）
 *   AIRSCRIPT_TOKEN 脚本令牌
 */
function unwrapResult(json) {
  if (!json || typeof json !== "object") return { code: 1, message: "响应格式异常" };
  if (json.code !== undefined && (json.action || json.matches || json.message)) return json;
  const candidates = [json.data, json.result, json.ret];
  for (const c of candidates) {
    if (!c) continue;
    let v = c;
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch (e) {
        continue;
      }
    }
    if (v && typeof v === "object" && v.code !== undefined) return v;
    if (v && typeof v === "object" && v.result) {
      let r = v.result;
      if (typeof r === "string") {
        try {
          r = JSON.parse(r);
        } catch (e) {}
      }
      if (r && typeof r === "object" && r.code !== undefined) return r;
    }
  }
  return { code: 1, message: "未能解析脚本返回值", raw: json };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "仅支持 POST" });
  }

  const WEBHOOK_URL = process.env.WEBHOOK_URL;
  const TOKEN = process.env.AIRSCRIPT_TOKEN;
  if (!WEBHOOK_URL || !TOKEN) {
    return res.status(500).json({ ok: false, error: "服务端未配置 WEBHOOK_URL / AIRSCRIPT_TOKEN 环境变量" });
  }

  try {
    const payload = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const resp = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "AirScript-Token": TOKEN,
      },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {}
    if (!json) {
      return res.status(502).json({ ok: false, error: "kdocs 返回非 JSON（HTTP " + resp.status + "）", raw: text.slice(0, 500) });
    }
    return res.status(200).json({ ok: resp.ok, httpStatus: resp.status, result: unwrapResult(json) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
};
