# 公网部署说明

这个项目的网页可以继续放在 GitHub Pages，查询记录 API 需要单独部署到一个支持 Node.js 的公网服务。

## 推荐方案

数据库推荐用 Supabase 免费版。后端推荐用 Render 或类似的 Node.js 托管服务。这个仓库已经自带 `server.js`，可直接启动：

```bash
npm start
```

## Supabase 建库

1. 打开 `https://supabase.com/` 注册账号。
2. 新建一个 Project。
3. 进入 SQL Editor。
4. 复制 `supabase-schema.sql` 的内容并运行。
   - 后续如果新增服务信息、反馈等数据库表，也重新运行 `supabase-schema.sql`，脚本使用 `if not exists`，可重复执行。
5. 进入 Project Settings -> API，复制：
   - Project URL
   - service_role key

注意：`service_role key` 只能放在后端环境变量里，不能写到 `index.html`。

## 部署步骤

1. 把代码推到 GitHub。
2. 在 Render 新建一个 Web Service，连接这个仓库。
3. Build Command 填 `npm install`。
4. Start Command 填 `npm start`。
5. 在 Render 的 Environment Variables 里添加：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
6. 部署后拿到一个公网地址，比如 `https://xxx.onrender.com`。
7. 打开 GitHub Pages 页面，把前端的 `API_BASE_URL` 指向这个公网地址。

## 本地查看记录

启动后端后，可以直接访问：

- `GET /api/plate-searches`
- `POST /api/plate-searches`

记录文件存放在本地：

- `data/plate-searches.json`

如果配置了 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`，记录会写入 Supabase 的 `plate_search_logs` 表，不再写本地 JSON。

## 本地开发环境

1. 复制 `.env.example` 为 `.env`
2. 填入：
   - `OPENAI_API_KEY`
   - `OPENAI_IMAGE_MODEL`
   - `OPENAI_IMAGE_QUALITY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. 启动：

```bash
npm start
```

本地访问地址：

- `http://127.0.0.1:8787/`

如果 `.env` 留空，后端会退回到本地文件存储，数据写入 `data/plate-searches.json`。

如果你要启用 OpenAI 图片生成接口，还需要填写：

- `OPENAI_API_KEY`
- `OPENAI_IMAGE_MODEL`，默认建议先用 `gpt-image-1`
- `OPENAI_IMAGE_QUALITY`，默认建议先用 `low`
