import {pageSize,endpointPoint,styleLimits} from './model.mjs';

const limit=(v,min,max)=>Math.min(max,Math.max(min,v));
const int=(v,min,max)=>Math.round(limit(v,min,max));
export const rectBetween = (a,b) => ({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)});
const line = (o,objects) => [endpointPoint(o.from,objects),endpointPoint(o.to,objects)];
const bounds = (o,objects) => o.type==='arrow'?rectBetween(...line(o,objects)):o;
export function selectionBounds(objects,ids){
  const selected=objects.filter(o=>ids.has(o.id)).map(o=>bounds(o,objects));
  if(!selected.length)return null;
  const x=Math.min(...selected.map(r=>r.x)),y=Math.min(...selected.map(r=>r.y));
  return {x,y,w:Math.max(...selected.map(r=>r.x+r.w))-x,h:Math.max(...selected.map(r=>r.y+r.h))-y};
}

// Existing groups move as units unless the selection consists of exactly one group.
export function alignmentUnits(model,ids){
  const groups=(model.groups??[]).filter(g=>g.every(id=>ids.has(id)));
  const units=groups.length===1&&groups[0].length===ids.size?[]:groups.map(g=>new Set(g));
  const grouped=new Set(units.flatMap(unit=>[...unit]));
  for(const id of ids)if(!grouped.has(id))units.push(new Set([id]));
  return units.map(unit=>new Set(model.objects.filter(o=>unit.has(o.id)&&
    (o.type!=='arrow'||[o.from,o.to].every(p=>!p.target||unit.has(p.target)))).map(o=>o.id))).filter(unit=>unit.size);
}
const alignment={left:['x','w',0],center:['x','w',.5],right:['x','w',1],top:['y','h',0],middle:['y','h',.5],bottom:['y','h',1]};
export function alignSelection(model,ids,mode){
  if(!Object.hasOwn(alignment,mode))return model.objects;
  const units=alignmentUnits(model,ids);
  if(units.length<2)return model.objects;
  const [axis,size,ratio]=alignment[mode];
  const frames=units.map(unit=>selectionBounds(model.objects,unit));
  const start=Math.min(...frames.map(r=>r[axis])), end=Math.max(...frames.map(r=>r[axis]+r[size]));
  const moves=new Map();
  units.forEach((unit,i)=>{
    const r=frames[i], delta=Math.round(start+(end-start-r[size])*ratio-r[axis]);
    if(delta)for(const id of unit)moves.set(id,delta);
  });
  const move=(p,delta)=>({...p,[axis]:p[axis]+delta});
  return moves.size?model.objects.map(o=>{
    const delta=moves.get(o.id);
    if(!delta)return o;
    if(o.type!=='arrow')return move(o,delta);
    return {...o,from:o.from.target?o.from:move(o.from,delta),to:o.to.target?o.to:move(o.to,delta)};
  }):model.objects;
}

// Clip the segment to both axes; the SVG overlay itself covers the entire slide.
function segmentHits([a,b],r){
  let lo=0,hi=1;
  for(const [axis,size] of [['x','w'],['y','h']]){
    const d=b[axis]-a[axis], start=r[axis]-a[axis], end=start+r[size];
    if(!d){if(start>0||end<0)return false;continue;}
    lo=Math.max(lo,Math.min(start/d,end/d));hi=Math.min(hi,Math.max(start/d,end/d));
    if(lo>hi)return false;
  }
  return true;
}
export function boxHits(objects,r){
  return objects.filter(o=>o.type==='arrow'?segmentHits(line(o,objects),r):
    o.x<r.x+r.w&&o.x+o.w>r.x&&o.y<r.y+r.h&&o.y+o.h>r.y).map(o=>o.id);
}

// Keep all freely positioned parts in bounds; attached endpoints follow their target even when it is not selected.
export function transformSelection(objects,ids,{dx=0,dy=0,ratio=1}={},frame=selectionBounds(objects,ids),size=pageSize()){
  const {w:width,h:height}=size;
  if(!frame)return objects;
  let min=0;
  for(const o of objects)if(ids.has(o.id)&&o.type!=='arrow')min=Math.max(min,24/o.w,24/o.h);
  const max=Math.min(frame.w?(width-frame.x)/frame.w:Infinity,frame.h?(height-frame.y)/frame.h:Infinity);
  const s=limit(ratio,Math.max(.01,min),max);
  const x=int(frame.x+dx,0,width-Math.round(frame.w*s)),y=int(frame.y+dy,0,height-Math.round(frame.h*s));
  return mapSelection(objects,ids,frame,size,s,x,y);
}

// A page-format change fits the content from the paper’s top-left corner. A paste fits just
// the copied group, preserves its offset when possible, and relocates free endpoints.
export function fitToPage(objects,ids,size,{frame=selectionBounds(objects,ids),offset=0}={}){
  if(!frame)return objects;
  const {w,h}=size, s=Math.min(1,frame.w?w/frame.w:1,frame.h?h/frame.h:1);
  return mapSelection(objects,ids,frame,size,s,int(frame.x+offset,0,w-Math.round(frame.w*s)),int(frame.y+offset,0,h-Math.round(frame.h*s)));
}
function mapSelection(objects,ids,frame,{w:width,h:height},s,x,y){
  if(s===1&&x===frame.x&&y===frame.y)return objects;
  const px=n=>x+Math.round((n-frame.x)*s),py=n=>y+Math.round((n-frame.y)*s);
  const end=p=>p.target?p:{x:px(p.x),y:py(p.y)};
  return objects.map(o=>{
    if(!ids.has(o.id))return o;
    if(o.type==='arrow')return {...o,from:end(o.from),to:end(o.to),strokeWidth:int(o.strokeWidth*s,1,styleLimits.strokeWidth)};
    const left=px(o.x),top=py(o.y),w=Math.max(24,px(o.x+o.w)-left),h=Math.max(24,py(o.y+o.h)-top);
    const next={...o,x:Math.min(left,width-w),y:Math.min(top,height-h),w,h,
      size:int(o.size*s,10,160),inset:int(o.inset*s,0,80),radius:int(o.radius*s,0,styleLimits.radius)};
    if(o.borderWidth!==undefined)next.borderWidth=int(o.borderWidth*s,0,styleLimits.borderWidth);
    return next;
  });
}
