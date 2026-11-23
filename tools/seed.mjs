import {writeFile} from 'node:fs/promises';
import {defaults as d, renderHTML, THEME as t} from '../workbench/model.mjs';
const text=(id,text,x,y,w,h,style={})=>({...d,id,type:'text',text,x,y,w,h,...style});
const rect=(id,x,y,w,h,fill)=>({...d,id,type:'rect',x,y,w,h,fill,radius:24});
const model={id:'p01-ai-pilot',title:'从一个场景开始',background:t.paper,notes:'开场提问：如果只选一个业务环节尝试 AI，你会选哪一个？\n请学员写下业务痛点、可获得的数据，以及一项可追踪的指标。',objects:[
  {...rect('section-marker',70,48,24,27,t.emphasis),radius:2},
  text('chapter-mark','FIELD GUIDE  /  01',109,48,440,40,{size:23,color:t.accent,bold:true}),
  text('workshop-label','企业 AI 落地工作坊',70,141,490,46,{size:28,color:t.accent,bold:true}),
  text('hero-title','从一个场景\n开始。',66,203,640,224,{size:86,bold:true,line:1.1,color:t.title}),
  text('hero-caption','先用一个可衡量的小试点，\n回答 AI 能否改善真实业务。',72,465,620,116,{size:33,color:t.muted,line:1.4}),
  rect('step-a-card',755,112,457,140,t.card),
  rect('step-b-card',755,272,457,140,t.card),
  rect('step-c-card',755,432,457,140,t.band),
  text('step-a-no','01',784,144,62,48,{size:27,color:t.accent,bold:true}),
  text('step-a','选场景',858,140,313,58,{size:39,bold:true,color:t.heading}),
  text('step-a-note','聚焦高频、可观察的痛点',858,201,322,38,{size:22,color:t.muted}),
  text('step-b-no','02',784,304,62,48,{size:27,color:t.accent,bold:true}),
  text('step-b','跑试点',858,300,313,58,{size:39,bold:true,color:t.heading}),
  text('step-b-note','限定范围，保留人工复核',858,361,322,38,{size:22,color:t.muted}),
  text('step-c-no','03',784,464,62,48,{size:27,color:t.accent,bold:true}),
  text('step-c','看指标',858,460,313,58,{size:39,bold:true,color:t.heading}),
  text('step-c-note','用改进数据判断是否扩展',858,521,322,38,{size:22,color:t.muted}),
  text('footer-mark','AI ENABLEMENT  /  WORKSHOP',72,645,690,36,{size:21,color:t.muted}),
  text('page-number','01',1118,645,92,36,{size:21,color:t.muted,align:'right'}),
]};
await writeFile(new URL('../sections/01-intro/pages/p01-ai-pilot.html',import.meta.url),renderHTML(model),{flag:'wx'});
