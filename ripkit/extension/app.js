
'use strict';
const $=id=>document.getElementById(id);
const state={fonts:new Map(),nonEnglishFonts:new Set(),visited:new Set(),faces:[],objects:[],jobs:[],errors:0,busy:false};
const extRE=/\.(woff2?|ttf|otf|eot)(?:[?#]|$)/i;
function resolve(raw,base){try{const u=new URL(raw,base);return /^(https?:|data:)$/.test(u.protocol)?u.href:null}catch{return null}}
function baseURL(){const v=$('url').value.trim();if(!v)return 'https://import.invalid/';const u=resolve(v);if(!u||!/^https?:/.test(u))throw Error('Enter a valid HTTP or HTTPS URL.');return u}
function log(message){state.errors++;$('diagnostics').hidden=false;$('logs').textContent+=message+'\n'}
function empty(title='Your next discovery starts here',message='Enter a page URL or scan the selected tab.'){const el=document.createElement('div');el.className='empty';const aa=document.createElement('div');aa.className='aa';aa.textContent='Aa';const h=document.createElement('h3');h.textContent=title;const p=document.createElement('p');p.textContent=message;el.append(aa,h,p);$('results').replaceChildren(el)}
function reset(){state.faces.forEach(f=>document.fonts.delete(f));state.objects.forEach(u=>URL.revokeObjectURL(u));state.fonts.clear();state.nonEnglishFonts.clear();state.localFontSource=null;state.visited.clear();state.faces=[];state.objects=[];state.jobs=[];state.errors=0;$('results').replaceChildren();$('logs').textContent='';$('diagnostics').hidden=true;$('count').textContent='0';$('allFonts').disabled=true;$('fontZipStatus').textContent=''}
const scanButtonLabel = $('scan').textContent;
function busy(on, scanning = false) {
 state.busy = on;
 for (const id of ['scan','checkSitemap','scanSite']) $(id).disabled = on;
 $('scan').textContent = on && scanning ? 'Scanning…' : scanButtonLabel;
}
async function run(work){if(state.busy)return;busy(true,true);reset();$('status').textContent='Reading sources and checking font files…';try{await work();await Promise.allSettled(state.jobs);groupFontCards();const localCount=await renderLocalFonts(state.localFontSource);refreshMoodBoardFonts();$('status').textContent=state.fonts.size+' unique font file(s) discovered.'+(localCount?' '+localCount+' local font '+(localCount===1?'family':'families')+' detected.':'')+(state.errors?' Some sources or previews were unavailable; see scan details.':'');if(!state.fonts.size&&!localCount)empty('No font files discovered',state.errors?'The scan could not read all sources. See scan details.':'No downloadable files or named local families were detected.');}catch(e){log(e.message);$('status').textContent=e.message;if(!state.fonts.size)empty('This source could not be read','Check the page URL or try scanning the selected tab.');}finally{await Promise.allSettled(state.jobs);busy(false)}}
async function request(url,kind='text'){if(new URL(url).hostname==='import.invalid')throw Error('Original source URL is missing: '+url);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const response=await fetch(url,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});if(!response.ok)throw Error('HTTP '+response.status);return {value:kind==='blob'?await response.blob():await response.text(),url:response.url||url}}catch(e){throw Error('Could not read '+(url.startsWith('data:')?'embedded file':url)+' ('+(e.name==='AbortError'?'15 second timeout':e.message)+'). The host may block CORS, or the resource may be unavailable.')}finally{clearTimeout(timer)}}
function cssUnescape(s){return s.replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi,(_,hex,c)=>hex?String.fromCodePoint(Math.min(parseInt(hex,16)||65533,1114111)):c)}
function urls(text){const out=[];const re=/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|((?:\\.|[^)\\])*))\s*\)/gi;let m;while((m=re.exec(text)))out.push(cssUnescape((m[1]??m[2]??m[3]).trim()));return out}
function clean(s){return s.replace(/^["']|["']$/g,'')}
function format(url,hint=''){const m=url.match(extRE);if(m)return m[1].toLowerCase();return hint.replace(/[^a-z0-9-]/gi,'')||'font'}
function filename(url,family,fmt){try{const n=decodeURIComponent(new URL(url).pathname.split('/').pop());if(n&&extRE.test(n))return n.replace(/[^a-z0-9._ -]/gi,'_')}catch{}return (family.replace(/[^a-z0-9_-]/gi,'_')||'font')+'.'+({truetype:'ttf',opentype:'otf'}[fmt]||fmt)}
function isFontAwesome(value) {
 return /font[\s_-]*awesome|(?:^|[/_-])(?:pro-)?fa-(?:brands|solid|regular|light|thin|duotone|sharp|v4compatibility)(?:[./_-]|$)/i.test(value || '');
}

function coversEnglishLetters(range) {
 if (!range?.trim()) return true;
 const intervals = range.split(',').map(part => {
  const match = /^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(part.trim());
  if (!match) return null;
  return [parseInt(match[1].replace(/\?/g,'0'),16),
   parseInt(match[2] || match[1].replace(/\?/g,'F'),16)];
 }).filter(Boolean);
 if (!intervals.length) return true;
 return [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'].every(letter => {
  const code = letter.charCodeAt(0);
  return intervals.some(([min,max]) => code >= min && code <= max);
 });
}

function addFont(url,meta={}){if(!url||isFontAwesome(url)||isFontAwesome(meta.family))return;
 if(!coversEnglishLetters(meta.unicode)){state.nonEnglishFonts.add(url);return;}
 if(!meta.family&&state.nonEnglishFonts.has(url))return;
 const existing=state.fonts.get(url);if(existing){if(meta.family&&(!existing.meta.family||(!existing.meta.unicode&&meta.unicode))){Object.assign(existing.meta,meta);existing.title.textContent=meta.family;existing.info.textContent=describe(existing)}return}const item={url,meta,fmt:format(url,meta.format),blob:null,face:null};state.fonts.set(url,item);renderCard(item);state.jobs.push(queueFontPreview(item))}
function describe(item){return [item.fmt.toUpperCase(),item.meta.weight?'Weight '+item.meta.weight:'Weight unspecified',item.meta.style||'normal',item.meta.unicode?'Character subset':''].filter(Boolean).join(' · ')}
function renderCard(item){const card=document.createElement('article');card.className='card';const title=document.createElement('h3');title.textContent=item.meta.family||filename(item.url,'Unnamed font',item.fmt);const info=document.createElement('div');info.className='meta';info.textContent=describe(item);const sample=document.createElement('div');sample.className='sample';sample.textContent=$('preview').value;sample.style.fontSize=$('size').value+'px';sample.hidden=true;const note=document.createElement('p');note.className='state';note.textContent='Loading actual font preview…';const footer=document.createElement('footer');const status=document.createElement('span');status.className='state';status.textContent='Checking file…';footer.append(status);const link=document.createElement('a');link.className='source';link.textContent=item.url.startsWith('data:')?'Embedded font data':item.url;link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';link.title=item.meta.unicode?'Unicode range: '+item.meta.unicode:item.url;card.append(title,info,sample,note,footer,link);$('results').append(card);Object.assign(item,{card,title,info,sample,note,status});$('count').textContent=state.fonts.size}
async function loadFont(item){try{item.blob=(await request(item.url,'blob')).value;if(!item.blob.size)throw Error('Empty font file');item.status.textContent=(item.blob.size/1024).toFixed(1)+' KB';const data=await item.blob.arrayBuffer();const signature=String.fromCharCode(...new Uint8Array(data,0,Math.min(4,data.byteLength)));const detected=({'wOF2':'woff2','wOFF':'woff','OTTO':'otf','true':'ttf','\u0000\u0001\u0000\u0000':'ttf'})[signature];if(detected){item.fmt=detected;item.info.textContent=describe(item)}const descriptors={};for(const key of ['weight','style','stretch'])if(item.meta[key])descriptors[key]=item.meta[key];if(item.meta.unicode)descriptors.unicodeRange=item.meta.unicode;const family='scout_'+state.fonts.size+'_'+Math.random().toString(36).slice(2);const face=new FontFace(family,data,descriptors);await face.load();document.fonts.add(face);state.faces.push(face);item.face=face;item.sample.style.fontFamily='"'+family+'", sans-serif';item.sample.style.fontWeight=(item.meta.weight||'400').split(' ')[0];item.sample.style.fontStyle=item.meta.style||'normal';item.sample.hidden=false;item.note.textContent=item.meta.unicode?'Subset font: characters outside its range may use a fallback.':'Preview loaded';}catch(e){item.note.textContent='Preview unavailable — no substitute preview is shown.';if(!item.blob){item.status.textContent='File access blocked'}else item.status.textContent+=' · unsupported preview';log((item.meta.family||item.url.slice(0,150))+': '+e.message)}}
function desktopFormat(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.byteLength<12)throw Error('The decoded font is incomplete.');
 const signature=view.getUint32(0);
 const fmt=signature===0x4f54544f?'otf':signature===0x00010000||signature===0x74727565?'ttf':null;
 if(!fmt)throw Error('Unsupported decoded format (font collections cannot be saved as a single OTF or TTF).');
 const count=view.getUint16(4);
 if(!count||12+count*16>bytes.byteLength)throw Error('Invalid font table directory.');
 for(let i=0;i<count;i++){const offset=view.getUint32(12+i*16+8),size=view.getUint32(12+i*16+12);if(offset+size>bytes.byteLength)throw Error('Incomplete decoded font table.');}
 return fmt;
}
function convertWOFF2(buffer){
 return new Promise((resolve,reject)=>{
  const bytes=new Uint8Array(buffer),view=new DataView(buffer);
  if(bytes.length<48||view.getUint32(0)!==0x774f4632){reject(Error('Not a valid WOFF2 file.'));return;}
  if(view.getUint32(16)>64*1024*1024||bytes.length>32*1024*1024){reject(Error('This font exceeds the conversion size limit. Download the original instead.'));return;}
  let worker,objectURL,timer;
  const cleanup=()=>{clearTimeout(timer);worker?.terminate();if(objectURL)URL.revokeObjectURL(objectURL)};
  try{
   worker=new Worker(chrome.runtime.getURL('woff2-worker.js'));
   timer=setTimeout(()=>{cleanup();reject(Error('Conversion timed out.'));},30000);
   worker.onerror=()=>{cleanup();reject(Error('The local font decoder could not start.'));};
   worker.onmessage=e=>{cleanup();if(e.data.error){reject(Error(e.data.error));return;}try{const bytes=new Uint8Array(e.data.bytes);const fmt=desktopFormat(bytes);resolve({blob:new Blob([bytes],{type:fmt==='otf'?'font/otf':'font/ttf'}),fmt});}catch(error){reject(error)}};
   worker.postMessage(buffer,[buffer]);
  }catch(error){cleanup();reject(error)}
 });
}
async function readCSS(text,base,depth=0){if(depth>12){log('CSS import depth limit reached: '+base);return}const imports=[];const noComments=text.replace(/\/\*[\s\S]*?\*\//g,'');for(const m of noComments.matchAll(/@import\s+(url\(\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^)])*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')[^;]*;/gi)){const raw=/^url/i.test(m[1])?urls(m[1])[0]:cssUnescape(clean(m[1]));const u=resolve(raw,base);if(u)imports.push(u)}const sheet=new CSSStyleSheet();sheet.replaceSync(text.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/gi,''));function walk(rules){for(const rule of rules){if(state.siteImages&&rule.type!==5&&rule.style)collectCSSImages(rule.style,base);if(rule.type===5){const s=rule.style,meta={family:clean(s.getPropertyValue('font-family')),weight:s.getPropertyValue('font-weight'),style:s.getPropertyValue('font-style'),stretch:s.getPropertyValue('font-stretch'),unicode:s.getPropertyValue('unicode-range')};for(const raw of urls(s.getPropertyValue('src')))addFont(resolve(raw,base),meta)}if(rule.cssRules)walk(rule.cssRules)}}walk(sheet.cssRules);for(const u of imports)await fetchCSS(u,depth+1)}
async function fetchCSS(url,depth=0){if(state.visited.has(url))return;if(!state.siteImages&&state.visited.size>=150){log('Stopped at 150 stylesheets.');return}state.visited.add(url);try{const r=await request(url);await readCSS(r.value,r.url,depth)}catch(e){log(e.message)}}
$('preview').oninput=()=>document.querySelectorAll('.sample').forEach(el=>el.textContent=$('preview').value);
$('size').oninput=()=>{$('sizeValue').textContent=$('size').value+' px';document.querySelectorAll('.sample').forEach(el=>el.style.fontSize=$('size').value+'px')};
empty();

let targetTabId=Number(new URLSearchParams(location.search).get('tab'))||null;
const HOSTS=['http://*/*','https://*/*'];
async function showTarget(){
 if(!targetTabId)return;
 try{const tab=await chrome.tabs.get(targetTabId);$('tabStatus').textContent='Selected tab: '+(tab.title||tab.url||targetTabId);if(tab.url&&/^https?:/.test(tab.url))$('url').value=tab.url;}
 catch{$('tabStatus').textContent='The selected tab has closed. Enter a URL above, or reopen RipKit from another tab.';targetTabId=null;}
}
async function grantAccess(){
 const granted=await chrome.permissions.request({origins:HOSTS});
 if(!granted)throw Error('Website access was not granted. Allow access to scan the website.');
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitForTab(id){
 const start=Date.now();
 while(Date.now()-start<30000){const tab=await chrome.tabs.get(id);if(tab.status==='complete')return tab;await pause(250);}
 log('Page load exceeded 30 seconds; inspecting the content available so far.');
 return chrome.tabs.get(id);
}
async function message(type,tabId){const response=await chrome.runtime.sendMessage({type,tabId});if(response?.error)throw Error(response.error);return response;}
async function inspectTab(id,{navigate=null}={}){
 let capturing=false;
 try{
  await message('startCapture',id);capturing=true;
  if(navigate){await chrome.tabs.update(id,{url:navigate});await waitForTab(id);}
  $('status').textContent='Watching the selected tab for font requests (5 seconds)…';
  await pause(5000);
  const tab=await chrome.tabs.get(id);
  if(!/^https?:/.test(tab.url||''))throw Error('Chrome protects this page. Choose a regular HTTP or HTTPS website.');
  const result=await chrome.scripting.executeScript({target:{tabId:id},func:collectPageFonts});
  const snapshot=result[0]?.result;if(!snapshot)throw Error('The page could not be inspected.');
  const capture=await message('finishCapture',id);capturing=false;
  const mediaResult=await chrome.scripting.executeScript({target:{tabId:id},func:collectPageAssets}).catch(error=>{
   log('Images and brand scan failed: '+error.message);
   return [];
  });
  const page=mediaResult[0]?.result;
  if(page && page.brand.url===snapshot.url){
   state.localFontSource = page.brand;
   renderBrandReport(page.brand);
   void showPageImages(page.images,page.truncated);
  }
  $('status').textContent='Reading stylesheets and loading font previews…';
  $('url').value=snapshot.url;
  $('tabStatus').textContent='Selected tab: '+snapshot.title+' — '+snapshot.url;
  if(snapshot.truncated)log('Stopped searching open shadow roots at 25,000 elements.');
  for(const source of snapshot.sources)await readCSS(source.text,source.url);
  for(const url of snapshot.links)await fetchCSS(url);
  for(const url of [...snapshot.fontURLs,...(capture.urls||[])])addFont(resolve(url,snapshot.url));
 }finally{if(capturing)await message('finishCapture',id).catch(()=>{});}
}
async function scanSelected(){
 if(state.busy)return;
 try{
  if(!targetTabId)throw Error('Open RipKit using its toolbar icon on the website you want to scan, or enter a URL above.');
  clearPageAssets();
  await run(()=>inspectTab(targetTabId));
 }catch(error){$('status').textContent=error.message;}
}
$('scanForm').onsubmit=async event=>{
 event.preventDefault();if(state.busy)return;
 try{
  const url=baseURL();await grantAccess();
  clearPageAssets();
  await run(async()=>{
   if(extRE.test(url)){addFont(url);return;}
   if(/\.css(?:[?#]|$)/i.test(url)){await fetchCSS(url);return;}
   const tab=await chrome.tabs.create({url:'about:blank',active:false});targetTabId=tab.id;
   await inspectTab(tab.id,{navigate:url});
  });
 }catch(error){$('status').textContent=error.message;}
};
