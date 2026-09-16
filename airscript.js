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

// ===== 配置：数据表名称（按候选顺序自动匹配，可自行增删） =====
var PRODUCT_SHEET_NAMES = ["产品资料表", "货品资料", "产品资料"]; // 条码对照表
var TARGET_SHEET_NAMES = ["数据表", "盘点数据"]; // 提交写入的表

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

function getSheetIdByNames(names) {
  for (var i = 0; i < names.length; i++) {
    var id = getSheetId(names[i]);
    if (id !== null) return { id: id, name: names[i] };
  }
  return null;
}

// 获取表的所有字段名（失败返回 null）
function getFieldNames(sheetId) {
  try {
    var flds = Application.Field.GetFields({ SheetId: sheetId });
    var list = flds.fields || flds || [];
    var names = [];
    for (var j = 0; j < list.length; j++) {
      var n = list[j].name !== undefined ? list[j].name : list[j].Name;
      if (n) names.push(n);
    }
    return names;
  } catch (e) {
    return null;
  }
}

// 在字段名列表里找包含关键词的字段
function findField(names, keyword) {
  if (!names) return null;
  for (var i = 0; i < names.length; i++) {
    if (String(names[i]).indexOf(keyword) !== -1) return names[i];
  }
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

var prod = getSheetIdByNames(PRODUCT_SHEET_NAMES);
if (!prod) {
  return { code: 1, message: "找不到产品资料表（tried: " + PRODUCT_SHEET_NAMES.join(" / ") + "）" };
}

// 自动识别产品表的字段名（条码/名称/编号列）
var prodFields = getFieldNames(prod.id);
var F_BC = findField(prodFields, "条码") || "货品条码";
var F_NAME = findField(prodFields, "名称") || "产品名称";
var F_NO = findField(prodFields, "编号") || "产品编号";

// ---- 查询条码 ----
if (action === "query") {
  var barcode = baseBarcode(argv.barcode);
  if (!barcode) return { code: 1, message: "条码为空" };

  var recs = getAllRecords(prod.id, [F_NO, F_NAME, F_BC]);
  var matches = [];
  for (var i = 0; i < recs.length; i++) {
    var f = recs[i].fields || {};
    if (baseBarcode(f[F_BC]) === barcode) {
      matches.push({
        产品编号: f[F_NO] === null || f[F_NO] === undefined ? "" : String(f[F_NO]),
        产品名称: f[F_NAME] === null || f[F_NAME] === undefined ? "" : String(f[F_NAME]),
        货品条码: f[F_BC] === null || f[F_BC] === undefined ? "" : String(f[F_BC]),
      });
    }
  }
  return { code: 0, action: "query", barcode: barcode, matches: matches };
}

// ---- 提交记录 ----
if (action === "submit") {
  var target = getSheetIdByNames(TARGET_SHEET_NAMES);
  if (!target) {
    return { code: 1, message: "找不到目标数据表（tried: " + TARGET_SHEET_NAMES.join(" / ") + "）" };
  }

  var data = argv.data || {};
  // 只写入目标表中已存在的字段，避免因缺列报错
  var exist = null;
  var skipped = [];
  exist = {};
  var tf = getFieldNames(target.id);
  if (tf) {
    for (var t = 0; t < tf.length; t++) exist[tf[t]] = true;
  } else {
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
    Application.Record.CreateRecords({ SheetId: target.id, Records: [{ fields: out }] });
  } catch (e2) {
    return { code: 1, action: "submit", message: "写入失败：" + (e2 && e2.message ? e2.message : String(e2)), data: out };
  }
  return { code: 0, action: "submit", written: out, skippedFields: skipped };
}

return { code: 1, message: "未知 action: " + action };
