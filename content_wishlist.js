/* Amazon Toolkit: Wishlist workspace v1.8 — always-accessible cancel for collection & checks. */
(() => {
  'use strict';
  if (!/^\/((hz\/)?wishlist)(\/|$)/.test(location.pathname)) return;

  const KEY = 'amtkWishlistCacheV11';
  const NOTES = 'amtkWishlistNotes';
  const DESC_KEY = 'amtkDescriptionsV16';
  const DESCRIPTION_BATCH = 30;
  const PRICE_CACHE = 'amtkUsedOffersV14';
  const PRICE_START_GAP_MS = 1100; // Minimum spacing between launching concurrent item checks.
  const PRICE_TTL_MS = {ok:12*3600e3, unavailable:2*3600e3, blocked:20*60e3, error:30*60e3};
  const defaults = {amtkWishlistEnabled:true, amtkWishlistCols:6, amtkAutoUsedEnabled:true, amtkPriceConcurrency:2};
  const colors={none:'なし',warm:'オレンジ',mint:'ミント',sky:'ブルー',rose:'ピンク'};
  const siteChoices = typeof SITES === 'undefined' ? [] : SITES;
  let settings={...defaults};
  let notes={};
  let cache={};
  let currentId='';
  let entries=new Map();
  let panel=null;
  let nativeVisible=false;
  let collecting=false;
  let abortCollection=false;
  let userPaused=false; // Persists for this tab until the user explicitly resumes.
  let floatingStop=null;
  let lastStoppedTask='prices'; // Shows the matching resume action after a cancellation.
  const priceControllers=new Set();
  let descriptionController=null;
  let renderTimer=0;
  let saveTimer=0;
  let lastSignature='';
  let lastError='';
  let collectionLog='';
  let gridResizeObserver=null;
  let dataRevision=0;
  let priceCache={};
  let descriptions={};
  let fetchingDescriptions=false;
  let stopDescriptions=false;
  let aiQuery='';
  let aiMatches=null; // null: normal search, Map: AI-selected products with explanations
  let aiRunning=false;
  let aiMessage='AI検索は未実行。Gemini APIキーは拡張のアイコンから設定します。';
  // Never replace a focused editable DOM node: it would cancel Japanese IME conversion.
  let pendingEditorRefresh=false;
  let composingSearch=false;
  let composingAI=false;

  let priceQueue=[];
  let queueSet=new Set();
  let priceLoopRunning=false;
  let priceActive=new Set();
  let lastPriceStartedAt=0;
  let filterText='';
  let filterMode='all';
  let pricePausedUntil=0;
  let priceResumeTimer=0;
  let priceCacheTimer=0;
  let completedChecks=0;
  const PRICE_DOCUMENT_MAX=4000000;


  function currentListId(){
    const path=location.pathname;
    const m=path.match(/\/hz\/wishlist\/ls\/([A-Za-z0-9_-]+)/);
    const fromQuery=new URLSearchParams(location.search).get('lid');
    return (m?.[1]||fromQuery||path+'?'+(new URLSearchParams(location.search).get('ref_')||'default')).slice(0,160);
  }
  function listTitle(){
    for(const s of ['#wl-list-title', '#profile-list-name', '#listName', '.wl-list-info h1', 'h1']){
      const t=document.querySelector(s)?.textContent?.trim();
      if(t&&t.length<180&&t!=='Amazon.co.jp')return t.replace(/\s+/g,' ').slice(0,100);
    }
    return 'Amazon ほしい物リスト';
  }
  function sources(){
    // Select ONLY Amazon's own item nodes; never scan our mirror cards.
    return [...new Set(document.querySelectorAll('#g-items > li, #g-items > div[data-itemid], #g-items .g-item-sortable, #g-items li[data-itemid], #g-items [data-itemid].g-item-sortable'))]
      .filter(el=>!el.closest('#amtk-wishlist-panel'));
  }
  function findText(node,sels){
    for(const selector of sels){
      const el=node.querySelector(selector);
      const val=el&&(el.getAttribute('title')||el.textContent||el.getAttribute('alt')||'').replace(/\s+/g,' ').trim();
      if(val&&val.length>2)return val.slice(0,350);
    }
    return '';
  }
  function idAndHref(el){
    const link=el.querySelector('a[href*="/dp/"], a[href*="/gp/product/"], a[href*="/exec/obidos/ASIN/"]');
    const asin=el.dataset.asin||el.querySelector('[data-asin]')?.getAttribute('data-asin')||link?.href?.match(/\/(?:dp|gp\/product|exec\/obidos\/ASIN)\/([A-Z0-9]{10})/i)?.[1];
    const itemid=el.dataset.itemid||el.getAttribute('data-itemid')||el.id;
    const href=link?.href|| (asin?`https://www.amazon.co.jp/dp/${encodeURIComponent(asin)}`:'');
    return {id:asin?`asin:${asin}`:(itemid?`item:${itemid}`:''),href};
  }
  function imageSrc(el){
    for(const img of el.querySelectorAll('img')){
      const dynamic=img.getAttribute('data-a-dynamic-image');
      let src=img.getAttribute('data-src')||img.currentSrc||img.src||'';
      if(dynamic){try{src=Object.keys(JSON.parse(dynamic))[0]||src;}catch{}}
      if(!/^https:\/\//i.test(src))continue;
      if(/transparent|sprite|grey-pixel|loading|placeholder|blank\.gif/i.test(src))continue;
      return src;
    }
    return '';
  }
  function recordFrom(el){
    const title=findText(el,['a[id^="itemName_"]','a[id*="itemName"]','.g-item-details a[href*="/dp/"]','.g-item-details .a-link-normal','.g-item-details h2','h2 a', 'a[href*="/dp/"]', 'img[alt]']);
    if(!title||/^(読み込み中|loading|商品名|amazon|ほしい物リスト)$/i.test(title))return null;
    const {id,href}=idAndHref(el);
    if(!id&&!href)return null; // don't mistake a loading skeleton for an item
    const rawPrice=findText(el,['.a-price .a-offscreen','[id*="itemPrice"]','.itemUsedAndNewPrice','.a-color-price','.a-price']);
    const price=rawPrice.length<85?rawPrice:'';
    const key=id||`url:${href.slice(0,150)}`;
    const used=typeof AMTKUsed!=='undefined'?AMTKUsed.fromWishlist(el):null;
    const asin=id?.startsWith('asin:')?id.slice(5):'';
    const extra=asin&&descriptions[asin]?.description?{description:descriptions[asin].description,descriptionFetchedAt:descriptions[asin].at,descriptionState:'ok'}:{};
    return {id:key,title,price,url:href,image:imageSrc(el),...extra,...(used||{})};
  }
  function mergeDescriptions(){
    let count=0;
    for(const [id,item] of entries){
      const asin=typeof AMTKUsed!=='undefined'?AMTKUsed.asinFrom(item.url):'';
      const saved=descriptions[asin];
      if(saved?.description && item.description!==saved.description){
        entries.set(id,{...item,description:saved.description,descriptionFetchedAt:saved.at,descriptionState:'ok'});count++;
      }
    }
    if(count){dataRevision++;persistSoon();drawSoon();}
  }
  function scan(){
    let modified=0;
    for(const el of sources()){
      const record=recordFrom(el);
      if(!record)continue;
      const previous=entries.get(record.id);
      const updated={...previous,...record};
      // Saved offer details survive rescans where Amazon omits used-price information.
      if(previous?.description && !record.description)updated.description=previous.description;
      if(previous?.descriptionState && !record.descriptionState)updated.descriptionState=previous.descriptionState;
      if(previous?.descriptionFetchedAt && !record.descriptionFetchedAt)updated.descriptionFetchedAt=previous.descriptionFetchedAt;
      if(previous?.usedSource && previous.usedSource!=='リスト上の表示' && record.usedSource==='リスト上の表示') {
        for(const k of ['usedPrice','usedShipping','usedTotal','usedSource','usedCheckedAt'])updated[k]=previous[k];
      }
      if(!previous || JSON.stringify(previous)!==JSON.stringify(updated)){
        entries.set(record.id,updated);
        modified++;
      }
    }
    if(modified){dataRevision++;persistSoon(); if(!collecting)drawSoon();}
    scheduleAutoPrices();
    return modified;
  }
  function persistSoon(){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(async()=>{
      cache[currentId]={updatedAt:Date.now(),name:listTitle(),items:[...entries.values()].slice(0,5000)};
      try{
        const keys=Object.keys(cache).sort((a,b)=>(cache[b]?.updatedAt||0)-(cache[a]?.updatedAt||0));
        for(const k of keys.slice(16))delete cache[k];
        await chrome.storage.local.set({[KEY]:cache});
      }catch(e){lastError='収集履歴の保存に失敗（Chromeの保存容量が不足した可能性があります）';drawSoon();}
    },650);
  }
  function getNote(id){return notes[`${currentId}|${id}`]||{};}
  async function setNote(id,n){
    notes[`${currentId}|${id}`]={tag:String(n.tag||'').slice(0,50),color:n.color in colors?n.color:'none'};
    try{
      await chrome.storage.local.set({[NOTES]:notes});
      if(filterText.trim() || filterMode!=='all'){
        if(isEditingCard())pendingEditorRefresh=true;
        else renderFilteredGrid();
      }
    }catch{lastError='タグ保存に失敗しました';drawSoon();}
  }
  function el(tag,cls,text){
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(text!=null)n.textContent=String(text);
    return n;
  }
  function btn(text,callback,cls=''){
    const b=el('button',cls,text);b.type='button';b.addEventListener('click',callback);return b;
  }
  function selectSites(){
    const select=el('select','amtk-card-site');
    select.setAttribute('aria-label','商品を探すサイト');
    for(const s of siteChoices){const option=el('option','',s.name);option.value=s.id;select.append(option);}
    select.value='kinokuniya';
    return select;
  }
  function searchHref(id,title){
    const site=siteChoices.find(x=>x.id===id);
    if(!site||typeof siteUrl==='undefined')return '';
    return siteUrl(site,title);
  }
  function searchOther(item,site){
    const href=searchHref(site,item.title);
    if(href)window.open(href,'_blank','noopener,noreferrer');
  }
  function usedLine(item){
    const box=el('div','amtk-wl-used');
    box.append(el('strong','','中古（取得時の参考価格）'));
    if(item.usedPrice){
      box.append(el('span','amtk-wl-used-price',item.usedPrice));
      box.append(el('span','amtk-wl-used-shipping',`送料: ${item.usedShipping||'確認できず'}`));
      if(item.usedTotal)box.append(el('span','amtk-wl-used-total',`同一出品の合計: ${item.usedTotal}`));
      else box.append(el('span','amtk-wl-used-hint','合計は計算できません'));
    }else{
      const texts={loading:'中古の出品情報を自動照合中…',waiting:'中古情報の確認待ち…',
        unavailable:'中古出品の表示から価格を確認できませんでした',
        blocked:'Amazon側のアクセス制限で確認を中断しています',
        error:'Amazonとの通信で確認できませんでした',
        noasin:'商品番号が不明で自動確認できません'};
      box.append(el('span','amtk-wl-used-unknown',texts[item.usedState]||'中古情報を自動確認します…'));
    }
    if(item.usedSource)box.title=`取得元: ${item.usedSource}（購入時の価格とは異なる場合があります）`;
    if(item.usedCheckedAt){
      const d=new Date(item.usedCheckedAt);
      box.append(el('small','amtk-wl-checked',`確認: ${d.toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`));
    }
    return box;
  }
  function cachedPrice(asin){
    const entry=priceCache[asin];
    return entry && Date.now()-entry.at < (PRICE_TTL_MS[entry.status]||PRICE_TTL_MS.error) ? entry : null;
  }
  function updateUsedCard(id){
    const record=entries.get(id);
    if(!record)return;
    for(const node of document.querySelectorAll('#amtk-wishlist-panel .amtk-wl-card')){
      if(node.dataset.amtkId !== id)continue;
      node.querySelector('.amtk-wl-used')?.replaceWith(usedLine(record));
      if(filterMode!=='all'||filterText.trim()){
        if(isEditingCard())pendingEditorRefresh=true;
        else renderFilteredGrid();
      }
      break;
    }
  }
  function usePriceCache(id,offer){
    const current=entries.get(id);
    if(!current||!offer)return;
    const next={...current,...(offer.result||{}),usedState:offer.status,usedCheckedAt:offer.at};
    if(JSON.stringify(next)===JSON.stringify(current))return;
    entries.set(id,next);dataRevision++;
    updateUsedCard(id);persistSoon();
  }
  function storePriceCache(){
    clearTimeout(priceCacheTimer);
    priceCacheTimer=setTimeout(async()=>{
      const keys=Object.keys(priceCache).sort((a,b)=>priceCache[b].at-priceCache[a].at);
      for(const key of keys.slice(3000))delete priceCache[key];
      try{await chrome.storage.local.set({[PRICE_CACHE]:priceCache});}
      catch(error){console.warn('中古価格履歴を保存できませんでした',error);}
    },450);
  }
  function scheduleAutoPrices(){
    if(!settings.amtkAutoUsedEnabled||!currentId||userPaused)return;
    if(pricePausedUntil>Date.now())return;
    for(const item of entries.values()){
      const asin=typeof AMTKUsed!=='undefined'?AMTKUsed.asinFrom(item.url):'';
      if(!asin){
        if(!item.usedPrice && item.usedState!=='noasin'){
          item.usedState='noasin';updateUsedCard(item.id);
        }
        continue;
      }
      const saved=cachedPrice(asin);
      if(saved){usePriceCache(item.id,saved);continue;}
      if(item.usedPrice && item.usedShipping)continue; // Already captured same-offer price and shipping.
      if(!queueSet.has(asin) && !priceActive.has(asin)){
        queueSet.add(asin);
        priceQueue.push(asin);
      }
      if(!item.usedPrice && !['waiting','loading'].includes(item.usedState)){
        item.usedState='waiting';updateUsedCard(item.id);
      }
    }
    if(!priceLoopRunning)void autoPriceLoop();
    updateFloatingStop();
  }
  function updatePricingStatus(){
    updateFloatingStop();
    if(collecting || fetchingDescriptions || userPaused)return; // Preserve collection / stop messages.
    const unresolved=priceQueue.length;
    const running=priceActive.size;
    const parallel=Math.min(3,Math.max(1,Number(settings.amtkPriceConcurrency)||2));
    const verified=[...entries.values()].filter(x=>x.usedPrice).length;
    const total=entries.size;
    const note=pricePausedUntil>Date.now()?' / Amazonのアクセス制限により一時停止':unresolved||running?' / 並列照合中':' / 照合済み';
    status(`${total}件収集 / 中古価格を表示 ${verified}件 / 実行中 ${running}/${parallel}件・待機 ${unresolved}件${note}。同一出品で送料が判明した場合のみ合計表示。`);
  }
  async function fetchPage(url,signal){
    const response=await fetch(url,{credentials:'include',redirect:'follow',signal:AbortSignal.any([signal,AbortSignal.timeout(14500)])});
    if([429,403,503].includes(response.status))return {blocked:true};
    if(!response.ok)throw Error(`Amazonの応答 ${response.status}`);
    if((response.headers.get('content-length')|0)>PRICE_DOCUMENT_MAX)throw Error('Amazonのページサイズが大きすぎます');
    const html=await response.text();
    if(html.length>PRICE_DOCUMENT_MAX)throw Error('Amazonのページサイズが大きすぎます');
    if(AMTKUsed.isBlocked(html,response.url))return {blocked:true};
    return {doc:new DOMParser().parseFromString(html,'text/html')};
  }
  async function findUsedOffer(asin,signal){
    const urls=[
      `https://www.amazon.co.jp/gp/offer-listing/${encodeURIComponent(asin)}?condition=used`,
      AMTKUsed.ajaxURL(asin),
      `https://www.amazon.co.jp/dp/${encodeURIComponent(asin)}`
    ];
    let trouble=false;
    for(let index=0;index<urls.length;index++){
      // Another parallel worker may have encountered an Amazon challenge.
      if(userPaused || signal.aborted || pricePausedUntil>Date.now())return {status:'paused',result:null};
      try{
        const result=await fetchPage(urls[index],signal);
        if(result.blocked)return {status:'blocked',result:null};
        const used=index<2 ? AMTKUsed.fromOffers(result.doc,index===0) : AMTKUsed.fromProduct(result.doc);
        if(used?.usedPrice)return {status:'ok',result:used};
      }catch(e){
        if(userPaused||signal.aborted)return {status:'paused',result:null};
        trouble=true;
        console.warn('Amazon中古出品ページの取得に失敗しました',e.message);
      }
      if(index<urls.length-1 && !signal.aborted)await sleep(450);
    }
    return {status:trouble?'error':'unavailable',result:null};
  }
  async function checkOnePrice(asin){
    const controller=new AbortController();priceControllers.add(controller);
    try{
      const initial=[...entries.values()].filter(x=>AMTKUsed.asinFrom(x.url)===asin);
      for(const item of initial){
        if(!item.usedPrice){item.usedState='loading';updateUsedCard(item.id);}
      }
      const outcome=await findUsedOffer(asin,controller.signal);
      if(userPaused||controller.signal.aborted||outcome.status==='paused')return;
      const saved={...outcome,at:Date.now()};
      priceCache[asin]=saved;
      storePriceCache();
      // List navigation may occur while the request is in flight. Only update the current list.
      for(const item of [...entries.values()].filter(x=>AMTKUsed.asinFrom(x.url)===asin))usePriceCache(item.id,saved);
      completedChecks++;
      if(outcome.status==='blocked'){
        // New requests stop; already-running checks can finish. No captcha bypass/retry storm.
        pricePausedUntil=Date.now()+20*60e3;
        clearTimeout(priceResumeTimer);
        priceResumeTimer=setTimeout(()=>{pricePausedUntil=0;scheduleAutoPrices();},20*60e3+250);
      }
    }catch(error){
      if(userPaused||controller.signal.aborted)return;
      console.warn('Amazon中古価格の並列照合に失敗しました:',error);
      const saved={status:'error',result:null,at:Date.now()};
      priceCache[asin]=saved;storePriceCache();
      for(const item of [...entries.values()].filter(x=>AMTKUsed.asinFrom(x.url)===asin))usePriceCache(item.id,saved);
    }finally{
      priceControllers.delete(controller);
      priceActive.delete(asin);
      updatePricingStatus();
    }
  }
  async function autoPriceLoop(){
    if(priceLoopRunning)return;
    priceLoopRunning=true;
    try{
      while(settings.amtkAutoUsedEnabled && !userPaused && (priceQueue.length || priceActive.size)){
        if(pricePausedUntil>Date.now())break;
        // Pause starting new network calls in background tabs.
        if(document.hidden){await sleep(550);continue;}
        const concurrency=Math.min(3,Math.max(1,Number(settings.amtkPriceConcurrency)||2));
        if(priceQueue.length && priceActive.size<concurrency){
          const gap=Math.max(0,PRICE_START_GAP_MS-(Date.now()-lastPriceStartedAt));
          if(gap){await sleep(Math.min(gap,250));continue;}
          const asin=priceQueue.shift();queueSet.delete(asin);
          if(!asin || userPaused || cachedPrice(asin) || priceActive.has(asin))continue;
          if(![...entries.values()].some(x=>AMTKUsed.asinFrom(x.url)===asin))continue;
          priceActive.add(asin);
          lastPriceStartedAt=Date.now();
          // Deliberately do not await: other ASINs can be checked simultaneously.
          void checkOnePrice(asin);
          updatePricingStatus();
        }else{
          await sleep(180);
        }
      }
    }finally{
      priceLoopRunning=false;
      updatePricingStatus();
      updateFloatingStop();
    }
  }
  function card(item){
    const note=getNote(item.id);
    const root=el('article','amtk-wl-card');root.dataset.color=note.color||'none';root.dataset.amtkId=item.id;
    if(item.url){
      const a=el('a','amtk-wl-thumb');a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';
      if(item.image){const img=el('img');img.src=item.image;img.alt='';img.loading='lazy';a.append(img);}
      else a.append(el('span','amtk-image-missing','画像なし'));
      root.append(a);
    }
    else root.append(el('div','amtk-wl-thumb','画像なし'));
    const a=el('a','amtk-wl-title',item.title);a.href=item.url||'#';a.target='_blank';a.rel='noopener noreferrer';root.append(a);
    if(item.price)root.append(el('div','amtk-wl-price',`表示価格: ${item.price}`));
    if(item.description){
      const detail=el('details','amtk-wl-description');
      detail.append(el('summary','',`商品説明を見る（${item.description.length}文字）`));
      detail.append(el('p','',item.description));root.append(detail);
    } else if(item.descriptionState==='unavailable') {
      const info=el('small','amtk-wl-description-unknown','説明文を取得できませんでした');root.append(info);
    }

    root.append(usedLine(item));
    const usedActions=el('div','amtk-wl-used-actions');
    const usedLink=el('a','amtk-wl-used-link','中古出品を見る ↗');usedLink.href=typeof AMTKUsed!=='undefined'?AMTKUsed.offersURL(item.url):item.url;usedLink.target='_blank';usedLink.rel='noopener noreferrer';
    usedActions.append(usedLink);root.append(usedActions);
    const quick=el('div','amtk-wl-quick');
    for(const [id,label] of [['kinokuniya','紀伊國屋'],['library','図書館'],['mercari','メルカリ']]){
      quick.append(btn(label,()=>searchOther(item,id),'amtk-wl-chip'));
    }
    root.append(quick);
    const extra=el('details','amtk-wl-more');extra.append(el('summary','','検索先・タグ設定'));
    const search=el('div','amtk-wl-search');const selector=selectSites();search.append(selector,btn('他サイトで検索 ↗',()=>searchOther(item,selector.value)));extra.append(search);
    const edits=el('div','amtk-wl-edit');
    const tag=el('input');tag.placeholder='タグ';tag.setAttribute('aria-label','タグ');tag.maxLength=50;tag.value=note.tag||'';
    const color=el('select');color.setAttribute('aria-label','色');
    for(const [v,label] of Object.entries(colors)){const op=el('option','',label);op.value=v;color.append(op);}
    color.value=note.color||'none';
    let timer;
    tag.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>setNote(item.id,{tag:tag.value,color:color.value}),550);});
    color.addEventListener('change',()=>{root.dataset.color=color.value;setNote(item.id,{tag:tag.value,color:color.value});});
    edits.append(tag,color);extra.append(edits);root.append(extra);
    return root;
  }
  function setNativeVisibility(show){
    nativeVisible=Boolean(show);
    document.documentElement.classList.toggle('amtk-wl-hide-native',!!panel&&!nativeVisible&&!collecting&&entries.size>0);
    const b=document.getElementById('amtk-wl-native');
    if(b)b.textContent=nativeVisible?'オリジナル表示を閉じる':'Amazon元の表示';
  }
  function ensureFloatingStop(){
    if(floatingStop?.isConnected)return floatingStop;
    const mount=document.body||document.documentElement;
    if(!mount)return null;
    floatingStop=el('aside','amtk-wl-floating-stop');
    floatingStop.id='amtk-wl-floating-stop';
    floatingStop.setAttribute('role','region');
    floatingStop.setAttribute('aria-label','収集と照合の操作');
    const progress=el('span','amtk-wl-float-progress');progress.id='amtk-wl-float-progress';
    const action=el('button','amtk-wl-float-button','■ 収集を停止');action.type='button';
    action.id='amtk-wl-float-button';
    floatingStop.append(progress,action);
    mount.append(floatingStop);
    return floatingStop;
  }
  function updateFloatingStop(){
    const busy=collecting||fetchingDescriptions||(!userPaused&&(priceQueue.length>0||priceActive.size>0));
    const shouldShow=busy||userPaused;
    if(!shouldShow){floatingStop?.remove();floatingStop=null;return;}
    const surface=ensureFloatingStop();if(!surface)return;
    const progress=surface.querySelector('#amtk-wl-float-progress');
    const action=surface.querySelector('#amtk-wl-float-button');
    if(userPaused && !collecting && !fetchingDescriptions){
      progress.textContent=`停止済み · ${entries.size}件保存`;
      const resume={list:['▶ リスト収集を再開',()=>{void gatherAll();}],descriptions:['▶ 説明収集を再開',()=>{void bulkDescriptions();}],prices:['▶ 中古照合を再開',resumePriceChecks]}[lastStoppedTask];
      action.textContent=resume[0];
      action.onclick=resume[1];
      action.disabled=false;
      surface.dataset.state='paused';
    }else{
      const kinds=[collecting?'リスト収集':null,fetchingDescriptions?'説明文収集':null,
        (!userPaused&&(priceQueue.length||priceActive.size))?'中古照合':null].filter(Boolean);
      progress.textContent=`${kinds.join('・')}中 · ${entries.size}件保存`;
      action.textContent=abortCollection||stopDescriptions||userPaused?'停止処理中…':'■ 収集を停止';
      action.onclick=stopAll;
      action.disabled=abortCollection||stopDescriptions||userPaused;
      surface.dataset.state='running';
    }
  }
  function stopAll(){
    if(!(collecting||fetchingDescriptions||priceActive.size||priceQueue.length))return;
    lastStoppedTask=collecting?'list':fetchingDescriptions?'descriptions':'prices';
    abortCollection=true;
    stopDescriptions=true;
    userPaused=true;
    priceQueue=[];queueSet.clear();
    descriptionController?.abort();
    for(const controller of priceControllers)controller.abort();
    status(`停止を受け付けました。取得済み ${entries.size}件は保存されます。`);
    persistSoon();
    updateFloatingStop();
    drawSoon();
  }
  function resumePriceChecks(){
    if(collecting||fetchingDescriptions)return;
    userPaused=false;
    abortCollection=false;
    stopDescriptions=false;
    status('中古価格の照合を再開しました。');
    scheduleAutoPrices();
    updateFloatingStop();
    drawSoon();
  }
  function status(text){
    collectionLog=text;
    const t=document.getElementById('amtk-wl-status');if(t)t.textContent=text;
  }
  function isEditingCard(){
    const active=document.activeElement;
    return !!(active && panel?.querySelector('.amtk-wl-grid')?.contains(active) &&
      (active.matches('input,textarea,[contenteditable]') || active.isContentEditable));
  }
  function isEditingPanel(){
    const active=document.activeElement;
    return !!(active && panel?.contains(active) &&
      (active.matches('input,textarea,[contenteditable]') || active.isContentEditable));
  }
  function makePanel(){
    if(panel?.isConnected)return;
    const source=document.querySelector('#g-items');
    if(!source?.parentElement)return;
    panel=el('section','amtk-wishlist-panel');panel.id='amtk-wishlist-panel';
    // Apply pending header/config changes after an editor loses focus, not during IME composition.
    panel.addEventListener('focusout',()=>{
      if(!pendingEditorRefresh)return;
      setTimeout(()=>{
        if(pendingEditorRefresh && !isEditingPanel()){
          lastSignature='';
          draw();
        }
      },60);
    });
    // Explicitly not injecting a grid into Amazon's native <li> structure.
    source.parentElement.insertBefore(panel,source);
  }
  function countDetail(){
    return `${entries.size}件収集済み（読み込まれた商品＋このChromeに保存した商品）。Amazon全件との一致は未確認。`;
  }
  function formatCSV(v){
    let s=String(v??'');if(/^[\s]*[=+@\-\t\r]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  }
  function rows(){return [...entries.values()];}
  function csvText(){
    const data=[['リスト名','商品名','商品説明','表示価格','中古価格（参考）','中古配送料（参考）','中古＋配送料合計（参考）','価格取得元','Amazon商品URL','タグ','色']];
    for(const i of rows()){const n=getNote(i.id);data.push([listTitle(),i.title,i.description||'',i.price,i.usedPrice||'',i.usedShipping||'未確認',i.usedTotal||'',i.usedSource||'',i.url,n.tag||'',colors[n.color]||'なし']);}
    return '\ufeff'+data.map(row=>row.map(formatCSV).join(',')).join('\r\n');
  }
  function download(filename,content,mime){
    const obj=URL.createObjectURL(new Blob([content],{type:mime}));const a=el('a');a.href=obj;a.download=filename;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(obj),1000);
  }
  function aiText(allLists=false){
    if(allLists){
      const collections={...cache,[currentId]:{updatedAt:Date.now(),name:listTitle(),items:rows()}};
      const chunks=[
        'Amazonの複数のほしい物リストを横断して整理してください。',
        '依頼: リストごとと全体のカテゴリー分け、重複商品、優先順位、購入・図書館・中古の選択肢を検討してください。',
        '重要: これはこのChromeでこれまで取得した商品の記録で、各リストのAmazon上の全件とは限りません。',
        ''
      ];
      for(const [key,list] of Object.entries(collections)){
        const items=Array.isArray(list?.items)?list.items:[];
        if(!items.length)continue;
        chunks.push(`## ${list.name||key} (${items.length}件収集済み)`);
        items.forEach((i,index)=>{
          const n=notes[`${key}|${i.id}`]||{};
          chunks.push(`${index+1}. ${i.title} / 商品説明: ${(i.description||'未取得').slice(0,600)} / 表示価格: ${i.price||'未取得'} / 中古: ${i.usedPrice||'未確認'} / 送料: ${i.usedShipping||'未確認'} / 中古＋送料合計: ${i.usedTotal||'未確認'} / タグ: ${n.tag||'なし'} / ${i.url||'URL未取得'}`);
        });
        chunks.push('');
      }
      return chunks.join('\n');
    }
    const items=rows();
    const lines=[
      '私のAmazonほしい物リストを整理・分析してください。',
      '目的：①カテゴリー分け ②優先順位（必要性・費用対効果）③似た商品・重複の指摘 ④本であれば図書館や中古も検討 ⑤買う前に確認したいことを整理。',
      '価格は取得時点で表示されていた参考値です。曖昧な商品情報は推測と明記し、未収集商品がある可能性を考慮してください。',
      `リスト名: ${listTitle()}`,
      `収集できた商品: ${items.length}件（リスト全体かは不明。画面外の商品も取得履歴に残っていれば含む）`,
      `作成日時: ${new Date().toLocaleString('ja-JP')}`,
      '',
      '--- 商品 ---'
    ];
    items.forEach((i,index)=>{
      const n=getNote(i.id);
      lines.push(`${index+1}. ${i.title}\n   商品説明: ${(i.description||'未取得').slice(0,600)}\n   表示価格: ${i.price||'未取得'} / 中古: ${i.usedPrice||'未確認'} / 送料: ${i.usedShipping||'未確認'} / 中古＋送料合計: ${i.usedTotal||'未確認'} / タグ: ${n.tag||'なし'} / 色: ${colors[n.color]||'なし'}\n   ${i.url||'URL未取得'}`);
    });
    return lines.join('\n');
  }
  async function copyAI(allLists=false){
    const text=aiText(allLists);
    try{
      await navigator.clipboard.writeText(text);status(`AI用の文章をコピーしました。AIの入力欄で ⌘V（WindowsはCtrl+V）してください。`);
    }catch{
      // Extra fallback: show text in a modal for manual copying.
      showTextModal(text);
    }
  }
  function showTextModal(text){
    document.getElementById('amtk-wl-modal')?.remove();
    const wrap=el('div','amtk-wl-modal');wrap.id='amtk-wl-modal';
    const content=el('div','amtk-wl-modal-content');
    content.append(el('h2','','AIに渡すリスト'),el('p','','コピーできない場合は、以下のテキストを選択してコピーしてください。'));
    const ta=el('textarea');ta.value=text;ta.rows=13;content.append(ta,btn('閉じる',()=>wrap.remove()));wrap.append(content);document.body.append(wrap);ta.focus();ta.select();
  }
  function openAI(url){
    // A user gesture opens the service. Text is copied, not silently sent to a third party.
    window.open(url,'_blank','noopener,noreferrer');
    copyAI(false);
  }
  function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
  async function gatherAll(){
    if(collecting)return;
    collecting=true;abortCollection=false;
    userPaused=false;stopDescriptions=false;
    scheduleAutoPrices();updateFloatingStop();
    const previousScroll=window.scrollY;
    const oldNative=nativeVisible;
    setNativeVisibility(true);
    document.documentElement.classList.remove('amtk-wl-hide-native');
    drawSoon();
    await sleep(180);
    let pos=0,step=0,stale=0,lastSize=entries.size,lastHeight=0,completed=false;
    window.scrollTo({top:0,behavior:'instant'});
    try{
      while(step<180&&!abortCollection&&currentListId()===currentId){
        const height=Math.max(document.documentElement.scrollHeight,document.body.scrollHeight);
        const view=Math.max(window.innerHeight,500);
        window.scrollTo({top:pos,behavior:'instant'});
        await sleep(360);
        if(abortCollection || currentListId()!==currentId)break;
        scan();
        if(step%4===0)status(`自動収集中… ${entries.size}件 / スクロール ${step+1}回。停止ボタンで中止できます。`);
        const bottom=(pos+view>=height-100);
        if(bottom){
          // Give Amazon some time to append the next batch at the bottom.
          await sleep(650);if(abortCollection||currentListId()!==currentId)break;scan();
          const newHeight=Math.max(document.documentElement.scrollHeight,document.body.scrollHeight);
          if(entries.size===lastSize&&newHeight<=lastHeight+30)stale++;
          else stale=0;
          lastSize=entries.size;lastHeight=newHeight;
          if(stale>=5){completed=true;break;}
        }
        pos=Math.min(pos+Math.max(400,Math.floor(view*0.70)),Math.max(0,Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)-view));
        step++;
      }
    }finally{
      collecting=false;
      persistSoon();
      updateFloatingStop();
      setNativeVisibility(oldNative);
      window.scrollTo({top:previousScroll,behavior:'instant'});
      status(`${entries.size}件収集。${abortCollection?'停止しました。':completed?'ページ下部まで走査しました。':'最大走査数に達しました。'} Amazon側で未配信の項目は取得できない場合があります。`);
      drawSoon();
      updateFloatingStop();
    }
  }
  function clearPanel(){
    gridResizeObserver?.disconnect();gridResizeObserver=null;
    panel?.remove();panel=null;
    floatingStop?.remove();floatingStop=null;
    document.documentElement.classList.remove('amtk-wl-hide-native');
  }
  function normalized(v){return String(v??'').normalize('NFKC').toLocaleLowerCase('ja-JP');}
  function itemMatches(item){
    if(aiMatches && !aiMatches.has(item.id))return false;
    const n=getNote(item.id);
    const words=normalized(filterText).trim().split(/\s+/).filter(Boolean);
    const haystack=normalized([item.title,item.price,item.usedPrice,item.usedShipping,item.usedCondition,item.description,n.tag,colors[n.color]||'',item.id].join(' '));
    if(!words.every(word=>haystack.includes(word)))return false;
    if(filterMode==='priced')return !!item.usedPrice;
    if(filterMode==='total')return !!item.usedTotal;
    if(filterMode==='unpriced')return !item.usedPrice;
    if(filterMode==='tagged')return !!n.tag;
    return true;
  }
  function renderFilteredGrid(){
    const grid=panel?.querySelector('.amtk-wl-grid');
    if(!grid)return;
    const matching=rows().filter(itemMatches);
    if(aiMatches)matching.sort((a,b)=>(aiMatches.get(b.id)?.score||0)-(aiMatches.get(a.id)?.score||0));
    const results=panel.querySelector('#amtk-wl-match-count');
    if(results)results.textContent=`${matching.length}件ヒット / ${entries.size}件収集済み${aiMatches?'（AI候補）':''}`;
    const chunk=document.createDocumentFragment();
    for(const record of matching.slice(0,2000)){
      const c=card(record);
      if(aiMatches?.has(record.id)){
        const match=aiMatches.get(record.id);
        const why=el('div','amtk-wl-ai-reason',`AI評価 ${match.score}/100：${match.reason}`);
        c.insertBefore(why,c.firstChild);
      }
      chunk.append(c);
    }
    if(!matching.length)chunk.append(el('div','amtk-wl-empty',entries.size?'該当する商品はありません。キーワードや絞り込み条件を変更してください。':'Amazonの商品情報をまだ取得できていません。'));
    grid.replaceChildren(chunk);
    const limit=panel.querySelector('#amtk-wl-view-limit');
    if(limit)limit.textContent=matching.length>2000?'表示を軽くするため検索結果の先頭2000件を表示。CSV・AI出力には収集済み全件を含みます。':'';
  }
  function asinOfItem(item){return typeof AMTKUsed!=='undefined'?AMTKUsed.asinFrom(item.url):'';}
  async function fetchDescription(asin,signal){
    const url=`https://www.amazon.co.jp/dp/${encodeURIComponent(asin)}`;
    const r=await fetch(url,{credentials:'include',redirect:'follow',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
    if([403,429,503].includes(r.status))return {status:'blocked'};
    if(!r.ok)return {status:'error'};
    const len=Number(r.headers.get('content-length'));
    if(len>3000000)return {status:'error'};
    const html=await r.text();if(html.length>3000000)return {status:'error'};
    if(AMTKUsed.isBlocked(html,r.url))return {status:'blocked'};
    const description=AMTKDescription.extract(new DOMParser().parseFromString(html,'text/html'));
    return description?{status:'ok',description}:{status:'unavailable'};
  }
  async function bulkDescriptions(){
    if(fetchingDescriptions)return;
    const targets=[];
    const now=Date.now();
    const seen=new Set();
    for(const i of rows()){
      const asin=asinOfItem(i);
      if(!asin||seen.has(asin)||i.description)continue;
      seen.add(asin);
      const d=descriptions[asin];
      // Failed fetches are cached for a day, so reloading does not hammer Amazon.
      if(d?.at && now-d.at<24*3600e3)continue;
      targets.push(asin);
    }
    if(!targets.length){status('未収集の説明文はありません。取得できない商品は24時間後に再試行できます。');return;}
    fetchingDescriptions=true;stopDescriptions=false;abortCollection=false;userPaused=false;lastSignature='';drawSoon();
    updateFloatingStop();scheduleAutoPrices();
    let added=0,failed=0,blocked=false;
    const batch=targets.slice(0,DESCRIPTION_BATCH);
    for(let i=0;i<batch.length&&!stopDescriptions;i++){
      if(document.hidden){status('説明収集を一時停止しています。タブに戻ると再開します。');while(document.hidden&&!stopDescriptions)await sleep(500);}
      const asin=batch[i];
      status(`商品説明を収集中 ${i+1}/${batch.length}件（残りの未取得商品は次回まとめて収集できます）`);
      let result;
      const controller=new AbortController();descriptionController=controller;
      try{result=await fetchDescription(asin,controller.signal);}catch{result={status:'error'};}
      finally{if(descriptionController===controller)descriptionController=null;}
      if(stopDescriptions||controller.signal.aborted)break;
      if(result.status==='blocked'){blocked=true;status('Amazonのアクセス制限を検出。説明文の収集を停止しました。');break;}
      descriptions[asin]={at:Date.now(),status:result.status,description:result.description||''};
      if(result.description){added++;mergeDescriptions();}else failed++;
      if(i%5===0 || i===batch.length-1){
        try{await chrome.storage.local.set({[DESC_KEY]:descriptions});}catch{status('説明文の保存に失敗しました。');}
      }
      if(i<batch.length-1&&!stopDescriptions)await sleep(1750);
    }
    try{await chrome.storage.local.set({[DESC_KEY]:descriptions});}catch{}
    fetchingDescriptions=false;lastSignature='';drawSoon();updateFloatingStop();
    status(`商品説明：${added}件取得・${failed}件取得できず${blocked?'・Amazonのアクセス制限で停止':''}${stopDescriptions?'・ユーザーが停止':''}。収集済み説明文は通常検索とAI検索で使えます。`);
  }
  async function runAISearch(){
    if(aiRunning)return;
    const query=aiQuery.trim();
    if(!query){aiMessage='AIで探したい内容を入力してください。';setAiMessage();return;}
    const arr=rows();if(!arr.length){aiMessage='検索できる商品がまだありません。';setAiMessage();return;}
    const maxItems=500;
    const items=arr.slice(0,maxItems);
    if(!window.confirm(`収集済み${arr.length}件のうち${items.length}件の商品名・商品説明・タグをGemini APIへ送信します。API利用料が発生する場合があります。実行しますか？`))return;
    aiRunning=true;aiMatches=null;
    aiMessage=`AI検索を開始：${items.length}件を照合します…`;
    setAiMessage();
    const matches=new Map();let scanned=0;
    try{
      for(let start=0;start<items.length;start+=40){
        const chunk=items.slice(start,start+40);
        const records=chunk.map((item,i)=>({i,title:item.title.slice(0,220),description:(item.description||'').slice(0,600),tags:(getNote(item.id).tag||'').slice(0,60)}));
        const result=await chrome.runtime.sendMessage({type:'amtk-ai-search',query,items:records});
        if(!result?.ok)throw Error(result?.error||'AI検索の通信に失敗しました');
        for(const row of result.matches||[]){
          const item=chunk[row.i];if(!item)continue;
          const score=Math.min(100,Math.max(0,Number(row.score)||0));
          if(score>=50)matches.set(item.id,{score,reason:String(row.reason||'関連する可能性があります').slice(0,130)});
        }
        scanned+=chunk.length;aiMessage=`AI照合中：${scanned}/${items.length}件、候補 ${matches.size}件`;setAiMessage();
        await sleep(550);
      }
      aiMatches=matches;
      aiMessage=`AI検索完了：${scanned}/${arr.length}件をAIで照合。候補 ${matches.size}件。AI判定は参考です。${arr.length>maxItems?'先頭500件までを照合。':''}`;
      filterText='';filterMode='all';lastSignature='';drawSoon();
    }catch(e){
      aiMatches=null;
      aiMessage=`AI検索に失敗しました：${String(e.message||e).slice(0,180)}。通常検索は利用できます。`;
      setAiMessage();
    }finally{aiRunning=false;setAiMessage();}
  }
  function setAiMessage(){
    const n=panel?.querySelector('#amtk-wl-ai-status');if(n)n.textContent=aiMessage;
    const b=panel?.querySelector('#amtk-wl-ai-search');if(b)b.disabled=aiRunning;
  }
  function draw(){
    if(!settings.amtkWishlistEnabled){clearPanel();floatingStop?.remove();floatingStop=null;return;}
    updateFloatingStop();
    makePanel();if(!panel)return;
    const signature=`${currentId}|${entries.size}|${dataRevision}|${settings.amtkWishlistCols}|${nativeVisible}|${collecting}|${fetchingDescriptions}|${userPaused}|${lastError}`;
    // Rebuild only when actual data or configuration changed; avoid MutationObserver loops.
    if(lastSignature===signature&&panel.querySelector('.amtk-wl-grid')){
      const t=panel.querySelector('#amtk-wl-status');if(t&&collectionLog)t.textContent=collectionLog;
      return;
    }
    // Async Amazon price/description updates may arrive while the user is typing.
    // Replacing the search input, even if refocused with the old caret position,
    // destroys the in-progress Japanese IME conversion candidate window.
    if(isEditingPanel()){
      pendingEditorRefresh=true;
      const count=panel.querySelector('.amtk-wl-heading small');
      if(count)count.textContent=countDetail();
      // Search results update in place while the search field itself survives.
      // Avoid rebuilding card inputs if the user is editing a tag.
      if(!isEditingCard() && !composingSearch)renderFilteredGrid();
      return;
    }
    pendingEditorRefresh=false;
    lastSignature=signature;
    gridResizeObserver?.disconnect();gridResizeObserver=null;
    const focus=panel.querySelector('#amtk-wl-query')===document.activeElement;
    const caret=focus?document.activeElement.selectionStart:null;
    panel.replaceChildren();
    const head=el('div','amtk-wl-bar');
    const heading=el('div','amtk-wl-heading');heading.append(el('strong','','🛍 ほしい物リスト整理'),el('small','',countDetail()));head.append(heading);
    const actions=el('div','amtk-wl-actions');
    const label=el('label','','表示列数 '),cols=el('select');
    for(let i=1;i<=10;i++){const opt=el('option','',`${i}列`);opt.value=String(i);cols.append(opt);}
    cols.value=String(Math.min(10,Math.max(1,Number(settings.amtkWishlistCols)||6)));
    cols.addEventListener('change',()=>chrome.storage.sync.set({amtkWishlistCols:Number(cols.value)}));
    const effective=el('small','amtk-wl-effective','指定列数で表示');
    label.append(cols,effective);actions.append(label);
    const parallelLabel=el('label','','同時照合 '),parallelSelect=el('select');
    parallelSelect.setAttribute('aria-label','中古価格の同時照合件数');
    for(let i=1;i<=3;i++){const option=el('option','',`${i}件`);option.value=String(i);parallelSelect.append(option);}
    parallelSelect.value=String(Math.min(3,Math.max(1,Number(settings.amtkPriceConcurrency)||2)));
    parallelSelect.addEventListener('change',()=>chrome.storage.sync.set({amtkPriceConcurrency:Number(parallelSelect.value)}));
    parallelLabel.append(parallelSelect);actions.append(parallelLabel);
    actions.append(btn(fetchingDescriptions?'■ 全収集を停止':'📖 説明文をまとめて取得（30件）',()=>{if(fetchingDescriptions)stopAll();else void bulkDescriptions();},'amtk-wl-primary'));
    actions.append(btn(collecting?'■ 全収集を停止':'↓ 全件収集を試す',()=>{if(collecting)stopAll();else void gatherAll();},'amtk-wl-primary'));
    if(userPaused)actions.append(btn('▶ 中古価格照合を再開',resumePriceChecks,'amtk-wl-primary'));
    actions.append(btn('CSV保存',()=>download(`amazon-wishlist-${new Date().toISOString().slice(0,10)}.csv`,csvText(),'text/csv;charset=utf-8')));
    actions.append(btn('AI用テキスト保存',()=>download(`amazon-wishlist-ai-${new Date().toISOString().slice(0,10)}.txt`,aiText(),'text/plain;charset=utf-8')));
    actions.append(btn('このリストをAIへコピー',()=>copyAI(false),'amtk-wl-primary'));
    actions.append(btn('保存済みの全リストをAIへコピー',()=>copyAI(true)));
    actions.append(btn('ChatGPT ↗',()=>openAI('https://chatgpt.com/')));
    actions.append(btn('Gemini ↗',()=>openAI('https://gemini.google.com/app')));
    actions.append(btn('Claude ↗',()=>openAI('https://claude.ai/new')));
    actions.append(btn(nativeVisible?'オリジナル表示を閉じる':'Amazon元の表示',()=>{setNativeVisibility(!nativeVisible);lastSignature='';drawSoon();},'amtk-wl-native-btn'));
    head.append(actions);panel.append(head);
    const line=el('div','amtk-wl-status',collectionLog||lastError||'画面に読み込まれた商品の中古出品情報を自動照合します。取得できない商品は理由を表示します。');line.id='amtk-wl-status';panel.append(line);
    const finder=el('div','amtk-wl-finder');
    const query=el('input','amtk-wl-query');query.type='search';query.id='amtk-wl-query';
    query.placeholder='商品名・タグ・価格などで検索';query.setAttribute('aria-label','ほしい物リスト内を検索');
    query.value=filterText;
    const mode=el('select','amtk-wl-filter');mode.setAttribute('aria-label','検索結果を絞り込む');
    for(const [id,label] of [['all','すべて'],['priced','中古価格あり'],['total','送料込み合計あり'],['unpriced','中古価格未取得'],['tagged','タグ付き']]){
      const option=el('option','',label);option.value=id;mode.append(option);
    }
    mode.value=filterMode;
    finder.append(query,mode);
    const counter=el('span','amtk-wl-match-count');counter.id='amtk-wl-match-count';finder.append(counter);
    const clear=btn('クリア',()=>{filterText='';filterMode='all';query.value='';mode.value='all';renderFilteredGrid();query.focus();},'amtk-wl-clear');
    finder.append(clear);panel.append(finder);
    const aiBar=el('div','amtk-wl-ai-bar');
    const aiInput=el('input','amtk-wl-ai-query');aiInput.type='search';aiInput.placeholder='AIで探す：例「社会の仕組みがわかる本」';aiInput.value=aiQuery;aiInput.setAttribute('aria-label','AIに探してほしいこと');
    aiInput.addEventListener('compositionstart',()=>{composingAI=true;});
    aiInput.addEventListener('compositionend',()=>{composingAI=false;aiQuery=aiInput.value;});
    aiInput.addEventListener('input',()=>{aiQuery=aiInput.value;});
    // Enter during Japanese IME conversion selects a candidate; it must not run AI search.
    aiInput.addEventListener('keydown',e=>{
      if(e.key==='Enter' && !(e.isComposing || composingAI || e.keyCode===229)){
        e.preventDefault();aiQuery=aiInput.value;void runAISearch();
      }
    });
    const doAI=btn('AIで意味検索',()=>{aiQuery=aiInput.value;void runAISearch();},'amtk-wl-primary');doAI.id='amtk-wl-ai-search';doAI.disabled=aiRunning;
    const clearAI=btn('AI結果を解除',()=>{aiMatches=null;aiMessage='通常検索に戻しました。';lastSignature='';drawSoon();},'amtk-wl-clear');
    const aiInfo=el('small','amtk-wl-ai-status',aiMessage);aiInfo.id='amtk-wl-ai-status';
    aiBar.append(aiInput,doAI,clearAI,aiInfo);panel.append(aiBar);
    let searchDebounce=0;
    const updateSearch=(immediate=false)=>{
      filterText=query.value;
      clearTimeout(searchDebounce);
      if(immediate)renderFilteredGrid();
      else searchDebounce=setTimeout(renderFilteredGrid,140);
    };
    query.addEventListener('compositionstart',()=>{composingSearch=true;});
    query.addEventListener('input',()=>{
      // Live preview is safe: only cards update, never the focused input.
      updateSearch();
    });
    query.addEventListener('compositionend',()=>{
      composingSearch=false;
      // The confirmed kanji/kana is searchable immediately, without a second Enter.
      updateSearch(true);
    });
    mode.addEventListener('change',()=>{filterMode=mode.value;renderFilteredGrid();});
    const visible=el('div','amtk-wl-grid-scroll');
    const grid=el('div','amtk-wl-grid');
    // Exact columns, not a maximum. Cards shrink and wrap instead of adding an inner scrollbar.
    // A high column count in a narrow browser may yield very small cards; that's user-controlled.
    const preferred=Math.min(10,Math.max(1,Number(settings.amtkWishlistCols)||6));
    function fitColumns(){
      if(!visible.isConnected)return;
      grid.style.setProperty('--amtk-effective-columns',String(preferred));
      grid.dataset.columns=String(preferred);
      const cardWidth=(visible.clientWidth-22-Math.max(0,preferred-1)*8)/preferred;
      grid.classList.toggle('amtk-wl-dense',cardWidth<145);
      effective.textContent=`${preferred}列固定`;
    }
    const limit=el('div','amtk-wl-view-limit');limit.id='amtk-wl-view-limit';
    visible.append(grid);panel.append(visible,limit);
    renderFilteredGrid();
    if(focus){query.focus();try{query.setSelectionRange(caret,caret);}catch{}}
    fitColumns();
    if(typeof ResizeObserver==='function'){
      gridResizeObserver=new ResizeObserver(fitColumns);
      gridResizeObserver.observe(visible);
    }
    setNativeVisibility(nativeVisible);
  }
  function drawSoon(){clearTimeout(renderTimer);renderTimer=setTimeout(draw,260);}
  function scheduleScan(){clearTimeout(renderTimer);renderTimer=setTimeout(()=>{scan();draw();},380);}
  function getListSwitch(){
    const id=currentListId();
    if(id===currentId)return;
    currentId=id;
    filterText='';filterMode='all';aiMatches=null;aiQuery='';
    priceQueue=[];queueSet.clear();
    entries=new Map((cache[id]?.items||[]).filter(x=>x?.id&&x?.title).map(x=>[x.id,x]));
    lastSignature='';
    collectionLog='';
    // Restore Amazon's own list during navigation until the new mirror is populated.
    setNativeVisibility(false);
  }
  async function init(){
    try{
      const [cfg,local]=await Promise.all([chrome.storage.sync.get(defaults),chrome.storage.local.get([KEY,NOTES,PRICE_CACHE,DESC_KEY])]);
      settings={...defaults,...cfg};cache=local[KEY]||{};notes=local[NOTES]||{};priceCache=local[PRICE_CACHE]||{};descriptions=local[DESC_KEY]||{};
      getListSwitch();mergeDescriptions();scan();draw();updatePricingStatus();
      chrome.storage.onChanged.addListener((changes,area)=>{
        if(area==='local' && changes[DESC_KEY]){
          descriptions=changes[DESC_KEY].newValue||{};mergeDescriptions();
        }
        if(area==='sync'){
          for(const k of Object.keys(defaults))if(changes[k])settings[k]=changes[k].newValue;
          lastSignature='';drawSoon();scheduleAutoPrices();
        }
      });
      new MutationObserver(mutations=>{
        const pageChanged=mutations.some(m=>!m.target?.closest?.('#amtk-wishlist-panel') && !m.target?.closest?.('#amtk-wl-modal') && !m.target?.closest?.('#amtk-wl-floating-stop') &&
          ![...m.addedNodes].every(n=>n.nodeType===1&&(n.id==='amtk-wishlist-panel'||n.id==='amtk-wl-floating-stop'||n.closest?.('#amtk-wishlist-panel')||n.closest?.('#amtk-wl-floating-stop'))));
        if(!pageChanged)return;
        getListSwitch();scheduleScan();
      }).observe(document.documentElement,{childList:true,subtree:true});
      document.addEventListener('visibilitychange',()=>{if(!document.hidden){getListSwitch();scheduleScan();scheduleAutoPrices();}});
    }catch(err){console.warn('Amazon Toolkit wishlist initialization:',err);}
  }
  init();
})();
