import {fileURLToPath} from 'node:url';
import {openWorkspace} from './workspace.mjs';
import {parseStoryline} from './storyline.mjs';
import {readFile} from 'node:fs/promises';
import {fontAssets} from '../workbench/model.mjs';
const root=new URL('..',import.meta.url);
const workspace=await openWorkspace(fileURLToPath(root));
const storyline=await readFile(new URL('STORYLINE.md',root),'utf8');
parseStoryline(storyline,[...workspace.pages.keys()]);
for(const id of workspace.pages.keys()){
  const {model,revision}=await workspace.read(id);
  console.log(`${id} · ${model.objects.length} 对象 · ${revision.slice(7,15)}`);
}
for(const [,filename,license] of fontAssets){
  const font=await readFile(new URL(`workbench/fonts/${filename}`,root));
  const text=await readFile(new URL(`workbench/fonts/${license}`,root),'utf8');
  if(font.subarray(0,4).toString()!=='wOF2'||!text.includes('OPEN FONT LICENSE'))throw new Error(`字体或许可证无效：${filename}`);
}
console.log(`check pass · ${workspace.pages.size} 页；清单、叙事索引、实体模型、静态投影、字体文件检查通过。`);
