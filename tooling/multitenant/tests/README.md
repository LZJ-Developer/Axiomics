# 测试分层

三个层级各自回答一个不同的问题，互不替代。全部用标准库，不需要额外依赖。

| 层级 | 位置 | 回答的问题 | 依赖 |
| --- | --- | --- | --- |
| 单元 | `unit/` | 单个判断是否正确（幂等键、行切分、Range 语义分类、世代读取） | 无 |
| 集成 | `integration/` | 模块之间是否对得上（真实 HTTP Range + 假 DB；CLI + 临时 AX_ROOT） | 无（不连 MySQL、不碰 podman） |
| 验收 | `e2e/` | 这套部署现在到底通不通 | 真实 `AX_ROOT`；没有则跳过 |

```bash
bash tooling/multitenant/tests/run-all.sh
AX_ROOT=/srv/axiomics bash tooling/multitenant/tests/run-all.sh   # 含验收层
```

## 为什么这样切

- **纯判断单独测**：`classify()` 把“服务器返回了什么”翻译成“游标该怎么动”，
  是这套拉取器最容易错、也最容易测的地方；把它做成纯函数就是为了不靠数据库才能断言。
- **HTTP 用真 socket，DB 用假连接**：Range 的行为（206 / 416 / 无视 Range）属于
  HTTP 服务端，假一个会测成自己想当然的样子；而 SQL 的幂等最终由 MySQL 唯一键保证，
  这里只需要验证“发了哪条语句、游标推到哪”。
- **CLI 用临时根 + 桩 `podman`/`ss`**：`axiomics-user` 的设计就是只读，
  所以它能被完整地跑在一次性目录里；桩掉外部命令后，连“容器存在”这种分支也能覆盖。
- **验收层只做只读自检**：`axiomics-verify` 与 `axiomics-user check` 已经是
  线上口径的断言，测试层不再另写一套，避免两套标准漂移。

## 已知边界

- `e2e/` 覆盖不到 Casdoor 身份侧（GPU→Web 不通），与 `axiomics-user check` 的边界一致。
- 拉取器的真实 MySQL 写入只验证到 SQL 语句级；唯一键冲突的行为由集成环境外的
  一次性验证保证（见 `docs/manual/admin-guide.md` §6.1 的迁移记录）。
