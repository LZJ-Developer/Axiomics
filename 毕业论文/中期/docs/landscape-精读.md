# 精读：《AI Agents and Research Environments for Spatial Omics: A 2025–2026 Technical Landscape》

> 原文：`docs/AI Agents and Research Environments for Spatial Omics_ A 2025–2026 Technical Landscape.pdf`（29 页）
> 精读日期：2026-10-17
> 用途：中期答辩材料 + 论文相关工作章节底稿

---

## 0. 身份边界（读之前必须知道）

```
Title:    AI Agents and Research Environments for Spatial Omics: A 2025–2026 Technical Landscape
Author:   ChatGPT Deep Research
Creator:  ChatGPT
Producer: WeasyPrint 68.0
Pages:    29
```

参考文献 URL 全部带 `?utm_source=chatgpt.com`。**这是 ChatGPT 深度搜索的生成物，不是论文。**

由此确定两条引用纪律：

| 纪律 | 含义 |
| --- | --- |
| 只用它的**分类与论证链** | 它没有做实验，任何数字都是转述 |
| 任何数字必须回到一手材料 | 引用它 = 引用二手，答辩时会被"出处呢"一击 |

**自我诚实**：如果这份文档是在本人 prompt 下生成的，它反映的是输入时给定的框架，**不构成独立验证**。中期不得以"一份调研报告说这个方向对"作为论据。

### 已完成的一手核对

对 SpatialOmicsLab 原文（bioRxiv 10.64898/2026.10.01.756049）逐条比对：

| 转述 | 原文 | 结论 |
| --- | --- | --- |
| 113 工具 | "113 computational tools" | ✅ |
| 63 参考数据集 | "63 curated reference datasets" | ✅ |
| 4,614 条任务规格 | "4,614 task specifications" | ✅ |
| 103 标注评测任务 | "103 reference-annotated benchmark tasks" | ✅ |
| SpatialBench 58.3% vs 27.1% vs 16.7% | 完全一致（同为 GPT-5.4） | ✅ |
| 程序性记忆 10/21 → 20/21 | "47.6% to 95.2%" | ✅ |
| 28/28 对比 ≥ 专家 | "all 28 comparisons" | ✅ |

→ 该文档对 SpatialOmicsLab 的转述准确。这是可靠性信号，**只覆盖一篇**。

### 待核（见 §9）

- "Mind the Alignment Gap" 的 0.43 → 0.36
- SpatialBench 的 159 题 / 五个平台 / 七类任务 / 50 多分
- LongHorizon-Harness 的 Manager–Executor–Auditor 与 AgentAdapter

---

## 1. 它要回答的问题

开篇即剥离常识提法：

> The hard problem is no longer "can an LLM write Scanpy/Squidpy code?" The hard problem is
> **how to build a trustworthy computational environment around an imperfect reasoning model.**

这是关键改写。问"模型能不能跑空间转录组工具"，答案是能，且每年更强。
问"能不能把一个不完美的推理模型装进一个可信环境"，答案远没定。

四代演进：

```
LLM writes code
   ↓
LLM + domain tools
   ↓
LLM + typed/schema-constrained tools + validation
   ↓
LLM + persistent scientific state + memory + independent verification
   ↓
[largely missing]  ← 论眼
backend-independent long-horizon scientific harness
```

---

## 2. 概念工具：四个正交层

全篇最有用的一节。四个被混用的词各回答一个问题：

| 术语 | 回答的问题 |
| --- | --- |
| **MCP** | 模型怎么调用这个工具？ |
| **Agent** | 下一步该做什么？ |
| **Harness** | 我怎么连续做对 20 小时、扛住失败与上下文重置，并且知道我确实做完了？ |
| **Scientific environment** | 什么数据、方法、约束、验证器与领域知识，让这些动作在科学上有意义？ |

据此的层位表：

| 层 | 当前最佳 | 仍缺 |
| --- | --- | --- |
| 域工具广度 | SpatialOmicsLab / SpatialAgent | 安装、生命周期、可靠组合 |
| 类型化确定性工具边界 | ChatSpatial | 缺长程状态 |
| 交互式空间工作区 | STAT / spatiAlytica | 自主持久执行有限 |
| 持久科研记忆 | SpatialClaw | 独立验证、多后端 harness |
| 工具自扩展记忆 | SpatialOmicsLab | 安全/版本、泛化 |
| 长程循环 | LongHorizon-Harness | 不懂空间/科学域 |
| **全组合** | **No system found** | 研究 + 产品缺口 |

**答辩可用**：把"我们做了一个 agent"拆成四层追问，能把评审从"比架构图"拉到"缺哪一层"。

---

## 3. 六层收敛与共同运行时

```
Researcher
   ↓
Agent / planner
   ↓
域上下文（skills / task specs · 数据元信息 · 生物学知识）
工具选择层（typed MCP · Python/R/shell · skill workflow）
   ↓
执行运行时（隔离环境 · 空间方法 · 产物/日志/图）
   ↓
验证 / 检查
   ↓
会话 / 程序性 / 科研记忆
   ↓
Report + provenance
```

### 全文最重的一句

> What is missing from most implementations is that **the same agent frequently performs planning,
> execution and acceptance.** This creates a **self-certification problem**. A model that made a bad
> decision is then asked whether that decision was good.

**自证问题**：裁判与运动员是同一个人。

三角色解法的形式（借自 LongHorizon-Harness）：

```
Agent:    "我做了 X → 我以为 X 成了 → 我记得 X 成了 → 继续"

Executor: "我尝试了 X。"
Auditor:  "环境显示产物是 A、B、C；判据 Y1 Y2 通过，Y3 未通过。"
Manager:  "现在只有 A、B 是可信的。下一个任务是修 Y3。"
```

---

## 4. 七个机制：各自真正买到了什么

| 机制 | 代表系统 | 真正买到的东西 |
| --- | --- | --- |
| Task specifications（4,614 条） | SpatialOmicsLab | 把隐性专家知识变成**可执行的域模型**，不是大 prompt 库 |
| Schema enforcement | ChatSpatial | **把确定性知识放进确定性软件**，而非交给概率模型临场发挥 |
| Procedural memory | SpatialOmicsLab | 不改权重，工具集成成功率 10/21 → 20/21 |
| Persistent research memory | SpatialClaw | 结构化版本化图；**并非每个观察都值得永久记住** |
| Viewer grounding | STAT / spatiAlytica | 空间分析无法完全降维为文本表格；当前视图本身是 agent 状态 |
| Method ensemble + 专家批判 | EnsAgent | 先聚合多种计算结构，再做语义解释 |
| 长程外部状态 | LongHorizon-Harness | **执行器输出 ≠ 可信科学状态** |

TaskSpec 的形态（可直接借鉴）：

```text
TaskSpec {
    biological_intent
    required_modalities
    required_fields
    admissible_methods
    method_constraints
    expected_artifacts
    validators
}
```

> "That structure could become **the scientific equivalent of a test specification**."

**这是全篇最有价值的一个类比**：coding agent 能规模化的根因是有测试当判据；科学任务能否造出"测试"，TaskSpec 是候选答案。

---

## 5. 六条局限

1. **评测错配** — ARI/F1/通过率有价值，但"科学上有趣的结论"是**多条不确定证据流共同支持的断言**。SpatialOmicsLab 自陈：计算有效 ≠ 生物学正确。
2. **短程评测伪装成自主** — 多步工作流可能仍在单一增长 context 里跑完，与撑过数十小时、进程重启、HPC 失败、人工打断是两件事。
3. **依赖与部署复杂度** — 真实科学软件栈比 LLM 客户端难打包得多。
4. **工具封装维护** — 上游库持续变化。
5. **过度脚手架（over-scaffolding）** — "Mind the Alignment Gap"：更丰富的环境上下文让 agent 探索更多工具，却得到更差的空间对齐分数（**待核**：0.43 → 0.36）。作者解读克制：不是环境工程错了，是 affordance 设计本身是个优化问题。
6. **缺前瞻性用户证据** — 几乎没有数据表明普通实验生物学家长周使用、纠正并回访。

---

## 6. 提议的架构：MCP 退到边缘

反对两种形态：

```
Claude Code → 几百个 MCP 工具
自定义 Spatial Agent → 自定义 UI → 自定义工具
```

提议形态：

```
        长程科学 harness
               │
   AgentAdapter（Claude Code / Codex / OpenCode / DeepSeek）
               │
      科学任务运行时
         ├ Task Specs
         ├ 科学状态
         └ Memory
               │
      领域工具 ABI（ToolSpec）
               │
      Python / CLI / MCP 适配器
               │
   容器 / Conda / HPC → 空间组学软件
```

核心主张：

> **MCP becomes one adapter at the edge, not the internal architecture.**

理由：MCP 解决的是**工具传输**，不解决任务持久化、科学验证、provenance 与长程协调。把科学本体论绑在某一个工具协议上，会损失后端可替换性。

### 状态模型

```text
ResearchState
├── Goal
├── Constraints
├── DataManifest
├── Questions
├── Hypotheses
├── PlannedAnalyses
├── RunningAnalyses
├── AcceptedAnalyses
├── RejectedAnalyses      ← 探索账本的位置
├── Evidence
├── Claims
├── Uncertainties
├── OpenProblems
└── NextAction
```

不变式：

```
Executor output
     ↓ Auditor 检查
accepted evidence
     ↓
trusted state
```

---

## 7. 优先级与"最高价值论文"

| 优先级 | 缺口 | 难度 | 影响 |
| --- | --- | --- | --- |
| P0 | 科学状态模型 + **独立科学审计者** | 5/5 | 5/5 |
| P0 | **后端无关**的长程空间 harness | 3/5 | 5/5 |
| P0 | 一键可复现科学运行时（懒加载不可变环境） | 4/5 | 5/5 |
| P0 | 规范化 Tool ABI，MCP 仅作适配器 | 3/5 | 5/5 |
| P1 | 长程原始数据到科学断言的 benchmark | 4/5 | 5/5 |
| P1 | 证据/断言 provenance 图 | 4/5 | 5/5 |
| P1 | 双记忆架构（程序性 + 科研） | 4/5 | 4/4 |
| P1 | Viewer-grounded auditor | 4/5 | 4/5 |
| P1 | 安全自主的工具获取/更新 | 5/5 | 4/5 |
| P2 | 人类科学家的纵向使用研究 | 3/5 | 4/5 |

它给自己的研究问题定位：

> 不该是 "Can another LLM agent run spatial transcriptomics tools?"（已拥挤）
> 而应是 **"Can externalized, independently verified scientific state transform general-purpose
> coding agents into reliable long-horizon spatial-omics researchers?"**

七臂消融设计：

```
A  裸 Claude Code / Codex
B  + 领域 skills
C  + task specifications
D  + long-horizon manager
E  + 独立科学审计者
F  + procedural memory
G  + scientific memory
```

指标不是 ARI/F1，而是：任务完成、结果质量、**无效输出率**、注入故障后的恢复、跨上下文连续性、
**虚假断言率**、证据完整性、可复现性、人工干预次数、token/美元/GPU 成本、墙钟时间。

十个注入扰动：GPU 作业失败、H5AD 损坏、坐标字段错误、包升级、缺参考数据、方法与模态不兼容、
上下文重置、进程重启、中途人工纠正、矛盾生物学证据。

> "A normal agent may look excellent on clean benchmark tasks but collapse under these perturbations."

---

## 8. 结论与适用条件

**直接支持的**
- 空间组学 agent 存在四个可拆分的层，混用会导致错误归因
- 当前没有系统实现"域环境 + 持久状态 + 独立审计 + 后端无关"的完整组合
- 独立审计是自证问题的机制性解法，且在空间组学中尚未落地

**支撑不了的**
- 任何"某架构更优"的性能断言（本文件无实验）
- 0.43→0.36、159 题/50 多分等转述数字（须回一手）
- LongHorizon-Harness 的机制细节（未一手核对）

**它自己没写的局限**
- 检索范围只收"同时有论文和公开代码"的系统 → 系统性忽略工业界未公开系统，以及已跑通未发表的工作
- 通篇无方法学章节：没有说明检索策略、筛选标准、纳排规则 → 其"没有系统实现全组合"是一个**检索范围内的否定**，不是全域否定

---

## 9. Claim–Evidence 表

| # | 主张 | 证据位置 | 支持范围 | 核对状态 |
| --- | --- | --- | --- | --- |
| C1 | 四代演进、第五格缺失 | p.1 摘要 | 6 个系统的归纳 | 概念性 |
| C2 | Agent/Harness/MCP 正交 | p.3 | 三类代表系统 | 概念性 |
| C3 | SpatialOmicsLab 体量与成绩 | p.1, p.4 | 一手论文 | ✅ 已核，一致 |
| C4 | 自证问题普遍存在 | p.14 | 6 系统共性归纳 | 未量化 |
| C5 | 过度脚手架有害 0.43→0.36 | p.15 | 转述 Mind the Alignment Gap | ⏳ 待核 |
| C6 | SpatialBench 未饱和（~50-60%） | p.24 | 转述 SpatialBench 仓库 | ⏳ 待核 |
| C7 | LongHorizon 三角色与 AgentAdapter | p.14-15 | 转述 | ⏳ 待核 |
| C8 | 全组合无系统 | p.2 | 检索范围否定 | 受检索范围限制 |
| C9 | 七臂消融方案 | p.24-25 | 设计提案 | 未执行 |

---

## 10. 对本论文意味着什么

### 10.1 它证明问题对齐，不证明方案正确

把它的 `ResearchState` 与既有机制对齐：

| 它的提议 | 已有对应 |
| --- | --- |
| `AcceptedAnalyses` + `RejectedAnalyses` + `OpenProblems` | 探索账本（待建） |
| "执行器输出 ≠ 可信状态" | 五层验证器 |
| "计算有效 ≠ 生物学正确" | 完成 ≠ 正确 |
| "短程评测伪装成自主" | 过早停止 |
| "over-scaffolding 有害" | 过度工作 |
| TaskSpec 作为科学的测试规格 | checks / trials 机制 |

**它的 P0 第一条，字面上就是本论文在解决的问题。**

### 10.2 但它标出了真正的缺口

不缺想法，不缺机制。缺两样只能靠时间换的东西：

- **域环境** — 它说的 113 工具 / 63 数据集 / 4,614 规格；现有 11 套锁定环境，差两个数量级
- **独立评测** — SpatialBench 这类第三方尺子；目前没有

### 10.3 七臂做不完，三臂够

```text
Baseline:  裸 agent + 领域 skills
臂 1:      + Manager（长程状态）
臂 2:      + Auditor（独立审计）
```

注入十个故障中的三到四个，指标锁定"过早停止率 / 虚假断言率 / 故障恢复"。

---

## 11. 答辩与写作的使用规则

- 引用层位表、四术语、自证问题 → 可以作为**观点**引用，注明出自技术调研而非论文
- 引用任何数字 → **必须回一手**，不得以本文件为出处
- 不得在 PPT 上写 "a survey found" 而不给一手作者与年份
- 该文件可作为"相关工作"章节的**索引**，不能作为**证据**
