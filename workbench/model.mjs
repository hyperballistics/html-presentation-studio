export const WIDTH = 1280, HEIGHT = 720;
export const defaultFormat = 'wide';
export const pageFormats = Object.freeze([
  ['屏幕比例',[
    ['wide','16:9',WIDTH,HEIGHT],['standard','4:3',960,720],['display','16:10',1152,720],
    ['photo','3:2',1080,720],['square','1:1',960,960],['vertical','9:16',720,1280],['cinema','21:9',1470,630],
  ]],
  ['ISO A 系列',[
    ['a0','A0',841,1189],['a1','A1',594,841],['a2','A2',420,594],['a3','A3',297,420],
    ['a4','A4',210,297],['a5','A5',148,210],['a6','A6',105,148],
  ],'mm'],
  ['ISO B 系列',[
    ['b0','B0',1000,1414],['b1','B1',707,1000],['b2','B2',500,707],['b3','B3',353,500],
    ['b4','B4（ISO）',250,353],['b5','B5（ISO）',176,250],['b6','B6',125,176],
  ],'mm'],
  ['JIS B 系列', [['jis-b4','B4（JIS）',257,364],['jis-b5','B5（JIS）',182,257]],'mm'],
  ['北美纸张', [['letter','Letter',8.5,11],['legal','Legal',8.5,14],['tabloid','Tabloid',11,17],['executive','Executive',7.25,10.5]],'in'],
]);
const sizes = new Map();
for(const [,items,paper] of pageFormats)for(const [id,label,w,h] of items){
  for(const landscape of paper?[false,true]:[false]){
    const [width,height]=landscape?[h,w]:[w,h];
    const unit=paper==='mm'?96/25.4:paper==='in'?96:1;
    const format=landscape?`${id}-landscape`:id;
    sizes.set(format,Object.freeze({format,id,label,landscape,paper,w:Math.floor(width*unit),h:Math.floor(height*unit),width,height}));
  }
}
export const pageSize = (format=defaultFormat) => sizes.get(format);

export const THEME = Object.freeze({
  background:'#F2F3F5', paper:'#FFFFFF', text:'#1A1A1A', muted:'#5C6066', title:'#111111',
  heading:'#0B2545', accent:'#065FA9', emphasis:'#AE0D1B', line:'#C9DDEB', component:'#173B59',
  card:'#F2F7FB', band:'#DCEBF8',
});
export const fontAssets = [
  ['Source Sans 3','SourceSans3VF-Upright.ttf.woff2','SourceSans3-OFL.txt','200 900'],
  ['Source Han Sans SC','SourceHanSansSC-VF.ttf.woff2','SourceHanSans-OFL.txt','250 900'],
];
export const fontFace = ([name,_file,_license,weight],url) => `@font-face{font-family:"${name}";src:url("${url}") format("woff2");font-style:normal;font-weight:${weight};font-display:swap}`;
export const FONTS = {
  sans: '"Source Sans 3","Source Han Sans SC","PingFang SC","Microsoft YaHei",sans-serif',
  han: '"Source Han Sans SC","PingFang SC","Microsoft YaHei",sans-serif',
  serif: 'Georgia,"Songti SC",serif',
  mono: 'ui-monospace,"Source Han Sans SC","PingFang SC",monospace',
};
export const defaults = {
  text: '', x: 0, y: 0, w: 300, h: 72, size: 30, font: 'sans', bold: false, italic: false,
  underline: false, align: 'left', line: 1.25, color: THEME.text, fill: 'transparent', radius: 0, inset: 0,
};
const boxFields = Object.keys(defaults);
export const borderDefaults = {borderColor:THEME.accent,borderWidth:0};
export const sides = ['top','right','bottom','left'];
const arrowFields = ['from','to','stroke','strokeWidth'];
export const styleLimits = {radius:360,borderWidth:24,strokeWidth:24};
export const arrowCSS = ({w,h}) => `position:absolute;inset:0;width:${w}px;height:${h}px;pointer-events:none;`;
// Permit only absolute HTTPS source links; reject ambiguous or credential-bearing URLs.
export function isSourceURL(value) {
  if(typeof value!=='string'||value.length>2048||!/^https:\/\/[^/\s?#]+/i.test(value)||/[\s\\\u0000-\u001f\u007f]/u.test(value))return false;
  try {const url=new URL(value);return url.protocol==='https:'&&!!url.hostname&&!url.username&&!url.password&&!value.split(/[/?#]/)[2].includes('@');}catch{return false;}
}
// Only bounded offline raster data, with an explicit MIME and matching file signature.
export const rasterImageCSS='display:block;width:100%;height:100%;object-fit:contain;object-position:right center;pointer-events:none';
function isRasterImage(value) {
  if(typeof value!=='string'||value.length>256_000)return false;
  const m=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if(!m||m[0]!==value||m[2].length%4)return false;
  return m[1]==='png'?m[2].startsWith('iVBORw0KGgo'):m[2].startsWith('/9j/');
}
const propKeys = o => o.type==='arrow'?arrowFields:[...boxFields,...Object.keys(borderDefaults)];
const modelKeys = o => [...propKeys(o),...(o.type==='text'?['href','textColors','textWeights']:o.type==='rect'?['image']:[])];
const idPattern = /^[a-z][a-z0-9-]{0,59}$/;
export const isHexColor = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const plain = v => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, keys) => plain(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const bounded = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const text = (v, max) => typeof v === 'string' && v.length <= max && !v.includes('\0');
const req = (ok, message) => { if (!ok) throw new Error(message); };

function textBoundary(value,index) {
  return bounded(index,0,value.length)&&
    !(value.charCodeAt(index-1)>=0xd800&&value.charCodeAt(index-1)<=0xdbff&&
      value.charCodeAt(index)>=0xdc00&&value.charCodeAt(index)<=0xdfff);
}
const textRangeFields={textColors:'color',textWeights:'bold'};
function textRangeMap(object,key) {
  const values=Array(object.text.length).fill(null);
  for(const range of object[key]??[])values.fill(range[textRangeFields[key]],range.start,range.end);
  return values;
}
function withTextRanges(object,key,values) {
  const ranges=[];
  for(let start=0;start<values.length;){
    const value=values[start];
    let end=start+1;
    while(end<values.length&&values[end]===value)end++;
    if(value!==null)ranges.push({start,end,[textRangeFields[key]]:value});
    start=end;
  }
  if(ranges.length)object[key]=ranges;
  else delete object[key];
  return object;
}
function setTextRange(object,key,start,end,value) {
  if(object.type!=='text'||start>=end||!textBoundary(object.text,start)||!textBoundary(object.text,end))return object;
  return withTextRanges({...object},key,textRangeMap(object,key).fill(value,start,end));
}
export function setTextColor(object,start,end,color=null) {
  return setTextRange(object,'textColors',start,end,color?.toLowerCase()??null);
}
export function textRangeIsBold(object,start,end) {
  return start<end&&textRangeMap(object,'textWeights').slice(start,end).every(bold=>bold??object.bold);
}
export function setTextBold(object,start,end,bold) {
  return setTextRange(object,'textWeights',start,end,bold===object.bold?null:bold);
}
export function replaceObjectText(object,value) {
  const next={...object,text:value};
  if((!object.textColors&&!object.textWeights)||typeof value!=='string'||value===object.text)return next;
  const previous=object.text;
  let start=0, oldEnd=previous.length, newEnd=value.length;
  while(start<oldEnd&&start<newEnd&&previous[start]===value[start])start++;
  while(!textBoundary(previous,start)||!textBoundary(value,start))start--;
  while(oldEnd>start&&newEnd>start&&previous[oldEnd-1]===value[newEnd-1]){oldEnd--;newEnd--;}
  while(!textBoundary(previous,oldEnd)||!textBoundary(value,newEnd)){oldEnd++;newEnd++;}
  for(const key of Object.keys(textRangeFields))if(object[key]){
    const values=textRangeMap(object,key);
    const insideRun=start>0&&oldEnd<values.length&&values.slice(start-1,oldEnd+1).every(value=>value===values[start]);
    withTextRanges(next,key,[...values.slice(0,start),...Array(newEnd-start).fill(insideRun?values[start]:null),...values.slice(oldEnd)]);
  }
  return next;
}
export function textStyleSegments(object) {
  const colors=textRangeMap(object,'textColors'), weights=textRangeMap(object,'textWeights');
  const boundaries=new Set([0,object.text.length]);
  for(const key of Object.keys(textRangeFields))for(const {start,end} of object[key]??[]){boundaries.add(start);boundaries.add(end);}
  const offsets=[...boundaries].sort((a,b)=>a-b);
  return offsets.slice(0,-1).map((start,i)=>({text:object.text.slice(start,offsets[i+1]),color:colors[start],bold:weights[start]}));
}

export const transitions = Object.freeze(['fade','slide','zoom']);
export const revealEffects = Object.freeze(['appear','fade','rise','zoom']);
export const revealStep = step => typeof step==='string'?{ids:[step],effect:'fade'}:step;
const encodeStep = ({ids,effect}) => ids.length===1&&effect==='fade'?ids[0]:{ids,effect};
const withList = (model,key,list) => {if(list.length)model[key]=list;else delete model[key];return model;};

export function selectGroups(model,ids) {
  const result=new Set(ids);
  for(const group of model.groups??[])if(group.some(id=>result.has(id)))for(const id of group)result.add(id);
  return result;
}
export function regroup(model,ids,makeGroup) {
  const groups=(model.groups??[]).filter(group=>!group.some(id=>ids.has(id)));
  if(makeGroup&&ids.size>1)groups.push(model.objects.filter(o=>ids.has(o.id)).map(o=>o.id));
  return withList({...model},'groups',groups);
}
export function setReveal(model,ids,effect) {
  const steps=(model.clickReveal??[]).map(revealStep), result=[];
  let replaced=false;
  for(const step of steps){
    if(effect&&step.ids.length===ids.size&&step.ids.every(id=>ids.has(id))){
      result.push(encodeStep({...step,effect}));replaced=true;continue;
    }
    const remaining=step.ids.filter(id=>!ids.has(id));
    if(remaining.length)result.push(encodeStep({...step,ids:remaining}));
  }
  if(effect&&ids.size&&!replaced)result.push(encodeStep({ids:model.objects.filter(o=>ids.has(o.id)).map(o=>o.id),effect}));
  return withList({...model},'clickReveal',result);
}

export function validate(model, pageId = model?.id) {
  req(exact(model,['id','title','background','notes','objects',...['transition','clickReveal','groups','format'].filter(k=>Object.hasOwn(model??{},k))]) && typeof model.id === 'string' && idPattern.test(model.id) && model.id === pageId, '页面 ID 或字段不匹配。');
  const size=pageSize(model.format);
  req(size&&(!Object.hasOwn(model,'format')||typeof model.format==='string'),'页面尺寸无效。');
  const {w:width,h:height}=size;
  req(text(model.title,100) && isHexColor(model.background) && text(model.notes,4000), '页面属性无效。');
  req(Array.isArray(model.objects) && model.objects.length <= 80, '对象数需在 0–80 之间。');
  const found = new Map();
  for (const o of model.objects) {
    req(plain(o) && typeof o.id==='string' && idPattern.test(o.id) && !found.has(o.id) && ['text','rect','ellipse','arrow'].includes(o.type), '对象字段无效或 ID 重复。');
    found.set(o.id,o);
  }
  req(!Object.hasOwn(model,'transition')||transitions.includes(model.transition),'切换动画无效。');
  function memberList(list,min,seen,label){
    req(Array.isArray(list)&&list.length>=min&&list.length<=found.size,label);
    for(const id of list){req(found.has(id)&&!seen.has(id),label);seen.add(id);}
  }
  if(Object.hasOwn(model,'clickReveal')){
    const cues=model.clickReveal, seen=new Set(), label='点击动画必须引用当前页不重复的对象，并使用支持的效果。';
    req(Array.isArray(cues)&&cues.length>0&&cues.length<=found.size,label);
    for(const cue of cues){
      req(typeof cue==='string'||(exact(cue,['ids','effect'])&&revealEffects.includes(cue.effect)),label);
      memberList(revealStep(cue).ids,1,seen,label);
    }
  }
  if(Object.hasOwn(model,'groups')){
    const groups=model.groups, seen=new Set(), label='组合至少包含两个本页对象，成员不可重复。';
    req(Array.isArray(groups)&&groups.length>0&&groups.length<=found.size/2,label);
    for(const group of groups)memberList(group,2,seen,label);
  }
  for (const o of model.objects) {
    if(o.type==='arrow') {
      req(exact(o,['id','type',...arrowFields,...['lineOnly','dashed'].filter(k=>Object.hasOwn(o,k)&&typeof o[k]==='boolean')]) && isHexColor(o.stroke) && bounded(o.strokeWidth,1,styleLimits.strokeWidth), `${o.id} 的箭头样式无效。`);
      for(const end of [o.from,o.to]) {
        const target=found.get(end?.target);
        req((exact(end,['x','y']) && bounded(end.x,0,width) && bounded(end.y,0,height)) || (exact(end,['target','side']) && sides.includes(end.side) && target && target.type!=='arrow'), `${o.id} 的端点或锚点无效。`);
      }
      continue;
    }
    const keys=Object.keys(o), allowed=['id','type',...modelKeys(o)];
    req(keys.every(k=>allowed.includes(k)) && boxFields.every(k=>Object.hasOwn(o,k)) && text(o.text,2000), `${o.id} 的字段或文字无效。`);
    for(const [key,field] of Object.entries(textRangeFields))if(Object.hasOwn(o,key)){
      let previousEnd=0;
      req(Array.isArray(o[key])&&o[key].length>0&&o[key].length<=o.text.length&&o[key].every(range=>{
        if(!exact(range,['start','end',field])||!textBoundary(o.text,range.start)||!textBoundary(o.text,range.end)||
          range.start<previousEnd||range.start>=range.end||!(field==='color'?isHexColor(range.color):typeof range.bold==='boolean'))return false;
        previousEnd=range.end;
        return true;
      }),`${o.id} 的局部文字${field==='color'?'颜色':'字重'}无效。`);
    }
    req(!Object.hasOwn(o,'href')||o.href===''||(isSourceURL(o.href)&&o.text.trim().length>0), `${o.id} 的来源链接须使用有效 HTTPS 地址和可见文字。`);
    req(!Object.hasOwn(o,'image')||(isRasterImage(o.image)&&o.text.trim().length>0), `${o.id} 的图片须为带替代文本的本地 PNG/JPEG（数据不超过 256000 字符）。`);
    req(bounded(o.w,24,width) && bounded(o.h,24,height) && bounded(o.x,0,width-o.w) && bounded(o.y,0,height-o.h), `${o.id} 超出画布或尺寸无效。`);
    req(bounded(o.size,10,160) && Object.hasOwn(FONTS,o.font) && ['left','center','right'].includes(o.align) && [1.1,1.25,1.4,1.6].includes(o.line), `${o.id} 的排版属性无效。`);
    req(['bold','italic','underline'].every(k => typeof o[k] === 'boolean') && isHexColor(o.color) && (isHexColor(o.fill) || o.fill === 'transparent') && bounded(o.radius,0,styleLimits.radius) && bounded(o.inset,0,80), `${o.id} 的样式属性无效。`);
    req((!Object.hasOwn(o,'borderColor') || isHexColor(o.borderColor)) && (!Object.hasOwn(o,'borderWidth') || bounded(o.borderWidth,0,styleLimits.borderWidth)), `${o.id} 的边框无效。`);
  }
  return model;
}

export function proposalFor(model, proposal, task) {
  req(exact(proposal,['version','request_id','page_id','base_revision','edits']) && proposal.version === 1 && proposal.request_id === task.id && proposal.page_id === task.page_id && proposal.base_revision === task.base_revision, '提案与任务或页面版本不匹配。');
  req(Array.isArray(proposal.edits) && proposal.edits.length === 1, '每个提案只允许修改任务指定的一个对象。');
  const [edit] = proposal.edits;
  req(exact(edit,['edit_id','set']) && edit.edit_id === task.edit_id && plain(edit.set) && Object.keys(edit.set).length, '提案越界或包含未知字段。');
  const next = structuredClone(model), object = next.objects.find(o=>o.id===edit.edit_id);
  req(object && Object.keys(edit.set).every(k=>propKeys(object).includes(k)), '提案越界或包含未知字段。');
  const diff = Object.entries(edit.set).filter(([k,v])=>JSON.stringify(object[k])!==JSON.stringify(v)).map(([k,v])=>[k,object[k],v]);
  req(diff.length, '提案没有产生变更。');
  if(Object.hasOwn(edit.set,'text')&&(object.textColors||object.textWeights)){
    const updated=replaceObjectText(object,edit.set.text);
    for(const key of Object.keys(textRangeFields))if(!Object.hasOwn(updated,key))delete object[key];
    Object.assign(object,updated);
  }
  Object.assign(object,edit.set);
  return {model:validate(next,task.page_id),diff};
}

export const objectStyle = o => ({
  left:`${o.x}px`,top:`${o.y}px`,width:`${o.w}px`,height:`${o.h}px`,fontSize:`${o.size}px`,
  fontFamily:FONTS[o.font],fontWeight:o.bold?'700':'400',fontStyle:o.italic?'italic':'normal',
  textDecoration:o.underline?'underline':'none',textAlign:o.align,lineHeight:String(o.line),
  color:o.color,backgroundColor:o.fill,borderRadius:o.type==='ellipse'?'50%':`${o.radius}px`,padding:`${o.inset}px`,
  ...(o.borderWidth?{boxShadow:`inset 0 0 0 ${o.borderWidth}px ${o.borderColor??borderDefaults.borderColor}`}:{}) ,
});
export function anchorPoint(o,side) {
  return {x:Math.round(o.x+(side==='left'?0:side==='right'?o.w:o.w/2)),y:Math.round(o.y+(side==='top'?0:side==='bottom'?o.h:o.h/2))};
}
export function endpointPoint(end,objects) {
  return end.target?anchorPoint(objects.find(o=>o.id===end.target),end.side):end;
}
export function arrowGeometry(o,objects) {
  const from=endpointPoint(o.from,objects), to=endpointPoint(o.to,objects);
  const dx=to.x-from.x,dy=to.y-from.y,len=Math.hypot(dx,dy);
  const ux=len?dx/len:0,uy=len?dy/len:0,head=o.lineOnly?0:Math.min(len,8+o.strokeWidth*2.5),wing=head*.48;
  const bx=to.x-ux*head,by=to.y-uy*head;
  return {from,to,line:{x1:from.x,y1:from.y,x2:bx,y2:by},points:`${to.x},${to.y} ${bx-uy*wing},${by+ux*wing} ${bx+uy*wing},${by-ux*wing}`};
}
export function withoutObjects(model, ids) {
  const detach=end=>ids.has(end.target)?endpointPoint(end,model.objects):end;
  const next={...model,objects:model.objects.filter(o=>!ids.has(o.id)).map(o=>o.type==='arrow'?{...o,from:detach(o.from),to:detach(o.to)}:o)};
  withList(next,'groups',(model.groups??[]).map(group=>group.filter(id=>!ids.has(id))).filter(group=>group.length>1));
  return setReveal(next,ids,'');
}
export const withoutObject = (model,id) => withoutObjects(model,new Set([id]));
export const sourceLinkCSS = '.source-link{color:inherit;text-decoration:underline;text-underline-offset:.14em}.source-link:focus-visible{outline:2px solid #065FA9;outline-offset:-1px}';
export const objectCSS = 'position:absolute;box-sizing:border-box;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;';
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function renderSlide(model) {
  validate(model);
  const size=pageSize(model.format);
  const blocks = model.objects.map(o=>{
    if(o.type==='arrow') {
      const g=arrowGeometry(o,model.objects);
      const line=Object.entries(g.line).map(([k,v])=>`${k}="${v}"`).join(' ');
      return `  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.w} ${size.h}" data-edit-id="${o.id}" style="${arrowCSS(size)}" role="img" aria-label="箭头"><line ${line} stroke="${o.stroke}" stroke-width="${o.strokeWidth}"${o.dashed?' stroke-dasharray="6 5"':''}/><polygon points="${g.points}" fill="${o.stroke}"/></svg>`;
    }
    const styles = Object.entries(objectStyle(o)).map(([k,v])=>`${k.replace(/[A-Z]/g,l=>'-'+l.toLowerCase())}:${v}`).join(';');
    const content=escape(o.text);
    const styled=o.textColors||o.textWeights?textStyleSegments(o).map(({text,color,bold})=>{
      const style=[color&&`color:${color}`,bold!==null&&`font-weight:${bold?'700':'400'}`].filter(Boolean).join(';');
      return style?`<span style="${style}">${escape(text)}</span>`:escape(text);
    }).join(''):content;
    return `  <div class="object" data-edit-id="${o.id}" style="${escape(styles)}">${o.image?`<img src="${o.image}" alt="${content}" draggable="false" style="${rasterImageCSS}">`:o.href?`<a class="source-link" href="${escape(o.href)}" target="_blank" rel="noopener noreferrer" aria-label="${content}（新标签页打开）" title="新标签页打开">${styled}</a>`:styled}</div>`;
  }).join('\n');
  return `<section class="slide" data-page-id="${model.id}" aria-label="${escape(model.title)}" style="background-color:${model.background}">
${blocks}
</section>`;
}
// Named pages let Chromium preserve each sheet size in mixed-format decks.
export function pdfPageCSS(models) {
  const formats=new Set(models.map(model=>pageSize(model.format).format));
  return `@page{size:${WIDTH}px ${HEIGHT}px;margin:0} .pdf-page{overflow:hidden;break-inside:avoid;break-after:page;print-color-adjust:exact;-webkit-print-color-adjust:exact} .pdf-page:last-child{break-after:auto}`+
    [...formats].map(format=>{
      const {w,h,paper,width,height}=pageSize(format), unit=paper??'px', name=`studio-${format}`;
      const rule=format===defaultFormat?'':`@page ${name}{size:${width}${unit} ${height}${unit};margin:0}`;
      return `${rule}.pdf-page[data-format="${format}"]{${rule?`page:${name};`:''}width:${w}px;height:${h}px}.pdf-page[data-format="${format}"]>.slide{width:${w}px;height:${h}px}`;
    }).join('');
}
export function renderPDFSource(models, embeddedFaces) {
  const pages=models.map(model=>{
    const slide=renderSlide(model);
    return `<div class="pdf-page" data-format="${pageSize(model.format).format}">${slide}</div>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"><style>${embeddedFaces}
html,body{margin:0}.slide{position:relative;overflow:hidden}.object{${objectCSS}}${sourceLinkCSS}${pdfPageCSS(models)}</style></head><body>${pages}</body></html>`;
}
export function renderHTML(model, {embeddedFaces,licenses}={}) {
  // The JSON is the editable block; the semantic HTML below is its deterministic display projection.
  const slide=renderSlide(model), {w,h}=pageSize(model.format);
  const json = JSON.stringify(model,null,2).replace(/</g,'\\u003c');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(model.title)}</title>
<style>${embeddedFaces||fontAssets.map(asset=>fontFace(asset,`../../../workbench/fonts/${asset[1]}`)).join('\n')}
html,body{margin:0;background:${THEME.background}}body{min-height:100vh;display:grid;place-items:center;overflow:auto}.slide{width:${w}px;height:${h}px;position:relative;overflow:hidden}.object{${objectCSS}}${model.objects.some(o=>['href','image','lineOnly','dashed'].some(key=>Object.hasOwn(o,key)))?sourceLinkCSS:''}</style>
</head><body>
<script type="application/json" id="slide-model">\n${json}\n</script>
${slide}${licenses?`\n<template id="font-licenses">${escape(licenses)}</template>`:''}
</body></html>\n`;
}

// A portable viewing document, independent of the per-page source-file contract.
export function renderDeckHTML(models,{title,embeddedFaces,licenses}) {
  const links=models.map((page,i)=>`<a href="#page-${page.id}">${i+1}. ${escape(page.title)}</a>`).join('');
  const pages=models.map(page=>{
    const {w,h,format}=pageSize(page.format);
    return `<div class="sheet pdf-page" id="page-${page.id}" data-format="${format}" tabindex="0" aria-label="${escape(page.title)}" style="--page-width:${w}px;--page-height:${h}px">${renderSlide(page)}</div>`;
  }).join('\n');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">
<title>${escape(title)}</title>
<style>${embeddedFaces}
html{scroll-padding-top:4rem}body{margin:0;background:${THEME.background};color:${THEME.text};font:14px ${FONTS.sans}}
nav{position:sticky;top:0;z-index:1;display:flex;gap:.5rem;overflow-x:auto;padding:.6rem;background:${THEME.paper};border-bottom:1px solid ${THEME.line}}
nav a{flex:none;color:${THEME.accent};border:1px solid ${THEME.line};border-radius:.4rem;padding:.25rem .5rem;text-decoration:none}
nav a:hover{background:${THEME.card}}:focus-visible{outline:2px solid ${THEME.accent};outline-offset:2px}
.sheet{width:min(var(--page-width),calc(100% - 1.5rem));margin:1rem auto;overflow:auto}
.slide{width:var(--page-width);height:var(--page-height);position:relative;overflow:hidden}
.object{${objectCSS}}${sourceLinkCSS}
@media print{nav{display:none}.sheet{margin:0}${pdfPageCSS(models)}}
</style></head><body>
<nav aria-label="页码导航">${links}</nav>
<main>${pages}</main>
<template id="font-licenses">${escape(licenses)}</template>
</body></html>\n`;
}

export function readHTML(html, pageId) {
  const match = html.match(/<script type="application\/json" id="slide-model">\n([\s\S]*?)\n<\/script>/);
  req(match, '实体 HTML 缺少 slide-model。');
  const model = validate(JSON.parse(match[1]),pageId);
  req(html === renderHTML(model), '实体 HTML 不符合生成契约；请用同一渲染器生成，不要单独编辑展示投影。');
  return model;
}
