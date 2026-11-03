# 采蝶轩门店分布图 / caidiexuan-store-map

采蝶轩（烘焙 / 茶饮品牌）门店分布与商品数据可视化项目。

## 目录结构
- `采蝶轩门店分布图.html` —— 门店分布主图（单文件、零外部依赖）
- `src/template.html` —— 页面模板
- `data/` —— 门店与商品数据（goods.json / stores*.json / 门店 CSV）
- `tools/` —— 数据采集与构建脚本（`tools/.tmap-key` 含腾讯地图密钥，已通过 .gitignore 排除，不会提交）
- `deploy/index.html` —— 部署版本

## 说明
- 本仓库为公开仓库，已确保不提交任何密钥与个人敏感信息。
- `out/` 为微信小程序打包产物，已忽略。
