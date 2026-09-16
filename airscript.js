/**
 * 盘点录入 Web API 入口（AirScript · 多维表格）
 * ============================================================
 * 使用方式：粘贴到「测试盘点」多维表格的 脚本 > AirScript脚本 编辑器，
 * 开启 Webhook（复制脚本webhook + 设置脚本令牌）。
 *
 * 请求格式（由本地代理转发）：
 *   查询条码：{"Context":{"argv":{"action":"query","barcode":"6975983219135"}}}
 *   提交记录：{"Context":{"argv":{"action":"submit","data":{
 *       "库位":"A-01","条码":"6975983219135-1","数量":2,
 *       "生产日期":"2026/01/01","到期日期":"2027/01/01",
 *       "产品编号":"15056","产品名称":"150轻上厚椰乳..."}}}}
 *
 * 同条码多品名规则：货品条码中 "-1"、"-2" 等后缀会被去掉后按基础条码匹配，
 * 如 6975983219135-1 / 6975983219135-2 都归到 6975983219135。
 * ============================================================
 */

// ===== 配置：数据表名称（按实际表名修改） =====
var PRODUCT_SHEET = "货品资料"; // 条码对照表
var TARGET_SHEET = "盘点数据"; // 提交写入的表

// ===== 工具函数 =====
function pickId(o) {
  return o.id !== undefined ? o.id : o.Id;
}
function pickName(o) {
  return o.name !== undefined ? o.name : o.Name;
}

function getSheetId(name) {
  // AirScript 2.0：Application.Sheets("表名")
  try {
    var sh = Application.Sheets(name);
    if (sh) {
      if (sh.Id !== undefined && sh.Id !== null) return sh.Id;
      if (sh.id !== undefined && sh.id !== null) return sh.id;
    }
  } catch (e) {}
  // AirScript 1.0 回退：Application.Sheet.GetSheets()
  try {
    var sheets = Application.Sheet.GetSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (pickName(sheets[i]) === name) return pickId(sheets[i]);
    }
  } catch (e) {}
  return null;
}

function getAllRecords(sheetId, fields) {
  var offset = null;
  var all = [];
  do {
    var opt = { SheetId: sheetId, PageSize: 1000 };
    if (offset) opt.Offset = offset;
    if (fields) opt.Fields = fields;
    var res = Application.Record.GetRecords(opt);
    all = all.concat(res.records || []);
    offset = res.offset || null;
  } while (offset);
  return all;
}

// 去掉条码尾部的 -数字 后缀
function baseBarcode(s) {
  return String(s === null || s === undefined ? "" : s)
    .trim()
    .replace(/-\d+$/, "");
}

// ===== 主逻辑 =====
var argv = typeof Context !== "undefined" && Context.argv ? Context.argv : {};
var action = argv.action || "query";

var prodId = getSheetId(PRODUCT_SHEET);
if (prodId === null) {
  return { code: 1, message: "找不到数据表【" + PRODUCT_SHEET + "】，请检查脚本顶部配置" };
}

// ---- 查询条码 ----
if (action === "query") {
  var barcode = baseBarcode(argv.barcode);
  if (!barcode) return { code: 1, message: "条码为空" };

  var recs = getAllRecords(prodId, ["产品编号", "产品名称", "货品条码"]);
  var matches = [];
  for (var i = 0; i < recs.length; i++) {
    var f = recs[i].fields || {};
    if (baseBarcode(f["货品条码"]) === barcode) {
      matches.push({
        产品编号: f["产品编号"] === null || f["产品编号"] === undefined ? "" : String(f["产品编号"]),
        产品名称: f["产品名称"] === null || f["产品名称"] === undefined ? "" : String(f["产品名称"]),
        货品条码: f["货品条码"] === null || f["货品条码"] === undefined ? "" : String(f["货品条码"]),
      });
    }
  }
  return { code: 0, action: "query", barcode: barcode, matches: matches };
}

// ---- 提交记录 ----
if (action === "submit") {
  var targetId = getSheetId(TARGET_SHEET);
  if (targetId === null) {
    return { code: 1, message: "找不到数据表【" + TARGET_SHEET + "】，请检查脚本顶部配置" };
  }

  var data = argv.data || {};
  // 只写入目标表中已存在的字段，避免因缺列报错
  var exist = null;
  var skipped = [];
  try {
    exist = {};
    var flds = Application.Field.GetFields({ SheetId: targetId });
    var list = flds.fields || flds || [];
    for (var j = 0; j < list.length; j++) {
      var n = list[j].name !== undefined ? list[j].name : list[j].Name;
      if (n) exist[n] = true;
    }
  } catch (e) {
    exist = null;
  }

  var out = {};
  for (var k in data) {
    if (exist === null || exist[k]) {
      out[k] = data[k];
    } else {
      skipped.push(k);
    }
  }

  try {
    Application.Record.CreateRecords({ SheetId: targetId, Records: [{ fields: out }] });
  } catch (e2) {
    return { code: 1, action: "submit", message: "写入失败：" + (e2 && e2.message ? e2.message : String(e2)), data: out };
  }
  return { code: 0, action: "submit", written: out, skippedFields: skipped };
}

return { code: 1, message: "未知 action: " + action };
