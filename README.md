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

## 车牌查询入库到云端数据库

如果你想把用户查询的车牌号记录到微信云数据库：

1. 在微信开发者工具里开通云开发。
2. 把云环境 ID 填到 `app.js` 的 `globalData.cloudEnvId`。
3. 在云数据库里创建集合 `plate_search_logs`。
4. 重新编译后，用户每次查询 TLC 车牌都会自动写入一条记录。

会保存的字段包括：

- `plate`
- `module`
- `searchedAt`
- `vehicleCount`
- `violationCount`
- `totalDue`
- `status`

## 票据训练示例

网页端和小程序端都包含票据训练示例工具：

- 上传票据图片用于本地预览。
- 只输入一个最终金额。
- 网页端会把最终金额以清晰的训练标记覆盖显示到示例图片上，可点击图片移动金额位置，并导出训练示例图片。
- 图片和金额调整都在本地完成，不会上传票据图片到服务器。
- 该模块仅供训练数据、界面演示和识别测试使用，不作为真实票据使用。

## 说明

TLC 官网说明 Current Business Licensees/Open Summonses 相关公开列表会每日更新。当前实现按车牌查询公开车辆记录和 NYC 停车/摄像头违章记录；如果后续拿到 TLC 按车牌或按 TLC 车辆牌照号开放的 summons 数据集 ID，可在 `pages/index/index.js` 的 `DATASETS` 中追加查询源并映射展示字段。
