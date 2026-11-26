import {constants} from 'node:fs';
import {link,lstat,mkdir,open,rename,rm,rmdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';

export async function fileState(path) {
  try {
    if(!(await lstat(path)).isFile())throw new Error('存储目标必须是普通文件。');
    const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    try {
      const entry=await file.stat();
      if(!entry.isFile())throw new Error('存储目标必须是普通文件。');
      return {text:await file.readFile('utf8'),mode:entry.mode&0o777,modifiedAt:entry.mtime.toISOString()};
    }finally{await file.close();}
  }catch(e){if(e.code!=='ENOENT')throw e;return null;}
}

export async function publish(path,text,{immutable=false,expected,onConflict,includeModifiedAt=false}={}) {
  const current=await fileState(path);
  const check=entry=>{
    if(expected!==undefined&&entry?.text!==expected)throw onConflict?.()??new Error('源文件已变化。');
  };
  check(current);
  if(current?.text===text)return includeModifiedAt?{modifiedAt:current.modifiedAt}:false;
  if(current&&immutable)throw new Error('不可变文件的内容与预期不符；未覆盖。');
  const temp=join(dirname(path),`.write-${randomUUID()}.tmp`);
  try {
    await writeFile(temp,text,{flag:'wx',flush:true,mode:current?.mode??(immutable?0o600:0o666)});
    const modifiedAt=includeModifiedAt?(await lstat(temp)).mtime.toISOString():null;
    if(immutable){
      try{await link(temp,path);}catch(e){if(e.code!=='EEXIST'||(await fileState(path))?.text!==text)throw e;return false;}
    }else{
      check(await fileState(path));
      await rename(temp,path);
    }
    return includeModifiedAt?{modifiedAt}:true;
  }finally{await rm(temp,{force:true});}
}

export async function withWriteLock(dir,action,onBusy) {
  const lock=join(dir,'write');
  try{await mkdir(lock);}catch(e){if(e.code==='EEXIST')throw onBusy();throw e;}
  try{return await action();}finally{await rmdir(lock);}
}
