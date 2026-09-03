# octopus-agent-monitor

日志驱动的 Agent 会话监控插件：从会话事件日志（dsh `session/event` 流）重建计数，
达到限额即停机并等待用户决策。

## 监控项

| 配置 | 含义 | 日志数据源 |
|---|---|---|
| `maxTokens` | 会话累计 input+output tokens 上限（0=不监控） | `assistant/message` 的 `data.usage` |
| `maxConsecutiveToolErrors` | 连续工具调用失败次数上限（0=不监控） | `tool/result` 的 `data.error` |
| `maxTurns` | 轮数上限（0=不监控） | `turn/start` |

## 工作方式

- 根 ctx 监听 `agent/created`：为该 agent 重放 `agent.session.events`（resume 后累计不丢），
  再订阅 `session/event` 增量累计；`agent/disposed` 时清理状态。
- 任一限额触发：`agent.cancel({ kind: "user" }, { keepInbox: true })` 停机，
  并通过全局事件 `agent-monitor/halted`（载荷 `AgentMonitorHaltEvent`）广播；
  halted 后不再重复触发，直到用户显式 `resume`。
- 提供服务 `agentMonitor`：
  - `resume(sessionId)`：重置计数并以 plugin 消息唤醒 agent 续跑（用户选"继续执行"时调用）
  - `status(sessionId)`：查询 halted 状态与当前计数
  - `drop(sessionId)`：手动清理状态

## 对接（事件订阅）

- **octopus-agent**（工作台聊天）：订阅 `agent-monitor/halted` → 弹出问题横幅
  （"…是否继续执行？" 选项 `["继续执行", "停止"]`）；选"继续执行"→ `agentMonitor.resume`。
- **octopus-workflow**（任务子会话）：订阅 `agent-monitor/halted` → 记录停机事件、
  任务回退 `todo` 并解除会话关联，等待用户在看板重新派发（新会话从零计数）。
