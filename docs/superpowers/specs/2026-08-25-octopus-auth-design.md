# Octopus 工作台用户权限体系设计（认证 · 用户 · 管理视图）

日期：2026-08-25
状态：已评审通过（方案 D + 三插件拆分 + forward-auth）

## 1. 背景与目标

工作台（octopus）计划暴露到公网使用，需要真实的认证与授权能力。当前系统完全没有身份概念：dsh webserver 默认绑 `127.0.0.1` 且明确无 TLS/认证/中间件机制，v1 设计文档将认证列为非目标。

本设计的目标：

1. **公网可部署**：登录墙是硬边界，默认拒绝（deny-by-default）；
2. **模块级 RBAC**：固定角色（`admin` / `user`），控制到模块卡片可见性与数据 API；
3. **契约先行**：权限是横切关注点，本次定下的三个契约（模块 `access` 字段、`auth` 服务、`users` 服务）决定后续所有功能插件的接入方式；
4. **本机零摩擦**：`single-user` 模式免登录直通，开发体验不变；
5. **持久化不自己造轮子**：复用平台现成的 `ctx.storage` 存储枢纽与后端插件。

## 2. 非目标（v1 明确不做）

- 自定义角色 / 角色编辑 UI（只有内置 `admin`、`user` 两角色）；
- 数据行级权限（如"只看自己创建的"）；
- OAuth / LDAP / 第三方登录；
- 邮箱找回密码（由管理员重置代替）；CAPTCHA；
- 应用内 HTTPS（由反向代理负责）;
- 进程内保护 dsh 本体端点（chat/marketplace/settings 等，靠 forward-auth 在反代层兜住）；
- 多进程共享会话（单主机进程假设，见 §11）；
- agent 会话级细分权限（forward-auth 之后所有登录用户可用全部功能）。

## 3. 总体架构

### 3.1 方案 D：壳硬依赖独立的认证平台插件

octopus 壳将 `octopus-auth` 列为硬依赖（cordis inject）。不存在"忘装认证导致静默裸奔"的状态——"不要认证"必须是一个显式的架构动作（而 v1 不提供该选项，`single-user` 模式即"免登录"形态）。

### 3.2 三插件拆分

按职责拆为三个独立插件，各自独立演进：

| 插件 | 职责 | cordis 声明 |
|---|---|---|
| `octopus-users` | 无头的数据服务：账号与会话记录的唯一所有者，不碰 HTTP | `inject: ["storage"]`，`provide: ["users"]` |
| `octopus-auth` | 认证协议与全部 HTTP 端点：scrypt、cookie 会话、限速、CSRF、登录页、用户管理 API、verify | `inject: ["webServer", "users"]`，`provide: ["auth"]` |
| `octopus-users-view` | 「用户管理」界面卡片：纯前端 + 静态资源托管，经 HTTP 调用 auth 的 API | `inject: ["workbench", "webServer"]` |

### 3.3 依赖方向（无环）

```
octopus ──peerDep──▶ octopus-auth ──peerDep──▶ octopus-users
（壳）                （协议+端点）               （存储单元所有者）

octopus-users-view ──peerDep octopus（仅 WorkbenchModule 类型），
                     与 auth 仅通过 HTTP 交互
```

**防环约束（关键决策）**：用户 CRUD API 放在 `octopus-auth` 而非 `octopus-users`。若 users 自开管理端点，它需 inject auth 做 admin 校验，而 auth 又需 inject users 验凭据 → 注入环。因此分层固定为：users 无头、auth 持有全部端点、view 只走 HTTP。

### 3.4 失败隔离语义

`octopus-users` 缺失或存储后端缺失 → auth 拒绝激活（报清晰错误）→ 壳随之不激活 → 整个工作台不可用并给出明确的缺失服务提示。这是有意为之的 fail-loud，不做内存降级。

## 4. 核心契约

### 4.1 模块访问声明（octopus 壳）

```ts
interface WorkbenchModule {
  id: string
  title: string
  order?: number
  entry: string
  /** 缺省 = 'authenticated'：任何登录用户可见；'admin' 仅管理员可见 */
  access?: 'authenticated' | 'admin'
}
```

演进预留：将来开放自定义角色时新增 `roles?: string[]` 字段，`access` 保持兼容。

### 4.2 users 服务（octopus-users 导出）

```ts
interface UserRecord {
  id: string            // uuid
  username: string      // 唯一，trim 后非空
  passwordHash: string  // 格式 scrypt$N$r$p$salt$hash（见 §5.1）
  role: 'admin' | 'user'
  disabled: boolean
  createdAt: number     // epoch ms
}

interface SessionRecord {
  id: string            // crypto.randomBytes(32) base64url
  userId: string
  createdAt: number
  expiresAt: number     // epoch ms，绝对过期
}

interface UsersService {
  // 所有写操作经内部 promise 写链串行化（后端契约要求调用方保证写序）
  findByUsername(username: string): Promise<UserRecord | null>
  getUser(id: string): Promise<UserRecord | null>
  listUsers(): Promise<UserRecord[]>
  createUser(input: { username: string; passwordHash: string; role: 'admin' | 'user' }): Promise<UserRecord>
  updateUser(id: string, patch: Partial<Pick<UserRecord, 'role' | 'disabled' | 'passwordHash'>>): Promise<UserRecord>
  deleteUser(id: string): Promise<void>
  countActiveAdmins(): Promise<number>

  getSession(id: string): Promise<SessionRecord | null>   // 读时惰性清除已过期记录
  putSession(record: SessionRecord): Promise<void>        // 每用户上限 20 个，超出逐出最旧
  deleteSession(id: string): Promise<void>
  deleteExpiredSessions(now: number): Promise<number>
}
```

### 4.3 auth 服务（octopus-auth 导出）

供壳与其他功能插件保护自己的路由：

```ts
interface AuthSession {
  sessionId: string
  user: { id: string; username: string; role: 'admin' | 'user' }
  expiresAt: number
}

interface HttpError extends Error { statusCode: number; code: string }

interface AuthService {
  resolveRequest(req: IncomingMessage): Promise<AuthSession | null>
  requireAuth(req: IncomingMessage): Promise<AuthSession>   // 未登录抛 401
  requireAdmin(req: IncomingMessage): Promise<AuthSession>  // 非 admin 抛 403
  login(username: string, password: string): Promise<{ setCookie: string }>  // 含限速
  logout(sessionId: string): Promise<void>
  hashPassword(password: string): Promise<string>
  verifyPassword(password: string, stored: string): Promise<boolean>
}
```

约定：路由 handler 内 `requireAuth/requireAdmin` 抛出的 `HttpError` 由统一的错误包装器转为 JSON 错误响应（401 `{error:'unauthorized'}` / 403 `{error:'forbidden'}`）。

### 4.4 存储单元（dsh-storage）

- 后端解析：`ctx.storage.backend.get(config.backend)`，Config `backend` 默认 `'json'`；
- 单元唯一所有者是 `octopus-users`：

```ts
const unit = await backend.kv.open({
  name: 'octopus-users',
  version: 1,
  tables: ['users', 'sessions'],
  hasGlobal: false,
})
```

- `users` 表以 `UserRecord.id` 为键，`sessions` 表以会话 ID 为键；
- 未来字段演进通过版本号迁移（打开时 `version-mismatch` 即显式处理），禁止裸改结构；
- 部署时须配置 dsh-storage-json 的 `root` 目录（其无默认值，目录自动以 0700 创建）。

## 5. 认证与会话设计

### 5.1 密码哈希

- Node 内置 `crypto.scrypt`（N=16384, r=8, p=1, keylen=32，16 字节随机 salt），零外部依赖；
- 存储格式 `scrypt$16384$8$1$<salt-hex>$<hash-hex>`，参数入格式串以便将来升级；
- 校验使用 `crypto.timingSafeEqual`。

### 5.2 会话与 Cookie

- Cookie 名：`octopus_session`；`secureCookie=true` 时改用 `__Host-octopus_session`（浏览器强制 Secure + Path=/ + 无 Domain）；
- 属性：HttpOnly、SameSite=Lax、Path=/、Max-Age=`sessionTtlDays*86400`（默认 7 天）、Secure 随 `secureCookie`；**永不设置 Domain**；
- 绝对过期，不做滑动续期；会话持久化于 `sessions` 表，重启不掉线；
- 会话 ID 只在登录时由服务端生成，每次登录签发新 ID（无固定攻击面），永不接受来自 URL/query 的会话标识；
- 过期清理：读取时惰性删除 + 登录成功时顺带执行一次全局清扫；
- 日志只输出会话 ID 前 8 位前缀，永不输出密码。

### 5.3 运行模式（octopus-auth Config）

```
mode:           'single-user' | 'multi-user'   # 默认 multi-user
backend:        string                          # 默认 'json'
secureCookie:   boolean                         # 默认 false；反代 TLS 时置 true
sessionTtlDays: number                          # 默认 7，最小 1
trustProxy:     boolean                         # 默认 false（见 §8.1）
bootstrapAdmin: { username: string; password: string }?  # 仅当用户表为空时生效，之后忽略
```

- **single-user**：`resolveRequest` 对一切请求返回虚拟管理员会话（不入库）；`/me` 返回该虚拟用户且 `canLogout:false`；login 端点返回 400 并说明当前模式。本机开发零摩擦。
- **multi-user 引导**：激活时若用户表为空且配置了 `bootstrapAdmin` → 创建首个 admin；若为空且未配置 → 正常激活，但启动日志打警告、登录页显示"尚未配置初始管理员"的设置提示（选择可用性而非拒绝启动——否则丢配置即砖死整个工作台）。

### 5.4 登录限速

- 内存计数器分桶：`trustProxy=false` 时按 socket 对端地址分桶（反代场景退化为全局限速）；`trustProxy=true` 时按重写后的 XFF 首值分桶；
- 15 分钟窗口内失败 ≥5 次 → 429，窗口内指数退避，成功登录清零该桶；
- 已知权衡：全局限速可被单人利用造成全员登录 DoS，个人规模接受（见 §8 表第 2 条）。

### 5.5 CSRF 防护

双层：SameSite=Lax cookie 之外，所有变更类请求（POST/PATCH/DELETE）校验 Origin 头与 Host 一致；**Origin 缺失一律 403**（严格模式，牺牲原始 curl 工具兼容性，换取不依赖浏览器 SameSite 行为的兜底）。

## 6. HTTP 端点总表（octopus-auth 注册）

| 路由 | 方法 | 权限 | 说明 |
|---|---|---|---|
| `/login` | GET | 公开 | 登录页：纯静态 HTML + 原生 JS，不用 React、零构建 |
| `/api/octopus-auth/login` | POST | 公开（限速） | `{username,password}` → Set-Cookie |
| `/api/octopus-auth/logout` | POST | 登录 | 注销当前会话 + 清 cookie |
| `/api/octopus-auth/me` | GET | 登录 | 当前用户信息；含 `canLogout` |
| `/api/octopus-auth/verify` | GET | 204/401 | 专供反代 subrequest；不记访问日志、不限速刷屏 |
| `/api/octopus-auth/users` | GET / POST | admin | 列表 / 创建 |
| `/api/octopus-auth/users/:id` | PATCH / DELETE | admin | 角色 / 禁用 / 重置密码 / 删除 |

**自我保护规则**：不能禁用或删除自己；不能使最后一个可用 admin 消失（删除或降级均拒绝）。

**输入校验**：username trim 后非空且不含空白字符；password 最短 8 位；重复用户名返回 409 `{error:'conflict'}`；不合法输入一律 400。

**用户名枚举防护**：凭据校验走恒定工作量路径——用户不存在时仍执行一次 dummy scrypt 校验后再返回统一的失败信息。

**路由评审规则**：所有变更操作必须是非 GET 方法（写入测试断言）。

「用户管理」界面由 `octopus-users-view` 注册为普通模块卡片：

```ts
ctx.workbench.register({
  id: 'users-view',
  title: '用户管理',
  access: 'admin',
  order: 900,
  entry: '/octopus/users-view/assets/index.js',
})
```

完全复用壳的模块网格与服务端过滤，view 插件自身无需感知角色逻辑。

## 7. 壳与前端行为

### 7.1 octopus 壳改动（刻意最小）

- `inject: ["webServer"]` → `["webServer", "auth"]`；
- `/api/octopus/modules`、`/api/octopus/config` 的 handler 开头 `await auth.requireAuth(req)`（401 JSON）；
- modules 响应按 `session.user.role === 'admin'` 过滤掉 `access: 'admin'` 的模块（服务端过滤是唯一真相，前端不做隐藏逻辑）；
- 静态资源（html/js/vendor）保持公开：纯代码无数据，安全边界 = 数据 API。此条为明文规则，禁止将来把鉴权撒进静态层。

### 7.2 前端流程

- 壳 App 挂载即 `GET /api/octopus-auth/me`：
  - 200 → 正常渲染（顶栏显示用户名 + 登出按钮，按钮可见性由 `canLogout` 控制）；
  - 401 → `location.href = '/login?redirect=/workbench'`；
- 登录页原生 JS：读取 `redirect` 参数并做同源相对路径校验（必须以 `/` 开头且非 `//` 开头，防开放重定向），POST 登录成功后跳转；401 显示错误、429 显示锁定提示；
- ModuleGrid 零改动。

## 8. 安全设计（威胁推演结论）

核心认知：挂反代后到达源站的所有请求都来自 `127.0.0.1`（代理本身），因此**系统中不存在任何基于来源 IP 的信任判定**，"伪造本地请求"无从谈起。身份唯一凭据是服务端会话 Cookie。

| # | 威胁 | 结论 / 对策 |
|---|---|---|
| 1 | X-Forwarded-For 伪造绕过限速 | `trustProxy` 默认 false，按 socket 地址分桶（反代下=全局限速）；仅在确认反代重写 XFF 时开启 |
| 2 | 全局限速被滥用为登录 DoS | 接受的个人规模权衡：15min/5 次 + 指数退避；不做 CAPTCHA |
| 3 | `?redirect=` 开放重定向 | 同源相对路径白名单校验（§7.2） |
| 4 | Cookie tossing（兄弟子域污染） | 永不设 Domain；secure 模式用 `__Host-` 前缀 |
| 5 | 时序侧信道枚举用户名 | dummy scrypt 恒定工作量路径 |
| 6 | DNS Rebinding（Host=Origin 可过校验） | 拿不到受害者的 host-only 会话 cookie，仍是未登录态；另要求反代绑定确切站点名、默认 server 直接拒绝 |
| 7 | single-user 模式裸奔公网 | 全系统最大配置性风险：启动检测并打醒目警告横幅，部署文档置顶红字 |
| 8 | 变更请求缺 Origin | 严格 403（§5.5） |
| 9 | 会话固定 / ID 注入 | ID 仅服务端生成、每登录换新、永不取自 URL（§5.2） |
| 10 | 凭据文件被读 | 后端目录 0700；哈希带参数头便于升级 |

补充成文规则：日志永不输出完整会话 ID（前 8 位）与密码；`/verify` 静默。

## 9. 部署姿态

### 9.1 本机（开发/单人）

- `mode=single-user`，直连 `127.0.0.1:3080/workbench`，无登录概念；
- 仍安装全部五个包，行为差异只在运行模式。

### 9.2 公网

强制项：

1. dsh 保持绑 `127.0.0.1`，仅同机反代监听公网做 TLS；
2. 反代对**全部路径**套 forward-auth（豁免三路径：`/login`、`/api/octopus-auth/login`、`/api/octopus-auth/verify` —— 否则 subrequest 自递归死循环，这是真实陷阱）；
3. `secureCookie=true`；
4. 反代绑定确切站点名，默认 server 直接拒绝（配合 §8 第 6 条）。

Caddy 示例：

```caddy
workbench.example.com {
    @public path /login /api/octopus-auth/login /api/octopus-auth/verify
    handle @public {
        reverse_proxy 127.0.0.1:3080
    }
    handle {
        forward_auth 127.0.0.1:3080 {
            uri /api/octopus-auth/verify
        }
        reverse_proxy 127.0.0.1:3080
    }
}
```

可选加固（与 forward-auth 二选一或叠加）：路径白名单精确放行工作台相关前缀，其余 404。

**为什么 forward-auth 全局姿态优于纯白名单**：dsh 存在动态插件机制（agent 可编程式注册新路由），白名单会被新路由绕过；forward-auth 挡在代理转发层，覆盖一切被转发路径，与源站路由注册方式无关。

## 10. 测试策略（vitest TDD，沿用现有规范）

- **octopus-users**：单元打开/版本戳、写链串行化、CRUD 语义、每用户会话上限逐出、惰性过期清理、自我保护所需的计数查询；
- **octopus-auth**：哈希/校验（含 dummy 恒定路径）、会话签发/过期/注销、cookie 属性矩阵（secure 开关两种名字）、限速窗口与退避、Origin 校验矩阵、bootstrap 规则（空表有/无配置）、自我保护规则、全端点状态码矩阵（200/400/401/403/404/429）、verify 端点行为；
- **octopus-users-view**：卡片注册参数、静态资源服务；
- **octopus 壳**：未登录 401、user 不可见 admin 卡片、admin 全可见、config API 要求登录；
- **手动联调清单**：完整登录流、登出、管理界面增删改、single-user 直通、本地起 Caddy 走一遍 forward_auth（含豁免路径验证）。

## 11. 已知边界与平台建议

1. **单主机进程假设**：dsh-storage-json 无跨进程写锁（last-write-wins），本设计及会话模型均以单进程为前提，文档明示；
2. **WebSocket v1 一律不在反代放行**；未来若需 agent 流式通道，WS 升级握手绕过普通 HTTP 中间件，需独立的握手期认证设计；
3. **平台建议**：向 dsh 提出「webserver 统一认证中间件 / 路由元数据守卫」feature request，长期应把认证下沉为平台能力，octopus 届时迁移为消费者；
4. **Windows 落盘耐久性**：storage-json 依赖 libuv rename 语义（README 已注明无显式 write-through），个人规模接受。

## 12. 包清单与交付物

| 包 | 新/改 | 内容 |
|---|---|---|
| `packages/octopus-users` | 新 | 数据服务 + 存储单元 + 写链 |
| `packages/octopus-auth` | 新 | 协议 + 全部端点 + 登录页静态资源 + Config |
| `packages/octopus-users-view` | 新 | 管理界面卡片（Vite library 构建）+ 静态资源托管 |
| `packages/octopus` | 改 | inject auth、两个 API 加鉴权、modules 过滤、类型加 `access` |
| `packages/octopus-quickstart` | 改（可选） | 示范 `access` 字段用法 |
| 根 `package.json` | 改 | dev script 安装列表加入三个新包 |
