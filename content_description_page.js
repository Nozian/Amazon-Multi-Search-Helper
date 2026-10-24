/* Opportunistically save description when the user opens an Amazon product page. */
(()=>{'use strict';
 const m=location.pathname.match(/^\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i);
 if(!m)return;
 const asin=m[1].toUpperCase(),KEY='amtkDescriptionsV16';
 async function capture(){
  const description=AMTKDescription.extract(document);
  if(!description)return false;
  try{
    const obj=(await chrome.storage.local.get(KEY))[KEY]||{};
    if(obj[asin]?.description===description)return true;
    obj[asin]={at:Date.now(),status:'ok',description};
    const ids=Object.keys(obj).sort((a,b)=>obj[b].at-obj[a].at);
    for(const k of ids.slice(1500))delete obj[k];
    await chrome.storage.local.set({[KEY]:obj});
  }catch(e){console.warn('説明の保存に失敗',e)}
  return true;
 }
 void capture().then(ok=>{if(!ok){setTimeout(()=>void capture(),2300);}});
})();
