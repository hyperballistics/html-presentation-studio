import {fileURLToPath} from 'node:url';
import {readdir,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {openWorkspace,revision} from './workspace.mjs';
import {parseStoryline} from './storyline.mjs';
import {refreshContext} from './context.mjs';
import {fileState,publish} from './storage.mjs';
import {readHTML,renderHTML} from '../workbench/model.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const nameValid=name=>typeof name==='string'&&/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name);
const hashValid=hash=>typeof hash==='string'&&/^sha256:[0-9a-f]{64}$/.test(hash);
const usage='用法：npm run history -- checkpoint <名称> | list | verify <名称> | restore <名称> <页ID> <当前sha256:…>';

async function inspectDir(workspace,sub){
  const dir=resolve(workspace.root,'.runtime',sub);
  try{if(await realpath(dir)!==dir)throw new Error('备份目录不得是符号链接。');return dir;}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function verifyBytes(dir,file,hash){
  if(!hashValid(hash))throw new Error('检查点版本无效。');
  const data=(await fileState(resolve(dir,file)))?.text;
  if(data===undefined||revision(data)!==hash)throw new Error(`备份缺失或损坏：${file}`);
  return data;
}
function blob(prefix,hash,suffix){
  if(!hashValid(hash))throw new Error('检查点版本无效。');
  return `${prefix}.${hash.slice(7)}.${suffix}`;
}
async function verifyCheckpoint(workspace,name){
  const dir=await inspectDir(workspace,'checkpoints'), history=await inspectDir(workspace,'history');
  const raw=dir&&(await fileState(resolve(dir,`${name}.json`)))?.text;
  if(!raw||!history)throw new Error('检查点或备份目录不存在。');
  const {created_at,...data}=JSON.parse(raw), {digest,...snapshot}=data;
  if(snapshot.version!==1||revision(JSON.stringify(snapshot))!==digest)throw new Error('检查点索引校验失败。');
  const manifest=JSON.parse(await verifyBytes(history,blob('manifest',snapshot.manifest,'json'),snapshot.manifest));
  await verifyBytes(history,blob('storyline',snapshot.storyline,'md'),snapshot.storyline);
  const pages=manifest.sections.flatMap(section=>section.pages), contexts=manifest.sections.map(section=>section.context);
  const records=new Map(snapshot.pages.map(page=>[page.id,page]));
  if(pages.length!==records.size||records.size!==snapshot.pages.length||contexts.length!==snapshot.contexts.length)throw new Error('检查点清单和索引不一致。');
  const models=new Map();
  for(const page of pages){
    const match=records.get(page.id);
    if(!/^[a-z][a-z0-9-]{0,59}$/.test(page.id)||match?.file!==page.file)throw new Error('检查点页路径不一致。');
    const html=await verifyBytes(history,blob(page.id,match.revision,'html'),match.revision);
    models.set(page.id,{html,file:page.file});
  }
  for(const [index,entry] of snapshot.contexts.entries()){
    if(entry.file!==contexts[index])throw new Error('检查点章节路径不一致。');
    await verifyBytes(history,blob('context',entry.revision,'md'),entry.revision);
  }
  return {data:{created_at,...data},models};
}

try{
  const [mode,name,id,expected,...extra]=process.argv.slice(2);
  const workspace=mode==='checkpoint'||mode==='restore'?await openWorkspace(root):{root:await realpath(root)};
  if(mode==='checkpoint'&&nameValid(name)&&id===undefined){
    await workspace.locked(async()=>{
      const ws=await openWorkspace(root), manifest=JSON.parse(ws.manifestText);
      const pkg=JSON.parse((await fileState(resolve(ws.root,'package.json'))).text);
      const history=await ws.runtime('history'), dir=await ws.runtime('checkpoints');
      const storylinePath=resolve(ws.root,'STORYLINE.md'), storyline=(await fileState(storylinePath))?.text;
      if(storyline===undefined)throw new Error('STORYLINE.md 不存在。');
      parseStoryline(storyline,[...ws.pages.keys()]);
      const snapshot={version:1,package_version:pkg.version,manifest:revision(ws.manifestText),storyline:revision(storyline),contexts:[],pages:[]};
      await publish(resolve(history,blob('storyline',snapshot.storyline,'md')),storyline,{immutable:true});
      await publish(resolve(history,blob('manifest',snapshot.manifest,'json')),ws.manifestText,{immutable:true});
      const inputs=[[ws.manifestPath,ws.manifestText],[storylinePath,storyline]];
      for(const section of manifest.sections){
        const path=resolve(ws.root,section.context), text=(await fileState(path)).text;
        if(await realpath(path)!==path)throw new Error('上下文不得通过符号链接备份。');
        const hash=revision(text);
        snapshot.contexts.push({file:section.context,revision:hash});
        inputs.push([path,text]);
        await publish(resolve(history,blob('context',hash,'md')),text,{immutable:true});
      }
      for(const page of ws.pages.values()){
        const current=await ws.read(page.id);
        snapshot.pages.push({id:page.id,file:page.file,revision:current.revision});
        inputs.push([page.full,current.html]);
        await ws.backup(current);
      }
      for(const [path,text] of inputs){if(await realpath(path)!==path||(await fileState(path))?.text!==text)throw new Error('保存检查点时维护源变化，未发布索引；请重试。');}
      const path=resolve(dir,`${name}.json`), digest=revision(JSON.stringify(snapshot));
      const prior=await fileState(path);
      if(prior){
        const verified=await verifyCheckpoint(ws,name);
        if(verified.data.digest!==digest)throw new Error('检查点名称已被使用；请换新名称。');
        console.log(`检查点已存在：${name} · ${digest}`);
      }else{
        await publish(path,JSON.stringify({created_at:new Date().toISOString(),digest,...snapshot},null,2)+'\n',{immutable:true});
        console.log(`检查点已保存：${name} · ${digest}`);
      }
      if(await refreshContext(()=>ws,'检查点已保存'))console.log('页面事实索引已同步。');
    });
  }else if(mode==='verify'&&nameValid(name)&&id===undefined){
    console.log(JSON.stringify((await verifyCheckpoint(workspace,name)).data,null,2));
  }else if(mode==='list'&&name===undefined){
    const dir=await inspectDir(workspace,'checkpoints'), history=await inspectDir(workspace,'history');
    const entries=dir?(await readdir(dir,{withFileTypes:true})).filter(e=>e.isFile()&&e.name.endsWith('.json')).map(e=>e.name.slice(0,-5)).sort():[];
    const objects=history?(await readdir(history,{withFileTypes:true})).filter(e=>e.isFile()&&/\.[0-9a-f]{64}\.(html|json|md)$/.test(e.name)):[];
    console.log(JSON.stringify({checkpoints:entries,history_objects:objects.length},null,2));
  }else if(mode==='restore'&&nameValid(name)&&id&&hashValid(expected)&&!extra.length){
    const {models}=await verifyCheckpoint(workspace,name);
    const version=models.get(id), current=await workspace.read(id);
    if(!version||version.file!==current.page.file)throw new Error('检查点无法映射到当前实体页；结构恢复需要单独审核。');
    const model=readHTML(version.html,id);
    if(renderHTML(model)!==version.html)throw new Error('检查点和当前渲染版本不兼容；请用对应的发行包恢复。');
    const result=await workspace.save(id,`"${expected}"`,model);
    console.log(`已恢复 ${id} · ${result.revision}`);
  }else throw new Error(usage);
}catch(e){console.error(e.message);process.exitCode=1;}
