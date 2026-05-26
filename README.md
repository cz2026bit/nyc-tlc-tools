# 纽约 TLC 司机违章查询微信小程序

这是一个微信小程序项目。用户输入车牌号后，小程序会直接查询 NYC Open Data：

- `ym4f-sp8x`：TLC 当前 For-Hire Vehicle 车辆资料
- `rhe8-mgbb`：TLC Medallion Vehicles - Authorized
- `nc67-uf89`：NYC Open Parking and Camera Violations

## 使用

1. 用微信开发者工具打开本目录。
2. 在 `project.config.json` 里替换正式小程序 `appid`。
3. 在微信公众平台后台把 `https://data.cityofnewyork.us` 加入 request 合法域名。
4. 编译后输入车牌号测试，例如 `T702139C`。

## 洗车发票金额调整

网页端和小程序端都包含洗车发票金额说明工具：

- 上传洗车发票图片用于本地预览。
- 只输入一个最终金额。
- 网页端会把最终金额以“调整金额 / ADJUSTED COPY”标记覆盖显示到发票图片上，可点击图片移动金额位置，并导出带标记的金额说明图片。
- 图片和金额调整都在本地完成，不会上传发票图片到服务器。

## 说明

TLC 官网说明 Current Business Licensees/Open Summonses 相关公开列表会每日更新。当前实现按车牌查询公开车辆记录和 NYC 停车/摄像头违章记录；如果后续拿到 TLC 按车牌或按 TLC 车辆牌照号开放的 summons 数据集 ID，可在 `pages/index/index.js` 的 `DATASETS` 中追加查询源并映射展示字段。
