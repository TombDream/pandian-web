# 盘点录入 · 网页提交 + WPS 多维表格

网页表单提交盘点数据到 WPS 多维表格；输入条码后自动匹配「货品资料」，同条码多品名（`-1`/`-2` 后缀）时弹窗选择。

支持两种运行方式：

- **Vercel 部署（推荐）**：手机/任何设备随时访问，电脑关机也能用
- **本地运行**：同一 WiFi 下手机访问，适合临时调试

## 文件说明

| 文件 | 作用 |
|---|---|
| `public/index.html` | 录入页面 |
| `api/airscript.js` | Vercel 云函数：代理转发到 AirScript Webhook（令牌在环境变量） |
| `api/status.js` | Vercel 云函数：服务状态显示 |
| `server.js` | 本地调试用代理服务（零依赖） |
| `airscript.js` | 粘贴到多维表格的 AirScript 脚本 |
| `config.json` | 仅本地运行使用（已被 .gitignore 排除，不会上传） |

## 第一步：多维表格挂脚本（两种方式都要做）

1. 打开「测试盘点」多维表格 → 顶部 `脚本` → 新建 AirScript 脚本 → 粘贴 `airscript.js` 全部内容
2. 在脚本编辑器开启 Webhook，复制「脚本 webhook 地址」和「脚本令牌」
3. 确认数据表：「货品资料」需有列 `产品编号 / 产品名称 / 货品条码`；「盘点数据」建议有列 `库位 / 条码 / 数量 / 生产日期 / 到期日期 / 产品编号 / 产品名称`（缺列会自动跳过不报错）

## 第二步 A：Vercel 部署（推荐）

1. 本仓库推送到 GitHub
2. Vercel → Add New Project → 导入该仓库，框架选 **Other**，直接 Deploy
3. 部署后进入 Settings → Environment Variables，添加两个变量：
   - `WEBHOOK_URL` = 脚本 webhook 地址
   - `AIRSCRIPT_TOKEN` = 脚本令牌
4. Settings → Deployments 里对最近一次点 **Redeploy**（让环境变量生效）
5. 访问 `https://你的项目.vercel.app` 即可，手机加到主屏幕

## 第二步 B：本地运行

1. 复制并填写 `config.json`（webhookUrl / token，mock 改 false）
2. 双击 `启动.bat` 或 `node server.js`
3. 电脑访问 `http://localhost:5217`；手机连同一 WiFi 访问启动时打印的局域网地址（如 `http://192.168.0.89:5217`）

> 调试时可把 `mock` 设为 true，不写真实表格即可体验完整交互。

## 同条码多品名规则

货品条码带 `-1`、`-2` 后缀表示同基础条码的不同品名。匹配时去掉后缀按基础条码比对：
1 个品名自动带出；多个品名弹窗点选（支持数字键快选）；0 个提示未登记。

## 日常使用

提交成功后库位保留、条码清空并聚焦，适合扫码枪连续录入。
生产/到期日期直接输 8 位数字（如 `20260916`），提交时自动转为 `2026/09/16`。
