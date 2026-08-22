# 09 — 桥接插件：DSH 设置页极简入口 + npm 打包收尾

**What to build:** 在 DSH 设置页提供极简宠物入口（启用开关、连接状态、打开桌宠按钮），并把 npm 包收尾成只发布桥接插件的形态：清理浏览器客户端声明与残留、更新发布清单与文档、保证安装即用。

**Blocked by:** 04 — 桥接插件：WS 客户端 + 事件翻译 + 重连

**Status:** resolved

- [x] DSH 设置页出现极简宠物面板：启用开关、连接状态、"打开桌宠"。
- [x] 关闭开关时插件停止连接；打开时自动连接桌宠。
- [x] npm 包只包含桥接插件内容，`dsh plugin add` 安装后即工作。
- [x] 发布清单（files/README/PUBLISHING）与实际内容一致，相关测试通过。


## Answer

Implemented in `plugins/pet`:

- Added a minimal DSH settings-page client (`lib/client.js`) that registers only `settings.section` with an enable checkbox, live connection status, and an “打开桌宠” button.
- Extended the bridge API with `enabled`/`setEnabled`/`getStatus`/`openPet`; disabling stops the WebSocket connection and enabling starts/restarts it.
- Added `/pet/bridge/status`, `/pet/bridge/enabled`, and `/pet/bridge/open` HTTP routes through `webServer` for the settings panel.
- Added `dsh.client` metadata and `./client` export to the npm package; `npm pack` now contains only `lib/index.mjs`, `lib/client.js`, `cordis.patch.yml`, `README.md`, `PUBLISHING.md`, and `package.json`.
- Updated README/PUBLISHING/TESTING to match the bridge-only + settings-page packaging.
- Added `test/settings.test.mjs` covering enable/disable behaviour and the settings HTTP routes; all plugin tests pass.
