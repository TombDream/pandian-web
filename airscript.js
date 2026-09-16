/**
 * 盘点录入 Web API 入口（AirScript · 多维表格 · 兼容 1.0 / 2.0 环境）
 * ============================================================
 * 使用方式：粘贴到多维表格 脚本 > AirScript脚本 编辑器，开启 Webhook（复制脚本webhook + 设置脚本令牌）。
 *
 * 请求格式（由本地代理/Vercel 函数转发）：
 *   查询条码：{"Context":{"argv":{"action":"query","barcode":"6975983219135"}}}
 *   提交记录：{"Context":{"argv":{"action":"submit","data":{
 *       "库位":"A-01","条码":"6975983219135-1","数量":2,
 *       "生产日期":"2026/01/01","到期日期":"2027/01/01",
 *       "产品编号":"15056","产品名称":"150轻上厚椰乳..."}}}}
 *
 * 特性：
 *  - 1.0 环境：Application.Record.GetRecords / CreateRecords（带 SheetId）
 *  - 2.0 环境：Application.Sheets("表名").Record.GetRecords / CreateRecords（表对象方法）
 *  - 表名按候选列表自动匹配；条码/名称/编号字段名自动识别
 *  - 同条码多品名：货品条码的 "-1"/"-2" 后缀去掉后按基础条码匹配
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

// 1.0 环境检测
function isV1Record() {
  try {
    return !!(Application.Record && Application.Record.GetRecords);
  } catch (e) {
    return false;
  }
}

function getSheetObj(name) {
  try {
    return Application.Sheets(name);
  } catch (e) {
    return null;
  }
}

function getSheetId(name) {
  var sh = getSheetObj(name);
  if (sh) {
    if (sh.Id !== undefined && sh.Id !== null) return sh.Id;
    if (sh.id !== undefined && sh.id !== null) return sh.id;
  }
  // 1.0 回退：GetSheets 列表匹配
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
    if (id !== null && id !== undefined) return { id: id, name: names[i] };
  }
  return null;
}

// 获取表的所有字段名（失败返回 null）
function getFieldNames(sheetName) {
  // 1.0：Application.Field.GetFields
  try {
    var sheetId = getSheetId(sheetName);
    var flds = Application.Field.GetFields({ SheetId: sheetId });
    var list = flds.fields || flds || [];
    var names = [];
    for (var j = 0; j < list.length; j++) {
      var n = list[j].name !== undefined ? list[j].name : list[j].Name;
      if (n) names.push(n);
    }
    if (names.length) return names;
  } catch (e) {}
  // 2.0：sheet.Field.GetFields（若存在）
  try {
    var sheet = getSheetObj(sheetName);
    var f2 = sheet.Field.GetFields();
    var l2 = f2.fields || f2 || [];
    var n2 = [];
    for (var k = 0; k < l2.length; k++) {
      var m = l2[k].name !== undefined ? l2[k].name : l2[k].Name;
      if (m) n2.push(m);
    }
    if (n2.length) return n2;
  } catch (e2) {}
  return null;
}

// 在字段名列表里找包含关键词的字段
function findField(names, keyword) {
  if (!names) return null;
  for (var i = 0; i < names.length; i++) {
    if (String(names[i]).indexOf(keyword) !== -1) return names[i];
  }
  return null;
}

// 分页拉取全部记录（1.0 / 2.0 自动适配）
function getAllRecords(sheetName, fields) {
  var all = [];
  var offset = null;

  if (isV1Record()) {
    var sheetId = getSheetId(sheetName);
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

  // 2.0：表对象 .Record
  var sheet = getSheetObj(sheetName);
  if (!sheet || !sheet.Record || !sheet.Record.GetRecords) {
    throw new Error("当前脚本环境不支持数据表 API（1.0/2.0 Record 均不可用）");
  }
  do {
    var opt2 = { PageSize: 1000 };
    if (offset) opt2.Offset = offset;
    if (fields) opt2.Fields = fields;
    var res2 = sheet.Record.GetRecords(opt2);
    all = all.concat(res2.records || []);
    offset = res2.offset || null;
  } while (offset);
  return all;
}

// 创建记录（1.0 / 2.0 自动适配）
function createRecord(sheetName, fieldsObj) {
  if (isV1Record()) {
    var sheetId = getSheetId(sheetName);
    return Application.Record.CreateRecords({ SheetId: sheetId, Records: [{ fields: fieldsObj }] });
  }
  var sheet = getSheetObj(sheetName);
  if (!sheet || !sheet.Record || !sheet.Record.CreateRecords) {
    throw new Error("当前脚本环境不支持数据表创建 API");
  }
  return sheet.Record.CreateRecords({ Records: [{ fields: fieldsObj }] });
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

// ---- 查询条码 ----
if (action === "query") {
  var barcode = baseBarcode(argv.barcode);
  if (!barcode) return { code: 1, message: "条码为空" };

  var prodFields = getFieldNames(prod.name);
  var F_BC = findField(prodFields, "条码");
  var F_NAME = findField(prodFields, "名称");
  var F_NO = findField(prodFields, "编号") || findField(prodFields, "编码");

  // 字段名识别失败时不传 Fields，取全字段再按关键词找
  var recs = getAllRecords(prod.name, prodFields ? [F_BC, F_NAME, F_NO] : null);

  if (!prodFields && recs.length) {
    var keys = [];
    for (var rk in recs[0].fields || {}) keys.push(rk);
    F_BC = findField(keys, "条码");
    F_NAME = findField(keys, "名称");
    F_NO = findField(keys, "编号") || findField(keys, "编码");
  }
  if (!F_BC) return { code: 1, message: "产品表里找不到条码字段（需有一列列名含「条码」）" };

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
  var targetFields = getFieldNames(target.name);
  var exist = null;
  var skipped = [];
  if (targetFields) {
    exist = {};
    for (var t = 0; t < targetFields.length; t++) exist[targetFields[t]] = true;
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
    createRecord(target.name, out);
  } catch (e2) {
    return { code: 1, action: "submit", message: "写入失败：" + (e2 && e2.message ? e2.message : String(e2)), data: out };
  }
  return { code: 0, action: "submit", written: out, skippedFields: skipped };
}

return { code: 1, message: "未知 action: " + action };
