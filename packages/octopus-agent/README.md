# octopus-agent

工作台 Agent 会话服务插件：提供 dsh AgentLoop 真实会话与 `/api/octopus-agent`；未挂载时聊天回退脚本 mock。

挂载后，工作台聊天即为真实 dsh agent 会话（需 `DEEPSEEK_API_KEY` 环境变量或 `$DSH_HOME/settings.yaml` 的 `llm-deepseek` 段）；未挂载时聊天回退脚本 mock。Agent 的审批/问题通道在聊天内以按钮/横幅呈现；会话权限沿用平台 `workspace-write`。
