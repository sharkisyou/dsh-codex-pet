# controller.test.ts "gateway sends a full state snapshot on connect" 间歇失败

Type: task
Status: needs-triage

## 现象

`apps/desktop-pet/test/controller.test.ts:93` 的
`gateway sends a full state snapshot on connect` 在**全套并跑**（`tsx --test test/*.test.ts`）
时间歇失败，断言 `assert.ok(state)` falsy——连接后未按时收到 full state snapshot。

- 单文件跑稳定通过；全套并跑约 1/3~1/2 概率失败（2026-09-08 实测 5 次中 2 次）。
- 基线 `fc5c3eb`（干净树）同样复现，非新引入。
- 疑似时序竞争：并跑时端口/事件循环负载导致 gateway 快照推送晚于断言超时。

## 建议

修复时优先看测试的等待策略（轮询/超时），而非产品代码。

## Comments
