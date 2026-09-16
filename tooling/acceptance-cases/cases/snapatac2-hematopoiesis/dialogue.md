# 自适应用户干预规程

只有 `prompt.md` 中的首轮问题预先确定。后续提问必须在查看 Agent 刚生成的 QC、嵌入、样本分布、cluster 结构或调控证据后再写，不预先指定簇数、谱系路径、marker、motif 或论文结论。

案例策划者扮演掌握样本来源和实验类型的湿实验人员。每轮只追问当前最影响解释的一项不确定性，例如测序深度是否主导嵌入、某个 cluster 是否由单一样本形成、gene activity 与 peak/motif 证据是否一致。提问使用简短自然语言，并在运行目录的 `interventions.jsonl` 记录所依据的 Result、观察和决策理由。

回放和 Results 冻结前不读取 `evaluation.json`。文献对照只写入会后验收材料，不返回原 Session，也不修改 Agent 已形成的结果。
