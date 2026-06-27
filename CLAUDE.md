# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

一个仓库里同时包含**两个面向纽约 TLC 司机的产品**，共享部分数据源但代码相互独立：

1. **微信小程序**（`app.js` / `app.json` / `app.wxss` / `pages/` / `project.config.json` / `sitemap.json`）
   司机输入车牌号后，小程序**直接**请求 NYC Open Data（`data.cityofnewyork.us`），不经过本仓库的后端。查询用的数据集 ID 集中定义在 `pages/index/index.js` 顶部的 `DATASETS`：`8wbx-tsch`（FHV 车辆）、`rhe8-mgbb`（Medallion 车辆）、`nc67-uf89`（停车/摄像头违章）。新增查询源就在这里追加并映射展示字段。可选地把查询记录写入微信云数据库 `plate_search_logs`（需在 `app.js` 的 `globalData.cloudEnvId` 填云环境 ID）。

2. **网页版工具站**（`index.html` + `server.js`）
   单文件 SPA，前端是 `index.html`（约 109KB，逻辑全内联在底部 `<script>` 里）。`preview.html` 是 `index.html` 的**完全相同副本** —— 改动前端时两个文件必须同步修改。后端是 `server.js`。

## 常用命令

```bash
npm start          # 启动后端，默认 http://127.0.0.1:8787/  （等价于 node server.js）
PORT=3000 npm start  # 换端口
```

- **没有依赖**：`server.js` 只用 Node 内置模块，`package.json` 无 `dependencies`，无需 `npm install`。
- **没有测试 / lint / 构建步骤**。本地验证靠 `curl` 打接口，例如 `curl http://127.0.0.1:8787/api/service-info`。
- 微信小程序部分用**微信开发者工具**打开本目录编译，不走 npm。正式发布前需在 `project.config.json` 换成正式 `appid`，并在微信后台把 `https://data.cityofnewyork.us` 加入 request 合法域名。

## 后端架构（server.js）

单文件 HTTP 服务，无框架，手写路由。关键点：

- **环境变量**：`loadEnvFile()` 在启动时手动解析仓库根目录的 `.env`（不依赖 dotenv）。复制 `.env.example` 为 `.env` 即可本地配置。
- **静态服务**：把仓库根目录当作站点根，`/` 映射到 `index.html`。
- **API 路由**（在 `createServer` 回调里按 `req.url` 顺序匹配）：
  - `GET/POST /api/plate-searches` —— 车牌查询记录
  - `GET /api/fare-rates` —— Uber 等费率表（默认值硬编码在 `defaultFareRates`）
  - `GET /api/service-info` —— 广告/服务信息（默认值 `defaultServiceInfo`）
  - `POST /api/feedback` —— 用户反馈，配置了 Resend 时通过 `sendFeedbackEmail()` 发邮件
  - `POST /api/openai-image` —— 调用 OpenAI 图片接口做图片编辑/生成
  - `GET /api/flights?...` —— 抓取 JFK/LGA/EWR 机场到港页面，解析航班并估算客流（见 `getAirportConfig` / `fetchLiveAirportArrivals` / `buildFlightOverview`）

- **存储策略（重要）**：是否写 Supabase 由环境变量决定，见 `hasSupabaseConfig()`。
  - 配置了 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` → 数据写入 Supabase 表（`plate_search_logs` / `service_info` / `feedback_messages`）。
  - 未配置 → 回退到本地 JSON 文件 `data/plate-searches.json`、`data/feedback.json`（`data/` 已 gitignore）。
  同一套读写函数（`appendSearch` / `readSearches` 等）内部分流，新增需要持久化的数据时要同时覆盖两条路径。
  - Supabase 建表脚本：`supabase-schema.sql`（三张表，`if not exists` 可重复执行）、`SUPABASE_FARE_RATES.sql`（费率表）。

## 前后端如何连接（部署相关）

- 前端在 `index.html` 底部根据 `window.location.hostname` 自动选后端地址：
  - `localhost` / `127.0.0.1` → `API_BASE = ""`，即同源访问本地 `server.js`。
  - 其它域名（如 GitHub Pages）→ 使用硬编码的 `RENDER_API_BASE`（当前为 `https://nyc-tlc-tools.onrender.com`）。
  - 可用 `window.API_BASE_URL` 覆盖。
- 典型生产拓扑：**前端托管在 GitHub Pages，后端 API 部署在 Render**，配置见 `DEPLOYMENT.md`。
- **更换后端服务器时**，需更新 `index.html` 里的 `RENDER_API_BASE`，并同步改 `preview.html`。

## 运维现状（context）

- Render 上的后端因资源有限**已停服**，待后续另找服务器重新部署。
- GitHub Actions 工作流 `.github/workflows/keep-render-awake.yml`（每 10 分钟 ping Render 保活）**已手动 disable**。重新部署后端后，更新里面的 URL 并重新启用即可。
