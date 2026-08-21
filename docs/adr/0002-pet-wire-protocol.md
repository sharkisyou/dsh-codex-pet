# 桌宠线协议：公开契约

状态：accepted

## 背景

桌宠作为服务端接收各 agent 工具（DSH、Codex、Claude……）推送的活动。为了让"其他 agent 工具接入"成为可能，桌宠与桥接之间的线协议必须是**公开、版本化、带 schema 的契约**，而不是 DSH 插件的内部实现细节。

## 决策

- **传输**：WebSocket。桌宠为服务端，桥接插件（及未来其他工具）为客户端主动连接。固定默认端口，`DSH_PET_URL` 覆盖。
- **版本化**：WS URL 路径带版本（`ws://127.0.0.1:<port>/v1`）+ 握手消息二次确认版本号。
- **Schema**：JSON Schema 为公开契约的唯一真相；构建时生成 TS 类型（如 `json-schema-to-typescript`），避免手写漂移。
- **会话身份**：每个事件显式携带 `agent`（来源工具）字段（开放字符串，非枚举）；桌宠内部会话键 = `agent:sessionId` 复合键，避免不同工具会话 id 冲突。

## 事件集（DSH/工具 → 桌宠）

- `session/status`（`running | idle`）
- `session/error`（结构化：`message` + 可选 `kind`/`code`）
- `tool/start` / `tool/end`（带工具名）
- `approval/start` / `approval/end`（并发计数，归零才发 end）
- `question/start` / `question/end`（独立事件，区分"等待审批"与"等待回答"）
- `subagent/start` / `subagent/end`（桥接解析归父会话后推送父会话 id）
- `session/sync`（当前存活顶层会话 id 列表，供桌宠清理）
- 握手快照（连接时回放当前所有会话与活动，桌宠重启/重连即恢复）
- 会话目录（含标题等元数据；桌宠拥有"已读/就绪"语义）

反向（桌宠 → 工具）：

- `session/open`（请求在 DSH Web 打开某会话；实现按可用性降级：深链优先，host API 探索，不可用则优雅降级）

## 关键取舍

- **WebSocket 而非 HTTP**：多工具并发推送同一服务端最自然，事件驱动、零轮询、断线语义清晰。
- **JSON Schema 而非 zod**：公开契约对第三方（其他语言）最友好；TS 类型从 schema 生成，schema 是唯一真相。
- **事件带 `agent` 字段 + 复合会话键**：多工具接入的必然要求，否则 `dsh:s1` 与 `codex:s1` 会互相覆盖。
- **`question/*` 独立成事件**：避免依赖"工具名 == ask_user_question"的隐式约定，第三方才能表达"在等人回答"。
- **桥接负责必要的翻译**（解析父会话、审批计数、question 识别、会话目录）：这些依赖 DSH 内部服务，桌宠侧无法也不应重复实现。

## 影响

- `packages/pet-protocol` 承载 schema、类型、常量与版本；`packages/pet-core` 承载桌宠侧纯逻辑（state-machine / pet-format / multi-session / animation 的 TS 版）。
- 桥接插件与桌宠各自消费 `pet-protocol`，实现校验与生成类型。
