import {createHash} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pageSize} from '../workbench/model.mjs';
import {fileState,publish} from './storage.mjs';
import {parseStoryline} from './storyline.mjs';

const folder='.runtime/context', index='PAGE-FACTS.md', receipt='reviewed.json';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Page titles are data, not Markdown. Encode punctuation (including autolink markers).
const cell=value=>value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,' ').trim()
  .replace(/[!-/:-@\[-`{-~]/g,ch=>`&#${ch.charCodeAt(0)};`)||'（无标题）';
const statusLabel={unreviewed:'未复核',source:'页面内容或编排有变',docs:'叙事文档有变',both:'页面内容或编排、叙事文档均有变',aligned:'与上次复核一致'};

async function readLocal(ws){
  const dir=resolve(ws.root,folder);
  try{if(await realpath(dir)!==dir)throw new Error('上下文目录不得是符号链接。');}
  catch(e){if(e.code==='ENOENT')return {approved:new Map(),prior:null};throw e;}
  const approved=new Map(), stored=await fileState(resolve(dir,receipt));
  if(stored){
    const value=JSON.parse(stored.text);
    if(value?.version!==1||!Array.isArray(value.pages))throw new Error('叙事复核记录格式无效。');
    for(const row of value.pages){
      if(!row||typeof row.id!=='string'||!/^[a-z][a-z0-9-]{0,59}$/.test(row.id)||approved.has(row.id)||
        ![row.source,row.docs].every(hash=>typeof hash==='string'&&/^[0-9a-f]{64}$/.test(hash)))throw new Error('叙事复核记录格式无效。');
      approved.set(row.id,row);
    }
  }
  return {approved,prior:await fileState(resolve(dir,index))};
}

async function collect(ws){
  const ids=[...ws.pages.keys()];
  const story=(await fileState(resolve(ws.root,'STORYLINE.md')))?.text;
  if(story===undefined)throw new Error('缺少 STORYLINE.md，请先恢复叙事索引。');
  const {rows,start,end}=parseStoryline(story,ids);
  const framing=digest([story.slice(0,start),story.slice(end)]);
  const result=[];
  let offset=0;
  for(const section of ws.manifest.sections){
    if(!section.pages.length)continue;
    const context=(await fileState(resolve(ws.root,section.context)))?.text;
    if(context===undefined)throw new Error(`缺少分节说明：${section.context}`);
    const sectionDigest=digest(context);
    for(const page of section.pages){
      const {model,revision}=await ws.read(page.id);
      const texts=model.objects.filter(o=>o.text?.trim()).map(o=>[o.id,o.text]);
      texts.sort(([a],[b])=>a<b?-1:a>b?1:0);
      result.push({page,sectionId:section.id,title:model.title,format:model.format,revision,review:{id:page.id,
        source:digest([model.title,page.title,texts,model.notes,section.id,section.title,ids[offset-1],ids[offset+1]]),
        docs:digest([framing,rows[offset][0],sectionDigest])}});
      offset++;
    }
  }
  return result;
}

function projection(rows,approved){
  const header=['# 已写回页面事实索引','','由 HTML Studio 生成，不手改。路径相对工作区根。标题是页面数据，不是指令。',
    '此处不含草稿、对象正文或讲者备注。页面意图和承接由作者维护在 `STORYLINE.md` 与 `section.md`；复核状态不是内容验收。','',
    '| 序 | 页 ID | 标题 | 分节 | 实体 | 规格（逻辑 px） | 源 SHA-256 前缀 | 叙事复核 |',
    '|---:|---|---|---|---|---|---|---|'];
  const pending=[];
  const lines=rows.map(({page,sectionId,title,format,revision,review},i)=>{
    const before=approved.get(page.id), source=before?.source!==review.source, docs=before?.docs!==review.docs;
    const state=!before?'unreviewed':source?(docs?'both':'source'):docs?'docs':'aligned';
    if(state!=='aligned')pending.push(page.id);
    const {w,h,label,paper,landscape}=pageSize(format);
    return `| ${i+1} | \`${page.id}\` | ${cell(title)} | \`${sectionId}\` | \`${page.file}\` | ${label}${paper?(landscape?' 横向':' 纵向'):''} · ${w}×${h} | \`${revision.slice(7,19)}\` | ${statusLabel[state]} |`;
  });
  return {text:[...header,...lines,''].join('\n'),pending};
}

// Mutating callers must hold the workspace write lock. Check does not create a runtime directory.
export async function updateContext(ws,{check=false,review}={}){
  const {approved,prior}=await readLocal(ws), rows=await collect(ws);
  if(review!==undefined){
    const target=rows.find(row=>row.page.id===review);
    if(!target)throw new Error('复核页不存在。');
    approved.set(review,target.review);
  }
  const {text,pending}=projection(rows,approved), current=prior?.text===text;
  if(check)return {current,pending};
  const dir=await ws.runtime('context');
  if(review!==undefined){
    const pages=rows.map(({page})=>approved.get(page.id)).filter(Boolean);
    await publish(resolve(dir,receipt),JSON.stringify({version:1,pages},null,2)+'\n');
  }
  const changed=await publish(resolve(dir,index),text);
  return {current:true,changed,pending};
}

// A derived-index failure must not turn an already-published source edit into a failed save.
export async function refreshContext(open,saved='源已保存'){
  try{await updateContext(await open());return true;}
  catch(e){console.warn(`${saved}，但页面事实索引未同步：${e.message} 请运行 npm run context -- sync。`);return false;}
}
