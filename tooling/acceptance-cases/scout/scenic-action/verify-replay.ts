import { createAxiomicsClient } from '/disk1/dabiao/project/axiomics/tooling/sdk/js/src/v2/client'
import { timeline, snapshot } from '/disk1/dabiao/project/axiomics/frontend/workspace/src/pages/cases/timeline'
import { strict as assert } from 'node:assert'
const client = createAxiomicsClient({baseUrl:'http://127.0.0.1:4096',directory:'/disk1/dabiao/axiomics-projects/09-scenic-action'})
const id='ses_f6432a4ccffeCziewTiLKrccrK'
const [session,messages,status]=await Promise.all([client.session.get({sessionID:id}),client.session.messages({sessionID:id}),client.session.status()])
assert(session.data&&messages.data)
assert(!status.data?.[id]||status.data[id].type==='idle','Session still running')
const frames=timeline(messages.data,session.data.revert?.messageID)
const before=JSON.stringify(messages.data)
const end=snapshot(session.data,messages.data,frames,frames.length)
const start=snapshot(session.data,messages.data,frames,1)
const users=messages.data.filter(m=>m.info.role==='user')
assert.equal(start.message[id].length,1)
assert.equal(start.message[id][0].id,users[0].info.id)
const finals=messages.data.filter(m=>m.info.role==='assistant'&&m.info.finish==='stop'&&m.parts.some(p=>p.type==='text'&&p.text.trim()))
assert(finals.some(m=>m.info.parentID===users.at(-1)?.info.id),'Last request missing final answer')
for(const answer of finals)assert(end.message[id].some(m=>m.id===answer.info.id))
const assets=messages.data.flatMap(m=>m.parts).filter(p=>p.type==='tool'&&p.tool==='artifact'&&p.state.status==='completed').map(p=>p.state.metadata?.savedArtifact).filter(Boolean)
for(const extension of ['.pdf','.tex','.bib','.csv'])assert(assets.some(a=>a.path.endsWith(extension)),`Missing ${extension} Results`)
const latest=assets.findLast(a=>a.path.endsWith('.pdf'))
assert(latest.path.endsWith('/report/regulon_site_report.pdf'),'Replay would open a figure PDF instead of the complete report')
assert.equal(await Bun.file(latest.path).size,latest.size)
const nested=Object.values(end.part).flat().find(p=>p.type==='tool')
if(nested?.type==='tool')nested.state.input.__replay_probe=true
snapshot(session.data,messages.data,frames,Math.floor(frames.length/2))
assert.equal(JSON.stringify(messages.data),before,'Snapshot mutated recording')
const result={status:'passed',projectID:session.data.projectID,frames:frames.length,messages:messages.data.length,users:users.length,finalAnswers:finals.length,results:assets.length,pdf:latest,checks:['first frame hides future turns','all recorded final answers preserved','last turn has final answer','seek snapshots isolate nested tool inputs','PDF/tex/bib/CSV saved in Results','latest PDF size matches saved version'],note:'Earlier interrupted/steered turns preserved exactly; no invented final answers.'}
await Bun.write('/disk1/dabiao/axiomics-projects/_tracer/scenic-action/replay-validation.json',JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2))
