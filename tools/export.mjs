import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {basename,extname,join,resolve} from 'node:path';
import {lstat,readFile} from 'node:fs/promises';
import {publishExport,publishHTMLDirectory} from './export-files.mjs';
import {openWorkspace,revision} from './workspace.mjs';
import {exportPDF} from './pdf.mjs';
import {fontAssets,fontFace,renderHTML} from '../workbench/model.mjs';

const usage='用法：npm run export -- html|pdf --out <HTML目录或PDF文件> [--page <页ID>]';

try{
  const {positionals:[format,...extra],values}=parseArgs({allowPositionals:true,options:{out:{type:'string'},page:{type:'string'}}});
  if(!['html','pdf'].includes(format)||extra.length||!values.out?.trim()||(format==='pdf'&&extname(values.out).toLowerCase()!=='.pdf'))throw new Error(usage);
  const dest=resolve(process.env.INIT_CWD||process.cwd(),values.out);
  const workspace=await openWorkspace(fileURLToPath(new URL('..',import.meta.url)));
  const ids=values.page!==undefined?[values.page]:[...workspace.pages.keys()];
  if(format==='pdf'&&ids.length>120)throw new Error('此演示超过 120 页；请用 --page 分页导出。');
  const pages=await Promise.all(ids.map(id=>workspace.read(id)));
  if(await readFile(workspace.manifestPath,'utf8')!==workspace.manifestText||
     (await Promise.all(ids.map(id=>workspace.read(id)))).some((page,i)=>page.revision!==pages[i].revision))throw new Error('采集期间维护源变化，请重试。');
  if(format==='pdf'){
    try{await lstat(dest);throw new Error('导出目标已存在；请另选 PDF 文件名。');}catch(e){if(e.code!=='ENOENT')throw e;}
    const bytes=await exportPDF(workspace.root,pages.map(page=>page.model));
    await publishExport(dest,bytes);
    console.log(`PDF · ${pages.length} 页 · ${dest}`);
  }else{
    const files=new Map(), faces=fontAssets.map(asset=>fontFace(asset,`fonts/${asset[1]}`)).join('\n');
    for(const {page,model} of pages)files.set(`${page.id}.html`,renderHTML({...model,notes:''},{embeddedFaces:faces}));
    for(const name of new Set(fontAssets.flatMap(([,font,license])=>[font,license])))files.set(`fonts/${name}`,await readFile(join(workspace.root,'workbench','fonts',name)));
    const index={format:'html-pages-v1',title:workspace.manifest.title,pages:pages.map(({page})=>({id:page.id,title:page.title,file:`${page.id}.html`})),files:[...files].map(([path,data])=>({path,sha256:revision(data)}))};
    const written=await publishHTMLDirectory(dest,files,index);
    console.log(`HTML${written?'':' 未改写'} · ${pages.length} 页 · ${dest}`);
  }
}catch(e){console.error(e.code==='EEXIST'?`目标 ${basename(e.path||'')} 已存在；未覆盖。`:e.message);process.exitCode=1;}
