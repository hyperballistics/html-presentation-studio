import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,mkdir,rm,readdir,stat,realpath,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {makeServer} from './serve.mjs';
import {publishHTMLDirectory} from './export-files.mjs';
import {exportPDF} from './pdf.mjs';
import {openWorkspace,revision} from './workspace.mjs';
import {updateContext} from './context.mjs';
import {proposalFor,renderHTML,renderPDFSource,readHTML,defaults,THEME,arrowGeometry,withoutObject,withoutObjects,fontAssets,validate,selectGroups,regroup,setReveal,revealStep,isHexColor,pageSize,pageFormats} from '../workbench/model.mjs';
import {selectionBounds,boxHits,transformSelection,fitToPage} from '../workbench/selection.mjs';
const id='p01-fixture', section='01-test', folder=`sections/${section}`, name=`${folder}/pages/${id}.html`;
const original={id,title:'Fixture',background:THEME.paper,notes:'',objects:[{...defaults,id:'hero-title',type:'text',x:70,y:70,text:'测试页'}]};
const source=renderHTML(original);
const pngData='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZi8AAAAASUVORK5CYII=';
const rasterObject={...defaults,id:'test-image',type:'rect',x:60,y:160,w:100,h:100,text:'照片说明 <示例>',image:pngData};
const manifest={version:1,title:'Fixture',sections:[{id:section,title:'Fixture',context:`${folder}/section.md`,pages:[{id,title:'Fixture',file:name}]}]};
const story=`# Fixture\n\n| Page | Content | Role |\n|---|---|---|\n| \`${id}\` | A | First page |\n`;
const facts='.runtime/context/PAGE-FACTS.md';

test('canonical HTML renders safe literal text and rejects projection drift',()=>{
  const model=structuredClone(original), o=model.objects[0];
  o.text='</script><img src=x onerror=alert(1)>\n测试';
  const html=renderHTML(model);
  assert.equal(html.includes('<img src'),false);
  assert.deepEqual(readHTML(html,id),model);
  assert.throws(()=>readHTML(html.replace('class="slide"','class="fake"'),id),/生成契约/);
  model.objects.push(o);assert.throws(()=>renderHTML(model),/重复/);
});

test('print document uses ordered projections, retains text, and omits notes and controls',()=>{
  const first={...original,notes:'PRIVATE SPEAKER NOTES'};
  const second={...original,id:'p02-fixture',objects:[{...original.objects[0],text:'第二页 <img src=x>'}]};
  const html=renderPDFSource([first,second],'');
  assert.match(html,/@page\{size:1280px 720px;margin:0/);
  assert.equal((html.match(/class="pdf-page"/g)||[]).length,2);
  assert.ok(html.indexOf('p01-fixture')<html.indexOf('p02-fixture'));
  assert.match(html,/第二页 &lt;img src=x&gt;/);
  assert.doesNotMatch(html,/PRIVATE SPEAKER NOTES|<img|<script|<button/);
});

test('page formats round-trip, enforce box and endpoint bounds, and preserve mixed PDF paper sizes',()=>{
  const a5=pageSize('a5'), b4=pageSize('b4-landscape');
  assert.deepEqual([a5.width,a5.height,a5.paper],[148,210,'mm']);
  assert.deepEqual([b4.width,b4.height,b4.paper],[353,250,'mm']);
  assert.deepEqual([pageSize('jis-b4').width,pageSize('jis-b4').height],[257,364]);
  assert.ok(pageFormats.filter(([, ,unit])=>unit).flatMap(([,items])=>items).length>10);
  const model={...original,format:'a5',objects:[...original.objects,
    {id:'axis',type:'arrow',from:{target:'hero-title',side:'left'},to:{x:a5.w,y:a5.h},stroke:'#065FA9',strokeWidth:4}]};
  const entity=renderHTML(model);
  assert.deepEqual(readHTML(entity,id),model);
  assert.match(entity,new RegExp(`viewBox="0 0 ${a5.w} ${a5.h}"`));
  assert.match(entity,new RegExp(`width:${a5.w}px;height:${a5.h}px`));
  assert.throws(()=>validate({...model,format:'custom'}),/页面尺寸/);
  assert.throws(()=>validate({...model,objects:[{...model.objects[0],x:a5.w}]}),/超出画布/);
  assert.throws(()=>validate({...model,objects:[model.objects[0],{...model.objects[1],to:{x:a5.w+1,y:a5.h}}]}),/端点/);
  const pdf=renderPDFSource([model,{...original,format:'b4-landscape'},original],'');
  assert.match(pdf,/@page studio-a5\{size:148mm 210mm;margin:0\}/);
  assert.match(pdf,/@page studio-b4-landscape\{size:353mm 250mm;margin:0\}/);
  assert.deepEqual([...pdf.matchAll(/<div class="pdf-page" data-format="([^"]+)"/g)].map(m=>m[1]),['a5','b4-landscape','wide']);
});

test('fit content and copied groups to a smaller format without losing links or leaving the page',()=>{
  const target=pageSize('a6');
  const base=[{...original.objects[0],x:100,y:95,w:820,h:320},
    {id:'axis',type:'arrow',from:{target:'hero-title',side:'right'},to:{x:1280,y:720},stroke:'#065FA9',strokeWidth:4},
    {...original.objects[0],id:'tiny',x:1256,y:696,w:24,h:24}];
  const ids=new Set(base.map(o=>o.id));
  const format='a6', objects=fitToPage(base,ids,target,{frame:{x:0,y:0,w:1280,h:720}});
  assert.deepEqual(objects[1].from,base[1].from);
  assert.equal(objects[1].to.x,target.w);
  assert.equal(objects[2].w,24);
  assert.equal(validate({...original,format,objects}).objects.length,3);
  const pasted=fitToPage(base,ids,target,{offset:18});
  validate({...original,format,objects:pasted});
  validate({...original,format,objects:transformSelection(pasted,ids,{dx:800,dy:800},undefined,target)});
});

test('proposal is scoped and typed',()=>{
  const obj=original.objects.find(o=>o.id==='hero-title');
  const task={id:'task',page_id:id,edit_id:obj.id,base_revision:'base'};
  const proposal=set=>({version:1,request_id:'task',page_id:id,base_revision:'base',edits:[{edit_id:obj.id,set}]});
  const {model}=proposalFor(original,proposal({text:'一个场景，一个指标'}),task);
  assert.equal(model.objects.find(o=>o.id===obj.id).text,'一个场景，一个指标');
  assert.notEqual(obj.text,'一个场景，一个指标');
  assert.throws(()=>proposalFor(original,proposal({x:2000}),task),/画布/);
  assert.throws(()=>proposalFor(original,proposal({html:'<b>'}),task),/越界/);
  assert.throws(()=>proposalFor(original,proposal({href:'https://example.org/'}),task),/越界/);
  assert.throws(()=>proposalFor(original,proposal({text:'a'}),{...task,edit_id:'different'}),/越界/);
  assert.throws(()=>proposalFor(original,proposal({text:'a'}),{...task,base_revision:'changed'}),/版本/);
});

const arrow={id:'connector',type:'arrow',from:{target:'hero-title',side:'right'},to:{x:830,y:380},stroke:'#065FA9',strokeWidth:4};
test('shape styling preserves legacy page bytes; anchors follow geometry and detach without jumping',()=>{
  assert.deepEqual(readHTML(source,id),original);
  assert.equal(renderHTML(readHTML(source,id)),source);
  const o={...original.objects[0],type:'rect',font:'han',color:'#112233',radius:125,borderColor:'#AE0D1B',borderWidth:4};
  const model={...original,objects:[o,arrow]};
  assert.deepEqual(arrowGeometry(arrow,model.objects).from,{x:370,y:106});
  const resized={...model,objects:[{...o,x:200,h:100},arrow]};
  const point={x:500,y:120};
  assert.deepEqual(arrowGeometry(arrow,resized.objects).from,point);
  const detached=withoutObject(resized,o.id);
  assert.deepEqual(detached.objects[0].from,point);
  const html=renderHTML(model);
  assert.match(html,/inset 0 0 0 4px #AE0D1B/);
  assert.match(html,/data-edit-id="connector"/);
  assert.deepEqual(readHTML(html,id),model);
  assert.throws(()=>renderHTML({...original,objects:[{...o,borderWidth:-1}]}),/边框/);
  assert.throws(()=>renderHTML({...original,objects:[{...arrow,from:{target:'connector',side:'right'}}]}),/锚点/);
  const task={id:'arrow-task',page_id:id,edit_id:arrow.id,base_revision:'base'};
  const proposal=set=>({version:1,request_id:task.id,page_id:id,base_revision:'base',edits:[{edit_id:arrow.id,set}]});
  assert.deepEqual(proposalFor(model,proposal({to:{target:o.id,side:'top'}}),task).model.objects[1].to,{target:o.id,side:'top'});
  assert.throws(()=>proposalFor(model,proposal({fill:'#FFFFFF'}),task),/越界/);
  assert.throws(()=>proposalFor(model,proposal({from:{target:'does-not-exist',side:'top'}}),task),/锚点/);
});

test('page animations round-trip without hiding static output; deleting an object removes its cue',()=>{
  const model={...original,transition:'fade',clickReveal:[arrow.id,'hero-title'],objects:[...original.objects,arrow]};
  const html=renderHTML(model);
  assert.deepEqual(readHTML(html,id),model);
  for(const projection of [html,renderPDFSource([model],'')]){
    assert.match(projection,/data-edit-id="hero-title"/);
    assert.match(projection,/data-edit-id="connector"/);
    assert.doesNotMatch(projection,/\s(?:hidden|aria-hidden)=|page-fade|click-fade/);
  }
  const one=withoutObject(model,arrow.id);
  assert.deepEqual(one.clickReveal,['hero-title']);
  assert.equal(Object.hasOwn(withoutObject(one,'hero-title'),'clickReveal'),false);
  assert.throws(()=>renderHTML({...model,transition:'spin'}),/切换动画/);
  for(const clickReveal of [[],['other-page-object'],['hero-title','hero-title'],null]){
    assert.throws(()=>renderHTML({...model,clickReveal}),/点击动画/);
  }
});

test('flat groups expand selection without changing layer order and prune metadata on delete',()=>{
  const second={...original.objects[0],id:'second',x:420,y:180};
  const base={...original,objects:[original.objects[0],arrow,second]};
  const model=regroup(base,new Set(['second','hero-title']),true);
  assert.deepEqual(model.groups,[['hero-title','second']]);
  assert.deepEqual([...selectGroups(model,['second'])],['second','hero-title']);
  assert.equal(model.objects,base.objects);
  assert.deepEqual(readHTML(renderHTML(model),id),model);
  assert.throws(()=>validate({...model,groups:[['second'],['hero-title','second']]}),/组合/);
  assert.throws(()=>validate({...model,groups:[['absent','second']]}),/组合/);
  assert.throws(()=>validate({...model,objects:[...model.objects,{...second,id:'fourth'}],groups:[['second','hero-title'],['second','fourth']]}),/组合/);
  const trimmed=withoutObjects(model,new Set(['hero-title']));
  assert.equal(Object.hasOwn(trimmed,'groups'),false);
  assert.deepEqual(trimmed.objects[0].from,{x:370,y:106});
  assert.deepEqual(regroup(model,new Set(['second','hero-title']),false),base);
});

test('shared transforms resize text and shape geometry from a common origin and preserve arrow anchors',()=>{
  const left={...original.objects[0],x:100,y:100,w:100,h:80,borderWidth:4};
  const right={...left,id:'second',x:300,y:200};
  const line={...arrow,to:{target:right.id,side:'left'}};
  const base={...original,objects:[left,right,line]};
  const ids=new Set(base.objects.map(o=>o.id));
  assert.deepEqual(selectionBounds(base.objects,ids),{x:100,y:100,w:300,h:180});
  const moved=transformSelection(base.objects,ids,{dx:50,dy:60});
  assert.deepEqual([moved[0].x,moved[0].y,moved[1].x,moved[1].y],[150,160,350,260]);
  assert.deepEqual(moved[2],line);
  const scaled=transformSelection(base.objects,ids,{ratio:1.5});
  assert.deepEqual([scaled[0].w,scaled[0].h,scaled[0].size,scaled[0].borderWidth,scaled[1].x],[150,120,45,6,400]);
  assert.deepEqual(arrowGeometry(scaled[2],scaled).to,{x:400,y:310});
  assert.equal(arrowGeometry(scaled[2],scaled).from.x,250);
  for(const options of [{ratio:0},{dx:-9999,dy:-9999},{ratio:100,dx:9999,dy:9999}]){
    validate({...base,objects:transformSelection(base.objects,ids,options)});
  }
  assert.deepEqual(boxHits(base.objects,{x:225,y:163,w:7,h:10}),[line.id]);
  assert.deepEqual(boxHits(base.objects,{x:209,y:202,w:10,h:10}),[]);
});

test('one click can reveal a selection; changing, splitting and deleting cues preserves other steps',()=>{
  const second={...original.objects[0],id:'second',x:340};
  const base={...original,transition:'slide',objects:[original.objects[0],arrow,second],clickReveal:['hero-title',arrow.id]};
  const both=new Set(['hero-title','second']);
  const model=setReveal(base,both,'rise');
  assert.deepEqual(model.clickReveal,[arrow.id,{ids:['hero-title','second'],effect:'rise'}]);
  const changed=setReveal(model,both,'zoom');
  assert.deepEqual(changed.clickReveal,[arrow.id,{ids:['hero-title','second'],effect:'zoom'}]);
  assert.deepEqual(setReveal(changed,new Set(['second']),'').clickReveal.map(revealStep),[
    {ids:[arrow.id],effect:'fade'},{ids:['hero-title'],effect:'zoom'}]);
  assert.deepEqual(withoutObjects(changed,both).clickReveal,[arrow.id]);
  assert.throws(()=>validate({...model,clickReveal:[model.clickReveal[1],'second']}),/点击动画/);
  assert.throws(()=>validate({...model,clickReveal:[{ids:['second'],effect:'spin'}]}),/点击动画/);
  assert.deepEqual(readHTML(renderHTML(changed),id),changed);
  assert.doesNotMatch(renderPDFSource([changed],''),/data-(?:transition|reveal)=|aria-hidden=/);
});

test('loopback API: task receipt, guarded atomic write, competing writer 412, backup and static route allowlist',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'html-studio-'));
  await mkdir(join(dir,folder,'pages'),{recursive:true});
  await writeFile(join(dir,folder,'section.md'),'fixture');
  await writeFile(join(dir,name),source);
  await writeFile(join(dir,'deck.manifest.json'),JSON.stringify(manifest));
  await writeFile(join(dir,'STORYLINE.md'),story);
  await mkdir(join(dir,'workbench')); await writeFile(join(dir,'workbench','index.html'),'fixture');
  const server=await makeServer(dir); server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${server.address().port}`, url=`${origin}/api/pages/${id}`;
  const catalog=await (await fetch(`${origin}/api/manifest`)).json();
  const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(catalog.studio_version,version);assert.equal(catalog.version,manifest.version);
  const get=await fetch(url), etag=get.headers.get('etag');
  assert.match(get.headers.get('content-security-policy'),/img-src 'self' data:/);
  const info=await get.json();assert.equal(info.file,name);assert.equal(info.absolute_file,await realpath(join(dir,name)));assert.equal(etag,`"${info.revision}"`);
  const hdr={'Content-Type':'application/json',Origin:origin};
  const pdf=(models,originHeader=origin)=>fetch(`${origin}/api/pdf`,{method:'POST',headers:{...hdr,Origin:originHeader},body:JSON.stringify(models)});
  assert.equal((await pdf([info.model],'https://elsewhere.invalid')).status,403);
  assert.equal((await pdf([])).status,400);
  assert.equal((await pdf([{...info.model,id:'other-page'}])).status,400);
  const request=await fetch(`${url}/requests`,{method:'POST',headers:hdr,body:JSON.stringify({base_revision:info.revision,edit_id:'hero-title',goal:'精简示例'})});
  assert.equal(request.status,201);const task=await request.json();
  assert.deepEqual(await (await fetch(`${origin}/api/requests/${task.id}`)).json(),task);
  const sameRequest=await fetch(`${url}/requests`,{method:'POST',headers:hdr,body:JSON.stringify({goal:task.goal,edit_id:task.edit_id,base_revision:task.base_revision})});
  assert.equal(sameRequest.status,201);assert.deepEqual(await sameRequest.json(),task);
  assert.equal((await readdir(join(dir,'.runtime','requests'))).length,1);
  assert.deepEqual(JSON.parse(await readFile(join(dir,'.runtime','requests',task.id+'.json'),'utf8')),task);
  assert.equal((await fetch(`${origin}/.runtime/requests/${task.id}.json`)).status,404);
  const put=(model,overrides={})=>fetch(url,{method:'PUT',headers:{...hdr,'If-Match':etag,...overrides},body:JSON.stringify(model)});
  assert.equal((await put(info.model,{Origin:'https://elsewhere.invalid'})).status,403);
  assert.equal((await put(info.model,{'If-Match':''})).status,428);
  assert.equal((await put({...info.model,background:'url(https://example.invalid)'})).status,400);
  const sync=(site=origin)=>fetch(`${origin}/api/context/sync`,{method:'POST',headers:{Origin:site}});
  assert.equal((await sync('https://elsewhere.invalid')).status,403);
  await assert.rejects(stat(join(dir,facts)),{code:'ENOENT'});
  const ws=await openWorkspace(dir);
  await ws.locked(async()=>assert.equal((await sync()).status,409));
  for(const changed of [true,false]){
    const res=await sync();assert.equal(res.status,200);
    assert.deepEqual(await res.json(),{changed,pending_count:1});
  }
  assert.equal(await readFile(join(dir,name),'utf8'),source);
  assert.equal(await readFile(join(dir,'STORYLINE.md'),'utf8'),story);
  assert.deepEqual(await readdir(join(dir,'.runtime','context')),['PAGE-FACTS.md']);
  await writeFile(join(dir,'STORYLINE.md'),'# Misaligned');
  assert.equal((await sync()).status,409);
  await writeFile(join(dir,'STORYLINE.md'),story);
  const models=['first','second'].map(label=>({...info.model,notes:label,objects:[
    {...info.model.objects[0],text:`— ${label}`,href:`https://example.org/${label}`},arrow,rasterObject]}));
  const receipts=await Promise.all(models.map(m=>put(m)));
  assert.deepEqual(receipts.map(r=>r.status).sort(),[200,412]);
  const winner=receipts.findIndex(r=>r.status===200), html=await readFile(join(dir,name),'utf8');
  assert.equal(html,renderHTML(models[winner]));
  assert.equal((await receipts[winner].json()).context_synced,true);
  assert.match(await readFile(join(dir,facts),'utf8'),/16:9 · 1280×720/);
  assert.equal((await fetch(`${origin}/${facts}`)).status,404);
  const mtime=(await stat(join(dir,name))).mtimeMs;
  assert.equal((await put(models[winner])).status,200);
  assert.equal((await stat(join(dir,name))).mtimeMs,mtime);
  assert.equal((await readdir(join(dir,'.runtime','history'))).length,1);
  assert.equal(await readFile(join(dir,'.runtime','history',`${id}.${info.revision.slice(7)}.html`),'utf8'),source);
  assert.equal((await fetch(`${url}/requests`,{method:'POST',headers:hdr,body:JSON.stringify({base_revision:info.revision,edit_id:'hero-title',goal:'旧请求'})})).status,412);
});

test('configured export writes standalone drafts to the selected directory without replacing files or source',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'html-studio-export-'));
  const root=join(dir,'项目'), dest=join(dir,'交付 目录');
  await mkdir(join(root,folder,'pages'),{recursive:true});
  await writeFile(join(root,folder,'section.md'),'fixture');
  await writeFile(join(root,name),source);
  await writeFile(join(root,'deck.manifest.json'),JSON.stringify(manifest));
  await mkdir(join(root,'workbench','fonts'),{recursive:true});
  for(const [,font,license] of fontAssets){
    await writeFile(join(root,'workbench','fonts',font),'fixture');
    await writeFile(join(root,'workbench','fonts',license),'fixture license');
  }
  await assert.rejects(makeServer(root,{exportRoot:dest}),/目录不存在/);
  await mkdir(dest);
  const server=await makeServer(root,{exportRoot:dest});
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  const post=(model,site=origin)=>fetch(`${origin}/api/html`,{method:'POST',headers:{Origin:site,'Content-Type':'application/json'},body:JSON.stringify(model)});
  const absDest=await realpath(dest);
  assert.equal((await (await fetch(`${origin}/api/manifest`)).json()).export_root,absDest);
  const draft={...original,transition:'fade',clickReveal:['hero-title'],objects:[{...original.objects[0],text:'未写回的草稿'},rasterObject]};
  assert.equal((await post(draft,'https://elsewhere.invalid')).status,403);
  assert.equal((await post({...draft,clickReveal:['absent']})).status,400);
  assert.equal((await post({...draft,id:'../escape'})).status,404);
  const outputs=await Promise.all([post(draft),post(draft)]);
  assert.deepEqual(outputs.map(r=>r.status),[201,201]);
  const [a,b]=await Promise.all(outputs.map(async r=>(await r.json()).file));
  assert.notEqual(a,b);
  assert.deepEqual((await readdir(dest)).map(file=>join(absDest,file)).sort(),[a,b].sort());
  const bytes=await readFile(a,'utf8');
  assert.match(bytes,/data:font\/woff2;base64,/);
  assert.match(bytes,/fixture license/);
  assert.match(bytes,/未写回的草稿/);
  assert.ok(bytes.includes(`<img src="${pngData}" alt="照片说明 &lt;示例&gt;"`));
  assert.equal(bytes,await readFile(b,'utf8'));
  assert.equal(source,await readFile(join(root,name),'utf8'));
  await rename(dest,`${dest}-old`);
  await mkdir(dest);
  assert.equal((await post(draft)).status,409);
  assert.deepEqual(await readdir(dest),[]);
});

test('hex colors are shared with the editor and the ID whitelist stays in force',()=>{
  for(const background of ['#Ab01fF','#000000']){
    assert.equal(isHexColor(background),true);
    assert.equal(readHTML(renderHTML({...original,background}),id).background,background);
  }
  for(const background of ['#abc','#11223344','red','color(display-p3 1 0 0)','#123456 ',null]){
    assert.equal(isHexColor(background),false);
    assert.throws(()=>validate({...original,background}),/页面属性/);
  }
  assert.throws(()=>validate({...original,objects:[{...original.objects[0],id:'hero-title" ]'}]}),/对象字段/);
});

test('CLI HTML directory publishing diagnoses incomplete, different and obstructed output without replacing files',async t=>{
  const root=await mkdtemp(join(tmpdir(),'html-studio-cli-dest-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const dest=join(root,'交付 目录'), marker=join(dest,'export-manifest.json');
  const files=new Map([['fixture.html','page'],['fonts/fixture.woff2','font']]);
  const index={format:'html-pages-v1',title:'Fixture',files:[...files].map(([path,bytes])=>({path,sha256:revision(bytes)}))};
  assert.equal(await publishHTMLDirectory(dest,files,index),true);
  const before=await stat(marker);
  assert.equal(await publishHTMLDirectory(dest,files,index),false);
  assert.equal((await stat(marker)).mtimeMs,before.mtimeMs);
  assert.equal((await stat(marker)).ino,before.ino);
  await assert.rejects(publishHTMLDirectory(dest,files,{...index,title:'Other'}),/完成清单与本次导出不一致/);
  await rename(join(dest,'fonts','fixture.woff2'),join(dest,'font-backup'));
  await assert.rejects(publishHTMLDirectory(dest,files,index), /fonts\/fixture\.woff2 缺失/);
  await writeFile(join(dest,'fonts','fixture.woff2'),'changed');
  await assert.rejects(publishHTMLDirectory(dest,files,index), /fonts\/fixture\.woff2 的哈希不匹配/);
  assert.equal(await readFile(join(dest,'fonts','fixture.woff2'),'utf8'),'changed');
  const existing=join(root,'user-data');await mkdir(existing);await writeFile(join(existing,'other'),'untouched');
  await assert.rejects(publishHTMLDirectory(existing,files,index), /export-manifest\.json 缺失/);
  assert.deepEqual(await readdir(existing),['other']);
  assert.equal(await readFile(join(existing,'other'),'utf8'),'untouched');
  await assert.rejects(publishHTMLDirectory(join(existing,'other'),files,index), /已存在且不是目录/);

  const partial=join(root,'partial');
  const blocked=new Map([['fixture.html','already published'],['fonts','not a directory'],['fonts/example','blocked']]);
  await assert.rejects(publishHTMLDirectory(partial,blocked,index), e=>{
    assert.ok(e.message.includes(partial));
    assert.match(e.message,/写入 fonts\/example 时失败：[\s\S]*(EEXIST|ENOTDIR)[\s\S]*另选目录重试/);
    return true;
  });
  assert.deepEqual((await readdir(partial)).sort(),['fixture.html','fonts']);
  await assert.rejects(publishHTMLDirectory(partial,files,index), /export-manifest\.json 缺失/);
  assert.equal(await readFile(join(partial,'fixture.html'),'utf8'),'already published');
});

test('PDF logs the failure stage and safe process fields, not paths, command, or stderr',async t=>{
  const root=await mkdtemp(join(tmpdir(),'html-studio-pdf-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const log=t.mock.method(console,'error',()=>{});
  const findBrowser=()=>'/private/sensitive/browser';
  const failure=async(opts,status,expected)=>{
    await assert.rejects(exportPDF(root,[original],opts),{
      status,message:{501:'未找到本机 PDF 渲染器。',500:'本机 PDF 渲染准备失败。',503:'本机 PDF 渲染失败。'}[status],
    });
    assert.deepEqual(log.mock.calls.at(-1).arguments,[`[PDF] ${expected}`]);
  };
  await failure({findBrowser:()=>null},501,'stage=renderer-not-found');
  await failure({findBrowser:()=>{throw Object.assign(new Error('private app path'),{code:'EACCES'});}},501,'stage=find-renderer code=EACCES');
  await failure({findBrowser},500,'stage=prepare-fonts code=ENOENT');
  await mkdir(join(root,'workbench','fonts'),{recursive:true});
  for(const [,font] of fontAssets)await writeFile(join(root,'workbench','fonts',font),'fixture');
  const err=Object.assign(new Error('private command/path'),{code:'EACCES',stderr:'private stderr'});
  await failure({findBrowser,execute:()=>{throw err;}},503,'stage=run-renderer code=EACCES');
  await failure({findBrowser,execute:()=>{throw {...err,code:19,signal:'SIGTERM'};}},503,'stage=run-renderer exit=19 signal=SIGTERM');
  await failure({findBrowser,execute:()=>{}},503,'stage=read-output code=ENOENT');
  const produce=bytes=>async (_browser,args)=>writeFile(args.find(a=>a.startsWith('--print-to-pdf=')).slice('--print-to-pdf='.length),bytes);
  await failure({findBrowser,execute:produce('not a PDF')},503,'stage=invalid-pdf');
  assert.equal((await exportPDF(root,[original],{findBrowser,execute:produce('%PDF-fixture')})).toString(),'%PDF-fixture');
  assert.equal(log.mock.callCount(),7);
});

test('outline API saves guarded section metadata and keeps persisted page and storyline order aligned',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'html-studio-outline-'));
  await mkdir(join(dir,folder,'pages'),{recursive:true});
  await writeFile(join(dir,folder,'section.md'),'fixture');
  const portraitSource=renderHTML({...original,format:'a5'});
  await writeFile(join(dir,name),portraitSource);
  const manifestFile=join(dir,'deck.manifest.json'), storyFile=join(dir,'STORYLINE.md');
  await writeFile(manifestFile,JSON.stringify(manifest));
  const baseline='# Fixture\n\n| Page | Content | Role |\n|---|---|---|\n| `'+id+'` | A | First page |\n\nUnchanged editorial text.\n';
  await writeFile(storyFile,baseline);
  const server=await makeServer(dir);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const getManifest=async()=>await (await fetch(`${origin}/api/manifest`)).json();
  let current=await getManifest();
  const patch=(op,expected=current.manifest_revision)=>fetch(`${origin}/api/outline`,{method:'PATCH',headers:{Origin:origin,'Content-Type':'application/json','If-Match':`"${expected}"`},body:JSON.stringify(op)});
  const edit=async op=>{const res=await patch(op);assert.equal(res.status,200,`failed ${op.op}`);current=await res.json();return current.affected;};
  assert.equal((await patch({op:'remove-section',section})).status,409);
  const stale=current.manifest_revision, newSection=await edit({op:'add-section',title:'New section'});
  assert.equal((await patch({op:'rename-section',section:newSection,title:'Oops'},stale)).status,412);
  await edit({op:'rename-section',section:newSection,title:'Renamed'});
  const manifestMtime=(await stat(manifestFile)).mtimeMs;
  await edit({op:'rename-section',section:newSection,title:'Renamed'});
  assert.equal((await stat(manifestFile)).mtimeMs,manifestMtime);
  const sectionFile=join(dir,current.sections[1].context); assert.match(await readFile(sectionFile,'utf8'),/分节说明/);
  const extra=await edit({op:'add-section',title:'Empty section'});
  const extraFile=join(dir,current.sections[2].context);
  await edit({op:'remove-section',section:extra});
  assert.equal(current.sections.length,2); assert.equal(await readFile(extraFile,'utf8'),'# 分节说明\n');
  const added=await edit({op:'add-page',section,title:'Second | Page'});
  const addedInNewSection=await edit({op:'add-page',section:newSection,title:'Other section'});
  assert.equal((await patch({op:'move-page',section,page:added,target:addedInNewSection,after:false})).status,400);
  assert.equal((await patch({op:'remove-section',section:newSection})).status,409);
  const addedResponse=await fetch(`${origin}/api/pages/${added}`);
  assert.equal(addedResponse.status,200);
  const addedPage=await addedResponse.json();
  assert.equal(addedPage.model.format,'a5');
  assert.ok(addedPage.model.objects[0].w<pageSize('a5').w);
  const request=await fetch(`${origin}/api/pages/${added}/requests`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({edit_id:'page-heading',goal:'Update heading',base_revision:addedPage.revision})});
  assert.equal(request.status,201);
  assert.deepEqual((await request.json()).page_size,{width:pageSize('a5').w,height:pageSize('a5').h});
  const ws=await openWorkspace(dir);
  await ws.locked(()=>updateContext(ws,{review:id}));
  assert.match(await readFile(join(dir,facts),'utf8'),new RegExp(`${id}.*与上次复核一致`));
  await edit({op:'move-page',section,page:added,target:id,after:false});
  assert.deepEqual((await getManifest()).sections[0].pages.map(p=>p.id),[added,id]);
  const storyline=await readFile(storyFile,'utf8');
  assert.deepEqual([...storyline.matchAll(/^\| `([^`]+)` \|/gm)].map(m=>m[1]),[added,id,addedInNewSection]);
  assert.match(storyline,/Second &#124; Page/);assert.match(storyline,/Unchanged editorial text/);
  assert.equal(await readFile(join(dir,name),'utf8'),portraitSource);
  const index=await readFile(join(dir,facts),'utf8');
  assert.deepEqual([...index.matchAll(/^\| \d+ \| `([^`]+)`/gm)].map(m=>m[1]),[added,id,addedInNewSection]);
  assert.match(index,/A5 纵向/);
  assert.match(index,new RegExp(`${id}.*页面内容或编排有变`));
  assert.ok((await readdir(join(dir,'.runtime','history'))).some(file=>file.startsWith('storyline.')));
  await writeFile(storyFile,baseline);
  assert.equal((await patch({op:'move-page',section,page:id,target:added,after:false})).status,409);
  assert.deepEqual((await getManifest()).sections[0].pages.map(p=>p.id),[added,id]);
});


test('context sync is idempotent, detects source and editorial changes separately, and never edits narrative',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'html-studio-context-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(join(dir,folder,'pages'),{recursive:true});
  const contextFile=join(dir,folder,'section.md'), storyFile=join(dir,'STORYLINE.md');
  const pageFile=join(dir,name), index=join(dir,facts), privateNote='PRIVATE SPEAKER NOTES';
  await writeFile(contextFile,'# Fixture\n');
  await writeFile(storyFile,story);
  await writeFile(join(dir,'deck.manifest.json'),JSON.stringify(manifest));
  await writeFile(pageFile,source);
  const ws=await openWorkspace(dir), sync=opts=>ws.locked(()=>updateContext(ws,opts));
  const check=()=>updateContext(ws,{check:true});
  assert.deepEqual(await check(),{current:false,pending:[id]});
  await assert.rejects(stat(join(dir,'.runtime')), {code:'ENOENT'});
  assert.deepEqual(await sync(),{current:true,changed:true,pending:[id]});
  const before=await stat(index);
  assert.deepEqual(await sync(),{current:true,changed:false,pending:[id]});
  assert.equal((await stat(index)).mtimeMs,before.mtimeMs);
  await assert.rejects(sync({review:'missing'}),/复核页不存在/);
  assert.deepEqual((await sync({review:id})).pending,[]);

  const a5={...original,format:'a5',objects:[{...original.objects[0],color:'#FF0000',x:75}]};
  const save=async model=>ws.save(id,`"${(await ws.read(id)).revision}"`,model);
  assert.equal((await save(a5)).context_synced,true);
  assert.deepEqual(await check(),{current:true,pending:[]});
  assert.match(await readFile(index,'utf8'),/A5 纵向/);

  const changed={...a5,objects:[{...a5.objects[0],text:'Revised visible content'}]};
  await writeFile(pageFile,renderHTML(changed)); // editor outside the service
  assert.deepEqual(await check(),{current:false,pending:[id]});
  await sync();
  assert.match(await readFile(index,'utf8'),/页面内容或编排有变/);
  assert.equal(await readFile(storyFile,'utf8'),story);
  await sync({review:id});
  const editedStory=story.replace('First page','Reframed opening');
  await writeFile(storyFile,editedStory);
  await sync();
  assert.match(await readFile(index,'utf8'),/叙事文档有变/);
  await sync({review:id});
  await writeFile(contextFile,'# Changed section purpose\n');
  assert.deepEqual(await check(),{current:false,pending:[id]});
  const result=await save({...changed,title:'[fake](https://example.net) | <b>\nrow',notes:privateNote});
  const markdown=await readFile(index,'utf8');
  assert.equal(result.context_synced,true);
  assert.match(markdown,/页面内容或编排、叙事文档均有变/);
  assert.match(markdown,/&#91;fake&#93;/);
  assert.doesNotMatch(markdown,/https:\/\/example\.net|<b>|Revised visible content|PRIVATE SPEAKER NOTES/);
  assert.ok(!markdown.includes(dir));
  assert.equal(await readFile(storyFile,'utf8'),editedStory);
  assert.equal(await readFile(contextFile,'utf8'),'# Changed section purpose\n');
});

test('a context refresh failure does not undo a published page or backup',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'html-studio-context-failure-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(join(dir,folder,'pages'),{recursive:true});
  await writeFile(join(dir,folder,'section.md'),'# Fixture\n');
  await writeFile(join(dir,'deck.manifest.json'),JSON.stringify(manifest));
  await writeFile(join(dir,name),source);
  await writeFile(join(dir,'STORYLINE.md'),'# Broken outline\n');
  const warn=t.mock.method(console,'warn',()=>{}), ws=await openWorkspace(dir);
  const model={...original,title:'Published despite derived failure'};
  const saved=await ws.save(id,`"${revision(source)}"`,model);
  assert.equal(saved.context_synced,false);
  assert.equal((await ws.read(id)).html,renderHTML(model));
  assert.equal(await ws.historical(id,revision(source)),source);
  assert.match(warn.mock.calls[0].arguments[0],/源已保存.*context -- sync/);
  await writeFile(join(dir,'STORYLINE.md'),story);
  await ws.locked(()=>updateContext(ws));
  assert.match(await readFile(join(dir,facts),'utf8'),/Published despite derived failure/);
});

test('source footnotes are safe native links and round-trip with editable text',()=>{
  const model=structuredClone(original), o=model.objects[0];
  o.text='— 来源 <tag>';o.href='https://example.org/p?a=1&b="quoted"';
  const html=renderHTML(model,{embeddedFaces:'/* test fonts */'});
  assert.ok(html.includes('href="https://example.org/p?a=1&amp;b=&quot;quoted&quot;"'));
  assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'));
  assert.ok(html.includes('新标签页打开'));
  assert.doesNotMatch(html,/tabindex="-1"|<tag>/);
  assert.deepEqual(readHTML(renderHTML(model),id),model);
  for(const href of ['javascript:alert(1)','data:text/html,x','http://example.org','//example.org','https:///example.org','https://a@example.org','https://@example.org','https://example.org/a b','https://example.org/\npath','https://']){
    o.href=href;assert.throws(()=>validate(model),/HTTPS/,href);
  }
  o.href='';assert.doesNotMatch(renderHTML(model),/<a class="source-link"/);
});

test('bounded raster data is editable geometry, persisted, and projected into HTML and print',()=>{
  const model={...original,objects:[...original.objects,structuredClone(rasterObject)]};
  const image=model.objects.at(-1);
  const entity=renderHTML(model), print=renderPDFSource([model],'');
  for(const html of [entity,print]){
    assert.ok(html.includes(`<img src="${pngData}" alt="照片说明 &lt;示例&gt;" draggable="false"`));
    assert.match(html,/object-fit:contain/);
  }
  assert.match(print,/img-src data:/);
  const moved=transformSelection(model.objects,new Set([image.id]),{dx:20,dy:30});
  assert.equal(moved.at(-1).x,image.x+20);
  assert.deepEqual(readHTML(renderHTML({...model,objects:moved}),id).objects.at(-1),{...image,x:80,y:190});
  for(const value of ['https://example.org/photo.png','data:image/svg+xml;base64,AAAA','data:image/jpeg;base64,iVBORw0KGgo=','data:image/png;base64,iVBORw0KGgo=\n',pngData+'Q'.repeat(256000)]){
    image.image=value;assert.throws(()=>validate(model),/本地 PNG\/JPEG/);
  }
  image.image=pngData;image.text=' ';assert.throws(()=>validate(model),/替代文本/);
  image.text='照片';image.type='text';assert.throws(()=>validate(model),/字段/);
});


test('dashed connectors can omit the arrowhead without moving the endpoint',()=>{
  const connector={...arrow,lineOnly:true,dashed:true};
  const model={...original,objects:[...original.objects,connector]};
  const {line,to}=arrowGeometry(connector,model.objects);
  assert.deepEqual([line.x2,line.y2],[to.x,to.y]);
  assert.match(renderHTML(model),/stroke-dasharray="6 5"/);
  assert.deepEqual(readHTML(renderHTML(model),id),model);
  assert.throws(()=>validate({...model,objects:[...original.objects,{...connector,dashed:'true'}]}),/箭头样式/);
});
