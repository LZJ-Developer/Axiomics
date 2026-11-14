# ADR 0003: 自助注册 + 管理员审批式开通

Status: accepted（2026-11-13）。rev F：按金字塔原则重排，结论前置，实施细节全部移到附录。
rev G：把可测试性作为架构约束写进设计——决策与副作用分离，测试分 L0–L3 四层（附录 I）。
rev H：本地实现与 L0–L2 验证完成（90 个单测 + 8 个 lab 场景全过），**未部署生产**。
rev I：修掉租户脚本的两个缺陷（retire 空表中断、归档含 token），隔离夹具验证通过。
rev J：部署准备期间子代理误执行两条生产命令；经确认改为**全量重置**——GPU 侧租户数据与归档已清空，
Casdoor 待 Web 全库重置。

日期：2026-11-13

## 0 结论

采纳「**原生注册 → 管理员在 Casdoor 控制台改 Tag 审批 → Web 侧对账开通**」。

用户自助注册只建账号（`tag=pending`），不获得任何算力；管理员把 Tag 改成 `active` 是唯一的批准动作；
Web 上的 `ax-admit` 服务每 60 秒（或收到 Casdoor 事件时）比对"Casdoor 里的用户状态"与"GPU 上的租户"，
多退少补——开通、撤权回收、删除回收都由这一次比对收敛。

代价约 2–2.5 天（含测试骨架），主要花在两个小服务上；不新增放行端口，不自建注册/待审页面，不启用邀请码与邮件。

## 1 关键决策

| # | 决策 | 一句话理由 |
|---|---|---|
| 1 | 注册用 Casdoor 原生 signup 页，挂在 `:8444/console` | 不重复实现已有界面；端口已通 |
| 2 | 账号 `tag=pending`，管理员改 `active` 即批准 | 只有一个动作，且该字段用户无权改 |
| 3 | 拒绝 = 勾「禁止登录」，不删账号 | 可逆、保留审计；且能挡住 Authelia 登录 |
| 4 | **事件只当唤醒，GPU 不消费载荷** | 载荷是客户端请求体，可伪造、失败请求也会产生 |
| 5 | **开通由 Web 侧 `ax-admit` 对账后推送** | GPU→Web 不通，唯一正确方向是 Web→GPU:8005 |
| 6 | 撤权/删除自动回收租户、token、路由 | "可撤销"才对得起审批这个词 |
| 7 | 品牌只求「不显著展示 Casdoor」，页脚隐去 | 不要看起来像别人的后台 |
| 8 | 待审账号能登录，但只看到「审核中」 | 先让人进来再解释状态 |
| 9 | 不做：自建页面、邀请码、邮件、MFA、平台 SSO | 与目标无关 |
| 10 | **决策与副作用分离**：`plan()` 是纯函数，I/O 只在边界 | 不开服务就能验证"该不该开通" |
| 11 | **四层测试 + 配置断言**：L0/L1 无网络、L2 本地全链路、L3 生产冒烟 | 可测试性由架构赋予，不靠事后补测 |
| 12 | **存量数据全量清零**：租户、归档、注册表全部删除，重新从零注册 | 尚未有真实用户访问；旧数据只会成为包袱 |

## 2 为什么（五个论点）

### 2.1 注册必须与算力解耦

算力是稀缺资源，账号不是。开放注册只影响身份表，GPU、端口、模型 token 全部要管理员批准后才产生；
未批准账号在网关没有路由、在模型代理没有 key。审批位（Tag）的修改规则是 `Admin`，用户自助修改会被
服务端静默还原。见附录 E、L。

### 2.2 事件不能作为事实来源

Casdoor 的 webhook 投递体是一条审计记录，其中 `object` 就是客户端提交的请求体；`AfterExec` 过滤器在
handler 报错时也执行、`AddRecord` 也不看响应结果。实测中，一条响应为 `The ID is immutable.`（Tag 根本没改）
的事件照样写着 `tag=active`；一条 `user=anonymous`、响应 `Unauthorized operation` 的事件同样被投递。
最初的"GPU 接收器读载荷开班"方案因此会允许未登录者给自己开通、给别人销户。

修正后的分工：事件只触发"去查一次真实状态"，不携带任何授权信息。见附录 G、L。

### 2.3 审批与品牌都留在原生控制台

v4.25.0 的新前端刚好具备三件事：用户列表自带 Tag 列（可搜索）、组织定义 `tags` 后编辑页的 Tag 变中文下拉、
页脚与 logo 全部走应用/组织的配置字段。于是"审核"就是"在用户页把下拉从待审核改成已通过"，不需要自建
任何页面，品牌也不需要改前端代码。见附录 E、F。

### 2.4 收敛靠对账，不靠事件链

每一轮都做全量比较（Casdoor 用户 ⟺ GPU 租户），因此事件丢失、重放、伪造、重复都不影响最终状态，只影响
发现速度（≤60 秒）。这一条顺带消掉了旧方案的两个缺口：事件丢失导致租户不补建、删除用户之外没有回收手段。
对账还带来一个安全兜底：每轮先校验"注册默认 Tag 必须是 pending"，配置被改错时停止开通并告警（fail-closed）。
见附录 B。

### 2.5 可测试性由架构赋予

"该不该开通/回收"是一个**纯数据决策**：输入是用户列表、租户列表、配置与时间，输出是动作清单。
把这个决策做成纯函数，测试就可以直接构造状态、跑一次、断言结果——不需要起 Casdoor、不需要 GPU、
不需要等 60 秒。反过来，如果把判断散落在 webhook 处理器里，就只能靠造事件、跑服务、看日志来验证，
正是"用更强的检测系统弥补不可测的架构"。

代价是强制三种拆分：决策与副作用分离、外部依赖（Casdoor/GPU/CLI/时钟）可注入、文件路径可配置。
这三条在附录 B、C 里已经落在签名层面；测试矩阵见附录 I。

## 3 可测试性（架构约束）

每个模块必须能在**没有网络、没有真实服务**的前提下被验证。为此规定五个接缝：

| 接缝 | 形态 | 替代物 |
|---|---|---|
| 决策 | `plan(users, tenants, config, now) -> [Action]`，纯函数 | 直接构造数据断言，无需替身 |
| Casdoor | `CasdoorClient.list_users()` | `FakeCasdoor`（返回固定 JSON） |
| GPU | `GpuClient.state()` / `apply(action)` | `FakeGpu`（内存 map + 调用记录） |
| CLI | `TenantExecutor.add/del` | `fake-cli`（记录 argv 到文件，可注入失败/超时） |
| 时钟与路径 | `clock` 参数、`TENANTS_MAP`/审计路径可配 | 逻辑时钟 + `tmpdir` |

四层测试，前三层不允许碰真实依赖：

| 层 | 覆盖 | 依赖 | 时长 | 门槛 |
|---|---|---|---|---|
| L0 | `plan()`、校验、配置不变量、待审页状态映射 | 无 | <1s | 全绿才合入 |
| L1 | 两个服务的 handler 与循环（fake 后端、tmpdir） | 回环 + fake | <5s | 全绿才合入 |
| L2 | 本地 lab 全链路（真 Casdoor + Caddy + 两服务 + fake-cli） | lab | <2min | 上线前必过 |
| L3 | 生产三条硬指标 + 注入用例 | 生产 | 人工 | 验收门槛 |

另外一类测试对象是**配置**：审批位、默认 Tag、页脚、导航都是 Casdoor 里的数据，改错同样会击穿设计。
因此提供只读的 `assert-config` 脚本，断言 `basePath`、`tags[0]==pending`、`defaultTag==pending`、
两个应用的 `footerHtml`、`navItems` 与默认应用；本地与生产上线前各跑一次。详见附录 I。

## 4 风险与边界

| 风险 | 影响 | 处置 |
|---|---|---|
| 控制台与工作区同源，Casdoor 会话 cookie 会到达租户上游 | 工作区 XSS 可代管理员调 API | 已知缺口；中期把控制台迁到独立 origin（附录 J） |
| 待审用户可在账户设置自开 MFA | 批准后 LDAP bind 永久失败 | 已知缺口 + 管理员清除 MFA 字段的 runbook |
| `X-Admin-Token` 走内网明文 HTTP | 内网嗅探 | 仅有 Web→GPU 一条专线，未上 TLS |
| 配置耦合：`tags[0]` 就是注册默认 Tag | 改顺序即改默认审批位 | fail-closed 校验 + 验收项 |
| `add` 中断可能留下半成品租户 | 容器在、map 没有 | runbook（附录 C） |
| `retire` 在 map 只剩一行时半途退出 | 最后一个租户删不掉（容器已停、map 仍在） | 已修（2026-11-13，夹具验证；附录 J/M） |
| 归档 tar 包包含 token 文件 | 撤权后凭据残留 | 已修（先删 token 再打包 + `--exclude`） |
| 新旧接收器载荷不兼容，旧实现静默回 200 | 迁移窗口内"看似成功" | 必须原子切换，不灰度共存（附录 J） |
| 控制台对 VPN 内可达者开放 | 登录页匿名可见 | 管理 API 仍需会话与管理员；必要时边缘限网段 |

## 5 完成标准（四条硬指标）

1. **测试门槛**：L0 + L1 在断网环境全绿；L2 场景全过；`assert-config` 通过。（本地已达成，2026-11-13）
2. **注入无效**：匿名构造 `update-user` 请求后，`tenants.map` 不新增；事件可产生，但无副作用。
3. **批准收敛**：管理员改 Tag 后 ≤60 秒租户出现，用户可登录并执行一次任务。
4. **撤权收敛**：改回 `pending`、勾禁止登录、删除账号，≤60 秒内租户、token 文件与网关路由全部消失。

完整验收清单见附录 H，测试矩阵见附录 I。

---

# 附录

## A 部署约束与拓扑

| 端口 | 实测（2026-11-13） | 影响 |
|---|---|---|
| `:8444` | VPN 可达（到达 TLS 层） | 注册、登录、审批都收敛到这里 |
| `:8446` | 超时 | 原私网控制台入口在 VPN 侧不可用 |
| `:8443` | 不可达 | 旧门户，已不依赖 |

东西向连通性：`Web → GPU:8005`、`Web → DB:3306` 通；`GPU → Web` 不通。开通服务必须放在 Web。

```text
用户浏览器
  ├─ /console/signup/app-axiomics-web ──► Casdoor（Web 127.0.0.1:8000）
  │       注册 → tag=pending
  └─ /auth ──► Authelia ──LDAP──► Casdoor LDAP :1389（Is forbidden → bind 失败）
                └─► 租户工作区 /uNNNN/

管理员
  └─ /console/users ──► Casdoor 控制台（改 Tag / 勾禁止登录）

Casdoor webhook（built-in，仅唤醒）
  └─ POST 127.0.0.1:43101/hook ──► ax-admit（Web）
       ① 查 Casdoor 用户状态  ② 查 GPU 租户  ③ 求差
       ▼
  GPU :8005 /admin/provision {ensure|retire} ──► ax-admin-api.py ──► axiomics-user add|del --no-idp
```

## B 开通服务 `ax-admit`

- 位置：Web（192.0.2.229），systemd 用户级 `ax-admit.service`，`Restart=on-failure`，只监听 `127.0.0.1:43101`。
- 配置：`~/.config/ax-admit/env`（0600，`EnvironmentFile`）：Casdoor origin、服务账号口令、GPU 的
  `/admin/provision` 与 `/admin/state` 地址、`admin-token` 文件路径。口令与 token 不进日志。
- 服务账号 `svc-admit`：建在 `built-in`、`isAdmin=true`，能读所有组织；**不在 `axiomics`**，所以 LDAP 目录里
  没有它，Authelia 看不到也登不进工作区。本项目不做 MFA；若开了登录验证码需对该账号关闭。
- 每轮对账：

  ```text
  users = GET /api/get-users?owner=axiomics（分页拉全）
  desired = tag == "active" and not isForbidden
  actual  = name in GET /admin/state
  desired && !actual → ensure
  !desired && actual → 连续 2 轮确认后 retire
  ```

- 节奏：webhook 去抖 1 秒触发一轮；另有 60 秒定时；同一时刻只允许一轮（`flock`）。
- 安全规则：
  - 任一上游失败或返回不完整 → 本轮**不回收**，只记录，下轮重试；
  - 回收需连续两轮观察到非活跃/已删除，防分页错误或瞬态故障误删；
  - 只接受 `^[a-z][a-z0-9_-]{1,31}$`；
  - **fail-closed**：每轮先校验 `axiomics.tags[0] == "pending"` 且 `app-axiomics-web.defaultTag == "pending"`，
    不满足则本轮不开通（回收照常），记 `config_violation` 并告警。
- 审计：`~/.local/share/ax-admit/audit.jsonl`，`{ts, run_id, name, action, result, http_status}`。
- 测试接缝：`plan(users, tenants, config, now)` 为纯函数；Casdoor 客户端、GPU 客户端、时钟与路径均可注入（附录 I）。

## C GPU 接收器与半成品恢复

改造 `~/.local/bin/ax-admin-api.py`：

| 端点 | 请求 | 行为 |
|---|---|---|
| `POST /admin/provision` | `action` 为 `ensure` 或 `retire`，附 `name`、`request_id` | `flock` 后查 `tenants.map`：ensure 已存在 → `noop`；retire 不存在 → `noop`；否则调 CLI |
| `GET /admin/state` | — | 返回 `{"ok":true,"tenants":[...]}`（读 `tenants.map`） |

- 门禁：Caddy `remote_ip 192.0.2.229 127.0.0.1` + `X-Admin-Token`（常量时间比较）；只监听 `127.0.0.1:43100`；
  body ≤ 4 KB；action 白名单；名字正则同上。
- 超时：CLI 超时对齐 `axiomics-user` 的 1800 秒（现有 600 秒会在容器已建、map 未写时被杀）。
- 响应：成功路径（含 `noop`）一律 2xx；CLI 失败 5xx，由 `ax-admit` 下轮重试。
- 审计：沿用 `logs/admin-audit.jsonl`，`actor=ax-admit`，带 `request_id`。
- 测试接缝：`decide(action, name, exists)` 为纯函数；`TenantExecutor` 可换成 `fake-cli`；`TENANTS_MAP` 与审计路径可配（附录 I）。

半成品 runbook（`add` 先建容器、最后写 map）：

1. `podman ps -a --filter name=ax-u` 找到无归属容器；
2. 确认 `tenants/<tid>/data` 存在后 `podman rm -f ax-<tid>`；
3. 等下一轮 `ensure`，或手工 `axiomics-user add <name> --no-idp`。

## D 边缘 Caddy 片段

`:8444` 站点是 `route { ... }`，指令不能放 site 顶层（Caddy 默认排序会把 `handle` 排到 `forward_auth` 前，
静默绕过鉴权）。插在 `route` 内、`request_header -Remote-User` 之后、`@auth` / `forward_auth` 之前：

```caddyfile
route {
    request_header -Remote-User

    handle /console* {
        reverse_proxy 127.0.0.1:8000
    }

    # ……原有 @auth / @anonymous / forward_auth 与租户路由……
}
```

GPU `:8005`（同样是 `route`，末尾有 catch-all `reverse_proxy {upstream}`，控制面必须排在它前面）：

```caddyfile
route {
    @denied not remote_ip 192.0.2.229 127.0.0.1
    respond @denied "forbidden" 403

    @admin path /admin/*
    reverse_proxy @admin 127.0.0.1:43100

    # ……@health / @ledger / catch-all……
}
```

Casdoor 侧只需 `basePath = console`；`BasePathMiddleware` 剥前缀，`addBasePathToHtml` 注入
`<meta name="casdoor-base-path">`，前端 router 用 `basename`，API 自动带前缀。
副作用：`:8446` 根路径 UI 失效，统一用 `:8444/console`。

## E Casdoor 配置清单

全局 `app.conf`：

- `basePath = console`；
- `forceLanguage = zh`（前端 localStorage 为空时才生效；验收用无痕窗口）；
- 容器禁用代理继承（宿主 `HTTP(S)_PROXY` 会污染 webhook 投递）。

应用 `app-axiomics-web`（**必须建在 `axiomics` 组织下**，built-in 组织禁止注册）：

- `enableSignUp = true`、`disableSelfSignup = false`；
- `defaultTag = "pending"`；
- `signupItems` 只留 `Username`（regex `^[a-z][a-z0-9_-]{1,31}$`）、`Password`、`Confirm password`；
- 品牌：`title`、`logo`、`logoDark`、`favicon`，`footerHtml` 隐去页脚。

应用 `app-built-in`（管理员登录页）：`enablePassword = true` + 同样的品牌字段；确认它仍是 `built-in` 的默认应用。

组织 `axiomics`（审批下拉与注册默认值都在这里）：

- `tags = ["pending|待审核", "active|已通过"]`；**`tags[0]` 就是新注册账号的默认 Tag**（`controllers/account.go:266`
  先于 `defaultTag`），必须是 `pending`；
- 账户项里 `Tag` 与 `Is forbidden` 的 `ModifyRule` 必须是 `Admin`。

组织 `built-in`：`displayName`、`logo`、`logoDark`、`favicon`、同样的 `tags`（列表标签映射用当前组织）、
精简的 `navItems`（数据看板；用户、组织；应用、提供商；登录、记录；Webhooks、Webhook Events）。

## F 品牌与页脚

标准是「不显著展示 Casdoor」，不是全文替换。

- 页脚隐去（两个应用都设）：

  ```html
  <style>#footer{display:none;}</style>
  ```

  不要用控制台「清空页脚」按钮——它生成的内容闭合标签写错（`web/src/lib/setting.tsx:2171-2177`）。
- logo：登录页取应用 `logo`/`logoDark`；控制台侧栏取组织 `logo`/`logoDark`（`Sidebar.tsx:179`）。
- 标题：登录页用应用 `title`；控制台页签回落组织 `displayName`。
- favicon：应用与组织都要显式配，否则回落 Casdoor 的 CDN 图标。
- 图片持久化：放容器挂载目录并挂到 `/web/build/brand`，URL 用
  `https://192.0.2.229:8444/console/brand/<file>`；不要 `podman cp` 进可写层（重建即丢），
  也不要用 `127.0.0.1`（管理员浏览器会访问自己）。
- 静态过滤对不存在路径回落 `index.html`（200 + `text/html`），浏览器会拒绝渲染成图片。

## G Webhook 配置（仅唤醒）

- 建在 **built-in 组织**（非 built-in 被 SSRF 防护拒绝访问内网）；
- URL `http://127.0.0.1:43101/hook`，回环投递实测可用；
- 事件手工填 `new-user, update-user, delete-user`（UI 默认的 `signup/login/logout/update-user` 不含前两者）；
- **`SingleOrgOnly` 必须关闭**，否则 `axiomics` 的注册事件（record 组织是 axiomics）被丢弃；
- 载荷一律忽略，只取 `action` 记一行日志，限制 body 大小；
- 非 2xx 一律重试（3 次 × 60 秒）——不是"只重 5xx"；
- **建好后必须重启 Casdoor 一次**，否则 worker 不启动、事件永远 `Pending`；
- 投递失败无害：轮询补上。

## H 验收清单

本地（✅ 为已完成）：

1. ✅ 子路径托管：`/console/` meta、`/console/assets/*` 200、signup/login/users 正常（2026-11-13）；
2. ✅ 品牌：注册页/登录页/控制台无页脚、无 Casdoor 品牌、全中文（无痕窗口）；
3. ✅ 注入无效：匿名 `POST /console/api/update-user`（body 带 `tag=active`）被拒，随后 `run_once` 零动作；
4. ⚠️ 部分：lab 用 API 建号验证了"pending 不开通、active 开通"，未走真实注册表单；
5. ✅ 重复触发/重放 → `noop`，不重复建租户；
6. ✅ 撤权 `active → pending` → 第 2 轮 retire：map 无该用户（token 与路由由 runbook 侧验证）；
7. ✅ 拒绝：`isForbidden` → 两轮回收（LDAP 拒绝由源码核实）；
8. ✅ 删除用户 → 有租户时两轮后 retire；
9. ⚠️ 部分：`run_once` 驱动验证了收敛，真实 60 秒定时器与 webhook 唤醒未接；
10. ⚠️ 未测：跨组织同名用户场景尚未在 e2e 中覆盖；
11. ✅ 非法用户名 / 坏 token / body 超限 → 400/401/413（单测覆盖）；
12. ✅ 配置错误：`invariant_ok=False` 时只挡 ensure、回收照常（单测覆盖）；
13. ⚠️ 部分：截图已有登录页/注册页/用户页；待审页与"禁止登录后登录失败"未截。

生产（维护窗口）：

1. `basePath` + 边缘路由（附录 D 片段），重启 Casdoor，`/console/` 可登录；
2. 部署 `ax-admit` 与 GPU 接收器，`/admin/state` 可达；
3. 配 webhook 后重启，事件不停留 `Pending`；
4. 完整链路：注册 → 待审 → 批准 → 登录 → 执行任务；
5. 撤权与删除各一次，确认回收；
6. 生产复跑注入用例；
7. 品牌 + 导航 + favicon 检查。

## I 测试矩阵与测试替身

### 替身

- `FakeCasdoor`：实现 `list_users()`，返回固定 JSON（只需 `name`/`tag`/`isForbidden`）；
  可脚本化三种失败——HTTP 500、超时、分页返回不完整（用于断言"取不全就不回收"）。
- `FakeGpu`：`state()` 返回内存集合；`apply()` 记录 `(action, name, request_id)`，可注入延迟与失败。
- `fake-cli`：可执行脚本，把 argv 追加到调用日志；环境变量控制 `FAIL=add|del`、`SLEEP=n`
  （模拟半成品与超时，不触碰真实容器）。
- 逻辑时钟：`now` 由参数传入，测试用计数器推进，不 sleep。

### L0 纯函数

| 用例 | 输入 | 期望 |
|---|---|---|
| 待审 + 无租户 | `tag=pending` | 无动作 |
| 已批 + 无租户 | `tag=active` | `ensure` |
| 已批 + 有租户 | — | 无动作 |
| 禁止登录 + 有租户 | 第 1 轮 | 无动作（第 2 轮才回收） |
| 禁止登录 + 有租户 | 第 2 轮 | `retire` |
| 用户消失 + 有租户 | 连续 2 轮 | `retire` |
| 用户消失 + 无租户 | — | 无动作 |
| 非法名字 | `"Alice!"` | 记 `invalid_name`，无动作 |
| 配置不变量失败 | `tags[0]=active` | 不 `ensure`；`retire` 照常 |
| Casdoor 拉取失败 | 客户端抛错 | 零动作（含不回收） |
| GPU state 失败 | 同上 | 零动作 |
| 待审页映射 | `403` + `no tenant` | `pending` |
| 待审页映射 | `403` 其他 / `500` | `other` |

### L1 组件

`ax-admit`：

| 用例 | 期望 |
|---|---|
| 任意噪音 body（1 KB） | 200，触发一轮，无副作用 |
| 超限 body | 413/400，不触发 |
| 两次并发唤醒 | 单飞，只跑一轮 |
| 上游 500 | 审计 error，下轮重试 |
| 推进两轮时钟 | `retire` 只在第 2 轮发生 |
| 重复事件 | fake GPU 记录显示 `ensure` 恰好 1 次 |

接收器：

| 用例 | 期望 |
|---|---|
| `ensure` 连发 2 次 | CLI 只被调用 1 次 |
| `retire` 且不在 map | 200 `noop`，无调用 |
| 错误 token | 401 |
| 非回环 peer（绕过 Caddy） | 403 |
| body > 4 KB | 413 |
| CLI 超时或失败 | 5xx，`tenants.map` 未被写 |
| 并发 `ensure` + `retire` | flock 串行，最终状态一致 |

### L2 本地全链路（lab）

每个场景一个脚本（`tests/e2e/<case>.sh`），跑完还原 lab：

1. 注册 → `pending` → 无租户；
2. 批准 → ≤1 轮开通；
3. 匿名 `update-user` 注入 → 无变化；
4. 撤权 → `retire`，token 文件消失、`tokens.caddy` 无该租户；
5. 删除 → `retire`；
6. 关掉 webhook → 轮询仍收敛；
7. 跨组织同名用户被改 → 无影响；
8. CLI 首次失败 → 状态不变，下轮成功；
9. `assert-config` 通过；故意改 `tags[0]` → 失败。

### L3 生产冒烟

注入用例、批准收敛、撤权收敛、`assert-config`、品牌检查（无痕窗口）。

### 当前状态（2026-11-13）

- L0/L1：90 个用例全绿（receiver 33、service 36、config 21）；
- L2：`e2e_lab.py` 8 个场景 PASS，连跑两次一致；未覆盖跨组织同名与真实 60 秒定时器；
- L3：未执行（生产未部署）。

### 边界

不测 Casdoor 前端渲染（由配置断言 + 截图覆盖）；不做自动混沌注入（L2 手工停一次服务即可）。
所有测试不得依赖真实 Casdoor/GPU/网络，L2 例外。

## J 风险登记与已知缺口（详版）

- **同源 Cookie**：控制台与工作区同源同端口，Casdoor 会话 cookie（`Path=/`）随请求到达 GPU 上游；工作区 XSS
  可代管理员调用 `/console/api`。缓解：控制台迁独立 origin/端口，或边缘只对 `/console` 下发该 cookie；本期未做。
- **待审用户自锁**：注册后自动登录 Casdoor，可在账户设置自开 MFA/WebAuthn，此后 LDAP bind 失败。
  runbook：管理员清除 `PreferredMfaType` / `TotpSecret` / `WebauthnCredentials`。
- **token 明文**：`X-Admin-Token` 走内网 HTTP；仅 Web→GPU 一条专线。
- **配置耦合**：`tags[0]` 与 `defaultTag` 共同决定注册默认值；改顺序即改审批位（有 fail-closed 兜底）。
- **半成品租户**：`add` 中断需人工按附录 C 清理。
- **控制台暴露面**：`:8444/console` 对 VPN 内可达者开放；必要时边缘按网段限制。
- **Tag 可见性依赖前端版本**：v4.25.0 新前端有 Tag 列；旧版 antd 控制台没有。
- **登录页多余登录方式**：`signinMethods=None` 只消掉验证码页签，WebAuthn/面容ID 仍在。
- **无邮箱**：没有密码找回，由管理员重置。
- **残留文案**：设置项、帮助链接、`app-built-in` 显示名仍有 Casdoor 字样。
- **`retire` 的最后一个租户**（2026-11-13 已修）：`axiomics-tenant:429` 用 `grep -v ... > map.new; mv` 且脚本是
  `set -euo pipefail`；map 只剩待退役那一行时 `grep` 无输出、返回 1，脚本在 `mv` 前退出——容器已停、归档已写，
  map 仍保留该行。修复改为 `awk -v n="$name" '$1 != n'`（空输出也返回 0，保留注释与空行）。
- **归档含 token**（2026-11-13 已修）：`tar` 早于 `rm -f token`，`archive/uNNNN-date.tar.gz` 内含 token。
  修复把删 token 提到打包之前，并加 `--exclude="$tid/token"` 兜底。
- **旧接收器的静默成功**：新载荷没有 `organization` 字段，旧实现命中 `ax-admin-api.py:328` 返回
  `200 {"ignored":true}`；迁移必须同一窗口内替换两端，禁止灰度共存。
- **子代理不得接触生产路径**（2026-11-13 事故）：仓库存在同名但语义相反的包装器——
  `axiomics-mt/bin/axiomics-user` 只读预演，`~/.local/bin/axiomics-user` 默认真实执行。给代理的任务只能
  指向夹具目录与假 CLI；真实路径由人执行。该事故导致 lzj 租户被误 retire、probe_dry 被建出。

## K 方案对比

| 方案 | 开通方式 | 代价 | 风险 | 结论 |
|---|---|---|---|---|
| A 邀请码 | 发码注册 | 零代码 | 无待审状态 | 备选 |
| B 人工建号 + 自动开通 | 仍人工建号 | 最小 | 不解决自助注册 | 回退 |
| C 原生 + GPU 消费 webhook | GPU 读事件开班 | 代码最少 | **未认证者可注入开班/销户** | 作废（rev C/D） |
| **E 原生 + Web 侧对账** | 原生审批，Web 查证后推 GPU | 一个小服务 | 多一个常驻进程 | 采纳 |
| C' 自建注册/待审页 | 自建页面 | 1.5–2 天 | 重复实现 | 不采纳 |
| D 开放注册即开班 | 注册即得算力 | 同 A | 任何人可得算力 | 不采纳 |

## L 调研记录与证据

源码（Casdoor v4.25.0）：

- `conf/conf.go`、`routers/base_path.go`、`web/src/lib/base-path.ts`：原生子路径；
- `object/record.go:157-164`：`object` 取自 `ctx.Input.RequestBody`；
- `object/record.go:240-254`：`AddRecord` 无条件 `SendWebhooks`；
- `object/record.go:333-350`：`single_org_only=0` 时不比较组织；
- `main.go:122`、`routers/record.go:39-41`：`AfterExec` 对失败请求同样记录，只豁免 login/signup；
- `object/user_util.go:795-801`、`:968-981`：非管理员改 Tag/Groups 被静默还原；
- `object/webhook_worker.go:169-198`：成功条件是 2xx，其余全部重试；
- `controllers/account.go:266-270, 289-290`：组织 `tags[0]` 先于 `defaultTag`；
- `object/init.go`：默认账户项 `Tag`/`Groups`/`Is forbidden` 均为 `Admin`；
- `web/src/pages/defaults.ts:647-661`：新建 webhook 的默认事件；
- `web/src/pages/UserListPage.tsx:137`、`UserEditPage.tsx:368-382`：Tag 列与下拉；
- `web/src/components/auth/AuthLayout.tsx:252,361`、`layout/AppLayout.tsx:36-53`：页脚来源；
- `web/src/lib/setting.tsx:2171-2177`：「清空页脚」内容闭合标签写错；
- `web/src/i18n.ts:33-42`：localStorage 语言优先于 `forceLanguage`；
- `ldap/server.go:108-150` → `object/check.go:415-417`：`IsForbidden` 令 bind 失败。

本地实例实测（SQLite，同一镜像）：

- 子路径与品牌全部正常；两个应用都设页脚隐去后，注册页/登录页/控制台均无页脚；
- 事件动作：注册 `new-user`、API 建号 `add-user`、删除 `delete-user`；
- 失败与未认证请求同样产生记录与投递：响应 `The ID is immutable.` 的事件里 `tag=active`；
  `user="anonymous"`、`Unauthorized operation` 的事件同样被投递；
- 组织 `tags` 为空时 `defaultTag` 生效；有 `tags` 时取 `tags[0]`；
- built-in webhook 可投递到 `127.0.0.1`；axiomics 组织 webhook 被 SSRF 拦截；
- 宿主代理变量污染投递；`--http-proxy=false` 后直连。

端口：`Web→GPU:8005`、`Web→DB:3306` 通；`GPU→Web` 不通；`:8444` 达 TLS；`:8446` 超时；`:8443` 不可达。
Web 侧 Authelia 实测为 LDAP 后端，`base_dn: ou=axiomics,dc=example,dc=com`。

## M 实施记录

本地验证（2026-11-13，Casdoor v4.25.0 + Caddy `:8040` → `:8020`）：

| 检查 | 结果 |
|---|---|
| `/console/` | 200，注入 `casdoor-base-path=/console` |
| `/console/assets/*.js` | 200，`text/javascript` |
| `/console/signup/app-ax` | 200，三个必填项，页脚已隐去 |
| 管理员登录 | 成功，跳转 `/console` |
| `/console/users` | 列表正常（路由与 API 均走子路径） |
| 语言 | `defaultLanguage` 无效；`forceLanguage` 在无已选语言时生效 |
| 页脚 | 两个应用都设后，三处页面均无页脚 |
| 组织品牌 | 侧栏与页签标题为「Axiomics 管理后台」 |
| 组织 tags | 编辑页 Tag 为中文下拉 |

更正：早先记录「注册页页脚已隐去」不实——当时只有 `app-built-in` 设置，`app-ax` 仍是可见替代文案；
本轮已统一为隐去并复验。

### 本地实现与验证（2026-11-13，rev H）

代码在 `ops/admit/`（仅标准库，未部署、未提交）：

| 模块 | 文件 | 验证（本人复跑） |
|---|---|---|
| 接收器 | `receiver.py` | 33 个单测 + curl 冒烟（401/403/413/400/500、幂等、flock） |
| 开通服务 | `service.py` | 36 个单测（`plan` 六条规则、两轮回收、fail-closed、hook 噪音、去抖、分页） |
| 配置断言 | `assert_config.py` | 21 个单测 + lab 实跑 9 项全 OK |
| 联调脚本 | `e2e_lab.py` | 8/8 PASS，`rc=0`，连跑两次一致 |

单测合计 90，`python3 -m unittest discover` 结果 `Ran 90 tests ... OK`。联调覆盖：待审不动、
批准开通、重复不叠加、改回 pending 两轮回收、禁止登录两轮回收、匿名注入无副作用、删用户回收、清理复原。
跑完 lab 用户数仍为 10，无临时用户、无残留监听、无残留进程。

实现与设计的一处环境差异：lab 的注册应用名是 `app-ax`，不是生产名的 `app-axiomics-web`，
脚本支持 `AX_E2E_APP` 覆盖。审计字段已按附录 C 补上 `request_id`（见下一节）。

### 租户脚本修复与夹具验证（2026-11-13）

改动 `/disk1/dabiao/axiomics-mt/bin/axiomics-tenant`（备份 `.bak-20261113`），两处：

1. `rm -f token` 提到 `tar` 之前，并加 `--exclude="$tid/token"`；
2. `grep -v "^$name "` 换成 `awk -v n="$name" '$1 != n'`（空表不返回非零）。

夹具：临时 `AX_ROOT` + PATH 前置的假 `podman`（只记录 argv，不碰真实容器），用真脚本执行 `retire`：

| 用例 | 修前 | 修后 |
|---|---|---|
| map 仅 1 行 | `rc=1`，map 仍含该用户，token 未删，归档含 token | `rc=0`，map 空，token 已删，归档无 token |
| map 2 行 | `rc=0`，但归档含 token | `rc=0`，map 仅剩另一行，归档无 token |

同时给接收器审计补了 `request_id`（契约与测试同步），`unittest discover` 仍 `Ran 90 tests ... OK`。
生产未执行任何 `retire`，真实容器、网关、Authelia 均未被触碰。

### 事故与全量重置（2026-11-13）

**事故**：部署准备阶段的子代理把 `~/.local/bin/axiomics-user`（默认真实执行）当成预演版，执行了
`add probe_dry` 与 `del lzj`。后果：lzj 的 `u0006` 被 retire（停容器、删 token、移出 map、撤路由、
生成 1.2G 归档），`probe_dry` 建出 `u0010` 并在运行；lzj 在 GPU file 后端的口令哈希被删除且不可恢复。

**处置**：确认当前没有真实用户访问后，改为**全量重置**，不执行恢复脚本。GPU 侧已执行并核对：

| 项目 | 结果 |
|---|---|
| 容器 | 全部 `ax-uNNNN` 已删除 |
| `tenants/`、`archive/` | 清空（0 项） |
| `tenants.map`、`retired.log` | 0 字节 |
| `gateway/{tenants,upstreams,tokens}.caddy` | 0 字节；`caddy validate` 通过 |
| 网关重载 | 首次报 `/certs/server.crt` ENOENT，重试 `rc=0`；`:8005/health` 200 |
| Authelia | `users_database.yml` 仅剩占位用户（随机口令、未公开）；`db.sqlite3` 删除后重建；启动检查通过 |
| 日志 | `logs/` 五个文件清空（usage/audit/access/model/activator），image-build 与 soak 日志删除； |
| | 截断后 Caddy 继续写 `access.log` 已验证（追加后 589 字节） |
| 未动 | `auth/` 证书与哈希文件、`~/.local/bin` 脚本、Casdoor 目录、根目录 legacy `audit.jsonl`（11 行） |

**Casdoor 重置（已完成，2026-11-13 18:10）**：生产实例是 **MySQL** 后端（`ax-mysql-web`，库 `casdoor`），
不是早期假设的 SQLite。实际步骤：`mysqldump` 备份 → `DROP/CREATE DATABASE casdoor` → 在 `app.conf`
设 `basePath=console`、`origin=https://192.0.2.229:8444`、`forceLanguage=zh` 与新的
`initAdminPassword` → 启动 → 用该口令登录 → 按附录 E 重建 `axiomics` 组织、`app-axiomics-web`、
`built-in` 品牌与导航、`svc-admit`。脚本 `ops/admit/deploy/reset-casdoor.py`（默认 dry-run）。
口令只落在 0600 文件：管理员 `/home/example-user-650420/casdoor/conf/.admin-initial-password`，
`svc-admit` `/home/example-user-650420/.config/ax-admit/secrets/casdoor-svc.password`。重置后
`assert_config.py` 九项全 `OK`（退出码 0）。

### 生产部署与验证（2026-11-13）

| 组件 | 位置 | 状态 |
|---|---|---|
| GPU 接收器 | systemd 用户 `ax-admin-api.service`，`127.0.0.1:43100`，入口 `~/.local/bin/ax-admin-api.py` | active |
| GPU 路由 | `:8005` 内 `@admin path /admin/* → 127.0.0.1:43100` | 回环 401、内网 403 |
| Web ax-admit | systemd 用户 `ax-admit.service`，`127.0.0.1:43101`，60s 轮询 | active |
| Casdoor | `:8444/console`（`basePath=console`），`/signup` 302 到原生注册页 | 200 / 302 |
| 待审页 | GPU 403 + `X-Axiomics-State: pending` → Web `handle_response` 返回「审核中」200 | 已验证 |
| 品牌 | 两应用页脚 `#footer{display:none}`；标题/logo/favicon 指向工作区静态资源 | assert 通过 |

端到端证据（探针 `probe_admit`，测完删除）：

| 场景 | 结果 |
|---|---|
| pending 用户 1FA 登录 → `/axiomics` | `200` + 「审核中」，无租户 |
| 批准（tag=active）→ 下一轮 | `ensure` 审计 `ok/200`；`tenants.map` 出现 `probe_admit u0001 42100 0`；`ax-u0001` Up |
| 已批准用户访问工作区 | `200`，不再是待审页 |
| 撤回（tag=pending）→ 连续两轮 | `retire`；容器停止、token 删除、归档生成、map 与网关清空、`retired.log` 记 `u0001` |

三个实测缺口（已处置）：

1. **webhook 无法投递**：Casdoor 在 pasta pod 内，容器的 `127.0.0.1` 与主机回环不是同一个；
   实测容器 → 主机 `192.0.2.229:43101` 也是 `000`（pasta 复制宿主地址，流量留在容器内）。
   事件因此永远 `Pending`。webhook 只用于加速唤醒，已删除；收敛由 60s 轮询保证。
2. **Authelia 的 LDAP 绑定账号失效**：重置后仍用旧 `admin` 口令，1FA 全部 401。已把绑定账号切到
   `cn=svc-admit,ou=built-in,…`，口令取 0600 文件；不再把人的管理员口令写进 Authelia 配置。
3. **客户端超时短于执行时间**：`GpuClient` 原为 30s，而 retire 打 849MB 归档耗时更久，Web 先断开
   并记 `retire error`（GPU 侧实际 `done/200`）。已加 `PROVISION_TIMEOUT=1800s`（与接收器
   `CliExecutor` 对齐）并补回归测试；测试总数 91。

**回滚点**：Casdoor 备份 `/home/example-user-650420/backup/casdoor-reset-20261113-181017/`；GPU Caddy
`Caddyfile.bak-ax-admit-20261113-180503`；Web Caddy `ax-gw/conf/Caddyfile.bak-ax-edge-20261113-181518`；
Authelia `configuration.yml.bak-reset-20261113-181913`。

### 工作量估算

| 项 | 估算 |
|---|---|
| `ax-admit`（Web 服务 + 与 Casdoor/GPU 联调） | 4–6 小时 |
| GPU 接收器改造（ensure/retire/state、幂等、超时对齐） | 3–4 小时 |
| 测试骨架（fake-cli、FakeCasdoor/Gpu、L2 场景脚本、`assert-config`） | 4–6 小时 |
| Casdoor `basePath` + 边缘路由 + 账户项与组织 tags 复核 | 1 小时 |
| 品牌与页脚（图片持久化、favicon、语言、导航） | 0.5 小时 |
| webhook 配置、重启、代理修正 | 0.5 小时 |
| 登录页注册入口 + 待审提示 | 2–3 小时 |
| 生产验证（含一次 Casdoor 重启） | 1.5 小时 |

待实施：生产部署（`svc-admit` 建号、env 文件、systemd、GPU systemd 与 Caddy 路由、webhook 配置与重启、
登录入口与待审页、品牌落地），以及 L2 未覆盖的两项（跨组织同名、真实 60 秒定时器）。
