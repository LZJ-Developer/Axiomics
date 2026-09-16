from pathlib import Path
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.font_manager import FontProperties
root=Path('/disk1/dabiao/axiomics-projects/09-scenic-action')
out=Path('/disk1/dabiao/axiomics-projects/_tracer/scenic-action/gallery');out.mkdir(exist_ok=True)
plt.rcParams.update({'font.family':'Noto Sans CJK JP','font.size':15,'axes.spines.top':False,'axes.spines.right':False,'axes.labelcolor':'#193340','text.color':'#193340','xtick.color':'#193340','ytick.color':'#193340','savefig.facecolor':'#f7f9fa'})
m=pd.read_csv(root/'data/cell_metadata.csv',low_memory=False)
u=m[['patient_uid','site','tech','Pathology']].drop_duplicates()
assert len(u)==43
fig,ax=plt.subplots(figsize=(6,6.6));fig.patch.set_facecolor('#f7f9fa')
fig.text(.08,.92,'看见差异，能做实验吗？',fontsize=23,weight='bold')
fig.text(.08,.86,'43 位患者 · 50,000 个恶性细胞',fontsize=13,color='#687b85')
a=pd.crosstab(u.site,u.tech).reindex(index=['Lung','Brain','Bone'],columns=['GEXSCOPE','10x'],fill_value=0)
ax.set_position([.20,.26,.66,.47]);ax.imshow(a,cmap='Blues',vmin=0,vmax=26,aspect='auto')
for i in range(3):
 for j in range(2):ax.text(j,i,str(a.iloc[i,j]),ha='center',va='center',fontsize=27,color='white' if a.iloc[i,j]>13 else '#193340',weight='bold')
ax.set_xticks([0,1],['GEXSCOPE','10x']);ax.set_yticks([0,1,2],['肺原发','脑转移','骨转移']);ax.tick_params(length=0)
fig.text(.08,.13,'部位与平台重叠',fontsize=20,weight='bold');fig.text(.08,.075,'数字为独立患者数；不是配对样本',fontsize=12)
fig.savefig(out/'scenic-design.png',dpi=200);plt.close(fig)
q=pd.read_csv(root/'results/table_pseudobulk_Brain_vs_Bone.csv').set_index('regulon')
fig,ax=plt.subplots(figsize=(6,3.6));fig.patch.set_facecolor('#f7f9fa');ax.set_position([.19,.24,.72,.46])
names=['MSX2','HOXA1','ELF4'];values=[q.loc[x+'(+)','fdr'] for x in names]
ax.barh(names,values,color='#447b86',height=.5);ax.invert_yaxis();ax.set_xlim(0,1.07)
for i,v in enumerate(values):ax.text(v+.025,i,f'{v:.3f}',va='center',fontsize=13)
ax.axvline(.05,color='#c57847',ls='--');ax.set_xlabel('患者级比较 · BH 校正 q 值',fontsize=12)
fig.text(.08,.88,'候选方向 ≠ 实验依据',fontsize=20,weight='bold');fig.text(.08,.055,'脑 vs 骨，260 项检验；虚线 q = 0.05',fontsize=11)
fig.savefig(out/'scenic-evidence.png',dpi=200);plt.close(fig)
fig,ax=plt.subplots(figsize=(6,3.6));fig.patch.set_facecolor('#f7f9fa');ax.set_position([.12,.24,.78,.42])
b=u[u.site=='Bone'].Pathology.fillna('未知').value_counts().reindex(['LA','SCC','未知'])
ax.barh(['骨转移'],[b['LA']],color='#26867c',label='LA: 3');ax.barh(['骨转移'],[b['SCC']],left=b['LA'],color='#d58a50',label='SCC: 1');ax.barh(['骨转移'],[b['未知']],left=b['LA']+b['SCC'],color='#adb7be',label='未知: 3')
ax.set_xlim(0,7);ax.set_xlabel('患者数',fontsize=12);ax.legend(loc='upper center',bbox_to_anchor=(.5,1.35),ncol=3,frameon=False,fontsize=12)
fig.text(.08,.89,'同一平台，也要核查可比性',fontsize=19,weight='bold');fig.text(.08,.05,'骨组病理标记：3 LA、1 SCC、3 未知',fontsize=11)
fig.savefig(out/'scenic-pathology.png',dpi=200);plt.close(fig)
print(out)
