import {execFile} from 'node:child_process';
import {access,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {embeddedFonts} from './export-files.mjs';
import {renderPDFSource} from '../workbench/model.mjs';
import {httpError} from './workspace.mjs';

const run=promisify(execFile);
async function installedBrowser() {
  const browserPaths={
    darwin:['Google Chrome','Microsoft Edge','Chromium'].flatMap(name=>['/Applications',join(homedir(),'Applications')].map(dir=>join(dir,`${name}.app`,'Contents','MacOS',name))),
    linux:['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/microsoft-edge'],
    win32:[process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA].filter(Boolean).flatMap(dir=>[
      join(dir,'Google','Chrome','Application','chrome.exe'),join(dir,'Microsoft','Edge','Application','msedge.exe'),
    ]),
  };
  let blocked;
  for(const path of browserPaths[process.platform]||[]){
    try {await access(path,process.platform==='win32'?constants.F_OK:constants.X_OK);return path;}
    catch(e){if(['EACCES','EPERM'].includes(e.code))blocked??=e;}
  }
  if(blocked)throw blocked;
  return null;
}

function reportFailure(stage,error){
  const {code,signal}=error??{}, fields=[`stage=${stage}`];
  if(Number.isInteger(code))fields.push(`exit=${code}`);
  else if(typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(code))fields.push(`code=${code}`);
  if(typeof signal==='string'&&/^SIG[A-Z0-9]{1,16}$/.test(signal))fields.push(`signal=${signal}`);
  // Do not log Error.message, the command, or the browser's stdout/stderr: they can contain local paths.
  console.error(`[PDF] ${fields.join(' ')}`);
}

export async function exportPDF(root,models,{findBrowser=installedBrowser,execute=run}={}) {
  let browser;
  try{browser=await findBrowser();}
  catch(e){reportFailure('find-renderer',e);throw httpError(501,'未找到本机 PDF 渲染器。');}
  if(!browser){reportFailure('renderer-not-found');throw httpError(501,'未找到本机 PDF 渲染器。');}
  let dir, stage='prepare-fonts';
  try {
    const {embeddedFaces}=await embeddedFonts(root,{block:true});
    stage='prepare-directory';
    dir=await mkdtemp(join(tmpdir(),'html-studio-pdf-'));
    const input=join(dir,'slides.html'), output=join(dir,'slides.pdf');
    stage='write-input';
    await writeFile(input,renderPDFSource(models,embeddedFaces),{mode:0o600});
    // Fixed executable and arguments, isolated profile, validated local-only document. Never use shell or --no-sandbox.
    stage='run-renderer';
    await execute(browser,['--headless','--no-first-run','--disable-background-networking','--disable-extensions',
      '--no-pdf-header-footer',`--user-data-dir=${join(dir,'profile')}`,`--print-to-pdf=${output}`,pathToFileURL(input).href],
      {timeout:25000,windowsHide:true,maxBuffer:512*1024});
    stage='read-output';
    const pdf=await readFile(output);
    stage='invalid-pdf';
    if(pdf.subarray(0,5).toString()!=='%PDF-')throw new Error('not PDF');
    return pdf;
  } catch(e) {
    reportFailure(stage,e);
    if(stage==='prepare-fonts'||stage==='prepare-directory')throw httpError(500,'本机 PDF 渲染准备失败。');
    throw httpError(503,'本机 PDF 渲染失败。');
  }
  finally {if(dir)await rm(dir,{recursive:true,force:true,maxRetries:3}).catch(()=>{});}
}
