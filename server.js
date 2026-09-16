/**
 * 盘点录入 - 本地代理服务（零依赖，Node 18+）
 * --------------------------------------------
 * 作用：
 *  1. 托管 public/index.html 网页
 *  2. 代理网页请求 -> WPS 多维表格 AirScript Webhook（解决浏览器跨域）
 *  3. config.json 中 mock=true 时返回模拟数据，便于先跑通页面
 *
 * 启动：node server.js   （或双击 启动.bat）
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const PORT = Number(config.port) || 5217;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// ---------- Mock 数据（config.mock=true 时使用） ----------
const MOCK_PRODUCTS = [
  { id: "15056", name: "150轻上厚椰乳（拼多多定制版*15）", bc: "6975983218275-1" },
  { id: "15056", name: "150轻上厚椰乳（ adjustments版*15）", bc: "6975983218275-2" },
  { id: "235025", name: "235纤冠军至宝油柑汁（1*10）", bc: "6975983217490" },
  { id: "Z-01684", name: "220东方补善六味地黄饮6瓶", bc: "6975983219135" },
  { id: "220339", name: "220东方补善六味地黄饮（1*6）", bc: "6975983219135-2" },
];

function baseBarcode(s) {
  return String(s === null || s === undefined ? "" : s).trim().replace(/-\d+$/, "");
}

function mockResponse(payload) {
  const argv = (payload && payload.Context && payload.Context.argv) || {};
  if (argv.action === "query") {
    const barcode = baseBarcode(argv.barcode);
    const matches = MOCK_PRODUCTS.filter((p) => baseBarcode(p.bc) === barcode).map((p) => ({
      产品编号: p.id,
      产品名称: p.name,
      货品条码: p.bc,
    }));
    return { code: 0, action: "query", barcode, matches };
  }
  if (argv.action === "submit") {
    return { code: 0, action: "submit", written: argv.data || {}, skippedFields: [] };
  }
  return { code: 1, message: "mock: 未知 action" };
}

// ---------- 从 kdocs 响应中提取脚本返回值（兼容多种包装格式） ----------
function unwrapResult(json) {
  if (!json || typeof json !== "object") return { code: 1, message: "响应格式异常" };
  // 直接就是脚本返回值
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

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---------- 服务 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  // API 状态
  if (req.method === "GET" && pathname === "/api/status") {
    const configured = Boolean(config.webhookUrl && config.webhookUrl.indexOf("https://www.kdocs.cn/") === 0 && config.token);
    return sendJson(res, 200, { mock: Boolean(config.mock), configured });
  }

  // 代理到 AirScript Webhook
  if (req.method === "POST" && pathname === "/api/airscript") {
    try {
      const raw = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: "请求体不是合法 JSON" });
      }

      if (config.mock) {
        await new Promise((r) => setTimeout(r, 350)); // 模拟网络延迟
        return sendJson(res, 200, { ok: true, result: mockResponse(payload) });
      }

      if (!config.webhookUrl || !config.token) {
        return sendJson(res, 500, { ok: false, error: "config.json 未配置 webhookUrl / token" });
      }

      const resp = await fetch(config.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "AirScript-Token": config.token,
        },
        body: JSON.stringify(payload),
      });
      const text = await resp.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (e) {}
      if (!json) {
        return sendJson(res, 502, { ok: false, error: `kdocs 返回非 JSON（HTTP ${resp.status}）`, raw: text.slice(0, 500) });
      }
      return sendJson(res, 200, { ok: resp.ok, httpStatus: resp.status, result: unwrapResult(json) });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) });
    }
  }

  // 静态文件
  let filePath = pathname === "/" ? "/public/index.html" : pathname;
  filePath = path.normalize(path.join(ROOT, filePath));
  if (!filePath.startsWith(path.join(ROOT, "public"))) {
    // 只允许访问 public 目录
    if (pathname !== "/") return sendJson(res, 403, { error: "forbidden" });
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not Found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(buf);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`盘点录入服务已启动 (本机): http://localhost:${PORT}`);
  // 列出局域网地址，方便手机访问
  const os = require("os");
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) ips.push(`http://${net.address}:${PORT}`);
    }
  }
  if (ips.length) {
    console.log("手机（连同一 WiFi）访问:");
    ips.forEach((u) => console.log("  " + u));
  }
  console.log(`模式: ${config.mock ? "MOCK（模拟数据）" : "REAL（已对接多维表格 Webhook）"}`);
});
