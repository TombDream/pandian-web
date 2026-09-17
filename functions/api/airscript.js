/**
 * EdgeOne Pages Function：代理转发到 WPS 多维表格 AirScript Webhook
 * 路由：POST /api/airscript
 * 环境变量（EdgeOne Pages 项目设置 -> 环境变量）：
 *   WEBHOOK_URL     脚本 webhook 地址
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

export async function onRequestPost(context) {
  const env = (context && context.env) || {};
  const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

  const WEBHOOK_URL = env.WEBHOOK_URL;
  const TOKEN = env.AIRSCRIPT_TOKEN;
  if (!WEBHOOK_URL || !TOKEN) {
    return new Response(
      JSON.stringify({ ok: false, error: "服务端未配置 WEBHOOK_URL / AIRSCRIPT_TOKEN 环境变量" }),
      { status: 500, headers: jsonHeaders }
    );
  }

  try {
    let payload = {};
    try {
      payload = await context.request.json();
    } catch (e) {}

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
      return new Response(
        JSON.stringify({ ok: false, error: "kdocs 返回非 JSON（HTTP " + resp.status + "）", raw: text.slice(0, 500) }),
        { status: 502, headers: jsonHeaders }
      );
    }
    return new Response(
      JSON.stringify({ ok: resp.ok, httpStatus: resp.status, result: unwrapResult(json) }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String((err && err.message) || err) }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
