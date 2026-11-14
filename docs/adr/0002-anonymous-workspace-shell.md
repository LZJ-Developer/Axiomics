# ADR 0002: 未登录先看到空工作台，首次操作再登录

Status: accepted（2026-11-13，方案 B 修订版；公开案例入口、工作台启动器、`/projects`、边缘 Cookie 分流与 Authelia 品牌资产均已实现，并已于 2026-11-13 部署到 Web）

日期：2026-11-13

## 已决策（2026-11-13）

1. **未登录页 = 案例画廊 + 全部 8 个真实对话回放**，每个案例都可点击；不做脱敏。
2. **登录后直接进工作台**；工作台可进入项目列表、可新建项目。
3. 登录页做 Axiomics 品牌化。
4. 公开入口仍是 `/axiomics`（案例页），点击“开始使用/案例回放”触发登录。

## 要解决的问题

当前访问 `https://192.0.2.229:8444/axiomics` 时，Caddy 在边缘先做 `forward_auth`，
未登录直接 `302` 到 `https://192.0.2.229:8443/?rd=...`。用户看不到工作台，只看到登录页。

期望行为：

1. 未登录访问 `8444/axiomics` 返回 `200`，能看到**空的工作台/对话台**；
2. 用户执行需要身份的操作（发消息、新建项目、打开已有项目）时，才跳转登录；
3. 登录成功后回到原地址，继续刚才的操作；
4. 已登录用户的行为与现在完全一致。

## 现状（已核实）

| 层 | 行为 | 位置 |
|---|---|---|
| Web 边缘 `:8444` | 全站 `forward_auth` → Authelia `:9091`；未登录 302 到 `:8443` | `axiomics-deploy/docs/manual/web-edge.Caddyfile` |
| GPU 网关 `:8005` | `Remote-User` → tenant 映射；映射失败 `403 no tenant` | `/disk1/dabiao/axiomics-mt/Caddyfile` |
| 前端 SPA | 没有应用内登录页，也没有匿名模式；首屏即调用租户 API | `frontend/workspace/src` |
| SPA 资源 | 根绝对路径（`/assets/...`），构建产物在 `frontend/workspace/dist`，由后端二进制内嵌 | `backend/cli/script/generate-web-assets.ts` |
| 登录门户 | Authelia 独立端口 `:8443`，已由运维放行 | — |

结论：这不是“Caddy 少配了一条”，而是**三道闸门 + 前端缺少匿名模式**。只放行静态路径会得到
`403 no tenant` 或白屏，不会得到可用的空工作台。

## 目标与非目标

目标：

- 未登录可渲染工作台外壳（导航、空项目列表、禁用的输入框）；
- 首次需要数据的操作触发登录，登录后回到原 URL；
- 匿名响应只包含静态资源，不包含任何租户数据；
- 不改变已登录用户的路径与性能。

非目标：

- 不做匿名试用/演示租户；
- 不把 API 暴露给未登录请求；
- 不在本期把登录门户挪到 `8444/auth`（`8443` 已放行，可作为后续清理项）。

## 方案对比

### 方案 A：维持登录优先，仅把登录页挪到 `8444/auth`（最小改动）

- 不做空工作台；地址栏不再跨端口。
- 改动：Authelia `server.address` 加 `/auth`，Caddy `forward_auth` URI 改为 `/auth/api/authz/forward-auth`。
- 成本：约 10 分钟 + 验收；风险低。
- 适用：只介意端口跳转，不要求“先看到工作台”。

### 方案 B：边缘软鉴权 + 匿名 SPA 外壳（推荐，若确需空工作台）

- Web 边缘用 Authelia 的 **authz（不重定向）** 端点做软判断：
  - 已登录：正常反代 GPU；
  - 未登录：返回静态外壳（`200`），并注入 `X-Axiomics-Anonymous: 1`；
- 静态外壳由 Web 上的 Caddy `file_server` 提供（同一份 `frontend/workspace/dist`）；
- API 与动作路径仍走 `forward_auth`，未登录返回 `302/401`；
- 前端增加匿名模式：不调用租户 API，输入框禁用，点击/发送时跳登录；
- 登录成功后 Authelia 按 `rd` 回到 `/axiomics`，SPA 以已登录状态启动。

### 方案 C：独立落地页（伪工作台）

- 用一个轻量页面模仿工作台外观，点击后去登录。
- 成本低，但与真实 SPA 双份维护，容易漂移；不推荐用于正式试用。

### 方案 D：匿名共享租户

- 未登录请求注入一个固定 `Remote-User`（演示租户）。
- 所有匿名用户共享一个身份，破坏审计和租户隔离；不建议。

**推荐：先按方案 A 解决端口跳转；若“空工作台”是硬需求，再按方案 B 排期。**
方案 B 的主要成本在前端，不在部署。

## 方案 B 详细设计

### 请求路径矩阵

| 路径 | 未登录 | 已登录 |
|---|---|---|
| `/`、`/axiomics`、`/axiomics/*` | 200 静态外壳 | 反代 SPA |
| `/assets/*`、`/favicon.ico`、`/manifest*` | 200 静态资源 | 200 静态资源 |
| `/api/public/session`（可选探针） | `{"authenticated":false}` | `{"authenticated":true,"user":"..."}` |
| `/api/*`、`/project/*`、`/session/*`、`/pty`、`/event`、`/runtime/*`、`/settings/*` | 302 到登录 | 反代 GPU |
| 其他 | 302 到登录 | 反代 GPU |

> 静态路径清单以构建产物为准，必须在部署时生成并纳入测试，不能手写猜测。

### Web 边缘（示意）

```caddyfile
:8444 {
	tls /certs/server.crt /certs/server.key

	# 软鉴权：authz 端点返回 401 而不是 302，便于分流
	forward_auth 127.0.0.1:9091 {
		uri /api/authz/authz
		copy_headers Remote-User Remote-Name Remote-Email
	}

	reverse_proxy 192.0.2.113:8005 {
		header_up Host {host}
		header_up X-Forwarded-Proto https
	}

	handle_errors {
		@unauth expression {http.error.status_code} == 401
		handle @unauth {
			header X-Axiomics-Anonymous "1"
			header Cache-Control "no-store"
			root * /srv/axiomics-shell
			try_files {path} /index.html
			file_server
		}
	}
}
```

注意：

- `authz` 端点的实际路径与状态码要在目标 Authelia 版本上先验证（**Phase 0 的 spike**）；
  若不支持，退化为一个公开的 `/api/public/session` 探针。
- 必须剥离客户端传入的 `Remote-User`（`request_header -Remote-User`），防止伪造租户。
- 静态目录需要只读挂载；给 Caddy 容器新增卷要**重建容器**，不能只 `restart`。

### 前端改动（主要工作量）

1. 启动时读取 `X-Axiomics-Anonymous`（或探针结果），进入匿名模式：
   - 渲染导航、空项目列表、禁用的输入框；
   - **不调用**租户 API，避免 `fetch` 跟随 302 拿到登录页 HTML；
2. 首次操作（发送、新建、打开）时跳转：
   ```ts
   location.assign("https://" + location.hostname + ":8443/?rd=" + encodeURIComponent(location.href))
   ```
3. 已登录启动路径保持不变；任何 API 返回 401/403 时回退到匿名模式并提示登录；
4. 静态资源缓存：带 hash 的资源 `immutable`，`index.html` 与匿名响应 `no-store`；
5. 匿名响应不写任何用户态到 localStorage/sessionStorage。

### 构建与部署

- 使用与后端二进制**同一版本**的 `frontend/workspace/dist`，部署时复制到 Web 的
  `/srv/axiomics-shell`（或挂载到 Caddy 容器的只读目录）；
- 版本不一致会造成“外壳是旧版、登录后是新版”的割裂，必须在发布流程里绑定版本号；
- 回滚：删除静态挂载/恢复 Caddyfile，回到登录优先。

## 安全分析

| 风险 | 缓解 |
|---|---|
| 匿名访问读到租户数据 | 匿名分支只允许静态文件；API 前缀一律鉴权 |
| 客户端伪造 `Remote-User` | Web 边缘删除入站该头；GPU 仅信任 Web 源 IP |
| 静态目录穿越 | `file_server` + 固定 root + `try_files`，禁止目录列表 |
| 缓存泄露 | 用户相关响应不缓存；匿名页 `no-store` |
| 版本漂移 | 静态包与后端二进制同版本发布，发布检查比对 hash |
| 登录循环 | 先验证 `rd` 回跳；用 curl 断言 302 的 `Location` |

## 工作量与风险

| 工作项 | 估算 | 说明 |
|---|---|---|
| Authelia authz 端点验证（spike） | 0.5 天 | 决定软鉴权是否可行 |
| Web 边缘分流 + 静态挂载 | 0.5–1 天 | 需要重建 Caddy 容器 |
| 前端匿名模式与登录闸门 | 3–5 天 | 主要成本；需处理首屏空态与 401 |
| 测试（匿名/登录/回跳/租户隔离） | 1–2 天 | 含安全负向用例 |
| 安全审查材料更新 | 0.5 天 | 新增公开静态面、端口与数据流 |

风险最高的不是部署，而是**前端首屏对租户数据的假设**。若 SPA 的空态改造超出预期，
应停止并回到方案 A，而不是用伪页面绕过。

## 验收标准

1. 未登录 `GET /axiomics` 返回 `200`，页面渲染空工作台，Network 中没有租户数据请求；
2. 点击发送/新建 → 跳 `8443` 登录 → 成功后回到原 URL，操作可继续；
3. 未登录 `GET /api/project`（或任一租户 API）返回 `302/401`，不返回数据；
4. 客户端自带 `Remote-User: admin` 不能提升权限；
5. 已登录用户的项目、会话、终端、内核行为与改造前一致；
6. 全量测试通过，新增匿名/回跳用例；
7. 安全审查能说明：公开面只有静态资源，数据面仍全部鉴权。

## 调研结论（2026-11-13，更新方案 B）

调研目标是回答：能否让专家先看到一个“有内容”的页面，而不是空工作台。结论是**可以，而且比原方案轻**：
仓库里已经有一个完全静态的案例画廊，可以直接作为匿名首页。

### 1. 现成的静态案例页

- `frontend/workspace/src/pages/cases-gallery.tsx` 渲染案例画廊；
- `frontend/workspace/src/pages/cases/catalog.ts` 是编译期静态数据（8 个真实案例：
  问题、数据、结论、三张图），不调用 API；
- 图片在 `frontend/workspace/public/cases/`，共 24 个文件、约 9.7MB；
- 依赖只有 Router、i18n、Wordmark、图标和 CSS；
- `AppBaseProviders`（`app.tsx:65`）只有 Meta/Theme/Language/Dialog，不依赖
  ServerProvider/SDK，可单独用于公开页；
- 案例回放 `pages/cases/replay.tsx` 才需要 SDK（`session.get`/`session.messages`），
  匿名页不加载它。

这意味着：**不需要匿名渲染整个工作台，只需要把案例画廊做成一个独立入口。**

### 2. 独立入口的构建方式（新增，替代原“匿名 SPA 外壳”）

- 新增 `cases.html` + `src/cases-entry.tsx`，只挂 `AppBaseProviders` 和一个最小 Router，
  渲染 `CasesGallery`；
- Vite `build.rollupOptions.input` 增加第二个入口，产物是静态 HTML + 共享 chunks；
- 公开页里的“新对话”和案例卡片指向受保护路由。`<A>` 是客户端路由，若用 catch-all
  会被画廊自己拦截，必须改成整页跳转（`location.assign`）或给 `CasesGallery` 增加
  `public` 模式，让这些链接走服务端；
- 部署时把 `dist` 中公开页所需的文件放到 Web 的只读静态目录，由 Caddy `file_server`
  提供；不需要在 GPU 增加匿名静态路由。

### 3. 软鉴权：用 Cookie 存在性，不用 authz 端点

原方案担心 Authelia 的 302 无法分流。调研发现可以更简单：

- Authelia 的会话 Cookie 默认名是 `authelia_session`（需在部署配置中确认）；
- Caddy 对**页面路径**（`/`、`/axiomics`、`/cases`、`/assets/*`、`/cases/*` 等）判断：
  - 没有会话 Cookie → 直接返回静态案例页（`200`）；
  - 有会话 Cookie → 走 `forward_auth`：有效则反代应用，过期则按现有逻辑跳登录；
- API 路径（`/api/*`、`/project/*`、`/session/*`、`/pty`、`/event`、`/runtime/*`、
  `/settings/*`）**永不**进入静态分支，始终鉴权。

优点：不依赖 Authelia 的 `authz`/`forward-auth` 状态码差异，也不需要 `handle_errors`
分流；风险只在 Cookie 名与路径清单，均可测试。

### 4. 登录页品牌化：可行，不改代码

Authelia 没有 `company_name`/`product_name` 配置，但支持**服务端资源覆盖**：

```yaml
server:
  asset_path: /config/assets
```

目录结构：

```text
/config/assets/
├── favicon.ico
├── logo.png
└── locales/
    ├── en/portal.json
    └── zh-CN/portal.json
```

可覆盖的文案键（来自 Authelia `portal.json`）：

| 键 | 默认值 | 建议值 |
|---|---|---|
| `Login - {{authelia}}` | 登录 - Authelia | 登录 - Axiomics |
| `Sign in` | Sign in | 登录 |
| `Username` | Username | 用户名 |
| `Password` | Password | 密码 |
| `Powered by {{authelia}}` | Powered by Authelia | Axiomics 多组学分析平台 |

注意：`asset_path` 需要把资源目录挂进 `ax-authelia` 容器并重启；当前版本是否支持要先确认
（该能力自 2022 年起存在，风险低）。

### 5. 范围澄清：案例画廊 ≠ 可交互对话

公开页能展示的是**案例画廊**（问题、数据、结论、截图），不是完整的对话回放。
点击案例或“新对话”会整页跳到受保护路由 → 登录 → 回到原地址。

如果要求“未登录也能看到一段真实的对话流”，需要额外把某个案例的消息导出成静态 fixture，
再用只读的 `SessionTurn` 渲染；这是另一项 1–2 天的工作，需单独决策。

### 6. 修正后的工作量

| 工作项 | 估算 |
|---|---|
| 独立 cases 入口 + 公开模式链接 | 1–1.5 天 |
| Vite 多入口 + Web 静态目录 + Caddy 规则 | 0.5–1 天 |
| Cookie 存在性分流 + 安全负向测试 | 0.5 天 |
| Authelia 品牌资源与中文 locale | 0.5 天 |
| 验收与回归 | 0.5–1 天 |
| **合计** | **3–4.5 天** |

比原方案少一天以上，主要省掉了“匿名渲染完整工作台”和 authz 端点适配。

### 7. Spike 清单（0.5 天，先做再排期）

1. 用 `AppBaseProviders` + 最小 Router 单独渲染 `CasesGallery`，确认无 API 调用、无报错；
2. 在部署配置里确认会话 Cookie 名，并验证 Caddy 的 Cookie 判断；
3. 确认 `ax-authelia` 版本支持 `server.asset_path`，并找到该版本 `portal.json` 的实际键；
4. 验证公开模式下案例卡片是整页跳转，不会被 Router 拦截；
5. 用 curl 断言：无 Cookie 访问 `/axiomics` 返回 200 案例页；有 Cookie 走应用；
   无 Cookie 访问 `/api/*` 不返回数据。

## 最终设计（2026-11-13 决策后）

### 未登录

- `/axiomics` 与 `/cases` 由 Caddy 按会话 Cookie 分流：
  - 无 `authelia_session` → 静态案例入口（`200`）；
  - 有 Cookie → `forward_auth` → 有效则反代应用，过期则跳登录。
- 静态入口 = 案例画廊 + **全部 8 个真实对话回放**；
- 回放是构建期导出的 JSON fixture，用现有 `timeline` + `snapshot` + `SessionTurn`
  只读渲染，不调用 SDK；
- 每个案例卡片可点击，进入该案例的静态回放，**不触发登录**；
- “登录 / 开始使用 / 新建对话”在**当前页打开登录弹层**：同源 `POST /auth/api/firstfactor`，
  成功后整页进入 `/axiomics`。认证仍是 Authelia（同一会话 Cookie、同一 LDAP/Casdoor 后端），
  但不再整页跳到它的门户；`href` 仍保留同源 `/auth` 作为无 JS 兜底。

### 已登录

- 登录后回到 `/axiomics`，应用 `/` 是 **工作台启动器**：
  - 有最近会话：直接 `navigate` 到该会话（`replace`，避免后退回到空页）；
  - 有项目、无会话：进入最近项目的“新会话”；
  - 无项目：工作台空态，提供“新建项目”“项目列表”“查看案例”。
- 项目列表迁到 `/projects`；工作台顶部/侧栏提供“项目”和“新建项目”入口；
- 不在未征得同意时自动创建项目。

### 导出与体积

- 8 个案例在发布期导出完整 `session` + `messages`，按决策**不做脱敏**；
- 先量一个案例的 JSON 体积；若过大，只裁剪工具输出的**展示体积**（分页/截断），
  不改变对话内容；
- 公开 fixture 与后端版本一起发布，避免结构漂移；
- 发布前仍扫描工具输出中的凭据/token（成本低，避免把密钥带进静态包）。

### 安全边界

- 公开分支只服务静态文件；API 路径永不进入公开分支；
- 边缘剥离客户端传入的 `Remote-User`；
- 匿名页不写任何用户态到本地存储。

### 修正后的工作量

| 工作项 | 估算 |
|---|---|
| 静态案例入口 + 回放组件 | 2–3 天 |
| 8 个案例导出 + 体积测量 | 1–2 天 |
| 工作台启动器 + 项目列表迁移 | 2–3 天 |
| 边缘 Cookie 分流 + 部署 | 1 天 |
| Authelia 品牌化 | 0.5 天 |
| 测试与回归 | 1 天 |
| **合计** | **7.5–10.5 天** |

## 实施记录（2026-11-13，tracer bullet 之后）

公开面、工作台启动器、`/projects`、边缘 Cookie 分流与 Authelia 品牌资产均已落地；
**部署已于 2026-11-13 完成**（Web 边缘、静态壳与 Authelia 子路径均已切换，见下方部署记录）。

| 件 | 位置 | 说明 |
|---|---|---|
| 公开入口 | `frontend/workspace/cases.html` + `src/cases-entry.tsx` | 独立 HTML，只挂 `AppBaseProviders`；`#/replay/<id>` 为 hash 路由，卡片用普通 `<a>`，不进入 SPA Router |
| 基础 Provider | `src/app-base.tsx` | 从 `app.tsx` 抽离 Meta/Theme/Language/Dialog，公开页不引入 Server/SDK/会话图 |
| 共享播放器 | `src/pages/cases/player.tsx` | 工作台回放与公开回放共用 `timeline` / `snapshot` / `SessionTurn`，避免两套渲染漂移 |
| 公开回放 | `src/pages/cases/public-replay.tsx` + `public-replay-shell.tsx` | 懒加载 fixture，只读渲染；不调用任何租户 API |
| 发布导出 | `script/export-cases.ts` | 只读扫描租户 `storage/`，按 8 个目录案例生成 fixture；输出目录已加入 `.gitignore` |
| 构建 | `vite.config.ts` | 两个 HTML 入口，共享 chunks；`dist/cases.html` 为公开页 |

验证证据：

| 项 | 结果 |
|---|---|
| 案例画廊 | 8 个案例全部渲染，搜索/筛选/统计正常 |
| 回放帧数 | SCENIC `313 / 313`；PBMC `550 / 550`，与 `catalog.ts` 标注一致 |
| 网络 | 页面只请求静态资源与 `/cases/replay/<id>.json`；没有 `/api/*`、`/session/*`、`/project/*`、`/event`、`/pty` |
| 控制台 | 无 error / warning |
| 体积 | 8 个 fixture 合计 25MB 原始 / 7.38MB gzip；PBMC 4.07MB gzip 为唯一异常值 |
| 截图 | `axiomics-manual/screenshots/01-public-gallery.jpg`、`02-public-replay.png`、`04-public-replay-result.png` |

部署侧还必须做对的一件事：`cases.html` 的资源是根路径绝对引用（`/assets/*`），
案例图片和 fixture 在 `/cases/*`。Web 边缘必须把这些**静态前缀**直接 `file_server`，
否则浏览器取 JS 时会先撞上 `forward_auth` 被送去登录页；API 前缀仍然一律鉴权。

### 已登录侧、边缘与品牌化（2026-11-13，DAG 之后）

| 件 | 位置 | 说明 |
|---|---|---|
| 工作台启动器 | `src/pages/home.tsx`、`workbench-launcher.ts`、`launch-route.ts` | `/` 按 `activity` 取最近项目，再按 `time.updated` 取最近会话并 `navigate(..., {replace:true})`；无项目时渲染空态（新建项目 / 项目列表 / 案例）；不自动建项目 |
| 项目列表 | `src/pages/projects.tsx`、`src/app.tsx` | 原项目列表整体迁到 `/projects`，搜索/新建/置顶/归档/恢复保持原行为；启动器与侧栏都有入口 |
| 公开页登录入口 | `src/pages/cases-gallery.tsx`、`public-replay.tsx`、`public-route.ts`、`cases/login-dialog.tsx`、`cases/login.ts` | “新建研究”不再指向 `/`（匿名 `/` 本身就是画廊，会原地打转）；点击在当前页打开同源登录弹层，`href` 保留 `/auth?rd=…/axiomics` 作为无 JS 兜底 |
| 边缘 Cookie 分流 | `axiomics-deploy/docs/manual/web-edge.Caddyfile` | 无 `authelia_session` → 静态 `cases.html`（页面与静态前缀都只走本地 handler）；有 Cookie → `forward_auth` → GPU；`/api/*` 等数据前缀永不进入公开分支；入站 `Remote-User` 先剥除 |
| 边缘测试 | `axiomics-deploy/docs/manual/check-web-edge.test.ts` | 38 pass / 12 skip（无容器引擎）；`AXIOMICS_CADDY_BIN=podman` 时 48 pass，含 `caddy adapt` 与 9 条真实 HTTP 断言 |
| Authelia 品牌资产 | `axiomics-deploy/deploy/authelia/assets/**`、`apply.sh`、`assets.test.ts` | logo/favicon 为真实字节拷贝；en/zh-CN `portal.json` 各 114 键；`apply.sh` 只打印 `podman cp` 与重启命令，不执行 |
| 品牌测试 | `assets.test.ts` | 19 pass；用真实 Authelia 容器跑 `validate-config`，并验证缺占位符/坏 JSON 会失败 |

验证证据（本轮实测）：

| 项 | 结果 |
|---|---|
| 启动器 | 真实后端下打开 `/` → 直接进入最近项目 “VR 验收 1029” 的最近会话，URL 无中间空页 |
| `/projects` | 5 个项目、搜索框、新建项目、案例入口均渲染；客户端路由切回正常 |
| 公开 CTA | `新建研究` 与回放页 `新建研究 →` 打开同源登录弹层（`href` 作为无 JS 兜底仍指向 `/auth`）；画廊仍为 8 张卡，配色仍是浅色 |
| 定向测试 | `public-route` + `public-replay.dom` 12 pass / 0 fail；`workbench-launcher` 17 pass；`launch-route` 11 pass；边缘与品牌 38+18 pass |
| typecheck | `bun run typecheck` 通过 |
| 全量测试 | 见下方“全量测试”一节 |

公开 fixture 凭据扫描：8 个 JSON 中仅命中 1 处形似 `AKIA…` 的字符串，位于一段
base64 图片数据内部，不是凭据；未发现真实 key/token。

已知偏差（记录，不在本轮改动）：

- 匿名页的 `ThemeProvider` 仍会写入主题 CSS 缓存键（`axiomics-theme-css-*`），
  它不包含用户数据，但严格按“匿名页不写任何 localStorage”衡量仍算一次写入。
- Authelia 资产原本只生成目录与 dry-run 脚本；2026-11-13 部署时已安装到
  `/home/example-user-650420/authelia/assets` 并启用 `server.asset_path`（见部署记录）。
- `/` 在匿名状态下返回静态画廊（按请求路径矩阵），因此公开页的登录入口必须显式指向
  `:8443`；这一点已由 `portalLoginHref` 与 DOM 测试固定。

### 全量测试（2026-11-13）

| 套件 | 命令 | 结果 |
|---|---|---|
| 前端 | `cd frontend/workspace && bun test src` | **1221 pass / 0 fail** |
| 后端 | `cd backend/cli && bun run test` | **3178 pass / 26 skip / 1 fail** |
| 边缘 | `cd axiomics-deploy/docs/manual && AXIOMICS_CADDY_BIN=podman bun test check-web-edge.test.ts` | **49 pass / 0 fail** |
| 品牌资产 | `bun test deploy/authelia/assets.test.ts` | 19 pass |
| typecheck | `bun run typecheck` | 通过 |

后端唯一失败是 `test/tool/webfetch-network.test.ts` 的
“webfetch revocation wins before a streamed download is installed”在 15s 处超时；
单独用 60s 超时运行 847ms 通过。该文件最近一次修改是 2026-10-29，与本期改动无关，
按既有 flake 记录，不掩盖。

### 部署记录（2026-11-13，Web 192.0.2.229）

按“只开放 `:8444` 也能工作”的目标落地。门户改由 Authelia 在 `/auth` 子路径提供，
CTA 指向同源 `/auth`，不再依赖 `:8443`；`:8443` 保留为旧链接入口。

| 变更 | 位置 | 说明 |
|---|---|---|
| 静态壳 | `/home/example-user-650420/axiomics-shell`（68MB） | `dist/` 全量安装，含 `cases.html`、8 个回放 fixture；SELinux 标为 `container_file_t` |
| 边缘配置 | `/home/example-user-650420/ax-gw/conf/Caddyfile` | 换成 `web-edge.Caddyfile`：`/auth` 门户 → Authelia；无 Cookie → 本地静态壳；有 Cookie → `forward_auth` → GPU |
| 网关容器 | `ax-web-gw` | 以 `-v /home/example-user-650420/axiomics-shell:/srv/axiomics-shell:ro,Z` 重建（host 网络，caddy 2.11.8） |
| Authelia | `/home/example-user-650420/authelia/configuration.yml` | `server.address: tcp://127.0.0.1:9091/auth`、`asset_path: /config/assets`、`authelia_url: https://192.0.2.229:8444/auth`、默认回跳 `/axiomics` |
| 品牌资产 | `/home/example-user-650420/authelia/assets/**` | logo/favicon/en+zh-CN `portal.json` |
| 回滚 | `Caddyfile.bak-20261113`、`configuration.yml.bak-20261113` | 恢复文件后用旧挂载重建 `ax-web-gw`、`podman restart ax-authelia` |

部署前用真实容器验证过：`caddy validate` 通过；`authelia validate-config` 通过；
Authelia 4.39.28 在 `server.address` 带 `/auth` 时同时服务 `/` 与 `/auth`，
会话 Cookie 的 `Path=/`（不是 `/auth`），因此 `/api` 也能携带会话。

部署后验证（在 Web 上以 `https://192.0.2.229` 实测）：

| 请求 | 结果 |
|---|---|
| `:8444/`、`/axiomics`、`/axiomics/`、`/cases`、`/cases.html` | 200，`<title>案例 · Axiomics</title>`，静态壳 |
| `:8444/cases/replay/scenic-action.json`、`/site.webmanifest`、`/axiomics-theme-preload.js`、`/assets/*` | 200，对应 content-type |
| `:8444/index.html`、`/api/project`、`/authning` | 302 → `https://192.0.2.229:8444/auth/?rd=…` |
| 伪造 `authelia_session=bogus` 访问 `/api/project` | 302（fail closed） |
| `:8444/auth/` | 200；`/auth/static/media/logo.png` 200 `image/png`；`data-logooverride="true"` |
| `:8443/` | 200；`:8443/axiomics` 302 → `:8444/axiomics` |
| 构建产物中的 CTA | `cases-gallery-*.js` 含 `"/auth"`，无 `8443` |

尚未验证的一项：真实账号登录（无凭据可用），即“登录 → 工作台启动器 → 会话”这条链路
需要用户用现有账号点一次。匿名链路、Cookie 分流、`/auth` 门户与品牌化均已实测通过。

### 登录与回放体验迭代（2026-11-13，部署后）

| 项 | 变更 |
|---|---|
| 登录 | 新增 `cases/login-dialog.tsx` + `cases/login.ts`：同源 `POST /auth/api/firstfactor`，成功后 `location.assign("/axiomics")`；`401` → 凭据错误，`403/429` → 限流，网络失败/被重定向 → 通用错误；Esc 与背景点击关闭；`onAuthenticated` 可注入便于测试 |
| 回放外壳 | 公开回放改为工作台形态：44px 头栏（返回、回放标题、8 案例下拉、登录入口）、`50rem` 居中对话列、进度条占据输入框位置 |
| 画廊 | 删除左下角说明小字；`.cases-page` 隐藏滚动条但保留滚动 |
| Authelia 兜底 | `theme: auto` → `light`：会话过期时门户也是白底，不再跟随系统深色模式 |

验证（本机 Caddy harness + CDP，未依赖生产）：

| 场景 | 结果 |
|---|---|
| 点“新建研究” | 弹层出现，URL 不变，无任何请求 |
| 错误密码 | 弹层显示「用户名或密码错误。」 |
| 正确密码 | 页面导航到 `/axiomics`（执行上下文销毁即证据） |
| 回放页 | 8 个案例下拉、切换后标题与帧数更新（`1 / 550`）、Esc 关闭弹层、无 console error |
| 全量测试 | `bun test src` **1226 pass / 0 fail**；typecheck 通过 |

截图：`axiomics-manual/screenshots/03-login-dialog.jpg`、`02-public-replay.png`。

已知边界：

- 会话过期时 API 请求仍会被 Authelia `302` 到它自己的门户；弹层只覆盖主动登录入口。
- regulation 封禁期间 Authelia 仍返回 `401`，前端无法与“密码错误”区分，统一按凭据错误提示。
- 回放页按决策不放左侧栏，与画廊的左侧导航刻意不同。

## 待确认（已收敛）

1. 最近会话：按会话 `time.updated` 取最近一条；有项目无会话时进入最近项目的新会话。（已决策）
2. 体积：8 个案例全量导出，25MB 原始 / 7.38MB gzip；PBMC 4.07MB gzip 暂不裁剪，按案例懒加载。（已量测）
3. 项目列表迁到 `/projects`、旧书签 `/` 由工作台启动器兜住：接受。（已决策）
