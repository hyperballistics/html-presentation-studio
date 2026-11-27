import {defaultFormat,pageFormats,pageSize,defaults,objectStyle,objectCSS,THEME,fontAssets,fontFace,validate,renderHTML,renderDeckHTML,borderDefaults,styleLimits,sides,arrowCSS,anchorPoint,endpointPoint,arrowGeometry,withoutObjects,pdfPageCSS,selectGroups,regroup,setReveal,revealStep,isHexColor,isSourceURL,rasterImageCSS,textStyleSegments,setTextColor,textRangeIsBold,setTextBold,replaceObjectText} from './model.mjs';
import {selectionBounds,rectBetween,boxHits,transformSelection,fitToPage,alignmentUnits,alignSelection} from './selection.mjs';
const $=id=>document.getElementById(id), all=q=>[...document.querySelectorAll(q)];
const make=(tag,classes='',text='')=>Object.assign(document.createElement(tag),{className:classes,textContent:text});
const symbols={text:'T',rect:'□',ellipse:'○',arrow:'↗'};
const props=all('[data-prop]'), toggles=all('[data-toggle]');
const formatKeys=['font','size','bold','italic','underline','align','line','color','inset'];
const clamp=(v,min,max)=>Math.min(max,Math.max(min,Math.round(v)));
const copy=x=>structuredClone(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const endpoint=id=>`/api/pages/${id}`;
let catalog, source, model, storageKey, baseKey, cached, draftBase, draftBaseTime, storageOK=true, forked=false, stale=false;
let history=[], future=[], group='', time=0, brush, pointer, inline, editorScale=1, busy=false, reviewAction, sampling;
let selection=new Set(), fixedZoom=null, objectClipboardEntry, clipboardFeedbackTimer;
let previewSource=false, diskRevisionKnown=true;
const visiblePage=()=>previewSource?source.model:model;
const canvasSize=()=>pageSize(visiblePage()?.format);
const selectedItems=()=>model.objects.filter(o=>selection.has(o.id));
const active=()=>selection.size===1?model?.objects.find(o=>selection.has(o.id)):undefined;
const multiKey=()=>[...selection].sort().join(',');
const selectedGroups=()=> (model.groups??[]).filter(g=>g.some(id=>selection.has(id)));
const sameGroup=()=>selectedGroups().some(g=>g.length===selection.size);
const modifier=e=>e.shiftKey||e.metaKey||e.ctrlKey;
const dirty=()=>!same(source?.model,model);
const announce=text=>{$('announcement').textContent=text;};
const status=(text,warn=false)=>{const el=$('save-status'); if(el.textContent!==text) el.textContent=text; el.classList.toggle('warn',warn);};
const on=(id,event,func)=>$(id).addEventListener(event,func);
const action=(id,func)=>on(id,'click',func);
const toolDisabled=(id,value)=>$(id).setAttribute('aria-disabled',String(Boolean(value)));
const editToolbar=$('edit-tools');
const editButtons=[...editToolbar.querySelectorAll('button')];
if(!('focusGroup' in HTMLElement.prototype)){
  const tabStop=target=>{for(const button of editButtons)button.tabIndex=button===target?0:-1;};
  tabStop(editButtons[0]);
  editToolbar.addEventListener('focusin',e=>{if(editButtons.includes(e.target))tabStop(e.target);});
  editToolbar.addEventListener('keydown',e=>{
    if(!editButtons.includes(e.target)||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;
    const index=editButtons.indexOf(e.target), last=editButtons.length-1;
    const direction=getComputedStyle(editToolbar).direction==='rtl'?-1:1;
    const step=e.key==='ArrowRight'?direction:e.key==='ArrowLeft'?-direction:0;
    const next=e.key==='Home'?0:e.key==='End'?last:step?(index+step+editButtons.length)%editButtons.length:null;
    if(next!==null){e.preventDefault();editButtons[next].focus();}
  });
}
editToolbar.addEventListener('click',e=>{
  const button=e.target.closest('button');
  if(button&&(busy||button.getAttribute('aria-disabled')==='true')){e.preventDefault();e.stopPropagation();}
},true);
async function api(url, options={}) {
  const res=await fetch(url,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  const data=await res.json();
  if(!res.ok) throw Object.assign(new Error(data.error),{status:res.status});
  return data;
}
function banner(message) {
  const el=$('banner'); el.hidden=!message; el.textContent=message||'';
}
const versionTime=new Intl.DateTimeFormat('zh-CN',{
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset',
});
function renderConflict() {
  $('conflict-banner').hidden=!stale;
  if(!stale)return;
  const page=source.model;
  $('conflict-workspace').textContent=catalog.title;
  $('conflict-workspace').title=source.absolute_file??source.file;
  $('conflict-page').textContent=`${page.title}（${page.id}）`;
  $('conflict-view').textContent=previewSource?'正在查看最新源文件（只读）':'正在查看旧草稿';
  for(const [id,revision,timestamp] of [
    ['conflict-base',draftBase,draftBaseTime],
    ['conflict-disk',diskRevisionKnown?source.revision:null,diskRevisionKnown?source.modified_at:null],
  ]){
    const el=$(id);
    el.textContent=typeof revision==='string'?revision.replace(/^sha256:/,'').slice(0,12):'未能读取';
    el.title=typeof revision==='string'?revision:'';
    const time=$(`${id}-time`), known=typeof timestamp==='string'&&Number.isFinite(Date.parse(timestamp));
    time.textContent=known?versionTime.format(new Date(timestamp)):'时间未知';
    if(known){time.dateTime=timestamp;time.title=timestamp;}
    else{time.removeAttribute('datetime');time.removeAttribute('title');}
  }
  $('view-conflict-draft').disabled=!previewSource;
}
action('open-conflict',()=>{
  if(busy)return;
  $('conflict-status').textContent='';
  $('conflict-dialog').showModal();
});
function contextStatus(text,warn=false) {
  const el=$('context-status');el.classList.toggle('warn',warn);el.textContent=text;
}
function adjacentPage(offset) {
  const index=pageList.findIndex(p=>p.id===model?.id);
  return index<0?undefined:pageList[index+offset];
}
function refreshStatus() {
  if (stale) status('版本冲突 · 草稿保留',true);
  else if (!storageOK && dirty()) status('草稿未持久化',true);
  else if (dirty()) status(forked?'备用草稿已保存':'草稿已自动保存');
  else status('与源文件一致');
  toolDisabled('save',!model||!dirty()||stale||busy);
  toolDisabled('sync-context',!model||busy);
  $('edit-prev-page').disabled=busy||!adjacentPage(-1);
  $('edit-next-page').disabled=busy||!adjacentPage(1);
  $('confirm-discard').disabled=busy;$('cancel-discard').disabled=busy;
}
function persist() {
  try {
    const stored=localStorage.getItem(storageKey);
    if(stored!==cached && dirty()) {
      // Preserve both tabs' drafts rather than silently replacing another tab's work.
      storageKey=baseKey+':'+crypto.randomUUID(); forked=true; cached=null;
      sessionStorage.setItem(baseKey,storageKey);
      announce('另一个标签页已保存草稿，本标签页另存为备用草稿。');
    }
    if(dirty()) {
      cached=JSON.stringify({base:draftBase,base_modified_at:draftBaseTime,model}); localStorage.setItem(storageKey,cached);
    } else if(stored===cached) {localStorage.removeItem(storageKey);cached=null;}
    storageOK=true;
  } catch {storageOK=false;}
  refreshStatus();
}
const svg = (tag,attrs={}) => {
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);
  return el;
};
function paintArrow(el,o,objects) {
  const g=arrowGeometry(o,objects), line=el.querySelector('.arrow-shaft');
  for(const [key,value] of Object.entries(g.line))line.setAttribute(key,value);
  if(o.dashed)line.setAttribute('stroke-dasharray','6 5');
  else line.removeAttribute('stroke-dasharray');
  line.setAttribute('stroke',o.stroke);line.setAttribute('stroke-width',o.strokeWidth);
  const polygon=el.querySelector('polygon');polygon.setAttribute('points',g.points);polygon.setAttribute('fill',o.stroke);
  const hit=el.querySelector('.arrow-hit');
  if(hit)for(const [key,value] of Object.entries({x1:g.from.x,y1:g.from.y,x2:g.to.x,y2:g.to.y,'stroke-width':Math.max(o.strokeWidth,Math.min(68,16/editorScale))}))hit.setAttribute(key,value);
}
function arrowNode(o,edit,objects,size) {
  const el=svg('svg',{viewBox:`0 0 ${size.w} ${size.h}`,'data-edit-id':o.id,style:arrowCSS(size),role:'img','aria-label':'箭头'});
  if(edit)el.append(svg('line',{class:'arrow-hit','aria-hidden':'true'}));
  el.append(svg('line',{class:'arrow-shaft'}),svg('polygon'));paintArrow(el,o,objects);return el;
}
function objectNode(o,edit,objects,size,links) {
  if(o.type==='arrow')return arrowNode(o,edit,objects,size);
  const node=make('div','object'+(edit?' editable':''));
  if(o.image){
    const img=make('img');Object.assign(img,{src:o.image,alt:o.text,draggable:false});
    img.style.cssText=rasterImageCSS;node.append(img);
  }else{
    let content=node;
    if(links&&o.href){
      content=make('a','source-link');
      Object.assign(content,{href:o.href,target:'_blank',rel:'noopener noreferrer'});
      content.title='新标签页打开';content.setAttribute('aria-label',`${o.text}（新标签页打开）`);
      node.append(content);
    }
    if(o.textColors||o.textWeights)for(const {text,color,bold} of textStyleSegments(o)){
      if(!color&&bold===null){content.append(text);continue;}
      const span=make('span','',text);
      if(color)span.style.color=color;
      if(bold!==null)span.style.fontWeight=bold?'700':'400';
      content.append(span);
    }
    else content.textContent=o.text;
  }
  node.dataset.editId=o.id;
  Object.assign(node.style,objectStyle(o));
  node.style.cssText+=objectCSS;
  return node;
}
function populate(slide,edit=false,page=model,links=!edit) {
  const size=pageSize(page.format);
  Object.assign(slide.style,{width:`${size.w}px`,height:`${size.h}px`,backgroundColor:page.background});
  slide.replaceChildren(...page.objects.map(o=>objectNode(o,edit,page.objects,size,links)));
  return slide;
}
function box(el,o) {Object.assign(el.style,{left:`${o.x}px`,top:`${o.y}px`,width:`${o.w}px`,height:`${o.h}px`});}
function fit(stage,frame,slide,{w,h},zoom=null) {
  const css=getComputedStyle(stage);
  const scale=zoom??Math.max(.01,Math.min((stage.clientWidth-2*parseFloat(css.paddingLeft))/w,(stage.clientHeight-2*parseFloat(css.paddingTop))/h));
  frame.style.width=`${w*scale}px`;frame.style.height=`${h*scale}px`;
  slide.style.transform=`scale(${scale})`;return scale;
}
const zoomSteps=[.01,.025,.05,.075,.1,.125,.15,.2,.25,.33,.5,.67,.8,1,1.25,1.5,2,3,4];
function resizeScene() {
  if(!model)return;
  const slide=$('slide');
  editorScale=fit($('stage'),$('frame'),slide,canvasSize(),fixedZoom);
  slide.style.setProperty('--arrow-handle',`${22/editorScale}px`);
  slide.style.setProperty('--anchor-size',`${8/editorScale}px`);
  slide.style.setProperty('--resize-handle',`${18/editorScale}px`);
  if(!previewSource)refreshArrows(pointer?.objects??model.objects);
  const percent=`${Math.round(editorScale*100)}%`;
  $('zoom').textContent=percent;
  $('zoom').setAttribute('aria-label',`当前 ${percent}，恢复 100%`);
  $('zoom').setAttribute('aria-pressed',String(fixedZoom===1));
  $('zoom-fit').setAttribute('aria-pressed',String(fixedZoom===null));
  $('zoom-out').disabled=editorScale<=zoomSteps[0];
  $('zoom-in').disabled=editorScale>=zoomSteps.at(-1);
}
function zoomView(scale){
  if(!model||pointer)return;
  const stage=$('stage'), frame=$('frame');
  const center=()=>{
    const view=stage.getBoundingClientRect(), rect=frame.getBoundingClientRect();
    return {x:view.left+stage.clientWidth/2-rect.left,y:view.top+stage.clientHeight/2-rect.top,w:rect.width,h:rect.height};
  };
  const before=center();fixedZoom=scale;resizeScene();
  if(scale!==null&&before.w&&before.h){
    const after=center();
    stage.scrollLeft+=Math.min(1,Math.max(0,before.x/before.w))*after.w-after.x;
    stage.scrollTop+=Math.min(1,Math.max(0,before.y/before.h))*after.h-after.y;
  }
}
action('zoom-out',()=>zoomView(zoomSteps.findLast(step=>step<editorScale-1e-5)??zoomSteps[0]));
action('zoom-in',()=>zoomView(zoomSteps.find(step=>step>editorScale+1e-5)??zoomSteps.at(-1)));
action('zoom',()=>zoomView(1));action('zoom-fit',()=>zoomView(null));
new ResizeObserver(resizeScene).observe($('stage'));
const ends=['from','to'];
const endLabel={from:'起点',to:'终点'};
const moveHandle=(el,p)=>{
  const offset='var(--arrow-handle) / 2 + 1px';
  el.style.left=el.matches('button')?`clamp(calc(${offset}), ${p.x}px, calc(100% - ${offset}))`:`${p.x}px`;
  el.style.top=el.matches('button')?`clamp(calc(${offset}), ${p.y}px, calc(100% - ${offset}))`:`${p.y}px`;
};
function refreshArrows(objects) {
  for(const o of objects)if(o.type==='arrow') {
    const node=$('slide').querySelector(`svg[data-edit-id="${o.id}"]`);
    if(node)paintArrow(node,o,objects);
    if(active()?.id===o.id)for(const k of ends){
      const handle=$('slide').querySelector(`[data-end="${k}"]`);
      if(handle)moveHandle(handle,endpointPoint(o[k],objects));
    }
  }
}
function arrowHandles(slide,o) {
  for(const k of ends) {
    const b=make('button','arrow-handle'+(o[k].target?' attached':''),k==='from'?'起':'终');b.type='button';b.dataset.end=k;
    b.title=`拖动${endLabel[k]}到对象锚点或空白处`;
    b.setAttribute('aria-label',`箭头${endLabel[k]}：方向键微调或在属性中连接对象`);
    b.onkeydown=e=>{
      const d=deltas[e.key];if(!d)return;e.preventDefault();
      const start=endpointPoint(active()[k],model.objects), step=e.shiftKey?10:1;
      const {w:width,h:height}=canvasSize();
      update({[k]:{x:clamp(start.x+d[0]*step,0,width),y:clamp(start.y+d[1]*step,0,height)}},`arrow-key-${k}`);
      $('slide').querySelector(`[data-end="${k}"]`)?.focus();
    };
    moveHandle(b,endpointPoint(o[k],model.objects));slide.append(b);
  }
}
function drawSelection(slide){
  slide.querySelectorAll('.selection,.selection-item,.arrow-handle').forEach(el=>el.remove());
  for(const node of slide.querySelectorAll('svg[data-edit-id]'))node.toggleAttribute('data-selected',selection.has(node.dataset.editId));
  const o=active(), multiple=selection.size>1, bounds=selectionBounds(model.objects,selection);
  if(o?.type==='arrow'){arrowHandles(slide,o);return;}
  if(!bounds)return;
  if(multiple)for(const item of selectedItems())if(item.type!=='arrow'){
    const outline=make('div','selection-item');outline.dataset.selectionId=item.id;box(outline,item);slide.append(outline);
  }
  const selectionBox=make('div',`selection${multiple?' multi':''}`);box(selectionBox,bounds);
  const handle=make('button','resize'); handle.type='button';
  handle.title=multiple?'等比缩放选区（方向键）':'调整尺寸（方向键）';
  handle.setAttribute('aria-label',`${handle.title}，使用方向键`);
  handle.addEventListener('keydown',e=>{
    const d=deltas[e.key];if(!d||busy||pointer)return;e.preventDefault();
    const step=e.shiftKey?10:1;
    if(multiple){
      const delta=d[0]||d[1], dimension=d[0]?bounds.w:bounds.h;
      if(dimension)transform({ratio:(dimension+delta*step)/dimension},'resize-selection');
    }else update({w:o.w+d[0]*step,h:o.h+d[1]*step},'resize-key');
    $('slide').querySelector('.resize')?.focus();
  });
  selectionBox.append(handle);slide.append(selectionBox);
}
function canvas() {
  const slide=populate($('slide'),!previewSource,visiblePage(),false);
  if(!previewSource)drawSelection(slide);
  measure();
}
function measure() {
  if(!model)return;
  const overflowing=[...$('slide').querySelectorAll('.object')].filter(el=>el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1).map(el=>el.dataset.editId);
  $('overflow').textContent=overflowing.length?`${overflowing.length} 个对象有内容溢出`:'';
  $('overflow').title=overflowing.join(', ');
}
document.fonts?.ready.then(measure);
const layerList=$('layers');
let layerDrag;
function layers() {
  if(layerDrag)finishLayerDrag(false);
  const {layer,grip}=document.activeElement?.dataset||{};
  const memberships=new Map();
  (model.groups??[]).forEach((members,i)=>members.forEach(id=>memberships.set(id,i+1)));
  layerList.replaceChildren(...[...model.objects].reverse().map(o=>{
    const li=make('li','layer-row'), b=make('button','layer-select'); b.type='button'; b.dataset.layer=o.id;li.dataset.row=o.id;
    b.setAttribute('aria-pressed',String(selection.has(o.id))); b.title=o.id;
    const glyph=make('span','layer-icon',symbols[o.type]);glyph.setAttribute('aria-hidden','true');
    const name=o.type==='arrow'?'箭头 · '+o.id.slice(6,14):o.text.split('\n')[0]||o.id;
    const label=make('span','layer-name',name);label.title=name;
    b.append(glyph,label);
    if(memberships.has(o.id)){const mark=make('span','layer-group-mark',`G${memberships.get(o.id)}`);mark.setAttribute('aria-label',`组合 ${memberships.get(o.id)}`);b.append(mark);}
    b.onclick=e=>selectObject(o.id,modifier(e));
    const handle=make('button','layer-grip');handle.type='button';handle.dataset.grip=o.id;
    handle.title='拖动排序';handle.setAttribute('aria-label',`调整图层顺序：${name}`);handle.setAttribute('aria-keyshortcuts','ArrowUp ArrowDown');
    handle.onclick=e=>selectObject(o.id,modifier(e));
    handle.onkeydown=e=>{
      const dir=e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0;
      if(!dir||e.altKey||e.ctrlKey||e.metaKey)return;
      e.preventDefault();const i=[...layerList.children].indexOf(li);
      moveLayer(o.id,i+dir);
    };
    li.append(b,handle);return li;
  }));
  if(grip)layerList.querySelector(`[data-grip="${grip}"]`)?.focus({preventScroll:true});
  else if(layer)layerList.querySelector(`[data-layer="${layer}"]`)?.focus({preventScroll:true});
  $('layer-count').textContent=model.objects.length;
}
function moveLayer(id,index) {
  const ordered=[...model.objects].reverse(), from=ordered.findIndex(o=>o.id===id);
  if(busy||from<0||index<0||index>=ordered.length||index===from)return;
  ordered.splice(index,0,ordered.splice(from,1)[0]);if(!selection.has(id))selectObject(id,false,false);sampling=null;
  commit({...model,objects:ordered.reverse()});
  const row=layerList.querySelector(`[data-row="${id}"]`);row?.scrollIntoView({block:'nearest',inline:'nearest'});
  announce(`图层已移动到第 ${index+1} 层（从上往下）。`);
}
function markLayerDrop(d) {
  const rect=d.scroller.getBoundingClientRect(), top=Math.max(rect.top,0), bottom=Math.min(rect.bottom,window.innerHeight);
  const y=Math.max(top,Math.min(d.y,bottom));
  const i=d.rows.findIndex(row=>{const r=row.getBoundingClientRect();return y<r.top+r.height/2;});
  d.index=i<0?d.rows.length:i;d.valid=d.x>=rect.left-12&&d.x<=rect.right+12;
  const marker=d.valid&&d.index!==d.from?(d.rows[d.index]||d.rows.at(-1)):null;
  if(d.marker&&(d.marker!==marker||!d.valid))delete d.marker.dataset.drop;
  if(marker)marker.dataset.drop=i<0?'after':'before';
  d.marker=marker;
}
function dragLayerFrame(now) {
  const d=layerDrag;if(!d?.moving)return;
  const r=d.scroller.getBoundingClientRect(), top=Math.max(r.top,0), bottom=Math.min(r.bottom,window.innerHeight), zone=26;
  const direction=d.y<top+zone?-1:d.y>bottom-zone?1:0;
  if(direction&&d.valid){
    const dt=Math.min(32,now-(d.lastFrame||now-16)),edge=direction<0?top+zone:bottom-zone;
    d.scroller.scrollTop+=Math.round(direction*dt*Math.min(.7,Math.abs(d.y-edge)/55));markLayerDrop(d);
  }
  d.lastFrame=now;d.frame=requestAnimationFrame(dragLayerFrame);
}
function finishLayerDrag(keep) {
  const d=layerDrag;if(!d)return;
  layerDrag=null;cancelAnimationFrame(d.frame);
  d.row.classList.remove('dragging');if(d.marker)delete d.marker.dataset.drop;
  if(layerList.hasPointerCapture(d.pointer))layerList.releasePointerCapture(d.pointer);
  if(keep&&d.moving&&d.valid)moveLayer(d.row.dataset.row,d.index);
}
layerList.addEventListener('pointerdown',e=>{
  const handle=e.target.closest('.layer-grip');
  if(!handle||!e.isPrimary||e.button!==0||busy||layerDrag||layerList.children.length<2)return;
  const row=handle.closest('.layer-row'), allRows=[...layerList.children], from=allRows.indexOf(row);
  layerDrag={pointer:e.pointerId,row,rows:allRows.filter(n=>n!==row),from,index:from,x:e.clientX,y:e.clientY,startY:e.clientY,
    scroller:getComputedStyle(layerList).overflowY==='auto'?layerList:$('left-content')};
  e.preventDefault();handle.focus({preventScroll:true});layerList.setPointerCapture(e.pointerId);
});
layerList.addEventListener('pointermove',e=>{
  const d=layerDrag;if(d?.pointer!==e.pointerId)return;
  d.x=e.clientX;d.y=e.clientY;
  if(!d.moving&&Math.abs(d.y-d.startY)<4)return;
  if(!d.moving){d.moving=true;d.row.classList.add('dragging');d.frame=requestAnimationFrame(dragLayerFrame);}
  markLayerDrop(d);
});
for(const type of ['pointerup','pointercancel','lostpointercapture'])layerList.addEventListener(type,e=>{
  if(layerDrag?.pointer===e.pointerId)finishLayerDrag(type==='pointerup');
});
function renderThumb(thumb,page) {
  const {w,h}=pageSize(page.format), slide=populate(make('div','slide'),false,page,false);
  thumb.style.aspectRatio=`${w} / ${h}`;
  // Keep portrait thumbnails usable in the narrow outline without distorting the page.
  thumb.style.maxWidth=w<h?`${156*w/h}px`:'';
  thumb.replaceChildren(slide);scaleThumb(thumb,slide);
}
function scaleThumb(thumb,slide){slide.style.transform=`scale(${thumb.clientWidth/parseFloat(slide.style.width)})`;}
function refreshThumb() {
  const thumb=$('outline').querySelector('[aria-current] .thumb');
  if(thumb)renderThumb(thumb,visiblePage());
}
new ResizeObserver(()=>{
  for(const node of $('outline').querySelectorAll('.thumb>.slide'))scaleThumb(node.parentElement,node);
}).observe($('outline'));
const lazyThumbs=new IntersectionObserver(entries=>{
  for(const {target,isIntersecting} of entries)if(isIntersecting){
    lazyThumbs.unobserve(target);
    const id=target.dataset.pageId;
    void pageSnapshot(id).then(page=>{
      if(target.isConnected&&id!==model.id)renderThumb(target,page);
    }).catch(()=>{});
  }
},{root:$('left-content')});
let outlineEdit, pageDrag;
const sectionKey=id=>panelKey(`section:${id}`);
function updateCatalog(next) {
  if(next.export_root!==catalog?.export_root){
    $('export-location').hidden=!next.export_root;
    if(next.export_root)exportLocation('导出根目录',next.export_root);
  }
  catalog=next;pageList=next.sections.flatMap(section=>section.pages);
}
async function changeOutline(body) {
  busy=true;refreshStatus();
  try {
    const next=await api('/api/outline',{method:'PATCH',headers:{'If-Match':`"${catalog.manifest_revision}"`},body:JSON.stringify(body)});
    updateCatalog(next);return next.affected;
  } finally {busy=false;refreshStatus();}
}
function outlineDialog(op,section,page) {
  if(busy)return;
  const remove=op==='remove-section'||op==='remove-page', field=$('outline-name');
  outlineEdit={op,section:section?.id,page:page?.id};
  $('outline-title').textContent=({
    'add-section':'新增分节','rename-section':'重命名分节','remove-section':`移除「${section?.title}」？`,'add-page':'新增页面','remove-page':`删除整页「${page?.title}」？`,
  })[op];
  $('outline-name-field').hidden=remove;field.disabled=remove;field.value=op==='rename-section'?section.title:'';
  $('outline-details').textContent=page?'将从演示中删除此页，源文件已写回的版本会备份。此操作不属于画布撤销。':'';
  $('outline-status').textContent='';$('outline-submit').textContent=page?'删除整页':remove?'移除':'确认';
  $('outline-dialog').showModal();
  if(remove)$('outline-cancel').focus();else field.select();
}
action('add-section',()=>outlineDialog('add-section'));
action('outline-cancel',()=>{if(!busy)$('outline-dialog').close();});
on('outline-dialog','cancel',e=>{if(busy)e.preventDefault();});
on('outline-form','submit',async e=>{
  e.preventDefault();if(busy)return;
  const {op,section,page}=outlineEdit, removing=op==='remove-section'||op==='remove-page';
  const deletingCurrent=op==='remove-page'&&page===model.id;
  if(deletingCurrent&&dirty()){$('outline-status').textContent='此页有未写回的草稿。请取消，先写回或撤销草稿，再确认删除。';return;}
  const neighbor=deletingCurrent?(adjacentPage(1)??adjacentPage(-1))?.id:null;
  const title=$('outline-name').value.trim();
  if(!removing&&!title){$('outline-status').textContent='名称不能为空。';$('outline-name').focus();return;}
  $('outline-submit').disabled=true;$('outline-cancel').disabled=true;$('outline-name').readOnly=true;
  try {
    const affected=await changeOutline({op,section,...(page&&{page}),...(!removing&&{title})});
    $('outline-dialog').close();
    if(op==='remove-section')try{localStorage.removeItem(sectionKey(section));}catch{}
    if(op==='remove-page'){
      drawOutline();
      if(deletingCurrent&&!await openPage(neighbor)){
        for(const id of ['workspace','top-actions','ribbon'])$(id).inert=true;
        banner('页面已删除，但无法载入相邻页。请刷新工作台。');return;
      }
      const current=$('outline').querySelector(`[data-page="${model.id}"]`);
      if(current){current.closest('details').open=true;current.focus();}
      announce('已删除整页，源文件已备份。');return;
    }
    if(op==='add-page'){
      const disclosure=$('outline').querySelector(`[data-section="${section}"] details`);if(disclosure)disclosure.open=true;
      try{localStorage.removeItem(sectionKey(section));}catch{}
      await openPage(affected);
      $('outline').querySelector(`[data-page="${affected}"]`)?.focus();
    }else{
      drawOutline();
      const focus=removing?$('add-section'):$('outline').querySelector(`[data-section="${affected}"] summary`);
      focus?.focus();
    }
  }catch(e){$('outline-status').textContent=e.message;}
  finally{$('outline-submit').disabled=false;$('outline-cancel').disabled=false;$('outline-name').readOnly=false;}
});
function clearPageDrag() {
  if(!pageDrag)return;
  delete pageDrag.handle.dataset.dragging;if(pageDrag.marker)delete pageDrag.marker.dataset.drop;
  pageDrag=null;
}
async function reorderPage(section,page,target,after) {
  if(busy||page===target)return;
  try {
    await changeOutline({op:'move-page',section,page,target,after});drawOutline();
    const handle=$('outline').querySelector(`[data-page-grip="${page}"]`);
    handle?.focus();handle?.closest('.page-row')?.scrollIntoView({block:'nearest',inline:'nearest'});
    announce(`页面已移到第 ${pageList.findIndex(p=>p.id===page)+1} 页。`);
  }catch(e){banner(e.message);}
}
function pageListItem(section,p,index,n) {
  const row=make('div','page-row'), b=make('button','page-select'), grip=make('button','page-grip','⠿');
  b.type=grip.type='button';b.dataset.page=p.id;grip.dataset.pageGrip=p.id;
  const thumb=make('span','thumb');thumb.setAttribute('aria-hidden','true');
  b.title=`${n} · ${p.title}`;
  thumb.dataset.pageId=p.id;b.append(thumb,make('span','page-label',b.title));
  if(p.id===model.id){b.setAttribute('aria-current','page');$('page-badge').textContent=n;}
  else lazyThumbs.observe(thumb);
  b.onclick=()=>{if(p.id!==model.id&&!busy)void openPage(p.id);};
  grip.title='拖动排序';grip.draggable=section.pages.length>1;
  grip.disabled=!grip.draggable;grip.setAttribute('aria-label',`调整页序：${p.title}`);
  grip.setAttribute('aria-keyshortcuts','Alt+ArrowUp Alt+ArrowDown');
  grip.onkeydown=e=>{
    const dir=e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0;
    const neighbor=section.pages[index+dir];if(!dir||!neighbor||!e.altKey||e.ctrlKey||e.metaKey)return;
    e.preventDefault();void reorderPage(section.id,p.id,neighbor.id,dir>0);
  };
  grip.ondragstart=e=>{
    if(busy){e.preventDefault();return;}
    clearPageDrag();pageDrag={section:section.id,page:p.id,handle:grip};grip.dataset.dragging='';
    e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-html-studio-page',p.id);
  };
  grip.ondragend=clearPageDrag;
  const after=e=>{const rect=row.getBoundingClientRect();return e.clientY>=rect.top+rect.height/2;};
  const valid=()=>!busy&&pageDrag?.section===section.id&&pageDrag.page!==p.id;
  row.ondragover=e=>{
    if(!valid())return;
    e.preventDefault();e.dataTransfer.dropEffect='move';
    if(pageDrag.marker&&pageDrag.marker!==row)delete pageDrag.marker.dataset.drop;
    pageDrag.marker=row;row.dataset.drop=after(e)?'after':'before';
  };
  row.ondragleave=e=>{if(!row.contains(e.relatedTarget))delete row.dataset.drop;};
  row.ondrop=e=>{
    if(!valid())return;
    e.preventDefault();const {page}=pageDrag;clearPageDrag();void reorderPage(section.id,page,p.id,after(e));
  };
  const remove=make('button','page-remove','×');remove.type='button';
  remove.disabled=pageList.length===1;remove.title=remove.disabled?'不能删除最后一页':'删除整页';
  remove.setAttribute('aria-label',`删除整页：${p.title}`);remove.setAttribute('aria-haspopup','dialog');
  remove.onclick=()=>outlineDialog('remove-page',section,p);
  row.append(b,grip,remove);return row;
}
function drawOutline() {
  let i=0; const out=$('outline'), focused=document.activeElement?.dataset.page;
  const expanded=new Map([...out.querySelectorAll('[data-section]')].map(row=>[row.dataset.section,row.querySelector('details').open]));
  lazyThumbs.disconnect();out.replaceChildren();
  for(const section of catalog.sections) {
    const row=make('div','page-section'), detail=make('details'), summary=make('summary','section-tag');
    row.dataset.section=section.id;
    summary.title=section.title;summary.append(make('span','section-label',section.title));
    detail.open=expanded.get(section.id)??true;
    if(!expanded.has(section.id))try{detail.open=localStorage.getItem(sectionKey(section.id))!=='closed';}catch{}
    const remember=open=>{if(detail.isConnected)try{localStorage.setItem(sectionKey(section.id),open?'open':'closed');}catch{}};
    summary.addEventListener('click',()=>remember(!detail.open));
    detail.addEventListener('toggle',()=>remember(detail.open));
    detail.append(summary,...section.pages.map((p,index)=>pageListItem(section,p,index,String(++i).padStart(2,'0'))));
    const controls=make('div','section-actions');
    for(const [op,label,icon] of [['add-page','新增页面','＋'],['rename-section','重命名分节','✎'],['remove-section','移除分节','−']]){
      const b=make('button','section-action',icon);b.type='button';b.title=label;b.setAttribute('aria-label',`${label}：${section.title}`);
      if(op==='remove-section'&&section.pages.length){b.disabled=true;b.title='只能移除空分节';}
      b.onclick=()=>outlineDialog(op,section);controls.append(b);
    }
    row.append(detail,controls);out.append(row);
  }
  $('page-count').textContent=String(i).padStart(2,'0');refreshThumb();
  if(focused)out.querySelector(`[data-page="${focused}"]`)?.focus({preventScroll:true});
}
function inspector(skip) {
  const items=selectedItems(), o=active(), first=items[0], arrow=o?.type==='arrow', multiple=items.length>1;
  const allArrows=items.length>0&&items.every(item=>item.type==='arrow');
  const allBoxes=items.length>0&&items.every(item=>item.type!=='arrow');
  const whole=multiple&&sameGroup();
  $('object-fields').hidden=!allBoxes;$('page-fields').hidden=!!items.length;$('arrow-fields').hidden=!allArrows;
  $('selection-fields').hidden=!multiple;$('object-geometry').hidden=multiple;$('object-text').hidden=multiple;$('object-href-row').hidden=multiple||o?.type!=='text';
  $('object-text-title').textContent=o?.image?'图片替代文本':'文本';
  $('object-text').setAttribute('aria-label',o?.image?'图片替代文本':'对象文本');
  $('radius-row').hidden=items.some(item=>item.type==='ellipse');
  for(const k of ends)$(`${k}-fields`).hidden=multiple;
  if(multiple){
    const bounds=selectionBounds(model.objects,selection);
    for(const key of ['x','y','w','h']){
      const field=$(`selection-${key}`);field.value=bounds[key];
      field.disabled=(key==='w'||key==='h')&&!bounds[key];
    }
  }
  $('page-effect').value=model.transition??'';
  const cues=(model.clickReveal??[]).map(revealStep);
  const order=cues.findIndex(c=>c.ids.length===items.length&&c.ids.every(id=>selection.has(id)));
  $('object-effect').disabled=!items.length;
  $('object-effect').value=order>=0?cues[order].effect:cues.some(c=>c.ids.some(id=>selection.has(id)))?'mixed':'';
  $('reveal-order').hidden=order<0;
  $('reveal-order').textContent=order>=0?`${order+1} / ${cues.length}`:'';
  $('object-name').textContent=multiple?(whole?'组合':'多选'):o?{text:'文本对象',rect:'矩形',ellipse:'圆形',arrow:'箭头'}[o.type]:'页面';
  $('object-type').textContent=multiple?'▧':o?symbols[o.type]:'▤';
  $('object-id').textContent=multiple?`${items.length} 个对象`:o?.id||model.id;
  if(skip!==$('swatch-background')) $('swatch-background').value=model.background;
  if(skip!==$('notes')) $('notes').value=visiblePage().notes;
  let hasMixed=false;
  if(first){
    const {w:width,h:height}=canvasSize();
    for(const input of props) {
      const hidden=input.closest('[hidden]');
      if(hidden&&hidden!==$('properties')&&$('properties').contains(hidden))continue;
      const k=input.dataset.prop, value=item=>item[k]??(k==='href'?'':borderDefaults[k]);
      const sameValue=items.every(item=>value(item)===value(first));
      hasMixed||=!sameValue;
      input.toggleAttribute('data-mixed',!sameValue);
      if(input.tagName==='SELECT'){
        const mixed=input.querySelector('option[data-mixed]');
        if(!sameValue&&!mixed){const option=make('option','','混合');option.value='';option.disabled=true;option.dataset.mixed='';input.prepend(option);}
        else if(sameValue)mixed?.remove();
      }
      if(k==='href'&&input!==skip)input.setCustomValidity('');
      if(input!==skip)input.value=!sameValue&&input.type!=='color'?'':k==='fill'&&first.fill==='transparent'?THEME.card:value(first);
      if(k==='x')input.max=width-first.w;
      if(k==='y')input.max=height-first.h;
      if(k==='w')input.max=width-first.x;
      if(k==='h')input.max=height-first.y;
    }
    $('transparent').checked=items.every(item=>item.fill==='transparent');
    $('transparent').indeterminate=allBoxes&&!$('transparent').checked&&items.some(item=>item.fill==='transparent');
    hasMixed||=$('transparent').indeterminate;
    if(arrow)endFields(o);
    if(allBoxes)for(const b of toggles){
      const k=b.dataset.toggle,mixed=items.some(item=>item[k]!==first[k]);
      b.setAttribute('aria-pressed',mixed?'mixed':String(first[k]));hasMixed||=mixed;
    }
  }
  syncTextRangeControls();
  $('mixed-style').hidden=!hasMixed;
  toolDisabled('group-selection',!multiple||whole);
  toolDisabled('ungroup-selection',!selectedGroups().length);
  $('align-fields').hidden=!multiple;
  $('align-fields').disabled=!multiple||alignmentUnits(model,selection).length<2;
  toolDisabled('duplicate',!items.length);toolDisabled('copy-objects',!items.length);
  toolDisabled('paste-objects',!objectClipboardEntry);toolDisabled('delete',!items.length);
  const objects=model.objects;
  toolDisabled('raise',!objects.some((item,i)=>selection.has(item.id)&&objects[i+1]&&!selection.has(objects[i+1].id)));
  toolDisabled('lower',!objects.some((item,i)=>selection.has(item.id)&&objects[i-1]&&!selection.has(objects[i-1].id)));
  toolDisabled('paint',!o||arrow);
  toolDisabled('apply-paint',!allBoxes||!brush);
  canvasHint();
  $('paint').toggleAttribute('data-ready',!!brush);
  toolDisabled('undo',!history.length);toolDisabled('redo',!future.length);
  refreshStatus();
}
const objectText=$('object-text');
let textRangeOwner;
function textRangeSelection() {
  const object=active(), {value,selectionStart,selectionEnd}=objectText;
  if(previewSource||object?.type!=='text'||object.text.replace(/\r\n?/g,'\n')!==value||selectionStart===selectionEnd)return null;
  // A textarea normalizes CRLF to LF. Map its selection back to the source string.
  const offsets=[0];
  for(let index=0;index<object.text.length;){
    index+=object.text.startsWith('\r\n',index)?2:1;
    offsets.push(index);
  }
  return {object,start:offsets[selectionStart],end:offsets[selectionEnd]};
}
function syncTextRangeControls() {
  const object=active(), owner=object?.type==='text'?object.id:null;
  if(owner!==textRangeOwner){
    textRangeOwner=owner;
    objectText.setSelectionRange(0,0);
  }
  const range=textRangeSelection(), editable=!!owner&&!previewSource;
  $('text-color-range').hidden=!owner;
  $('text-color-hint').textContent=range?'作用范围：选中的文字':'作用范围：整个文本框（选中文字可单独设置）';
  const bold=editable&&(range?textRangeIsBold(object,range.start,range.end):
    object.text.length?textRangeIsBold(object,0,object.text.length):object.bold);
  $('toggle-range-bold').disabled=!editable;
  $('toggle-range-bold').setAttribute('aria-pressed',String(bold));
  if(editable)$('object-fields').querySelector('[data-toggle="bold"]').setAttribute('aria-pressed',String(bold));
  $('text-range-color').disabled=!editable;
  $('apply-text-color').disabled=!editable;
  $('clear-text-color').disabled=!editable||!object.textColors?.some(({start,end})=>!range||start<range.end&&end>range.start);
}
for(const event of ['select','selectionchange','pointerup','keyup','blur'])on('object-text',event,syncTextRangeControls);
function applyTextStyle(key,value,{restore=false,input=null,refocus=false}={}) {
  const object=active();
  if(object?.type!=='text'||previewSource||busy||pointer)return;
  const range=textRangeSelection(), color=key==='color', field=color?'textColors':'textWeights';
  let next;
  if(range){
    const {start,end}=range;
    next=color?setTextColor(object,start,end,restore?null:value):setTextBold(object,start,end,value);
  }else{
    next=restore?{...object}:{...object,[key]:value};
    delete next[field];
  }
  commit({...model,objects:model.objects.map(item=>item===object?next:item)},input?`${object.id}:${key}`:'',input??objectText);
  if(refocus&&range)objectText.focus({preventScroll:true});
  if(!input)announce(`${range?'选中文字':'整个文本框'}：${color?(restore?'已恢复默认颜色。':'已应用颜色。'):(value?'已加粗。':'已取消加粗。')}`);
}
function toggleTextBold(refocus=false) {
  const object=active(), range=textRangeSelection();
  if(object?.type!=='text')return;
  const bold=range?textRangeIsBold(object,range.start,range.end):
    object.text.length?textRangeIsBold(object,0,object.text.length):object.bold;
  applyTextStyle('bold',!bold,{refocus});
}
action('apply-text-color',()=>applyTextStyle('color',$('text-range-color').value,{refocus:true}));
action('clear-text-color',()=>applyTextStyle('color',null,{restore:true,refocus:true}));
action('toggle-range-bold',()=>toggleTextBold(true));
function endFields(o) {
  const options=model.objects.filter(n=>n.type!=='arrow');
  for(const k of ends) {
    const field=$(`${k}-target`), free=make('option','','自由端点');free.value='';
    const nodes=options.map(n=>{const option=make('option','',`${(n.text.split('\n')[0]||n.id).slice(0,24)} · ${n.id.slice(0,16)}`);option.value=n.id;return option;});
    field.replaceChildren(free,...nodes);
    const end=o[k], p=endpointPoint(end,model.objects);
    field.value=end.target||'';$(`${k}-side-row`).hidden=!end.target;$(`${k}-coords`).hidden=!!end.target;
    $(`${k}-x`).max=canvasSize().w;$(`${k}-y`).max=canvasSize().h;
    $(`${k}-side`).value=end.side||(k==='from'?'right':'left');$(`${k}-x`).value=p.x;$(`${k}-y`).value=p.y;
  }
}
function canvasHint() {
  $('slide').classList.toggle('sampling',!!sampling);
}
function render(skip) {canvas();resizeScene();renderFormat();layers();inspector(skip);refreshThumb();}
function renderPageVersion() {
  const page=visiblePage();
  $('page-title').textContent=page.title;
  $('file-path').textContent=source.absolute_file??source.file;
  $('edit-tools').inert=previewSource;
  $('workspace').toggleAttribute('data-source-preview',previewSource);
  $('layer-group').hidden=previewSource;
  $('page-format').disabled=previewSource;
  $('page-orientation').disabled=previewSource;
  $('notes').readOnly=previewSource;
  $('slide').setAttribute('aria-label',previewSource?'最新源文件预览':'编辑画布');
  renderConflict();
  render();
}
const formatSelect=$('page-format'), orientationSelect=$('page-orientation');
for(const [label,items,paper] of pageFormats){
  const options=make('optgroup');options.label=label;
  for(const [id,name,w,h] of items){
    const option=make('option','',paper?`${name} · ${w} × ${h}${paper==='mm'?' mm':' in'}`:name);
    option.value=id;options.append(option);
  }
  formatSelect.append(options);
}
function renderFormat(){
  const {id,landscape,paper,width,height,label}=canvasSize();
  formatSelect.value=id;orientationSelect.hidden=!paper;orientationSelect.value=landscape?'landscape':'portrait';
  formatSelect.title=`${label} · ${width} × ${height} ${paper??'px'}`;
}
function updateFormat(format){
  if(!model||busy||pointer){if(model)renderFormat();return;}
  const previous=canvasSize(), size=pageSize(format);
  if(!size||size===previous){renderFormat();return;}
  const ids=new Set(model.objects.map(o=>o.id)), bounds=selectionBounds(model.objects,ids);
  const objects=fitToPage(model.objects,ids,size,{frame:bounds&&{x:0,y:0,w:bounds.x+bounds.w,h:bounds.y+bounds.h}});
  const next={...model,objects};
  if(format===defaultFormat)delete next.format;else next.format=format;
  commit(next);
  announce(`页面规格已更新：${formatSelect.title}。`);
}
on('page-format','change',()=>{
  const format=formatSelect.value;
  updateFormat(pageSize(format)?.paper&&canvasSize().landscape?`${format}-landscape`:format);
});
on('page-orientation','change',()=>updateFormat(`${canvasSize().id}${orientationSelect.value==='landscape'?'-landscape':''}`));
function select(ids=[],draw=true){
  const next=selectGroups(model,ids);
  if(next.size!==selection.size||[...next].some(id=>!selection.has(id))){group='';sampling=null;selection=next;}
  if(draw){drawSelection($('slide'));layers();inspector();}
}
function selectObject(id,toggle=false,draw=true){
  if(busy||pointer)return;
  if(!toggle){select([id],draw);return;}
  const next=new Set(selection), unit=selectGroups(model,[id]);
  for(const member of unit){if(selection.has(id))next.delete(member);else next.add(member);}
  select(next,draw);
}
function transform(change,key){
  if(busy||pointer||!selection.size)return;
  commit({...model,objects:transformSelection(model.objects,selection,change,undefined,canvasSize())},key?`${multiKey()}:${key}`:'');
}
function commit(next,key='',skip=null,draw=true) {
  if(previewSource||same(next,model))return;
  validate(next,model.id);
  const now=performance.now();
  if(!key||key!==group||now-time>750){history.push(model);if(history.length>50)history.shift();}
  group=key; time=now; future=[]; model=next;
  persist(); if(draw) render(skip); else { inspector(skip); }
}
on('page-effect','change',e=>{
  if(busy||pointer){inspector();return;}
  const next={...model};
  if(e.target.value)next.transition=e.target.value;else delete next.transition;
  commit(next);
});
on('object-effect','change',e=>{
  if(busy||pointer||!selection.size){inspector();return;}
  commit(setReveal(model,selection,e.target.value));
});
for(const key of ['x','y','w','h'])on(`selection-${key}`,'change',e=>{
  const bounds=selectionBounds(model.objects,selection),value=e.target.valueAsNumber;
  if(selection.size<2||!Number.isFinite(value)){inspector();return;}
  if(key==='x'||key==='y')transform({[key==='x'?'dx':'dy']:value-bounds[key]});
  else if(bounds[key])transform({ratio:value/bounds[key]});
  inspector();
});
function normalized(o) {
  const {w:width,h:height}=canvasSize();
  if(o.type==='arrow'){o.strokeWidth=clamp(o.strokeWidth,1,styleLimits.strokeWidth);return o;}
  o.radius=clamp(o.radius,0,styleLimits.radius);
  if(o.borderWidth!==undefined)o.borderWidth=clamp(o.borderWidth,0,styleLimits.borderWidth);
  o.w=clamp(o.w,24,width);o.h=clamp(o.h,24,height);
  o.x=clamp(o.x,0,width-o.w);o.y=clamp(o.y,0,height-o.h);
  o.size=clamp(o.size,10,160);o.inset=clamp(o.inset,0,80); return o;
}
function update(changes,key='',skip=null,draw=true) {
  if(!selection.size||busy||pointer)return;
  const objects=model.objects.map(o=>{
    if(!selection.has(o.id))return o;
    const next={...(Object.hasOwn(changes,'text')?replaceObjectText(o,changes.text):o),...changes};
    if(next.image&&!next.text.trim())return o;
    if(next.href&&!next.text.trim())next.href='';
    if(changes.borderColor!==undefined&&!o.borderWidth)next.borderWidth=1;
    return normalized(next);
  });
  commit({...model,objects},key?`${multiKey()}:${key}`:'',skip,draw);
}
function turnEditorPage(offset) {
  if(busy||pointer||layerDrag||pageDrag)return;
  const page=adjacentPage(offset);
  if(page)void openPage(page.id,{selectDefault:false});
}
action('edit-prev-page',()=>turnEditorPage(-1));
action('edit-next-page',()=>turnEditorPage(1));
const draftKey=id=>`html-studio:v1:${catalog.workspace_key}:${id}`;
function tabDraftKey(key){
  const alias=sessionStorage.getItem(key);
  return alias?.startsWith(key+':')?alias:key;
}
async function openPage(id,{discardDraft=false,selectDefault=true}={}) {
  if(busy)return;
  busy=true;
  if(model&&!discardDraft&&(!stale||!storageOK))persist();else refreshStatus();
  try {
    const result=await api(endpoint(id));
    const key=draftKey(id);
    let draft=null;
    if(discardDraft){
      // Do not clear the draft before the latest source is available, or erase another tab's bytes.
      const stored=localStorage.getItem(storageKey);
      if(stored!==null&&stored!==cached){
        sessionStorage.setItem(key,key+':'+crypto.randomUUID());
      }else if(stored!==null){
        localStorage.removeItem(storageKey);
      }
    }
    baseKey=key;storageKey=key;cached=null;storageOK=true;
    try {
      storageKey=tabDraftKey(key);
      cached=localStorage.getItem(storageKey);
      if(cached){draft=JSON.parse(cached);validate(draft.model,id);}
    } catch {draft=null;storageOK=false;}
    source=result; draftBase=draft?.base||result.revision; model=draft?.model||result.model; forked=storageKey!==key;
    draftBaseTime=draft?.base_modified_at??(draftBase===result.revision?result.modified_at:undefined);
    stale=!!draft&&draft.base!==source.revision&&dirty(); history=[];future=[];group='';sampling=null;
    previewSource=stale; diskRevisionKnown=true;
    select(!previewSource&&selectDefault&&model.objects.length?[model.objects.find(o=>o.id==='hero-title')?.id||model.objects[0].id]:[],false);
    banner();
    $('stage').scrollTo(0,0);drawOutline();renderPageVersion();
    for(const id of ['workspace','top-actions','ribbon']) $(id).inert=false;
    return true;
  } catch(e) {
    if(discardDraft)$('discard-status').textContent=`未能载入最新源文件，草稿仍保留。${e.message}`;
    else banner(e.message);
    return false;
  }
  finally {busy=false;if(model)refreshStatus();}
}
function timeTravel(from,to) {if(!from.length||busy||pointer)return;to.push(model);model=from.pop();group='';sampling=null;select(model.objects.filter(o=>selection.has(o.id)).map(o=>o.id),false);persist();render();}
function insert(type) {
  if(busy||pointer)return;
  if(model.objects.length>=80){banner('一页最多 80 个对象。');return;}
  const next=copy(model), id=`${type}-${crypto.randomUUID()}`;
  const {w:width,h:height}=canvasSize(), w=type==='text'?300:150,h=type==='text'?72:110;
  const center={x:Math.round(width/2),y:Math.round(height/2)};
  next.objects.push(type==='arrow'?{id,type,stroke:THEME.accent,strokeWidth:3,from:{x:center.x-120,y:center.y-30},to:{x:center.x+120,y:center.y+30}}:
    {...defaults,id,type,x:center.x-Math.round(w/2),y:center.y-Math.round(h/2),w,h,text:type==='text'?'输入文字':'',fill:type==='text'?'transparent':THEME.band});
  select([id],false);
  commit(next);
}
function mutateOrder(offset) {
  if(busy||pointer)return;
  const objects=[...model.objects], indexes=objects.map((_,i)=>i);
  for(const i of offset>0?indexes.reverse():indexes){
    const next=objects[i+offset];
    if(next&&selection.has(objects[i].id)&&!selection.has(next.id))[objects[i],objects[i+offset]]=[next,objects[i]];
  }
  commit({...model,objects});
}
function remove(){
  if(busy||pointer||!selection.size)return;
  const next=withoutObjects(model,selection);select([],false);commit(next);
}
function groupSelection(makeGroup){
  if(busy||pointer||(makeGroup?(selection.size<2||sameGroup()):!selectedGroups().length))return;
  commit(regroup(model,selection,makeGroup));
  announce(makeGroup?`已组合 ${selection.size} 个对象。`:'已取消组合。');
}
action('group-selection',()=>groupSelection(true));action('ungroup-selection',()=>groupSelection(false));
on('align-options','click',e=>{
  const button=e.target.closest('button[data-align]');
  if(!button||busy||pointer)return;
  const objects=alignSelection(model,selection,button.dataset.align);
  if(objects!==model.objects){commit({...model,objects});announce(`已${button.textContent}。`);}
  else announce('对象已对齐。');
});
action('undo',()=>timeTravel(history,future));action('redo',()=>timeTravel(future,history));
for(const type of ['text','rect','ellipse','arrow'])action(`add-${type}`,()=>insert(type));
function portableSelection(){
  const end=p=>p.target&&!selection.has(p.target)?endpointPoint(p,model.objects):p;
  const objects=selectedItems().map(o=>o.type==='arrow'?{...o,from:end(o.from),to:end(o.to)}:o);
  const groups=selectedGroups();
  return {objects,...(groups.length?{groups}:{}),...(model.format?{format:model.format}:{})};
}
function clipboardFeedback(message){
  const status=$('clipboard-status');
  clearTimeout(clipboardFeedbackTimer);
  status.textContent=message;
  clipboardFeedbackTimer=setTimeout(()=>{status.textContent='';},4000);
}
function copyObjects(){
  if(!model||busy||pointer||inline||!selection.size)return;
  const payload=copy(portableSelection());
  objectClipboardEntry={payload,page:model.id};
  toolDisabled('paste-objects',false);
  clipboardFeedback(`已复制 ${payload.objects.length} 个对象，可切页粘贴。`);
  return payload;
}
function pasteObjects(payload,{duplicate=false,offset=0}={}){
  if(busy||pointer||inline)return;
  const count=payload.objects.length, verb=duplicate?'创建副本':'粘贴';
  if(model.objects.length+count>80){clipboardFeedback(`无法${verb}：一页最多 80 个对象。`);return;}
  const mapping=new Map(payload.objects.map(o=>[o.id,`${o.type}-${crypto.randomUUID()}`]));
  const ids=new Set(mapping.keys());
  const end=p=>p.target?{...p,target:mapping.get(p.target)}:p;
  const objects=fitToPage(payload.objects,ids,canvasSize(),{offset}).map(o=>o.type==='arrow'?
    {...o,id:mapping.get(o.id),from:end(o.from),to:end(o.to)}:{...o,id:mapping.get(o.id)});
  const groups=[...(model.groups??[]),...(payload.groups??[]).map(g=>g.map(id=>mapping.get(id)))];
  select(mapping.values(),false);
  commit({...model,objects:[...model.objects,...objects],...(groups.length?{groups}:{})});
  $('slide').focus({preventScroll:true});
  clipboardFeedback(duplicate?`已创建 ${count} 个对象的副本。`:`已粘贴 ${count} 个对象。`);
}
function pasteCopiedObjects(){
  if(!objectClipboardEntry)return;
  const {payload,page}=objectClipboardEntry;
  pasteObjects(payload,{offset:page===model.id?18:0});
}
action('duplicate',()=>{if(selection.size)pasteObjects(portableSelection(),{duplicate:true,offset:18});});
action('copy-objects',copyObjects);action('paste-objects',pasteCopiedObjects);
action('raise',()=>mutateOrder(1));action('lower',()=>mutateOrder(-1));action('delete',remove);
action('paint',()=>{const o=active();if(o&&o.type!=='arrow'){brush=Object.fromEntries(formatKeys.map(k=>[k,o[k]]));inspector();announce('已取格式。选择另一个对象后点击刷格式。');}});
action('apply-paint',()=>{if(brush&&selection.size&&selectedItems().every(o=>o.type!=='arrow'))update(brush);});
for(const b of toggles)b.onclick=()=>{
  if(b.dataset.toggle==='bold'&&active()?.type==='text'){toggleTextBold(true);return;}
  update({[b.dataset.toggle]:b.getAttribute('aria-pressed')!=='true'});
};
for(const input of props){
  const key=input.dataset.prop, number=input.type==='number'||key==='line';
  const change=()=>{
    if(key==='href'){
      const href=input.value.trim();
      if(href&&(!isSourceURL(href)||!active()?.text.trim())){
        input.setCustomValidity('请输入有效 HTTPS 地址，并保留可见的链接文字。');input.reportValidity();return;
      }
      input.value=href;
      if(href!==(active()?.href??''))update({href},key,input);
      return;
    }
    if(input.type==='color'){applyColor(key,input.value,input);return;}
    if(number&&(input.value===''||!Number.isFinite(Number(input.value))))return;
    const value=number?Number(input.value):input.value;
    if(key==='text'&&active()?.image&&!value.trim())return;
    if(value!==''||key==='text')update({[key]:value},key,input);
  };
  input.addEventListener(input.type==='number'||key==='href'?'change':'input',change);
  if(key==='text')input.addEventListener('blur',()=>{if(active()?.image&&!input.value.trim())inspector();});
  if(key==='href')input.addEventListener('input',()=>input.setCustomValidity(''));
  if(input.type==='number')input.addEventListener('blur',()=>{if(model)inspector();});
}
on('notes','input',e=>{if(!busy)commit({...model,notes:e.target.value},'notes',e.target);});
on('swatch-background','input',e=>applyColor('background',e.target.value,e.target));
on('transparent','change',e=>update({fill:e.target.checked?'transparent':$('object-fields').querySelector('[data-prop=fill]').value}));
const panelKey=side=>`html-studio:panel:${catalog.workspace_key}:${side}`;
const panelSides=['left','right'], sideLimits={left:[150,450],right:[200,480]};
const desktopPanels=matchMedia('(min-width: 821px)'), panelWidths={}, panelBounds={};
let panelResize;
function layoutPanels() {
  const workspace=$('workspace');
  if(!desktopPanels.matches||!workspace.clientWidth)return;
  const css=getComputedStyle(workspace), budget=workspace.clientWidth-340;
  const closed=side=>workspace.classList.contains(`${side}-closed`);
  const widths=Object.fromEntries(panelSides.map(side=>[side,closed(side)?32:clamp(
    panelWidths[side]??parseFloat(css.getPropertyValue(`--${side}-default`)),...sideLimits[side],
  )]));
  // The canvas keeps its minimum share when the viewport shrinks; preferences are not overwritten.
  for(const side of ['right','left'])if(!closed(side)){
    const other=side==='left'?'right':'left';
    widths[side]=Math.max(sideLimits[side][0],Math.min(widths[side],budget-widths[other]));
  }
  for(const [side,other] of [['left','right'],['right','left']]){
    if(closed(side))continue;
    const w=widths[side], min=sideLimits[side][0], max=Math.min(sideLimits[side][1],budget-widths[other]);
    panelBounds[side]={w,min,max};workspace.style.setProperty(`--${side}-width`,`${w}px`);
    const handle=$(`resize-${side}`);
    for(const [attr,value] of Object.entries({min,max,now:w,text:`${w} 像素`}))handle.setAttribute(`aria-value${attr}`,value);
  }
}
function resizePanel(side,w) {
  const {min,max}=panelBounds[side];panelWidths[side]=clamp(w,min,max);layoutPanels();
}
function savePanelWidth(side) {
  if(panelWidths[side]!==undefined)try{localStorage.setItem(panelKey(`${side}:width`),String(panelWidths[side]));}catch{}
}
new ResizeObserver(layoutPanels).observe($('workspace'));
desktopPanels.addEventListener('change',layoutPanels);
for(const side of panelSides){
  const id=`resize-${side}`, sign=side==='left'?1:-1;
  on(id,'pointerdown',e=>{
    if(e.button!==0||!e.isPrimary||panelResize||!panelBounds[side])return;
    e.preventDefault();e.currentTarget.focus({preventScroll:true});
    panelResize={side,id:e.pointerId,x:e.clientX,w:panelBounds[side].w,previous:panelWidths[side]};
    e.currentTarget.dataset.resizing='';e.currentTarget.setPointerCapture(e.pointerId);
  });
  on(id,'pointermove',e=>{
    if(panelResize?.side!==side||panelResize.id!==e.pointerId)return;
    const width=panelResize.w+sign*(e.clientX-panelResize.x);
    if(width!==panelResize.w||panelResize.moved){panelResize.moved=true;resizePanel(side,width);}
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])on(id,type,e=>{
    if(panelResize?.side!==side||panelResize.id!==e.pointerId)return;
    if(type==='pointerup')savePanelWidth(side);
    else {panelWidths[side]=panelResize.previous;layoutPanels();}
    panelResize=null;delete e.currentTarget.dataset.resizing;
  });
  on(id,'keydown',e=>{
    if(e.ctrlKey||e.altKey||e.metaKey||panelResize||!panelBounds[side])return;
    const {w,min,max}=panelBounds[side], step=e.shiftKey?32:8;
    const width={ArrowLeft:w-sign*step,ArrowRight:w+sign*step,Home:min,End:max}[e.key];
    if(width===undefined)return;
    e.preventDefault();resizePanel(side,width);savePanelWidth(side);
  });
}

function setPanel(side,open,persistPreference=true) {
  const b=$(`toggle-${side}`), panel=$(b.getAttribute('aria-controls'));
  if(!open&&panel.contains(document.activeElement))b.focus();
  if(side==='left'&&!open){finishLayerDrag(false);clearPageDrag();}
  panel.hidden=!open;$('workspace').classList.toggle(`${side}-closed`,!open);
  b.setAttribute('aria-expanded',String(open));b.title=(open?'收起':'展开')+(side==='left'?'大纲':'属性');b.setAttribute('aria-label',b.title);
  if(persistPreference)try{localStorage.setItem(panelKey(side),open?'open':'closed');}catch{}
  layoutPanels();
}
for(const side of ['left','right'])action(`toggle-${side}`,()=>setPanel(side,$(`toggle-${side}`).getAttribute('aria-expanded')==='false'));
function restoreOutlineSections() {
  for(const section of ['page-group','layer-group']) {
    const group=$(section), key=panelKey(section);
    try{group.open=localStorage.getItem(key)!=='closed';}catch{}
    group.addEventListener('toggle',()=>{
      if(!group.open&&section==='layer-group')finishLayerDrag(false);
      try{localStorage.setItem(key,group.open?'open':'closed');}catch{}
    });
  }
}
for(const k of ends) {
  on(`${k}-target`,'change',e=>{
    const target=e.target.value,end=active()[k];
    update({[k]:target?{target,side:end.side||(k==='from'?'right':'left')}:endpointPoint(end,model.objects)});
  });
  on(`${k}-side`,'change',e=>update({[k]:{target:active()[k].target,side:e.target.value}}));
  for(const axis of ['x','y'])on(`${k}-${axis}`,'change',e=>{
    const end=active()[k], value=e.target.value;
    if(end.target)return;
    if(value===''){e.target.value=end[axis];return;}
    update({[k]:{...end,[axis]:clamp(Number(value),0,canvasSize()[axis==='x'?'w':'h'])}});
  });
}
function applyColor(prop,color,input=null) {
  if(!model||busy||pointer)return false;
  if(!isHexColor(color)){
    if(input)inspector(); // Restore the current model value without saving or creating undo history.
    return false;
  }
  if(prop==='background')commit({...model,background:color},input?'background':'',input);
  else if(prop==='color'&&active()?.type==='text')applyTextStyle('color',color,{input});
  else update({[prop]:color},input?prop:'',input);
  return true;
}
for(const b of all('[data-pick]'))b.onclick=async()=>{
  if(busy)return;
  const prop=b.dataset.pick,page=model.id,object=selection;
  if(sampling?.prop===prop){sampling=null;canvasHint();return;}
  if(typeof window.EyeDropper==='function')try {
    const {sRGBHex}=await new EyeDropper().open();
    if(!busy&&model.id===page&&selection===object)applyColor(prop,sRGBHex);
    return;
  }catch(e){if(e.name==='AbortError')return;}
  if(!busy&&model.id===page&&selection===object){sampling={prop};canvasHint();announce('画布取色：点击对象取填充、文字或线条色，点击空白取背景色。按 Esc 取消。');}
};
function sampleColor(e) {
  const hit=e.target.closest('[data-edit-id]');
  const o=model.objects.find(n=>n.id===hit?.dataset.editId);
  if(o?.type==='arrow')return o.stroke;
  if(o) {
    const p=canvasPoint(e), w=o.borderWidth||0;
    if(w&&Math.min(p.x-o.x,o.x+o.w-p.x,p.y-o.y,o.y+o.h-p.y)<w)return o.borderColor??borderDefaults.borderColor;
    if(o.fill!=='transparent')return o.fill;
    if(o.text)return o.color;
  }
  return model.background;
}
function canvasPoint(e) {
  const {w:width,h:height}=canvasSize();
  const r=$('slide').getBoundingClientRect();
  return {x:clamp((e.clientX-r.left)/editorScale,0,width),y:clamp((e.clientY-r.top)/editorScale,0,height)};
}
function snapEndpoint(point) {
  const radius=Math.min(65,18/editorScale), candidates=[];
  for(const o of [...model.objects].reverse())if(o.type!=='arrow')for(const side of sides){
    const p=anchorPoint(o,side),dist=Math.hypot(point.x-p.x,point.y-p.y);
    if(dist<=radius*1.6)candidates.push({dist,p,end:{target:o.id,side}});
  }
  const snap=candidates.reduce((best,c)=>c.dist<=radius&&(!best||c.dist<best.dist)?c:best,null);
  $('slide').querySelectorAll('.anchor-hint').forEach(el=>el.remove());
  for(const c of candidates){const el=make('span','anchor-hint'+(c===snap?' snap':''));el.setAttribute('aria-hidden','true');moveHandle(el,c.p);$('slide').append(el);}
  return snap?.end||point;
}
const deltas={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
on('stage','pointerdown',e=>{
  if(!model||previewSource||busy||pointer||e.button!==0||!e.isPrimary||inline)return;
  const slide=$('slide'), stage=e.currentTarget;
  if(!slide.contains(e.target)){
    if(e.target!==stage||sampling||e.pointerType==='touch')return;
    const bounds=stage.getBoundingClientRect();
    if(e.clientX>=bounds.left+stage.clientWidth||e.clientY>=bounds.top+stage.clientHeight)return;
  }
  if(sampling){const value=sampleColor(e),{prop}=sampling;sampling=null;if(applyColor(prop,value))announce('颜色已应用。');canvasHint();return;}
  const obj=e.target.closest('[data-edit-id]'), resize=e.target.closest('.resize'), handle=e.target.closest('[data-end]');
  if(!resize&&!handle){e.preventDefault();slide.focus({preventScroll:true});}
  if(obj&&modifier(e)){selectObject(obj.dataset.editId,true);return;}
  if(obj&&!selection.has(obj.dataset.editId))selectObject(obj.dataset.editId,false);
  const {left,top}=slide.getBoundingClientRect();
  const shared={id:e.pointerId,cx:e.clientX,cy:e.clientY,x:(e.clientX-left)/editorScale,y:(e.clientY-top)/editorScale,started:false};
  if(!obj&&!resize&&!handle){
    pointer={...shared,mode:'marquee',start:{x:shared.x,y:shared.y},add:modifier(e)};
  }else{
    const end=handle?.dataset.end, o=active(), mode=end?'end':resize?'resize':'move';
    const rect=selectionBounds(model.objects,selection);
    if(!rect)return;
    pointer={...shared,o,end,mode,rect,hit:obj?.dataset.editId,point:end?endpointPoint(o[end],model.objects):null,
      nodes:new Map([...slide.querySelectorAll('.object,.selection-item')].map(el=>[el.dataset.selectionId?`outline:${el.dataset.selectionId}`:el.dataset.editId,el]))};
  }
  slide.setPointerCapture(e.pointerId);
});
function marqueeRects(start,{x,y}){
  const {left,top}=$('slide').getBoundingClientRect();
  return {
    preview:rectBetween({x:left+start.x*editorScale,y:top+start.y*editorScale},{x,y}),
    selection:rectBetween(start,{x:(x-left)/editorScale,y:(y-top)/editorScale})
  };
}
on('stage','scroll',()=>{
  if(pointer?.overlay)box(pointer.overlay,marqueeRects(pointer.start,pointer.cursor).preview);
});
on('slide','pointermove',e=>{
  const p=pointer;if(p?.id!==e.pointerId)return;
  const {cx,cy,o,mode,end,point,rect}=p, slide=$('slide');
  if(!p.started&&Math.hypot(e.clientX-cx,e.clientY-cy)<3)return;
  p.started=true;
  if(mode==='marquee'){
    if(!p.overlay){
      p.overlay=make('div','marquee');p.overlay.setAttribute('aria-hidden','true');document.body.append(p.overlay);
    }
    p.cursor={x:e.clientX,y:e.clientY};
    box(p.overlay,marqueeRects(p.start,p.cursor).preview);
    return;
  }
  const {left,top}=slide.getBoundingClientRect(), {w:width,h:height}=canvasSize();
  const dx=(e.clientX-left)/editorScale-p.x, dy=(e.clientY-top)/editorScale-p.y;
  if(end){
    const value=snapEndpoint({x:clamp(point.x+dx,0,width),y:clamp(point.y+dy,0,height)});
    p.objects=model.objects.map(item=>item.id===o.id?{...item,[end]:value}:item);
  }else if(mode==='resize'&&o){
    p.objects=model.objects.map(item=>item.id===o.id?{...o,w:clamp(o.w+dx,24,width-o.x),h:clamp(o.h+dy,24,height-o.y)}:item);
  }else{
    const diagonal=rect.w**2+rect.h**2;
    const change=mode==='resize'?{ratio:diagonal?1+(dx*rect.w+dy*rect.h)/diagonal:1}:{dx,dy};
    p.objects=transformSelection(model.objects,selection,change,rect,canvasSize());
  }
  if(!end){
    for(const item of p.objects)if(item.type!=='arrow'&&selection.has(item.id)){
      const node=p.nodes.get(item.id);
      if(!node)continue;
      if(mode==='move')box(node,item);else Object.assign(node.style,{boxShadow:'none',...objectStyle(item)});
      const outline=p.nodes.get(`outline:${item.id}`);if(outline)box(outline,item);
    }
    const frame=slide.querySelector('.selection');if(frame)box(frame,selectionBounds(p.objects,selection));
  }
  refreshArrows(p.objects);
});
function finishPointer(e,keep){
  const p=pointer;if(p?.id!==e.pointerId)return;
  pointer=null;
  const slide=$('slide');
  if(slide.hasPointerCapture(p.id))slide.releasePointerCapture(p.id);
  if(p.mode==='marquee'){
    p.overlay?.remove();
    if(!keep)return;
    if(p.started||Math.hypot(e.clientX-p.cx,e.clientY-p.cy)>=3){
      const hits=boxHits(model.objects,marqueeRects(p.start,{x:e.clientX,y:e.clientY}).selection);
      select(p.add?[...selection,...hits]:hits);
      announce(`已选中 ${selection.size} 个对象。`);
    }else if(!p.add)select();
    return;
  }
  if(keep&&p.objects&&!same(p.objects,model.objects)){
    commit({...model,objects:p.objects});
    announce(p.mode==='end'?'箭头端点已更新。':p.mode==='resize'?'尺寸已更新。':'位置已更新。');
  }else if(p.started)canvas();
  else if(keep&&p.mode==='move'&&p.hit&&selectGroups(model,[p.hit]).size!==selection.size)select([p.hit]);
}
on('slide','pointercancel',e=>finishPointer(e,false));on('slide','lostpointercapture',e=>finishPointer(e,false));
function editInline() {
  const o=active(); if(!o||o.type==='arrow'||inline||busy||sampling)return;
  const el=make('textarea','inline-editor'); el.value=o.text; el.maxLength=2000;el.setAttribute('aria-label',`编辑对象 ${o.id} 的文本`);
  Object.assign(el.style,objectStyle(o));$('slide').append(el); inline=el;
  el.addEventListener('input',()=>update({text:el.value},'inline',null,false));
  el.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing){el.blur();e.stopPropagation();}});
  el.addEventListener('blur',()=>{inline=null;group='';render();},{once:true});el.focus();el.select();
}
on('slide','dblclick',e=>{if(e.target.closest('[data-edit-id]')) editInline();});
// A stable canvas listener also handles double taps whose DOM targets were replaced by selection.
let lastTap;
on('slide','pointerup',e=>{
  const marquee=pointer?.id===e.pointerId&&pointer.mode==='marquee';
  finishPointer(e,true);
  if(marquee||e.pointerType!=='mouse'||!active()){lastTap=null;return;}
  const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-edit-id]');
  if(!hit||hit.dataset.editId!==active()?.id){lastTap=null;return;}
  if(lastTap?.id===active()?.id&&performance.now()-lastTap.time<420&&Math.hypot(lastTap.x-e.clientX,lastTap.y-e.clientY)<5){lastTap=null;editInline();}
  else lastTap={id:active().id,x:e.clientX,y:e.clientY,time:performance.now()};
});
const textControl=el=>el instanceof Element&&(el.isContentEditable||el.matches('input,textarea,select'));
const objectFocus=el=>el===document.body||$('slide').contains(el)||layerList.contains(el)||$('ribbon').contains(el);
const canUseObjectActions=e=>model&&!previewSource&&!busy&&!inline&&!pointer&&!layerDrag&&!pageDrag&&!sampling&&$('player').hidden&&
  !e.defaultPrevented&&!document.querySelector('dialog[open]')&&!textControl(e.target)&&window.getSelection()?.isCollapsed;
const canEditObjects=e=>canUseObjectActions(e)&&objectFocus(e.target);
// A click on the outline or page controls can retain focus after the destination page loads.
const canUseObjectClipboard=e=>canUseObjectActions(e)&&(objectFocus(e.target)||
  (e.target instanceof Element&&e.target.matches('[data-page],#edit-prev-page,#edit-next-page')));
const objectClipboard='application/x-html-studio-object-v1', selectionClipboard='application/x-html-studio-selection-v2';
document.addEventListener('copy',e=>{
  if(!canUseObjectClipboard(e)||!e.clipboardData)return;
  const payload=copyObjects();if(!payload)return;
  e.clipboardData.setData(selectionClipboard,JSON.stringify(payload));
  if(payload.objects.length===1)e.clipboardData.setData(objectClipboard,JSON.stringify(payload.objects[0]));
  const text=payload.objects.map(o=>o.text).filter(Boolean).join('\n');
  if(text)e.clipboardData.setData('text/plain',text);
  e.preventDefault();
});
document.addEventListener('paste',e=>{
  if(!canUseObjectClipboard(e))return;
  const selectionData=e.clipboardData?.getData(selectionClipboard);
  const raw=selectionData||e.clipboardData?.getData(objectClipboard);
  if(!raw){
    if(objectClipboardEntry){e.preventDefault();pasteCopiedObjects();}
    return;
  }
  if(raw.length>21_000_000)return; // Up to 80 bounded raster objects plus their model fields.
  let payload;
  try{
    const data=JSON.parse(raw);
    payload=selectionData?data:{objects:[data]};
    validate({id:model.id,title:model.title,background:model.background,notes:'',...payload},model.id);
    if(!payload.objects.length)return;
  }catch{return;}
  e.preventDefault();pasteObjects(payload);
});
document.addEventListener('keydown',e=>{
  lastTap=null;
  if(!model||e.defaultPrevented||e.isComposing||document.querySelector('dialog[open]'))return;
  if(!$('player').hidden){playerKey(e);return;}
  if(previewSource){
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s')e.preventDefault();
    if(!textControl(e.target)&&!e.shiftKey&&!e.altKey&&!e.metaKey&&!e.ctrlKey){
      const offset=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0;
      if(offset&&adjacentPage(offset)){e.preventDefault();turnEditorPage(offset);}
    }
    return;
  }
  if(e.key==='Escape'&&pointer){e.preventDefault();finishPointer({pointerId:pointer.id},false);return;}
  if(e.key==='Escape'&&layerDrag){e.preventDefault();finishLayerDrag(false);announce('已取消图层排序。');return;}
  const editing=textControl(e.target);
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();confirmSave();return;}
  if(e.key==='Escape'&&sampling){e.preventDefault();sampling=null;canvasHint();return;}
  if(editing)return;
  if((e.metaKey||e.ctrlKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault(); if(e.shiftKey||e.key.toLowerCase()==='y')timeTravel(future,history);else timeTravel(history,future);return;}
  if(e.key==='Escape'){select();return;}
  // App clipboard paste also works with an empty or inaccessible system clipboard.
  if(!e.altKey&&!e.shiftKey&&(e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='v'&&
    objectClipboardEntry&&canUseObjectClipboard(e)){
    e.preventDefault();pasteCopiedObjects();return;
  }
  if(!canEditObjects(e)||e.altKey)return;
  if(e.metaKey||e.ctrlKey){
    if(e.key.toLowerCase()==='a'){e.preventDefault();select(model.objects.map(o=>o.id));}
    if(e.key.toLowerCase()==='g'){e.preventDefault();groupSelection(!e.shiftKey);}
    return;
  }
  if(!selection.size){
    const offset=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0;
    if(offset&&!e.shiftKey&&!editToolbar.contains(e.target)&&!pageDrag){
      if(adjacentPage(offset)){e.preventDefault();turnEditorPage(offset);}
    }
    return;
  }
  const d=deltas[e.key];
  if(d&&!editToolbar.contains(e.target)){e.preventDefault();const s=e.shiftKey?10:1;transform({dx:d[0]*s,dy:d[1]*s},'nudge');}
  if(e.key==='Backspace'||e.key==='Delete'){e.preventDefault();remove();}
});
let exportAssets;
async function embedFonts() {
  exportAssets??=Promise.all(fontAssets.map(async asset=>{
    const [font,license]=await Promise.all([fetch(`/fonts/${asset[1]}`),fetch(`/fonts/${asset[2]}`)]);
    if(!font.ok||!license.ok)throw new Error('无法读取字体资产，未导出。');
    const blob=await font.blob();
    const url=await new Promise((ok,fail)=>{const reader=new FileReader();reader.onload=()=>ok(reader.result);reader.onerror=()=>fail(reader.error);reader.readAsDataURL(blob);});
    return {face:fontFace(asset,url),license:await license.text()};
  })).catch(e=>{exportAssets=null;throw e;});
  return exportAssets;
}
function exportLocation(label,file){
  $('export-location').hidden=false;
  $('export-label').textContent=label;
  $('export-path').textContent=file;
}
const exportDialog=$('export-dialog');
let choosingExport=false;
const exportTypes={html:'text/html',pdf:'application/pdf'};
function chooseExportDestination(format,filename){
  const pick=$('choose-export-file'), root=$('choose-export-root'), path=$('export-root-choice');
  const downloads=$('choose-export-download'), message=$('export-dialog-status');
  const native=typeof window.showSaveFilePicker==='function';
  $('export-title').textContent=`保存 ${format.toUpperCase()}`;
  pick.hidden=!native;root.hidden=path.hidden=!catalog.export_root;
  path.textContent=catalog.export_root??'';
  message.hidden=true;message.textContent='';exportDialog.returnValue='';
  return new Promise(resolve=>{
    let file,picking=false;
    const cancel=e=>{if(picking)e.preventDefault();};
    exportDialog.addEventListener('cancel',cancel);
    exportDialog.addEventListener('close',()=>{
      pick.onclick=null;exportDialog.removeEventListener('cancel',cancel);
      const choice=exportDialog.returnValue;exportDialog.returnValue='';
      resolve(choice==='file'&&file?{choice,file}:['root','download'].includes(choice)?{choice}:null);
    },{once:true});
    pick.onclick=async()=>{
      if(picking)return;
      picking=true;
      root.disabled=downloads.disabled=$('cancel-export').disabled=true;
      try{
        // Acquire the handle while the click still carries user activation, before collecting/rendering.
        file=await window.showSaveFilePicker({id:'studio-export',suggestedName:filename,
          excludeAcceptAllOption:true,types:[{description:format.toUpperCase(),accept:{[exportTypes[format]]:[`.${format}`]}}]});
        exportDialog.close('file');
      }catch(e){
        if(e.name==='AbortError')exportDialog.close();
        else{message.textContent='无法打开系统保存窗口，请重试或使用其他保存方式。';message.hidden=false;}
      }finally{picking=false;root.disabled=downloads.disabled=$('cancel-export').disabled=false;}
    };
    exportDialog.showModal();
    if(!native)(root.hidden?downloads:root).focus();
  });
}
function addPageRanges(ids,range,pages){
  if(!range.trim())return;
  for(const item of range.split(/[,，、]/)){
    const match=/^\s*(\d+)\s*(?:[-–—－]\s*(\d+)\s*)?$/.exec(item);
    if(!match)throw new Error('页码格式有误，请输入类似 1, 3-5 的范围。');
    const start=Number(match[1]), end=Number(match[2]??match[1]);
    if(start<1||end>pages.length||start>end)throw new Error(`页码须在 1–${pages.length} 之间，范围起点不得大于终点。`);
    for(let n=start;n<=end;n++)ids.add(pages[n-1].id);
  }
}
function chooseExportScope(){
  const dialog=$('select-export-dialog'), list=$('select-export-pages');
  const range=$('select-export-range'), format=$('select-export-format');
  const summary=$('select-export-summary'), next=$('select-export-next');
  const pages=pageList, manifestRevision=catalog.manifest_revision;
  const checks=new Map(), groups=[];
  let pageNumber=0, scope;
  const checkbox=(parent,classes,text)=>{
    const label=make('label',classes), input=make('input');input.type='checkbox';
    label.append(input,make('span','',text));parent.append(label);return input;
  };
  list.replaceChildren();range.value='';format.value='pdf';
  for(const section of catalog.sections){
    const group=make('fieldset'), legend=make('legend','sr',section.title);
    group.append(legend);list.append(group);
    const sectionCheck=checkbox(group,'export-scope-section',`${section.title}（${section.pages.length} 页）`);
    const pageChecks=section.pages.map(page=>{
      const input=checkbox(group,'export-scope-page',`${++pageNumber}. ${page.id===model.id?model.title:page.title}`);
      checks.set(page.id,input);return input;
    });
    sectionCheck.disabled=!pageChecks.length;
    sectionCheck.onchange=()=>{for(const input of pageChecks)input.checked=sectionCheck.checked;};
    groups.push({sectionCheck,pageChecks});
  }
  function refresh(){
    for(const {sectionCheck,pageChecks} of groups){
      const count=pageChecks.filter(input=>input.checked).length;
      sectionCheck.checked=count>0&&count===pageChecks.length;
      sectionCheck.indeterminate=count>0&&!sectionCheck.checked;
    }
    const ids=new Set([...checks].filter(([,input])=>input.checked).map(([id])=>id));
    const outputFormat=format.value;
    let message, invalid=false, rangeInvalid=false;
    scope=null;
    try{addPageRanges(ids,range.value,pages);}
    catch(e){message=e.message;invalid=rangeInvalid=true;}
    if(!invalid){
      const selected=pages.filter(p=>ids.has(p.id));
      if(selected.length>120){invalid=true;message='每次最多导出 120 页，请缩小范围。';}
      else if(!selected.length)message='请选择至少一页。';
      else {
        const kind=outputFormat==='pdf'?'一个 PDF':'一个离线 HTML';
        message=`将按大纲顺序导出 ${selected.length} 页，生成${kind}。`;
        scope={format:outputFormat,pages:selected,manifestRevision};
      }
    }
    summary.textContent=message;summary.toggleAttribute('data-invalid',invalid);
    range.setAttribute('aria-invalid',String(rangeInvalid));next.disabled=!scope;
  }
  function selectOnly(id){
    range.value='';for(const [key,input] of checks)input.checked=key===id;refresh();
  }
  list.onchange=range.oninput=format.onchange=refresh;
  $('select-export-current').onclick=()=>selectOnly(model.id);
  $('select-export-clear').onclick=()=>selectOnly();
  $('select-export-cancel').onclick=()=>dialog.close();
  $('select-export-form').onsubmit=e=>{if(!scope)e.preventDefault();};
  dialog.returnValue='';refresh();
  return new Promise(resolve=>{
    dialog.addEventListener('close',()=>{
      list.onchange=range.oninput=format.onchange=null;
      $('select-export-current').onclick=$('select-export-clear').onclick=$('select-export-cancel').onclick=null;
      $('select-export-form').onsubmit=null;
      list.replaceChildren();
      resolve(dialog.returnValue==='export'?scope:null);
    },{once:true});
    dialog.showModal();
  });
}
async function deliverBlob(blob,filename,destination){
  if(destination.file){
    const writable=await destination.file.createWritable();
    try{await writable.write(blob);await writable.close();}
    catch(e){await writable.abort().catch(()=>{});throw e;}
    return destination.file.name;
  }
  const href=URL.createObjectURL(blob), a=make('a');
  a.href=href;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
  return null;
}
async function exportHTML(snapshot,filename,destination) {
  if(destination.choice==='root'){
    const {file}=await api('/api/html',{method:'POST',body:JSON.stringify(snapshot)});
    return file;
  }
  const assets=await embedFonts();
  const html=renderHTML(snapshot,{embeddedFaces:assets.map(a=>a.face).join('\n'),licenses:assets.map(a=>a.license).join('\n\n')});
  return deliverBlob(new Blob([html],{type:'text/html;charset=utf-8'}),filename,destination);
}
const player=$('player');
let presentSize=pageSize(), pageList, playIndex=0, playTicket=0, viewportFull=false, navigationStatus='', pdfStatus='';
const fitPlayer=()=>{if(!player.hidden)fit($('present-stage'),$('present-frame'),$('present-slide'),presentSize);};
new ResizeObserver(fitPlayer).observe($('present-stage'));
function playStatus(text,channel='navigation') {
  if(channel==='pdf')pdfStatus=text;else navigationStatus=text;
  const message=navigationStatus||pdfStatus;
  const status=$('play-status');
  if(status.textContent!==message)status.textContent=message;
  status.hidden=!message;
}
function syncPlayer() {
  $('play-index').textContent=`${playIndex+1} / ${pageList.length}`;
  $('prev-page').disabled=playIndex===0;$('next-page').disabled=playIndex===pageList.length-1;
}
async function pageSnapshot(id) {
  if(id===model.id)return visiblePage();
  let draft;
  try {
    draft=JSON.parse(localStorage.getItem(tabDraftKey(draftKey(id))));
    if(draft) return validate(draft.model,id);
  } catch { /* A corrupt or inaccessible browser draft must not prevent reading the saved page. */ }
  return (await api(endpoint(id))).model;
}
let pendingReveals=[];
function showReveals(){
  const next=$('reveal-next');
  if(!pendingReveals.length&&document.activeElement===next){
    ($('next-page').disabled?$('close-present'):$('next-page')).focus();
  }
  next.hidden=!pendingReveals.length;
  $('present-stage').toggleAttribute('data-reveals',Boolean(pendingReveals.length));
}
function revealNext(){
  if(!pendingReveals.length)return false;
  const {nodes,effect}=pendingReveals.shift();
  for(const node of nodes){node.removeAttribute('hidden');node.dataset.reveal=effect;}
  showReveals();return true;
}
function showSlide(page) {
  presentSize=pageSize(page.format);
  const old=$('present-slide'), slide=populate(old.cloneNode(false),false,page);
  if(page.transition)slide.dataset.transition=page.transition;else delete slide.dataset.transition;
  slide.setAttribute('aria-label',page.title);
  const byId=new Map([...slide.children].map(node=>[node.dataset.editId,node]));
  pendingReveals=(page.clickReveal??[]).map(revealStep).map(({ids,effect})=>({nodes:ids.map(id=>byId.get(id)),effect}));
  for(const {nodes} of pendingReveals)for(const node of nodes)node.setAttribute('hidden','');
  old.replaceWith(slide);fitPlayer();showReveals();
}

async function turnPage(offset) {
  const next=clamp(playIndex+offset,0,pageList.length-1);
  if(next===playIndex)return;
  playIndex=next;syncPlayer();
  const ticket=++playTicket;
  pendingReveals=[];showReveals();
  playStatus('载入中…');
  try {
    const page=await pageSnapshot(pageList[next].id);
    if(ticket===playTicket){showSlide(page);playStatus('');}
  } catch(e) {
    if(ticket===playTicket){$('present-slide').replaceChildren();playStatus(e.message);}
  }
}
function syncFullscreen() {
  const full=viewportFull||document.fullscreenElement===player, wasFull=player.classList.contains('full');
  player.classList.toggle('full',full);$('fullscreen').setAttribute('aria-pressed',String(full));fitPlayer();
  if(!player.hidden&&full!==wasFull)(full?$('present-stage'):$('fullscreen')).focus();
}
async function toggleFullscreen() {
  if(document.fullscreenElement===player){await document.exitFullscreen().catch(()=>{});return;}
  if(viewportFull){viewportFull=false;syncFullscreen();return;}
  try {
    if(!player.requestFullscreen)throw new Error();
    await player.requestFullscreen();
    if(player.hidden&&document.fullscreenElement===player)await document.exitFullscreen();
  } catch {if(!player.hidden){viewportFull=true;syncFullscreen();}}
}
function closePlayer() {
  ++playTicket;viewportFull=false;pendingReveals=[];showReveals();
  if(document.fullscreenElement===player)void document.exitFullscreen().catch(()=>{});
  player.hidden=true;$('edit-ui').hidden=false;syncFullscreen();$('present').focus();
}
function playerKey(e) {
  if(e.ctrlKey||e.metaKey||e.altKey||e.defaultPrevented)return;
  if(e.key.toLowerCase()==='f'&&!e.repeat){e.preventDefault();void toggleFullscreen();}
  else if(e.key==='Escape'&&document.fullscreenElement!==player){e.preventDefault();if(viewportFull)void toggleFullscreen();else closePlayer();}
  else if(['ArrowLeft','PageUp','ArrowRight','PageDown'].includes(e.key)){e.preventDefault();void turnPage(['ArrowLeft','PageUp'].includes(e.key)?-1:1);}
  else if(e.code==='Space'&&!e.target.closest('button,a[href]')){e.preventDefault();if(!e.repeat&&(e.shiftKey||!revealNext()))void turnPage(e.shiftKey?-1:1);}
}
action('present',()=>{
  if(busy)return;
  inline?.blur();sampling=null;canvasHint();
  playIndex=pageList.findIndex(p=>p.id===model.id);pdfStatus='';playStatus('');
  $('edit-ui').hidden=true;player.hidden=false;
  syncPlayer();showSlide(visiblePage());$('present-stage').focus();
});
action('close-present',closePlayer);
action('reveal-next',revealNext);
action('present-stage',e=>{if(!e.target.closest('a[href]'))revealNext();});
action('prev-page',()=>turnPage(-1));action('next-page',()=>turnPage(1));
action('fullscreen',toggleFullscreen);action('exit-fullscreen',toggleFullscreen);
document.addEventListener('fullscreenchange',syncFullscreen);
const printDeck=$('print-deck');
const printStyle=make('style');document.head.append(printStyle);
async function printPDF(pages) {
  printStyle.textContent=`@media print{${pdfPageCSS(pages)}}`;
  printDeck.replaceChildren(...pages.map(page=>{
    const frame=make('div','pdf-page'), slide=populate(make('div','slide'),false,page);
    frame.dataset.format=pageSize(page.format).format;slide.dataset.pageId=page.id;
    frame.append(slide);return frame;
  }));
  // Force layout so document.fonts.ready includes fonts of the print-only pages.
  document.body.classList.add('printing');void printDeck.offsetHeight;
  await document.fonts.ready;window.print();
}
window.addEventListener('afterprint',()=>{document.body.classList.remove('printing');printDeck.replaceChildren();printStyle.textContent='';});
async function exportPages(format,pages,filename,destination,manifestRevision){
  const models=await Promise.all(pages.map(p=>pageSnapshot(p.id)));
  const viaRoot=destination.choice==='root';
  if(format==='html'&&!viaRoot){
    const assets=await embedFonts();
    const html=renderDeckHTML(models,{title:catalog.title,embeddedFaces:assets.map(a=>a.face).join('\n'),licenses:assets.map(a=>a.license).join('\n\n')});
    return deliverBlob(new Blob([html],{type:'text/html;charset=utf-8'}),filename,destination);
  }
  const query=new URLSearchParams({delivery:viaRoot?'root':'browser'});
  if(manifestRevision)query.set('scope','selected');
  const body=manifestRevision?{models,manifest_revision:manifestRevision}:models;
  const res=await fetch(`/api/${format}?${query}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(format==='pdf'&&destination.choice==='download'&&[413,501,503].includes(res.status)){await printPDF(models);return null;}
  if(!res.ok)throw new Error((await res.json()).error);
  if(viaRoot)return (await res.json()).file;
  return deliverBlob(await res.blob(),filename,destination);
}
async function requestExport(format,{conflictCopy=false,conditional=false}={}){
  if(busy||choosingExport)return;
  inline?.blur();
  let scope, snapshot, filename, destination;
  choosingExport=true;
  try{
    if(conditional){
      scope=await chooseExportScope();
      if(!scope)return;
      format=scope.format;
    }
    if(format==='html'&&(!scope||scope.pages.length===1))snapshot=conflictCopy?model:await pageSnapshot(scope?.pages[0].id??model.id);
    const stem=catalog.title.replace(/[\\/:*?"<>|]/g,'-').slice(0,100)||'slides';
    filename=snapshot?`${snapshot.id}${snapshot===model&&dirty()?'-draft':''}.html`:
      `${stem}${scope?'-选页':''}.${format}`;
    destination=await chooseExportDestination(format,filename);
  }catch(e){banner(e.message);return;}
  finally{choosingExport=false;}
  if(!destination)return;
  const label=format.toUpperCase();
  busy=true;refreshStatus();
  const buttons=['export','edit-export-pdf','export-pdf','save-conflict-copy','select-export'].map($);
  for(const button of buttons)button.disabled=true;
  if(player.hidden)status(`正在导出 ${label}…`);else playStatus(`正在导出 ${label}…`,'pdf');
  try{
    const file=snapshot?await exportHTML(snapshot,filename,destination):
      await exportPages(format,scope?.pages??pageList,filename,destination,scope?.manifestRevision);
    if(file)exportLocation(`已保存 ${label}`,file);
    if(!player.hidden)playStatus(file?`已保存 ${label} · ${file}`:'','pdf');
    announce(file?`已保存 ${label}。`:`${label} 导出已提交。`);
    if(conflictCopy)$('conflict-status').textContent=file?'已另存副本，当前草稿仍保留。':'已发起下载，当前草稿仍保留。请确认下载完成后再丢弃。';
  }catch(e){
    if(conflictCopy)$('conflict-status').textContent=`另存失败，当前草稿仍保留。${e.message}`;
    else if(player.hidden)banner(e.message);else playStatus(e.message,'pdf');
  }finally{
    busy=false;refreshStatus();
    for(const button of buttons)button.disabled=false;
  }
}
action('select-export',()=>requestExport(null,{conditional:true}));
action('export',()=>requestExport('html'));
for(const id of ['edit-export-pdf','export-pdf'])action(id,()=>requestExport('pdf'));
action('cancel-conflict',()=>{if(!busy)$('conflict-dialog').close();});
on('conflict-dialog','cancel',e=>{if(busy)e.preventDefault();});
action('view-conflict-source',async()=>{
  if(busy||!stale)return;
  busy=true;
  const button=$('view-conflict-source');
  button.disabled=true;
  $('conflict-status').textContent='正在读取磁盘版本…';
  try {
    source=await api(endpoint(model.id),{cache:'no-store'});
    diskRevisionKnown=true;
    changeConflictView(true);
  }catch(e){
    diskRevisionKnown=false;
    previewSource=false;
    renderPageVersion();
    $('conflict-status').textContent=`无法读取最新源文件，草稿仍保留。${e.message}`;
  }finally{busy=false;button.disabled=false;refreshStatus();}
});
action('view-conflict-draft',()=>{if(!busy&&stale)changeConflictView(false);});
function changeConflictView(readSource) {
  previewSource=readSource;
  sampling=null; select([],false);
  renderPageVersion();
  $('conflict-dialog').close();
  $('slide').focus({preventScroll:true});
}
action('save-conflict-copy',()=>requestExport('html',{conflictCopy:true}));
action('discard-conflict',()=>{
  if(busy||choosingExport)return;
  $('discard-status').textContent='';$('discard-dialog').showModal();
});
action('cancel-discard',()=>{if(!busy)$('discard-dialog').close();});
on('discard-dialog','cancel',e=>{if(busy)e.preventDefault();});
action('confirm-discard',async()=>{
  if(busy||!stale)return;
  if(await openPage(model.id,{discardDraft:true})){
    $('discard-dialog').close();$('conflict-dialog').close();
    $('slide').focus({preventScroll:true});announce('已丢弃当前草稿并载入最新源文件。');
  }else $('cancel-discard').focus();
});
window.addEventListener('beforeunload',e=>{if(model&&dirty()&&!storageOK){e.preventDefault();e.returnValue='';}});
function changes(before,after) {
  const lines=[]; const show=(v,k)=>k==='image'&&v?`内嵌图片（${v.length} 字符）`:typeof v==='string'?v:JSON.stringify(v);
  const compare=(keys,a,b,label)=>{
    const changed=keys.filter(k=>!same(a[k],b[k]));
    if(changed.length)lines.push(label,...changed.map(k=>`  ${k}\n    − ${show(a[k],k)}\n    + ${show(b[k],k)}`));
  };
  compare(['title','format','background','notes','transition','clickReveal','groups'],before,after,'页面');
  const previousIds=new Set(before.objects.map(o=>o.id)), nextIds=new Set(after.objects.map(o=>o.id));
  const order=(page,retained)=>page.objects.filter(o=>retained.has(o.id)).map(o=>o.id).join(' → ');
  const oldOrder=order(before,nextIds), newOrder=order(after,previousIds);
  if(oldOrder!==newOrder)lines.push(`对象顺序（底 → 顶）\n  − ${oldOrder}\n  + ${newOrder}`);
  for(const o of before.objects)if(!after.objects.some(n=>n.id===o.id))lines.push(`− 删除 ${o.id}`);
  for(const o of after.objects){const old=before.objects.find(n=>n.id===o.id); if(!old)lines.push(`+ 新增 ${o.id} · ${o.text||o.type}`);else compare([...new Set([...Object.keys(old),...Object.keys(o)])],old,o,o.id);}
  return lines.join('\n\n');
}
function openReview(title,diff,label,apply) {
  $('review-title').textContent=title;$('diff').textContent=diff;
  $('approve').disabled=false;$('approve').textContent=label;$('dialog-status').textContent='';reviewAction=apply;
  $('review-dialog').showModal(); $('cancel-review').focus();
}
action('cancel-review',()=>{if(!busy)$('review-dialog').close();});
on('review-dialog','cancel',e=>{if(busy)e.preventDefault();});
action('approve',async()=>{
  const approve=$('approve');
  if(!reviewAction||busy||approve.disabled)return;
  const label=approve.textContent;
  approve.disabled=true;approve.textContent='正在写回…';$('dialog-status').textContent='';
  try {
    const onClose=await reviewAction();
    $('review-dialog').close();
    onClose?.();
  } catch(e){$('dialog-status').textContent=e.message;}
  finally{
    approve.textContent=label;approve.disabled=stale;
    if($('review-dialog').open)(stale?$('cancel-review'):approve).focus({preventScroll:true});
  }
});
async function writeSource() {
  if(stale||!dirty())throw new Error('当前没有可写回的变更。');
  busy=true; $('cancel-review').disabled=true;status('正在写回…');
  try {
    source=await api(endpoint(model.id),{method:'PUT',headers:{'If-Match':`"${source.revision}"`},body:JSON.stringify(model)});
    draftBase=source.revision; draftBaseTime=source.modified_at; persist(); banner();
    return ()=>{
      if(source.context_synced===true)contextStatus('已写回 · 上下文已同步');
      else if(source.context_synced===false)contextStatus('源已写回 · 上下文同步失败，可重试',true);
      else announce('已写回实体 HTML。');
    };
  } catch(e) {
    if(e.status===412){
      stale=true;
      try {
        source=await api(endpoint(model.id),{cache:'no-store'});
        diskRevisionKnown=true;
        previewSource=true;
        sampling=null;select([],false);
      }catch{
        diskRevisionKnown=false;
      }
      renderPageVersion();
    }
    throw e;
  } finally {busy=false;$('cancel-review').disabled=false;refreshStatus();}
}
function confirmSave() {
  if(stale||!dirty()||busy)return;
  openReview('确认写回源文件',changes(source.model,model),'确认写回',writeSource);
}
action('save',confirmSave);
action('sync-context',async()=>{
  if(!model||busy)return;
  busy=true;$('sync-context').dataset.syncing='';refreshStatus();
  try {
    const {changed,pending_count}=await api('/api/context/sync',{method:'POST'});
    contextStatus(`${changed?'已同步':'已是最新'} · ${pending_count?`${pending_count} 页待复核`:'无待复核页'}`);
  } catch(e){contextStatus(`同步失败：${e.message}`,true);}
  finally {busy=false;delete $('sync-context').dataset.syncing;refreshStatus();}
});
try {
  updateCatalog(await api('/api/manifest'));
  if(catalog.studio_version)$('studio-version').textContent=`v${catalog.studio_version}`;
  for(const side of panelSides) {
    let open=true;
    try {
      open=localStorage.getItem(panelKey(side))!=='closed';
      const saved=Number(localStorage.getItem(panelKey(`${side}:width`)));
      if(Number.isFinite(saved)&&saved>0)panelWidths[side]=saved;
    }catch{}
    setPanel(side,open,false);
  }
  restoreOutlineSections();
  await openPage(pageList[0].id);
} catch(e) {banner(e.message);}
