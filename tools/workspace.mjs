import {readFile,mkdir,realpath} from 'node:fs/promises';
import {resolve, relative, sep, isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {pageSize, readHTML, renderHTML} from '../workbench/model.mjs';
import {fileState,publish,withWriteLock} from './storage.mjs';
import {refreshContext} from './context.mjs';

export const revision = html => 'sha256:'+createHash('sha256').update(html).digest('hex');
export const httpError = (status,message) => Object.assign(new Error(message),{status});
export async function openWorkspace(directory) {
  const root = await realpath(directory);
  const manifestPath=resolve(root,'deck.manifest.json');
  const manifestText=(await fileState(manifestPath))?.text;
  const manifest=JSON.parse(manifestText);
  const pages = new Map();
  const paths = new Set();
  const sectionIds = new Set();
  const slug = x=>typeof x==='string' && /^[a-z0-9][a-z0-9-]{0,59}$/.test(x);
  const inside = full => { const rel=relative(root,full); return rel && rel!=='..' && !rel.startsWith('..'+sep) && !isAbsolute(rel); };
  if (manifest.version!==1 || typeof manifest.title!=='string' || !Array.isArray(manifest.sections) || !manifest.sections.length) throw new Error('manifest 无效。');
  for (const section of manifest.sections) {
    if (!slug(section.id) || sectionIds.has(section.id) || typeof section.title!=='string' || section.context!==`sections/${section.id}/section.md` || !Array.isArray(section.pages)) throw new Error('章节配置无效。');
    sectionIds.add(section.id);
    const contextPath=await realpath(resolve(root,section.context));
    if (!inside(contextPath)) throw new Error('章节上下文不能指向工作区之外。');
    for (const page of section.pages) {
      if (!slug(page.id) || !/^[a-z]/.test(page.id) || typeof page.title!=='string' || page.file!==`sections/${section.id}/pages/${page.id}.html` || pages.has(page.id)) throw new Error('页面路径、ID 或标题无效。');
      const full=resolve(root,page.file);
      if (!inside(full) || paths.has(full) || await realpath(full)!==full) throw new Error('页面重复或指向工作区之外。');
      paths.add(full);
      pages.set(page.id,{...page,full,context:section.context});
    }
  }
  if (!pages.size) throw new Error('manifest 至少需要一页。');
  async function read(id) {
    const page=pages.get(id);
    if (!page) throw httpError(404,'页面不存在。');
    if(await realpath(page.full)!==page.full)throw new Error('页路径已变化，不能通过符号链接读写。');
    const {text:html,modifiedAt}=(await fileState(page.full))??{};
    const model=readHTML(html,id);
    return {page,html,model,revision:revision(html),modifiedAt};
  }
  async function runtime(sub) {
    const base=resolve(root,'.runtime'), path=resolve(base,sub);
    await mkdir(base,{recursive:true});
    if (await realpath(base)!==base) throw new Error('运行目录不能是符号链接。');
    await mkdir(path,{recursive:true});
    if (await realpath(path)!==path) throw new Error('运行子目录不能是符号链接。');
    return path;
  }
  const locked=async action=>withWriteLock(await runtime('locks'),action,()=>httpError(409,'工作区正在写入，稍后重试。'));
  const conflict=()=>httpError(412,'源页面已更新；草稿保留，未覆盖源文件。');
  async function historyPath(id,base) {
    if(!pages.has(id)||!/^sha256:[0-9a-f]{64}$/.test(base))throw new Error('备份页 ID 或版本无效。');
    return resolve(await runtime('history'),`${id}.${base.slice(7)}.html`);
  }
  async function backup(current) {
    return publish(await historyPath(current.page.id,current.revision),current.html,{immutable:true});
  }
  async function historical(id,base) {
    if(!pages.has(id)||!/^sha256:[0-9a-f]{64}$/.test(base))throw new Error('备份页 ID 或版本无效。');
    const dir=resolve(root,'.runtime','history');
    const path=resolve(dir,`${id}.${base.slice(7)}.html`);
    const saved=await fileState(path);
    if(!saved)return null;
    if(await realpath(dir)!==dir||revision(saved.text)!==base)throw new Error('备份路径或内容校验失败。');
    return saved.text;
  }
  async function save(id, match, model) {
    return locked(async()=>{
      const current=await read(id), full=current.page.full;
      if(model?.id!==id)throw httpError(400,'模型页面 ID 不匹配。');
      const html=renderHTML(model);
      if(match!==`"${current.revision}"`){
        const base=/^"(sha256:[0-9a-f]{64})"$/.exec(match)?.[1];
        if(html!==current.html||!base||!await historical(id,base))throw conflict();
        return current;
      }
      if(html===current.html)return current;
      await backup(current);
      if(await realpath(full)!==full)throw conflict();
      const {modifiedAt}=await publish(full,html,{expected:current.html,onConflict:conflict,includeModifiedAt:true});
      const context_synced=await refreshContext(()=>openWorkspace(root));
      return {...current,html,model,revision:revision(html),modifiedAt,context_synced};
    });
  }
  const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
  async function task(id,body) {
    return locked(async()=>{
      const current=await read(id), {page,model}=current;
      if (body?.base_revision!==current.revision) throw httpError(412,'源文件已变化，不能基于旧版本创建任务。');
      const object=model.objects.find(o=>o.id===body.edit_id);
      if (!object || typeof body.goal!=='string' || !body.goal.trim() || body.goal.length>2000) throw httpError(400,'请选择一个已写回对象并填写 1–2000 字的修改目标。');
      const {w,h}=pageSize(model.format);
      const fields={version:1,page_id:id,base_revision:current.revision,edit_id:object.id,goal:body.goal.trim(),source:page.file,section_context:page.context,object,...(model.format?{page_size:{width:w,height:h}}:{})};
      const key=revision(JSON.stringify(fields)).slice(7,39).replace(/^(........)(....)(....)(....)/,'$1-$2-$3-$4-');
      const path=resolve(await runtime('requests'),`${key}.json`);
      const existing=await fileState(path);
      if(existing){
        const {id:stored,created_at,...data}=JSON.parse(existing.text);
        if(stored!==key||typeof created_at!=='string'||JSON.stringify(data)!==JSON.stringify(fields))throw new Error('已存请求内容校验失败。');
        return JSON.parse(existing.text);
      }
      const task={id:key,created_at:new Date().toISOString(),...fields};
      await publish(path,JSON.stringify(task,null,2)+'\n',{immutable:true});
      return task;
    });
  }
  async function getTask(id) {
    if (!uuid.test(id)) throw httpError(404,'未找到本地任务。');
    const path=resolve(root,'.runtime','requests',`${id}.json`);
    try {
      if (await realpath(path)!==path) throw httpError(404,'未找到本地任务。');
      return JSON.parse(await readFile(path,'utf8'));
    } catch(e) { if(e.code==='ENOENT') throw httpError(404,'未找到本地任务。'); throw e; }
  }
  return {root,manifestPath,manifestText,manifest:{...manifest,workspace_key:revision(root)},pages,read,save,task,getTask,runtime,locked,backup,historical};
}
