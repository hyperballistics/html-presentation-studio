import {randomUUID} from 'node:crypto';
import {mkdir,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileState,publish} from './storage.mjs';
import {parseStoryline} from './storyline.mjs';
import {refreshContext} from './context.mjs';
import {httpError,openWorkspace,revision} from './workspace.mjs';
import {defaults,pageSize,renderHTML,THEME} from '../workbench/model.mjs';

const newPageModel=(id,title,format)=>({id,title,background:THEME.paper,notes:'',...(format?{format}:{}),objects:[
  {...defaults,id:'page-heading',type:'text',x:70,y:60,w:pageSize(format).w-140,h:100,text:title,size:54,color:THEME.title,bold:true},
]});
const pageIds=manifest=>manifest.sections.flatMap(section=>section.pages.map(page=>page.id));
function reorderStoryline(text,previous,next,newPage) {
  const {rows,start,end,newline}=parseStoryline(text,previous);
  const byId=new Map(rows.map(m=>[m[1],m[0]]));
  if(newPage){
    const title=newPage.title.replaceAll('&','&amp;').replaceAll('|','&#124;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    byId.set(newPage.id,`| \`${newPage.id}\` | ${title} | 新建页，待补叙事作用和承接。 |`);
  }
  return text.slice(0,start)+next.map(id=>byId.get(id)).join(newline)+text.slice(end);
}

export const changeOutline=(workspace,match,body)=>writeOutline(workspace,match,body);
export function addPageWithId(workspace,section,id,title) {
  if(typeof id!=='string'||!/^[a-z][a-z0-9-]{0,59}$/.test(id))throw httpError(400,'页面 ID 无效。');
  return writeOutline(workspace,undefined,{op:'add-page',section,title},id);
}

async function writeOutline(workspace,match,body,explicitId) {
  const conflict=()=>httpError(412,'大纲或叙事索引已更新，未覆盖。请刷新工作台后重试。');
  return workspace.locked(async()=>{
    const ws=await openWorkspace(workspace.root);
    if(!explicitId&&match!==`"${revision(ws.manifestText)}"`)throw conflict();
    const manifest=JSON.parse(ws.manifestText), previous=pageIds(manifest), op=body?.op;
    const section=manifest.sections.find(s=>s.id===body?.section);
    if(!['add-section','rename-section','remove-section','add-page','move-page'].includes(op))throw httpError(400,'大纲操作无效。');
    if(op!=='add-section'&&!section)throw httpError(404,'分节不存在。');
    let title, added, inheritedFormat, newSection, affected=section?.id;
    if(['add-section','rename-section','add-page'].includes(op)){
      title=typeof body.title==='string'?body.title.trim():'';
      if(!title||title.length>80||/[\x00-\x1f\x7f]/.test(title))throw httpError(400,'名称须为 1–80 字，不能换行。');
    }
    switch(op){
      case 'add-section': {
        affected=`section-${randomUUID()}`;
        newSection={id:affected,title,context:`sections/${affected}/section.md`,pages:[]};
        manifest.sections.push(newSection);break;
      }
      case 'rename-section': if(section.title===title)return {workspace:ws,affected};else {section.title=title;break;}
      case 'remove-section':
        if(section.pages.length)throw httpError(409,'只能移除空分节。');
        manifest.sections.splice(manifest.sections.indexOf(section),1);break;
      case 'add-page': {
        const id=explicitId??`page-${randomUUID()}`;
        const file=`sections/${section.id}/pages/${id}.html`;
        const existing=ws.pages.get(id);
        if(existing){
          if(!explicitId||existing.file!==file||existing.title!==title)throw httpError(409,'页面 ID 已被占用。');
          return {workspace:ws,affected:id,created:false};
        }
        const neighbor=section.pages.at(-1)?.id??previous[0];
        inheritedFormat=(await ws.read(neighbor)).model.format;
        added={id,title,file};
        section.pages.push(added);affected=id;break;
      }
      case 'move-page': {
        const from=section.pages.findIndex(p=>p.id===body.page), to=section.pages.findIndex(p=>p.id===body.target);
        if(from<0||to<0||typeof body.after!=='boolean')throw httpError(400,'只支持在同一分节内拖动页面。');
        affected=body.page;
        const index=to+Number(body.after)-Number(from<to);
        if(from===to||index===from)return {workspace:ws,affected};
        const [page]=section.pages.splice(from,1);section.pages.splice(index,0,page);break;
      }
    }
    const history=await ws.runtime('history');
    const backup=(kind,text,extension)=>publish(resolve(history,`${kind}.${revision(text).slice(7)}.${extension}`),text,{immutable:true});
    const storylinePath=resolve(ws.root,'STORYLINE.md');
    let story, nextStory;
    if(op==='add-page'||op==='move-page'){
      story=(await fileState(storylinePath))?.text;
      if(!story)throw httpError(409,'缺少 STORYLINE.md，未更新页码。');
      nextStory=reorderStoryline(story,previous,pageIds(manifest),added);
      await backup('storyline',story,'md');
    }
    await backup('manifest',ws.manifestText,'json');
    if(newSection){
      const sections=resolve(ws.root,'sections'), dir=resolve(sections,newSection.id);
      if(await realpath(sections)!==sections)throw httpError(409,'分节目录已变化。');
      await mkdir(dir);await mkdir(resolve(dir,'pages'));
      await publish(resolve(ws.root,newSection.context),'# 分节说明\n',{immutable:true});
    }
    if(added){
      const pages=resolve(ws.root,'sections',section.id,'pages');
      if(await realpath(pages)!==pages)throw httpError(409,'页面目录已变化。');
      const target=resolve(ws.root,added.file), html=renderHTML(newPageModel(added.id,title,inheritedFormat));
      // An identical unregistered page can be adopted on a CLI retry; never replace other bytes.
      await publish(target,html,{immutable:true});
      if((await fileState(target))?.text!==html)throw conflict();
    }
    if(nextStory!==undefined)await publish(storylinePath,nextStory,{expected:story,onConflict:conflict});
    try {await publish(ws.manifestPath,JSON.stringify(manifest,null,2)+'\n',{expected:ws.manifestText,onConflict:conflict});}
    catch(e){
      if(nextStory!==undefined)await publish(storylinePath,story,{expected:nextStory,onConflict:conflict});
      throw e;
    }
    const next=await openWorkspace(ws.root);
    return {workspace:next,affected,created:!!added,context_synced:await refreshContext(()=>next)};
  });
}
