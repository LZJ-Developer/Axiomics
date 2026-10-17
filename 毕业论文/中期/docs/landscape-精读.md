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
5. **过度脚手架（over-scaffolding）** — "Mind the Alignment Gap"（✅ 已一手核对，见 §9 C5）。

   转述说"上下文越丰富，分数从 0.43 掉到 0.36"。**原文其实是三个条件，不是两个：**

   | 条件 | agent 拿到什么 | 综合分 | 95% CI |
   | --- | --- | --- | --- |
   | Basic | 只有任务描述 | **0.43** | [0.38, 0.49] |
   | Package-aware | 方法名 + 包建议，自己装 | **0.42** | [0.37, 0.48] |
   | Full + prior | 预装环境 + 方法先验 | **0.36** | [0.31, 0.42] |

   Basic → Package-aware 差 **−0.008，p = 0.48，不显著**。全部效应来自最重的那个条件。
   所以"上下文越多越差"是压缩后的说法，准确的是"**预装环境 + 方法先验**这一档显著更差"。

   原文的解释比转述锋利，而且用的词正好对应过度工作：

   > "added scientific context can also create **action bias** that lowers aggregate accuracy."
   > "it is much easier to prompt agents to use specialized packages than to use them effectively."

   它给的三个机制性理由：简单自定义几何（如 Procrustes）常常不输现成包；包 API 引入参数与环境方差却不给保证；
   在完成压力下 agent 会接受次优结果而不回退到更简单的方法。
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
| C5 | 过度脚手架有害 0.43→0.36 | p.15 | 转述 Mind the Alignment Gap | ✅ 已核，**需改写**（见下） |
| C6 | SpatialBench 未饱和（~50-60%） | p.24 | 转述 SpatialBench 仓库 | ✅ 已核，**需分全量与 Verified 两说** |
| C7 | LongHorizon 三角色与 AgentAdapter | p.14-15 | 转述 | ✅ 已核，**一处需修正**（见 §12） |
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

---

## 12. 一手核对记录

### C5 · Mind the Alignment Gap ✅ PARTIALLY CONFIRMED

| 项 | 内容 |
| --- | --- |
| 正式标题 | *Mind the alignment gap: a spatial transcriptomics benchmark for scientific coding agents* |
| 作者 | Yiqun Chen, Stephanie C. Hicks（Johns Hopkins，生物统计 / 计算机 / 生物医学工程） |
| 出处 | bioRxiv preprint，doi **10.64898/2026.07.05.736638**，v1，2026-07-09 |
| 评审状态 | **未同行评审**（另有 ICML 2026 workshop poster，非归档评审） |
| 任务 | 40 个多切片空间配准任务（源自 SABench），每任务 3 次重复 × 3 条件 = 360 次运行 |
| 指标 | 0–1 综合分（基因 PCC、余弦、SSIM、互信息、landmark 匹配、IoU、几何诊断），**不是 ARI** |
| 模型 | Codex CLI + `gpt-5.3-codex`，reasoning effort `xhigh`，**单一模型单一 harness** |

**统计结果**

| 对比 | 差值 | 95% CI | p |
| --- | --- | --- | --- |
| FPP − Basic | **−0.067** | [−0.11, −0.028] | **0.0021** |
| FPP − PA | −0.059 | [−0.11, −0.017] | 0.021 |
| PA − Basic | −0.008 | [−0.043, +0.029] | **0.48（不显著）** |

**转述必须修正的三处**

| 转述写的 | 实际 |
| --- | --- |
| "更丰富的上下文把 0.43 拉到 0.36" | 只对 Basic → FPP 成立；中间的 PA = 0.42，与 Basic 无显著差异 |
| "over-committed to package-first" | 原文用 **fragile**（脆弱，易在错误恢复时崩），不是"过度承诺" |
| 未提局限 | 单一模型、单一任务族、单一源论文；作者明说"能否泛化到其他领域仍是开放问题" |

**原文自己承认的两个反向证据（务必知道，否则被问会答不上）**

1. 在 5 个有隐藏金标准坐标的任务上，Basic 的优势**不清楚**，最低平均 MAE 全部来自 PA 或 FPP（FPP 在 5 个中 3 个最好）。
2. 敏感性分析（仅统计有效运行）：FPP − Basic 缩小到 **−0.035**（0.393 vs 0.428），约为原差值的一半 —— 说明相当一部分差距来自失败处理。

**可用于本论文的句子（原文措辞）**

> "added scientific context can also create **action bias** that lowers aggregate accuracy."
> "it is much easier to prompt agents to use specialized packages than to use them effectively."

**引用格式**

> Chen Y, Hicks SC. *Mind the alignment gap: a spatial transcriptomics benchmark for scientific
> coding agents.* bioRxiv 2026. doi:10.64898/2026.07.05.736638

### C7 · LongHorizon-Harness ✅ CONFIRMED

| 项 | 内容 |
| --- | --- |
| 论文 | *LongHorizon-Harness: Advancing Long-Horizon Agents for Real-World Tasks* |
| 出处 | **arXiv:2608.01964**，2026-08-03 提交，v1，29 页，cs.CV，**无期刊/会议接受记录** |
| 作者与单位 | Ziyu Ma, Hailang Huang, Shun Zou, Yong Wang, Shidong Yang, Yiming Hu, Fei Wei, XiangXiang Chu —— **阿里 DreamX Team** |
| 代码 | `AMAP-ML/LongHorizon-Harness`，MIT，1,749 star，**最后推送 2026-08-20（已静默约两月）** |
| 包 | **`lh-harness`（PyPI）**，最新 0.1.7（2026-08-20），共 8 个版本 |
| 安装 | `uv tool install lh-harness`，或 `pip install lh-harness` |

**架构：全部证实**

- **Manager** —— 持有持久任务状态，决定下一个子任务。**没有环境访问权**：看不见应用状态、不能读文件、不能调工具。
  只能看到原始目标、当前状态、审计报告。输出 `execute` / `done` / `blocked` / `ask`。
- **Executor** —— "唯一被允许有意修改环境"的角色；每次调用都是 **"fresh, budget-bounded episode"**，拿不到上一轮轨迹。
- **Auditor** —— 从**全新上下文**启动，对着契约检查真实环境，**只读**。
- **信任不变式** —— "Executor claims do not directly change the persistent state"；状态"只由独立验证过的事实更新"。
  README 里有一句可以直接借用的表述：**"A rejected result remains evidence, not progress."**

**AgentAdapter：已实现，不是画饼**

是真正的 `@runtime_checkable Protocol`，单一方法：

```python
async def run_episode(prompt, env, budget, live_trajectory_path) -> EpisodeResult
```

交回整回合结果而非逐步回调 —— 这正是"保住原生 agent 循环"的实现方式。
`src/lh_harness/adapters/` 下确有 `claude_code.py`、`codex.py`、`opencode.py`、`deepseek_harness.py`，经人工打开确认不是桩。

**⚠️ 一处必须修正转述**

| 转述说 | 实际 |
| --- | --- |
| 支持 Claude Code / Codex / OpenCode / DeepSeek Harness | 这是**仓库当前**的后端集；**论文**里写的是 Claude Code / Codex CLI / **OpenClaw** / **Hermes Agent** |

要引这四个名字，引仓库不引论文。

**它自己有实测数字（不是纯设计）** —— Qwen 3.7-Plus 底座：

| 基准 | 改前 → 改后 |
| --- | --- |
| WeaveBench（114 题） | 51.8% → **80.7%** |
| Terminal-Bench 2.1 | 69.7% → **77.2%** |
| OSWorld 2.0（108 题） | 2.8% → **8.3%**（二元）；21.5% → 35.2%（部分） |
| OSWorld 子集（Claude Opus 4.7，34 题） | 20.0% → **34.3%** |

**引用时必须一并交代的三条**

1. WeaveBench 用了 VM 内 root 权限，与官方普通用户跑法不可比 —— **作者自己标注了这条**。
2. Token 成本上升：WeaveBench **2.3×**，OSWorld 输出 token **3.6×**；Terminal-Bench 反降 24%。
3. OSWorld 绝对值很小（2.8% → 8.3%），相对增益大但远未解决。

**对本论文的意义（最重要的一条）**

它把"独立审计"从概念变成了**可安装、可运行的对照组**。这意味着：

- 你的 Auditor 不能只说"我实现了一个审计者"——那已经不新鲜了
- 你必须说"**它不知道一次空间域检测怎么做才算合格**"——这正是它论文里没有、你的领域里有东西
- 而且它可以当你的 **Baseline D** 直接跑，不用自己重写一个

**引用格式**

> Ma Z, Huang H, Zou S, Wang Y, Yang S, Hu Y, Wei F, Chu X.
> *LongHorizon-Harness: Advancing Long-Horizon Agents for Real-World Tasks.*
> arXiv:2608.01964, 2026.

### C6 · SpatialBench ✅ PARTIALLY CONFIRMED（且比转述更可用）

| 项 | 内容 |
| --- | --- |
| 论文 | *SpatialBench: Can Agents Analyze Real-World Spatial Biology Data?* |
| 出处 | **arXiv:2512.21907**，Kenny Workman, Zhen Yang, Harihara Muralidharan, Hannah Le，2025-12 |
| 仓库 | `latchbio/spatialbench`，Apache-2.0，11 star，创建 2026-06-10 |
| 维护方 | **LatchBio**（生物云公司），榜单在 benchmarks.bio |
| 需区分 | **至少四篇不相干的论文都叫 SpatialBench** —— 只有 LatchBio 这个是 agentic 数据分析基准 |

**题量三个版本，必须说清用哪个**

| 来源 | 题量 |
| --- | --- |
| 仓库 README（当前） | **159** |
| 论文 v1（2025-12） | 146 |
| **SpatialBench Verified**（人工复核后） | **115** |

五个平台（Curio / Vizgen / Xenium / AtlasXOmics / Visium）、七类任务（QC、归一化、降维、聚类、细胞分型、差异表达、空间分析）——**均属实**。

**"50 多分"要分两种说法**

| 口径 | 榜首 | 能否说"未饱和" |
| --- | --- | --- |
| 全量 159 题 | gpt-5.5 + mini-swe-agent **57.65%** | ✅ "中高 50%"准确 |
| **Verified 115 题** | Sonnet 5.5 / Opus 5 **72.5%**，最高报到 78% | ⚠️ 此时"中高 50%"已过时 |

**最重要的一条，转述完全没提**

2026-05 的人工复核：6 位专家尝试全部 159 题，**只有 94 题（59.1%）能做出通过答案**；二轮 28 人又救回 21 题，合计 115。
→ **约 28% 的公开题目连人类都不稳定可解。** 这直接决定了你该用哪个子集。

失败原因：规格歧义、容差标定失准、分析选择未定死（例：一道相关性题，人算 r=0.8514，金标准 0.62，差在归一化选择）。

**机制：无 LLM 裁判** —— 每题是一个 JSON（`task` + `data_node` + 确定性 grader），产物写 `eval_answer.json`，五类 grader 家族：数值容差 / 多选 / 标记基因 P@K·R@K / 标签集 Jaccard / 分布比较。**设计上很强。**

**SpatialOmicsLab 的 58.3% 已核实，但有两个把它撑不住的地方**

- 子集：**16 道 SpatialBench + 4 道 SpatialBench-Long**，每系统 3 次运行（48 与 12 次）。28/48 = 58.33%，13/48 = 27.08%，8/48 = 16.67%。
- 仓库 `example_evals/` 恰好有 **16 个 eval JSON** → 它跑的是**整个公开样本**，不是挑过的切片（此为推断，但很紧）。
- ⚠️ **58.3% 的 Wilson 95% CI 约 44–71%**；而且它只比仓库全量最佳（57.65%）高 **0.65 个百分点**。
- ⚠️ 论文说自己跑了一个 "ported mini-swe-agent"，但**正文没有给它的通过率** —— 省略了最强基线，只跟明显更弱的 DSGym / Biomni 比。

**对单个硕士生的可执行性（这条最关键）**

| 项 | 实际 |
| --- | --- |
| 硬件 | **4 vCPU / 32 GB / 100 GB，无 GPU**，单题 6 小时上限 |
| 协议 | 每题跑 3 次取平均，最高 reasoning effort，无步数上限 |
| 费用 | 每次评测均值 **$0.0164 ~ $3.16**；16 题 × 3 次（48 次）约 **$0.8 ~ $54** |
| 时长 | 单次 231–1739 秒 → 48 次串行约 **3–23 小时**，可并行 |
| **卡点** | 每题数据指向 `latch://` URI，**CLI 没有下载命令**，无 HuggingFace 数据集 |

→ **算力不是问题，数据访问才是。** 要跑，先联系 `kenny@latch.bio` 拿 Latch 平台访问，预算一周。
最稳的低风险做法：**只报 16 道公开题并声明子集** —— 这正是 SpatialOmicsLab 做的，有先例可援引。

**引用格式**

> Workman K, Yang Z, Muralidharan H, Le H.
> *SpatialBench: Can Agents Analyze Real-World Spatial Biology Data?*
> arXiv:2512.21907, 2025.

---

## 13. 三份核对的合并结论

| 核对 | 结论 | 对选题的影响 |
| --- | --- | --- |
| Mind the Alignment Gap | ✅ 数字真，但只对最重脚手架成立 | 给了"过度工作"一个学术名：**action bias** |
| LongHorizon-Harness | ✅ 全属实，一处作者名单需换源 | 审计架构**已有人做**；你只剩"领域内审计"这一格 |
| SpatialBench | ✅ 但三个题量、两个口径 | **评测底座现成、便宜、CPU 可跑**，卡在数据授权 |

一句话：**机制层已被占满，评测层已备好，空着的是"领域判据"。**
