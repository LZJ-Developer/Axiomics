# SpatialOmicsLab 定位分析：必须回答的"你和它什么区别"

> 原文：`docs/SpatialOmicsLab_an_integrated_research_environment.pdf`
> bioRxiv doi:10.64898/2026.10.01.756049 · posted 2026-10-08 · 49 页
> 作者：Yi Jiang, Xiaowei Zhan, Peiran Quan, Ruheng Wang, Fangjiang Wu, Junhui Mi, Jia Yao, Bo Yao,
> Guanghua Xiao\*, Wenqi Shi\*, Yang Xie\*
> 单位：Washington University in St. Louis · UT Southwestern · SMU
> 精读日期：2026-10-17（一手，已逐条核对数字）

---

## 1. 它做了什么

一句话：**给空间转录组造了一个环境（工具 + 数据 + 任务规格 + 执行隔离 + 输出检查），并在其中跑一个 agent。**

三个组件：

| 组件 | 规模 | 作用 |
| --- | --- | --- |
| 工具注册表 | **113** 个（103 分析 + 10 工具） | 空间聚类 34 / 反卷积 23 / 图像与工具 16 / SVG 12 / 多切片对齐 8 / 细胞通讯 8 / 超分 2；经 MCP server–worker 对暴露，隔离 Python/R 环境 |
| 参考数据集 | **63** 套 curated Visium | 12 个人类组织；32 疾病 / 31 健康；支持"无数据提问" |
| 任务规格 | **4,614** 条 | 12 个任务族 × 3 种模态（4004 测序 / 183 成像 / 427 联合） |
| 评测任务 | **103** 条人工标注 | ARI / F1 / Pearson r |

外加 **ST-Coscientist**：把生物问题翻译成分析流程的 agent。

---

## 2. 它的成绩（全部来自原文，已核）

| 对比 | 结果 |
| --- | --- |
| vs 专家工作流（同方法同数据，28 组） | **28/28 ≥ 专家** |
| Visium DLPFC 聚类 | ARI 0.509（stLearn）vs 专家 0.487（BASS） |
| MERFISH 聚类 | ARI 0.398 vs 专家 0.361 |
| SVG 检测 | F1 0.386 vs 专家 0.341 |
| 反卷积（淋巴结/冠脉/主动脉） | r = 0.530 / 0.639 / 0.546 vs 专家 0.509 / 0.538 / 0.454 |
| SpatialBench（GPT-5.4 同底座） | **58.3%** vs DSGym **27.1%** vs Biomni **16.7%** |
| 程序性记忆（21 个 GitHub 工具） | 真数据深验通过 10/21 → **20/21**（47.6% → 95.2%），不重训模型 |

---

## 3. 它的自陈局限（原文 Discussion 末段）

> - Comparisons evaluate **complete agent configurations** and **do not isolate the contribution of individual environment components**
> - Expert comparisons cover only **three task families**
> - External evaluation sampled **public subsets** of SpatialBench / SpatialBench-Long
> - Broader evaluation needed for image-direct workflows, larger cohorts, **prospective use**
> - Reference-data selection bounded by library size/diversity/annotation quality
> - Tools from public repos: code/dependency/interface drift; **licensing and security only partly addressed**
> - Computational validation assesses inputs/execution/outputs; **method suitability and biological interpretation still require expert scrutiny**

**第 1 条就是留给后来者的门。** 它证明了"整套配置有效"，但没证明"有效来自哪个部件"。

### 2.1 它的两条成绩需要打折（外部核对所得）

核对 SpatialBench 原始仓库后，它的 58.3% 有两个削弱因素：

| 问题 | 实际 |
| --- | --- |
| 样本量 | 16 道 SpatialBench + 4 道 SpatialBench-Long，每系统 3 次 → 48 与 12 次运行。**58.3% 的 Wilson 95% CI 约 44–71%** |
| 与仓库榜首比 | 仓库全量 159 题榜首 57.65%（gpt-5.5 + mini-swe-agent）→ 它只高 **0.65 个百分点** |
| 省略的基线 | 论文称自己跑过一个 "ported mini-swe-agent"，**正文没给它的通过率** |

所以准确说法是：**它证明了"在公开子集上，域环境能让弱底座逼近强 harness"，而不是"域环境显著优于一切"**。

**能用**：可以说"它的结果与公开最强 harness 大致持平，而它用的是更弱的对比对象"——这是它自己数据的读法，不是攻击。

---

## 4. 它没有做的（这是本论文的立身之处）

| 它有的 | 它没有的 |
| --- | --- |
| 程序性记忆（工具**怎么装**） | 科研记忆（**科学判断做到哪了**） |
| 输出检查（结构是否合法） | 断言级验证（**这个结论能不能下**） |
| 失败轨迹记录（用于修工具） | **失败作为证据**（哪些解释已被排除） |
| 任务规格（请求→方法映射） | **停止判据**（什么时候不该再做了） |
| 单 agent 自评自验 | 独立审计（规划/执行/验收分离） |
| 干净 benchmark 上的成绩 | 注入故障后的鲁棒性 |

一句话：

> **它让 agent 在空间转录组里"能跑通"，没让它"知道该不该停"。**

---

## 5. 如果被问"和 SpatialOmicsLab 什么区别"，标准答案

禁止使用："我们也有一套环境 / 我们工具更多 / 我们更快"。

建议答法，分三层：

**第一层 · 承认它的位置**
> SpatialOmicsLab 把域环境这件事做到了目前最好——113 个工具、4,614 条规格、28/28 不输专家。
> 我不会重复做这件事，也做不过。

**第二层 · 指出它自己划的边界**
> 它论文里明确写了两条：一是整配置对比，**没有拆解各部件的贡献**；二是计算有效不等于生物学正确。
> 我的工作正好落在这两条之间的那条缝里。

**第三层 · 给出可检验的差异**
> 它的程序性记忆记的是"工具怎么装"，成功率 48%→95%。
> 我关心的是另一件事：**分析做到哪一步算够、哪些解释已经被排除**。
> 这个状态它没有表示，所以它无法度量"过早停止"，也无法阻止 agent 在无关细节上做第九次参数扫描。
> 这是可以被单独测量、单独消融的一件事。

---

## 6. 对本论文的三条直接后果

**（1）不要自建域环境。** 差两个数量级，且时间不允许。用它的思路（TaskSpec），不做它的规模。

**（2）必须用它的尺子，或者用比它更独立的尺子。** SpatialBench / SpatialBench-Long 是公开的、它自己也在用的——
用它做对照，评审无法说你挑数据。这比自己造 4,614 条规格划算一个数量级。

**（3）消融是唯一的活路。** 它承认"没拆解部件贡献"。你把 Manager 和 Auditor 单独拆出来测，
正好补上它公开承认的空缺——这不是绕过它，是接住它。

---

## 7. 引用格式（答辩 PPT / 报告用）

> Jiang Y, Zhan X, Quan P, Wang R, Wu F, Mi J, Yao J, Yao B, Xiao G, Shi W, Xie Y.
> *SpatialOmicsLab: an integrated research environment for AI co-scientists in spatial
> transcriptomics.* bioRxiv 2026. doi:10.64898/2026.10.01.756049

注意：**preprint，未同行评审**（bioRxiv 页面原文："not certified by peer review"）。
引用时如需强调体量，加一句"preprint"是加分的，不是减分。
