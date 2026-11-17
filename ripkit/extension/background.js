'use strict';

chrome.action.onClicked.addListener(async tab => {
 const url = new URL(chrome.runtime.getURL('dashboard.html'));
 if (tab.id !== undefined) url.searchParams.set('tab', tab.id);
 if (/^https?:/.test(tab.url || '')) {
  url.searchParams.set('auto', '1');
  try {
   // The toolbar click supplies the gesture Chrome requires for optional access.
   await chrome.permissions.request({origins: ['http://*/*', 'https://*/*']});
  } catch {
   // The dashboard offers a manual scan if Chrome does not grant access here.
  }
 }
 await chrome.tabs.create({url: url.href});
});
// Session-only captures; serialise updates to avoid losing simultaneous font requests.
let queue=Promise.resolve();
function serial(task){const result=queue.then(task);queue=result.catch(()=>{});return result}
const key=id=>'capture_'+id;
chrome.webRequest.onCompleted.addListener(details=>{
 if(details.tabId<0)return;
 serial(async()=>{
  const k=key(details.tabId),data=(await chrome.storage.session.get(k))[k];
  if(!data)return;
  if(Date.now()-data.started>120000){await chrome.storage.session.remove(k);return;}
  if(data.urls.length<500&&!data.urls.includes(details.url)){
   data.urls.push(details.url);await chrome.storage.session.set({[k]:data});
  }
 });
},{urls:['http://*/*','https://*/*'],types:['font']});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||!Number.isInteger(message?.tabId)||!['startCapture','finishCapture'].includes(message.type))return;
 serial(async()=>{
  const k=key(message.tabId);
  if(message.type==='startCapture'){
   await chrome.storage.session.set({[k]:{started:Date.now(),urls:[]}});return {ok:true};
  }
  const data=(await chrome.storage.session.get(k))[k];await chrome.storage.session.remove(k);return {ok:true,urls:data?.urls||[]};
 }).then(respond,error=>respond({error:error.message}));
 return true;
});
chrome.tabs.onRemoved.addListener(tabId=>{serial(()=>chrome.storage.session.remove(key(tabId)))});
