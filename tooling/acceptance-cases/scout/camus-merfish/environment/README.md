# CAMUS Figure 4B 环境探针

本目录保留可审阅脚本；数据、模型、安装日志和产物存于：
`/disk1/dabiao/axiomics-projects/_tracer/camus-merfish/environment/`。
脚本以该执行目录为基准。不要在源码仓库内生成训练模型或表达矩阵。

- `prepare.py`：固定384个参考细胞、512个查询细胞；不根据查询标签选样，写入前移除查询标签。
- `isolation.py`：Python路径、SQLite、SSL及独立site-packages检查。
- `dgl-probe.py`：真实GPU图卷积和反向传播。
- `stamapper-probe.py`：3轮GPU训练、权重重载、真实条码及表达值保留、三种图表生成检查。
- `scvi-probe.py`：SCVI与SCANVI各3轮GPU训练、预测/隐变量重载一致性；默认MERFISH数据，亦可传入数据子目录和输出子目录。
- `verify-contingency.py`：真实预测列联表与scikit-learn逐项对照。
- `verify-normalization.py`：稠密/稀疏、行/列、sum/max及零行零列，与scikit-learn对照。

两套独立Python：

- `/disk1/dabiao/axiomics-envs/omics-stamapper-0.0.2/bin/python`
- `/disk1/dabiao/axiomics-envs/omics-scvi-1.3.3/bin/python`

运行时配置 `LD_LIBRARY_PATH=<对应环境>/lib`，STAMapper另设 `DGLBACKEND=pytorch`、`MPLBACKEND=Agg`。
每次完整STAMapper探针使用新的输出目录；上游training会跳过已有目录，不能把跳过误当作成功重跑。
线程设为4足够跑本探针，不需要SLURM或申请远程资源。

完整版本锁位于各环境的 `requirements.lock`。STAMapper基线提交为
`28e06050e18340235dbd46929f8155411c2982a6`，补丁见
`../../../cases/camus-merfish/patches/`，共两个文件三行兼容修复，不改变训练方法。

本探针只验证软件兼容，不能证明准确率或CAMUS排序效果。来源MERFISH表达含非整数值；
正式scANVI训练需核实其变换来源，不擅自取整。独立的RNA整数计数对照已用于排除环境问题。
