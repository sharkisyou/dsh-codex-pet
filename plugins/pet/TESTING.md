# dsh-pet 桥接插件测试指南

## 运行测试

```sh
cd plugins/pet
npm test
```

当前测试套件（`test/bridge.test.mjs`、`test/settings.test.mjs`）使用 mock WebSocket、mock `ctx` 与 mock `webServer` 覆盖：

- 连接握手：`hello` + 当前会话快照 + 会话目录/同步
- DSH 会话事件到线协议事件的翻译：
  - `session/status`
  - `session/error`
  - `tool/start` / `tool/end`
  - 独立 `question/start` / `question/end`
  - `approval/start` / `approval/end` 并发计数
  - 子代理归父解析
- 断线重连后重新握手并携带最新快照
- 反向 `session/open` 分发到宿主 opener
- 发送前协议校验
- 启用/停用开关控制桥接连接
- 设置页 HTTP 状态与控制接口

## 手动验证

1. 启动桌宠（`apps/desktop-pet`）。
2. 启动 DSH Web 并安装/加载本插件。
3. 在 DSH 设置页找到“桌宠”面板，确认启用开关、连接状态和“打开桌宠”按钮。
4. 关闭开关，确认桥接停止连接；重新打开，确认自动连接桌宠。
5. 在 DSH 发起会话，观察桌宠动画状态变化。
6. 关闭桌宠再打开，观察桥接自动重连并恢复。
