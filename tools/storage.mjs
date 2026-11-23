import {link,lstat,mkdir,readFile,rename,rm,rmdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';

export async function fileState(path) {
  try {
    const entry=await lstat(path);
    if(!entry.isFile())throw new Error('存储目标必须是普通文件。');
    return {text:await readFile(path,'utf8'),mode:entry.mode&0o777};
  }catch(e){if(e.code!=='ENOENT')throw e;return null;}
}

export async function publish(path,text,{immutable=false,expected,onConflict}={}) {
  const current=await fileState(path);
  const check=entry=>{
    if(expected!==undefined&&entry?.text!==expected)throw onConflict?.()??new Error('源文件已变化。');
  };
  check(current);
  if(current?.text===text)return false;
  if(current&&immutable)throw new Error('不可变文件的内容与预期不符；未覆盖。');
  const temp=join(dirname(path),`.write-${randomUUID()}.tmp`);
  try {
    await writeFile(temp,text,{flag:'wx',flush:true,mode:current?.mode??(immutable?0o600:0o666)});
    if(immutable){
      try{await link(temp,path);}catch(e){if(e.code!=='EEXIST'||(await fileState(path))?.text!==text)throw e;return false;}
    }else{
      check(await fileState(path));
      await rename(temp,path);
    }
    return true;
  }finally{await rm(temp,{force:true});}
}

export async function withWriteLock(dir,action,onBusy) {
  const lock=join(dir,'write');
  try{await mkdir(lock);}catch(e){if(e.code==='EEXIST')throw onBusy();throw e;}
  try{return await action();}finally{await rmdir(lock);}
}
