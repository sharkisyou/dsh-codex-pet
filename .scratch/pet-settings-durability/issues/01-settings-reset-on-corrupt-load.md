# settings.json 损坏/丢失后自动回退默认值，宠物选择静默丢失

Type: task
Status: needs-triage

## 现象（2026-09-08 实测）

机器/WSL 重启后 pet server 挂掉（已知：不会自启）。手工重启 server 后发现
`~/.local/share/dev.yshark.desktop-pet/settings.json` 变成默认值
（`selectedPetId: null`、`zoom: 1.2`），用户选的宠物（naruto）与缩放（0.9）丢失，
桌宠静默回退待机剪影。

## 推断的根因链

1. 重启瞬间 settings.json 写盘损坏（settings-store 用 tmp+rename 原子写，
   但 rename 前断电/重启仍可能留下损坏的旧文件）。
2. server 重启 `load()` 读文件失败 → 静默返回 defaults（settings-store.ts
   L182-185，catch 分支无任何日志）。
3. 之后任何一次 `updateSettings`（如窗口 onMoved 的 windowX/Y 保存）把整个
   默认缓存落盘，覆盖原文件——损坏的旧值也彻底消失。

## 改进方向

- `load()` 失败时打日志（server 侧 logger），提示"settings 读取失败用默认值"。
- 原子写之前轮转一份 `settings.json.bak`（上次成功内容），load 失败时尝试 bak。
- tmp 文件命名带 pid/随机后缀，避免并发 server 实例互踩。

## 附注

- 当次经 server WS API（`settings/update`）重写了 selectedPetId/zoom 恢复，
  用户窗口位置保留。
- 试图从 `/tmp/settings-backup.json` 恢复失败：WSL 重启清空 /tmp，
  **临时备份不要放 /tmp**。
- pet server 重启后不会自启（交接文档已知），拉起方式：
  `setsid nohup npm run server >> ~/.dsh/logs/pet-server.log 2>&1 &`（apps/desktop-pet 下）。

## Comments
