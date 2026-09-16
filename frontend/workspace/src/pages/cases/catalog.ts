export type ShowcaseCase = {
  id: string
  segment: string
  sessionID: string
  title: string
  omics: string
  tool: string
  question: string
  data: string
  result: string
  frames: number
  images: readonly [string, string, string]
  imageFit?: "contain"
  series?: string
}

/** Curated, deployment-wide demonstrations. Source sessions and Results stay
 * in their owning projects; the showcase only keeps stable routes and public
 * presentation copy. */
export const cases = [
  {
    id: "zheng-pbmc68k",
    segment: "prj_116b84da22cf42d79948f9961e765d2d",
    sessionID: "ses_f8d3f137bffe9d5TcziutlDsjT",
    title: "健康人血液：有哪些免疫细胞，各占多少？",
    omics: "单细胞转录组",
    tool: "Scanpy",
    question: "血液里有哪些免疫细胞？能否根据它们表达的基因，分清负责免疫协调和杀伤的不同群体？",
    data: "健康供者的外周血单个核细胞（PBMC），来自 10x Genomics 公开数据；质控后分析 59,911 个细胞的基因表达。",
    result: "本样本中，参与免疫协调的 CD4 T 细胞占 48.8%；具有杀伤功能的 NK 和细胞毒性 T 细胞分别占 15.9% 和 11.4%，特征基因支持这些分类。",
    frames: 550,
    images: [
      "/cases/pbmc-umap.png",
      "/cases/pbmc-markers.png",
      "/cases/pbmc-composition.png",
    ],
  },
  {
    id: "maynard-dlpfc",
    segment: "prj_00072ce5fcb74b6386935b11b379eb5f~1y5ma80",
    sessionID: "ses_f863d0d26ffenZzlnP4nsd067G",
    title: "人脑灰质—白质交界：分子变化是渐变还是分界？",
    omics: "空间转录组",
    tool: "Squidpy + SpatialData",
    question: "以神经元胞体为主的灰质与富含神经纤维的白质之间，只是两边细胞混在一起，还是有特别活跃的基因？",
    data: "一位神经正常成人的前额叶脑切片（DLPFC）：用 10x Visium 测量 3,636 个位置的基因表达，并结合组织图像定位。",
    result: "22.7% 的位置形成连续过渡带，CST3、CLU、APOE 等胶质相关基因在交界处更突出；支持局部特殊的分子信号，但还不足以认定一种新的细胞状态。",
    frames: 391,
    images: [
      "/cases/dlpfc-boundary.png",
      "/cases/dlpfc-gradient.png",
      "/cases/dlpfc-heatmap.png",
    ],
  },
  {
    id: "snapatac2-hematopoiesis",
    segment: "prj_ffce85d75204405cb468dc3fdbc2f442",
    sessionID: "ses_f80c20b2bffeWiXqdNWa9b1F4F",
    title: "骨髓与血液：寻找造血前体细胞的基因调控线索",
    omics: "单细胞表观组",
    tool: "SnapATAC2",
    question: "富集造血前体细胞的骨髓样本为何形成独特细胞群？是真实的基因调控差异，还是测得的数据量不同造成的？",
    data: "普通骨髓单个核细胞（BMMC）、CD34+ 富集骨髓和外周血（PBMC）三批公开数据；用 scATAC-seq 检测 10,886 个细胞中哪些 DNA 区域更容易被调控蛋白接触。",
    result: "CD34+ 富集样本的优势群在同批数据内不随测序深度变化；造血相关基因 GATA2 的启动子及邻近 DNA 更开放，提供了造血干/祖细胞调控的候选线索，仍需验证。",
    frames: 502,
    images: [
      "/cases/scatac-evidence.png",
      "/cases/scatac-gata2.png",
      "/cases/scatac-confound.png",
    ],
  },
  {
    id: "open2c-hesc-hff",
    segment: "prj_158e0fad0f0a4526a04aa2ba818eb46f",
    sessionID: "ses_f7fd27e32ffe7YYUtqkqFA7zF6",
    title: "干细胞与成纤维细胞：DNA 的折叠方式有何不同？",
    omics: "三维基因组",
    tool: "cooler + cooltools",
    question: "同样是人类细胞，胚胎干细胞与成纤维细胞中的 DNA 如何折叠？哪些差异在考虑测序深度后仍然存在？",
    data: "Open2C 公开 Micro-C 数据，记录人胚胎干细胞（hESC）和成纤维细胞（HFF）中 DNA 片段的接触；分析第 2、17 号染色体的四档分辨率。",
    result: "在所分析染色体上，相隔 200万–1000万碱基（2–10 Mb）的 DNA 片段在干细胞中接触更少，深度检验后差异仍在；大的活跃/不活跃分区较稳定，提示局部折叠组织存在差异。",
    frames: 422,
    images: [
      "/cases/hic-region.png",
      "/cases/hic-contact.png",
      "/cases/hic-insulation.png",
    ],
  },
  {
    id: "mcmicro-luad",
    segment: "prj_89ac91cfc55b44e1891bc42ed3f07549",
    sessionID: "ses_f80371b05ffeEKogsnwhXkjXYC",
    title: "肺腺癌组织：免疫细胞聚在哪里，离肿瘤有多远？",
    omics: "空间蛋白组",
    tool: "MCMICRO + Squidpy",
    question: "免疫细胞是在肿瘤内部，还是更多聚集在肿瘤之外？能否从组织图像中量化它们与肿瘤细胞的位置关系？",
    data: "MCMICRO 公开肺腺癌切片：3 轮循环荧光成像（CyCIF）、12 个图像通道；对齐图像并识别 15,509 个细胞，结合蛋白标记判断细胞类型和位置。",
    result: "该切片中，免疫细胞占比从肿瘤内及邻近区域的 4.8% 升至远处的 17.8%；不同距离尺度的检验均支持免疫细胞聚集区与肿瘤腺体分开，但不能据此认定免疫细胞被肿瘤排斥。",
    frames: 344,
    images: [
      "/cases/spatial-proteomics-overlay.jpg",
      "/cases/spatial-proteomics-composition.png",
      "/cases/spatial-proteomics-robustness.png",
    ],
  },
  {
    id: "stamo-p22",
    series: "ST 系列",
    segment: "prj_6ecffd7e2b7848e4a3c65c57dd563890",
    sessionID: "ses_f65f4d24dffegXvAXYEbiD4tee",
    title: "小鼠脑空间多组学：两层分子信号如何辨认白质",
    omics: "空间多组学",
    tool: "STAMO",
    question: "基因表达和基因活跃相关标记能否共同辨认脑区？白质的共同信号，会不会只是形成髓鞘的细胞更多？",
    data: "出生后 22 天小鼠的同一张脑切片：9,370 个空间位置，每处 20 μm；同时测量基因表达（RNA）和活跃调控相关标记（H3K27ac）。",
    result:
      "两层信号共同指向富含神经纤维“绝缘层”——髓鞘的白质区域，校正测序深度后仍一致；但尚不能区分这是少突胶质细胞更多，还是细胞内部的调控变化。",
    frames: 512,
    images: ["/cases/stamo-domains.png", "/cases/stamo-white-matter.png", "/cases/stamo-composition.png"],
  },
  {
    id: "camus-merfish",
    series: "ST 系列",
    imageFit: "contain",
    segment: "prj_d3e4e4c028744b129068a94c5ecbdaa3",
    sessionID: "ses_f6488517dffepZvDqQu5Zjfb7j",
    title: "脑细胞该叫什么？用 CAMUS 选择更可靠的注释",
    omics: "空间转录组",
    tool: "STAMapper + CAMUS",
    question: "不同方法给同一个细胞贴上不同名字，哪一种更可信？如何避免把少见细胞都归进常见的大类？",
    data: "小鼠下丘脑 31,340 个 MERFISH 空间细胞，以 30,370 个 RNA 参考细胞、153 个共有基因重新训练 STAMapper 和 scANVI；CAMUS 不使用人工标签进行方法排序。",
    result: "CAMUS 选中 STAMapper；事后与作者注释核对，它识别出 96.9% 的脑室内壁细胞（室管膜细胞），scANVI 为 0.2%；总体注释一致率为 91.2% 对 85.6%。",
    frames: 679,
    images: ["/cases/camus-cover.png", "/cases/camus-ranking.png", "/cases/camus-disagreement.png"],
  },
  {
    id: "scenic-action",
    imageFit: "contain",
    segment: "prj_43d0f54efd544a10b12037ba5ad35891",
    sessionID: "ses_f6432a4ccffeCziewTiLKrccrK",
    title: "肺癌转移：看见调控差异，能推进实验吗？",
    omics: "单细胞转录组",
    tool: "SCENIC / AUCell",
    question: "肺部、脑转移和骨转移中的肿瘤细胞有哪些调控变化？已有分析提出的候选，是否足以支持下一步功能实验？",
    data: "真实合作项目的 SCENIC 下游数据：43 位独立患者、50,000 个恶性细胞、260 个调控程序；肺原发灶采用 GEXSCOPE，脑与骨转移灶采用 10x。",
    result: "独立审查后撤回直接推进功能实验的建议：原发与转移的差异无法与平台效应分离，原器官特异性问题在当前数据下不可回答；脑骨比较仅保留有局限的探索线索。",
    frames: 313,
    images: ["/cases/scenic-design.png", "/cases/scenic-evidence.png", "/cases/scenic-pathology.png"],
  },
] as const satisfies readonly ShowcaseCase[]

export function replay(caseID: ShowcaseCase) {
  return `/${encodeURIComponent(caseID.segment)}/session/${encodeURIComponent(caseID.sessionID)}?replay=1`
}

export function select(query: string, filter: string) {
  const term = query.trim().toLocaleLowerCase()
  return cases.filter((item) => {
    if (filter !== "all" && item.omics !== filter && (!("series" in item) || item.series !== filter)) return false
    if (!term) return true
    return [item.title, item.omics, item.tool, item.question, item.data, item.result, "series" in item ? item.series : ""].some((value) =>
      value.toLocaleLowerCase().includes(term),
    )
  })
}
