import {randomUUID} from 'node:crypto';
import {link,lstat,mkdir,readFile,realpath,rm,stat,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fontAssets,fontFace} from '../workbench/model.mjs';
import {httpError,revision} from './workspace.mjs';

export async function publishExport(path,bytes,verifyRoot){
  const dir=dirname(path);
  if(verifyRoot)await verifyRoot();else await mkdir(dir,{recursive:true});
  const temp=join(dir,`.export-${randomUUID()}.tmp`);
  try{
    await writeFile(temp,bytes,{flag:'wx',flush:true});
    if(verifyRoot)await verifyRoot();
    await link(temp,path); // A completed file appears at its final name only if that name is free.
  }finally{await rm(temp,{force:true});}
}

// A missing marker can mean another process is still writing. Never repair or remove an existing directory here.
async function readPublishedHTMLFile(dest,name){
  const path=join(dest,name);
  try{
    if((await lstat(path)).isFile())return await readFile(path);
  }catch(e){
    if(!['ENOENT','ENOTDIR','EISDIR'].includes(e.code)){
      throw new Error(`无法检查导出目录 ${dest}：读取 ${name} 失败。${e.message}`,{cause:e});
    }
  }
  throw new Error(`目标目录未通过完整性检查：${name} 缺失或不是常规文件。请另选目录：${dest}`);
}

export async function publishHTMLDirectory(dest,files,index){
  const marker='export-manifest.json', listing=Buffer.from(JSON.stringify(index,null,2)+'\n');
  await mkdir(dirname(dest),{recursive:true});
  try{await mkdir(dest);}catch(e){
    if(e.code!=='EEXIST')throw e;
    if(!(await lstat(dest)).isDirectory())throw new Error(`导出目标已存在且不是目录，请另选目录：${dest}`);
    if(!(await readPublishedHTMLFile(dest,marker)).equals(listing)){
      throw new Error(`目标目录的完成清单与本次导出不一致，请另选目录：${dest}`);
    }
    for(const {path,sha256} of index.files){
      if(revision(await readPublishedHTMLFile(dest,path))!==sha256){
        throw new Error(`目标目录未通过完整性检查：${path} 的哈希不匹配。请另选目录：${dest}`);
      }
    }
    return false;
  }
  let name;
  try{
    for(const [file,data] of files){name=file;await publishExport(join(dest,name),data);}
    name=marker;
    await publishExport(join(dest,marker),listing); // Only publish the marker after every asset and page is in place.
    return true;
  }catch(e){
    throw new Error(`HTML 导出中断：${dest}\n写入 ${name} 时失败：${e.message}\n目标目录可能含未完成文件，未自动清理；请另选目录重试。`,{cause:e});
  }
}

export async function openExportRoot(path){
  const dir=await realpath(path).catch(()=>{throw new Error('导出根目录不存在；请先创建目录。');});
  const initial=await stat(dir);
  if(!initial.isDirectory())throw new Error('导出根目录必须是目录。');
  async function verify(){
    const current=await lstat(dir).catch(()=>null);
    if(!current?.isDirectory()||current.dev!==initial.dev||current.ino!==initial.ino||await realpath(dir).catch(()=>null)!==dir){
      throw httpError(409,'导出根目录已移动或替换，请确认后重新启动工作台。');
    }
  }
  return {dir,async save(stem,extension,bytes){
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const path=join(dir,`${stem}-${stamp}-${randomUUID()}.${extension}`);
    try{await publishExport(path,bytes,verify);}catch(e){
      if(e.status)throw e;
      throw httpError(503,'无法保存到导出根目录，请检查权限和可用空间。');
    }
    return path;
  }};
}

export async function embeddedFonts(root,{licenses=false,block=false}={}){
  const assets=await Promise.all(fontAssets.map(async asset=>{
    const data=await readFile(join(root,'workbench','fonts',asset[1]));
    const face=fontFace(asset,`data:font/woff2;base64,${data.toString('base64')}`);
    return {face:block?face.replace('font-display:swap','font-display:block'):face,
      license:licenses?await readFile(join(root,'workbench','fonts',asset[2]),'utf8'):''};
  }));
  return {embeddedFaces:assets.map(a=>a.face).join('\n'),licenses:assets.map(a=>a.license).join('\n\n')};
}
