"""Editorial redraw from frozen predictions. No fitting, label changes or held-out labels."""
from pathlib import Path
import json
import sys
import numpy as np
import pandas as pd
import anndata as ad
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.font_manager import FontProperties

root=Path(__file__).resolve().parents[1]
out=root/'report/figures'
cover=root/'report/gallery'
out.mkdir(exist_ok=True); cover.mkdir(exist_ok=True)
tab=pd.read_csv(root/'results/query_annotations_percell.csv')
q=ad.read_h5ad(root/'results/query_annotations.h5ad')
assert list(q.obs_names)==tab.barcode.tolist()
assert len(tab)==31340
st=tab.STAMapper.to_numpy(); sv=tab.scANVI.to_numpy(); xy=tab[['x','y']].to_numpy()
ep=st=='Ependymal'; astro=st=='Astrocytes'; disagree=st!=sv
assert ep.sum()==1278 and (ep & (sv=='Astrocytes')).sum()==1195 and disagree.sum()==3870
scores=json.loads((root/'results/camus_scores.json').read_text())['camus_scores']
ink='#193340'; muted='#657985'; teal='#007F79'; orange='#D6803F'; blue='#4477AA'; light='#DCE3E6'
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':9,'axes.labelcolor':ink,'text.color':ink,
 'axes.edgecolor':'#CCD5D9','axes.spines.top':False,'axes.spines.right':False,
 'xtick.color':muted,'ytick.color':muted,'axes.titleweight':'bold','axes.titlesize':11,
 'pdf.fonttype':42,'savefig.facecolor':'white','figure.facecolor':'white'})
cn=FontProperties(fname='/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc')
cnstrong=FontProperties(fname='/usr/share/fonts/google-noto-cjk/NotoSansCJK-Bold.ttc')

def save(fig,name,directory=out):
 if '--gallery-only' in sys.argv and directory != cover:
  plt.close(fig); return
 fig.savefig(directory/f'{name}.png',dpi=240,**({'bbox_inches':'tight','pad_inches':.12} if directory==out else {}))
 if directory==out: fig.savefig(directory/f'{name}.pdf',dpi=300,bbox_inches='tight',pad_inches=.12)
 plt.close(fig)

def spatial(ax,labels=None,mask=None,values=None):
 if labels is not None:
  for c,color in palette.items():
   m=labels==c
   ax.scatter(*xy[m].T,s=1.4,c=color,lw=0,rasterized=True)
 elif values is not None:
  vmax=float(np.percentile(values,99))
  a=ax.scatter(*xy.T,c=values,s=1.6,lw=0,cmap='magma',vmin=0,vmax=vmax,rasterized=True)
  return a,vmax
 else:
  ax.scatter(*xy.T,s=1.3,c=light,lw=0,rasterized=True)
  ax.scatter(*xy[mask].T,s=3,c=teal,lw=0,rasterized=True)
 ax.set_aspect('equal'); ax.invert_yaxis(); ax.axis('off')

def title(ax,letter,text):
 ax.set_title(f'{letter}   {text}',loc='left',pad=10)

def gene(name):
 v=q[:,name].X
 return np.asarray(v.toarray() if hasattr(v,'toarray') else v).ravel()

palette=dict(zip(['Inhibitory','Excitatory','Astrocytes','Ependymal','OD Mature','OD Immature','OD Newly formed','Endothelial','Mural','Microglia','Macrophage','Fibroblast'],
 ['#547BA5','#B2C8DA','#D6A25E',teal,'#887AB2','#B5A9CF','#DAD2E7','#BC657B','#D8A0AE','#729868','#AAC28C','#A79A86']))
# Figure 1: identical colors, coordinates and scale across the two methods.
fig=plt.figure(figsize=(8,7.8));gs=fig.add_gridspec(2,2,height_ratios=[3.3,1],left=.14,right=.94,bottom=.19,top=.93,hspace=.28,wspace=.32)
for j,(labels,name) in enumerate([(st,'STAMapper'),(sv,'scANVI')]):
 ax=fig.add_subplot(gs[0,j]); spatial(ax,labels=labels);title(ax,chr(65+j),name)
ax=fig.add_subplot(gs[1,0]);ax.barh([1,0],[scores['STAMapper'],scores['scANVI']],color=[teal,orange],height=.48)
ax.set_yticks([1,0],['STAMapper','scANVI']); ax.set_xlim(0,1);ax.set_xticks([0,.5,1]);ax.set_xlabel('CAMUS score (not accuracy)');title(ax,'C','Unlabelled method ranking')
for y,v in zip([1,0],scores.values()):ax.text(v+.025,y,f'{v:.3f}',va='center',fontweight='bold')
ax=fig.add_subplot(gs[1,1]);ax.axis('off');title(ax,'D','Same cells, different labels')
ax.text(0,.62,'3,870 / 31,340',fontsize=21,fontweight='bold',color=teal)
ax.text(0,.31,'12.35% disagree',fontsize=13)
ax.text(0,.04,'153 shared genes · original coordinates',fontsize=9,color=muted)
fig.legend(handles=[Line2D([],[],marker='o',color=c,ls='',label=k,markersize=5) for k,c in palette.items()],loc='lower center',ncol=4,frameon=False,fontsize=8,bbox_to_anchor=(.5,.005))
save(fig,'spatial_annotations')
# Figure 2: exactly the SAME candidate population compared in A and B.
fig,axes=plt.subplots(2,2,figsize=(8,9),gridspec_kw={'height_ratios':[1.5,1]})
fig.subplots_adjust(left=.12,right=.95,top=.94,bottom=.16,hspace=.30,wspace=.34)
spatial(axes[0,0],mask=ep);title(axes[0,0],'A','STAMapper: Ependymal')
ax=axes[0,1];ax.scatter(*xy.T,c=light,s=1.3,lw=0,rasterized=True)
for mask,color,name in [(ep&(sv=='Astrocytes'),orange,'Astrocytes: 1,195'),(ep&~np.isin(sv,['Astrocytes','Ependymal']),blue,'Other types: 79'),(ep&(sv=='Ependymal'),teal,'Ependymal: 4')]:
 ax.scatter(*xy[mask].T,c=color,s=3,lw=0,rasterized=True,label=name)
ax.set_aspect('equal');ax.invert_yaxis();ax.axis('off');title(ax,'B','scANVI: same 1,278 cells')
ax.legend(loc='lower center',bbox_to_anchor=(.5,-.1),frameon=False,fontsize=8,markerscale=3)
ax=axes[1,0]; genes=['Cd24a','Mlc1','Aqp4','Aldh1l1'];means=np.array([[gene(g)[ep].mean(),gene(g)[astro].mean()] for g in genes])
colors=LinearSegmentedColormap.from_list('tealwhite',['#F1F6F5',teal])
ax.imshow(means/means.max(axis=1,keepdims=True),cmap=colors,vmin=0,vmax=1,aspect='auto')
for i in range(4):
 for j in range(2):ax.text(j,i,f'{means[i,j]:.2f}',ha='center',va='center',color='white' if means[i,j]/means[i].max()>.6 else ink,fontsize=11)
ax.set_yticks(range(4),genes);ax.set_xticks([0,1],['Ependymal\n1,278 cells','Astrocytes\n3,853 cells'],fontsize=8);ax.tick_params(length=0)
title(ax,'C','Marker-expression contrast')
ax.set_xlabel('STAMapper groups · source-value means\nColor scaled within each gene',fontsize=7,labelpad=10)
ax=axes[1,1];a,vmax=spatial(ax,values=gene('Cd24a'));ax.set_aspect('equal');ax.invert_yaxis();ax.axis('off');title(ax,'D','Cd24a expression')
c=fig.colorbar(a,ax=ax,fraction=.035,pad=.04,extend='max');c.set_label('Source expression',fontsize=8)
fig.text(.5,.025,'Original coordinates retained. Cd24a color saturates at P99.\nAnatomical identity remains to be validated.',ha='center',fontsize=8,color=muted)
save(fig,'ependymal_dispute')
# Figure 3: percentages readable, no implication that either axis is ground truth.
labels=list(palette)
counts=pd.crosstab(pd.Categorical(st,categories=labels),pd.Categorical(sv,categories=labels),dropna=False).to_numpy()
pct=counts/counts.sum(axis=1,keepdims=True)*100
fig,ax=plt.subplots(figsize=(8,7.4));fig.subplots_adjust(left=.23,right=.90,bottom=.25,top=.88)
im=ax.imshow(pct,cmap=colors,vmin=0,vmax=100)
for i in range(len(labels)):
 for j in range(len(labels)):
  if pct[i,j]>=1:ax.text(j,i,f'{pct[i,j]:.0f}',ha='center',va='center',fontsize=8,color='white' if pct[i,j]>60 else ink)
ax.set_yticks(range(len(labels)),[f'{s}  (n={int(n):,})' for s,n in zip(labels,counts.sum(axis=1))],fontsize=8)
ax.set_xticks(range(len(labels)),labels,rotation=55,ha='right',fontsize=8)
ax.set_xlabel('scANVI annotation');ax.set_ylabel('STAMapper annotation')
fig.suptitle('Where the methods disagree',x=.23,ha='left',fontsize=17,fontweight='bold',y=.98)
fig.text(.23,.93,'Each row sums to 100%; values below 1% are not labelled.',fontsize=9,color=muted)
fig.colorbar(im,ax=ax,fraction=.03,pad=.03,label='Row percentage')
save(fig,'confusion_heatmap')
# Dedicated gallery assets, composed for portrait / landscape slots instead of cropped paper panels.
# Display the largest coordinate block, selected by cell count, with an explicit crop label.
# Gaps > 500 source-coordinate units isolate the six visible blocks; this is display-only.
bins=[]
for k in range(2):
 v=np.sort(xy[:,k]); indices=np.where(np.diff(v)>500)[0]
 bins.append(np.searchsorted((v[indices]+v[indices+1])/2,xy[:,k]))
regions=np.column_stack(bins); unique,counts=np.unique(regions,axis=0,return_counts=True)
region=unique[np.argmax(counts)]; roi=(regions==region).all(axis=1)
fig=plt.figure(figsize=(5,5.5));ax=fig.add_axes([.08,.17,.84,.60])
for c,color in palette.items():
 m=roi&(st==c)
 ax.scatter(*xy[m].T,s=5,c=color,lw=0,rasterized=True)
ax.scatter(*xy[roi&ep].T,s=8,c=teal,lw=0,rasterized=True)
ax.set_aspect('equal');ax.invert_yaxis();ax.axis('off')
fig.text(.08,.92,'少见细胞，去了哪里？',fontproperties=cnstrong,fontsize=21)
fig.text(.08,.85,'STAMapper 空间注释 · 室管膜候选群',fontproperties=cn,fontsize=11,color=teal)
fig.text(.08,.11,'绿色条带：室管膜候选细胞',fontproperties=cn,fontsize=11,color=teal)
fig.text(.08,.05,f'最大坐标分区 · {roi.sum():,} 个细胞；完整数据见回放',fontproperties=cn,fontsize=9,color=muted)
(cover/'crop.json').write_text(json.dumps({'rule':'largest coordinate block by cell count; gaps >500 source-coordinate units','region':region.tolist(),'cells':int(roi.sum()),'all_cells':len(tab)},indent=2)+'\n')
save(fig,'camus-cover',cover)
fig,ax=plt.subplots(figsize=(5,3));fig.subplots_adjust(left=.26,right=.90,top=.73,bottom=.16)
fig.text(.08,.88,'CAMUS 无标签排序',fontproperties=cnstrong,fontsize=19)
ax.barh([1,0],[scores['STAMapper'],scores['scANVI']],height=.47,color=[teal,orange]);ax.set_yticks([1,0],['STAMapper','scANVI']);ax.set_xlim(0,1);ax.set_xticks([0,.5,1]);ax.tick_params(axis='y',length=0)
for y,v in zip([1,0],scores.values()):ax.text(v+.02,y,f'{v:.3f}',va='center',fontsize=14,fontweight='bold')
save(fig,'camus-ranking',cover)
fig=plt.figure(figsize=(5,3));fig.text(.08,.82,'同一群细胞，不同的名字',fontproperties=cnstrong,fontsize=18)
fig.text(.08,.40,'93.5%',fontsize=43,fontweight='bold',color=orange)
fig.text(.08,.22,'1,195 / 1,278 个候选室管膜细胞',fontproperties=cn,fontsize=12)
fig.text(.08,.09,'被 scANVI 判为星形胶质细胞',fontproperties=cn,fontsize=12,color=muted)
save(fig,'camus-disagreement',cover)
(out/'editorial-values.json').write_text(json.dumps({'n':len(tab),'ependymal':int(ep.sum()),'astrocyte_assignments':int((ep&(sv=='Astrocytes')).sum()),'disagreements':int(disagree.sum()),'camus':scores,'marker_means':dict(zip(genes,means.tolist()))},indent=2)+'\n')
print('Redrawn from frozen predictions; numerical assertions passed. PNG + PDF + three dedicated gallery assets.')
