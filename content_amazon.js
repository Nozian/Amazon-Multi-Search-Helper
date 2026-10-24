/* 元の Amazon Multi-Search Helper を基に再構成。外部スクリプト・通信はなし。 */
(() => {
  'use strict';
  // content scripts share an isolated world; sites.js is loaded via manifest before this file.
  const ITEM_CLASSES = 'amtk-compare-links';
  const defaults={amtkCompareEnabled:true,preferredSites:DEFAULT_SITES};
  let config={...defaults};
  let debounceTimer;
  let scanning=false;
  function isWishlist(){return /\/(?:hz\/)?wishlist\b/.test(location.pathname);}
  function isCart(){return /\/gp\/cart\b/.test(location.pathname);}
  function isProduct(){return /\/(?:dp|gp\/product)\//.test(location.pathname);}
  function getTitle(node, selectors){
    for(const sel of selectors){
      const e=node.querySelector(sel);
      const text=e && (e.getAttribute('title')||e.textContent||e.getAttribute('alt')||'').trim();
      if(text) return text;
    }
    return null;
  }
  const searchTitleSelectors=['h2 a span','h2 span.a-text-normal','.a-size-medium.a-color-base.a-text-normal','.a-size-base-plus.a-color-base.a-text-normal'];
  const wishTitleSelectors=['a[id^="itemName_"]','a[id*="itemName"]','h2 a','.a-link-normal[title]','.g-item-details a[href*="/dp/"]'];
  const cartTitleSelectors=['.sc-product-title','a.sc-product-link','.a-truncate-full'];
  function addLinks(title, container){
    if (!title || !container || container.querySelector(`.${ITEM_CLASSES}`)) return;
    const clean=cleanBookTitle(title);
    if(!clean) return;
    const chosen = Array.isArray(config.preferredSites)?config.preferredSites:DEFAULT_SITES;
    const chosenSites=SITES.filter(site=>chosen.includes(site.id));
    if(!chosenSites.length) return;
    const bar=document.createElement('div');
    bar.className=ITEM_CLASSES;
    bar.setAttribute('aria-label','ほかのサイトで探す');
    const titleText=document.createElement('span');
    titleText.className='amtk-compare-heading';titleText.textContent='ほかで探す';
    bar.appendChild(titleText);
    for(const site of chosenSites){
      const a=document.createElement('a');
      a.href=siteUrl(site,clean);
      a.target='_blank';a.rel='noopener noreferrer';a.textContent=site.name;
      a.title=`「${clean}」を${site.name}で検索`;
      bar.appendChild(a);
    }
    container.appendChild(bar);
  }
  function scan(){
    if(scanning||!document.body) return;
    scanning=true;
    try{
      if(!config.amtkCompareEnabled){
        document.querySelectorAll(`.${ITEM_CLASSES}`).forEach(el=>el.remove());
        return;
      }
      if(isProduct()){
        const title=getTitle(document,['#productTitle','#ebooksProductTitle','h1#title','.parseasinTitle #btAsinTitle']);
        const box=document.querySelector('#centerCol, #buybox_feature_div .a-box-inner, #buybox, #desktop_buybox');
        if(title&&box) addLinks(title,box);
      }else if(isWishlist()){
        // v1.1: The independent Wishlist panel includes per-item cross-site search.
        // Do not inject 16 links into each Amazon native li: it breaks Amazon's own layout.
      }else if(isCart()){
        document.querySelectorAll('.sc-list-item, div[data-item-id]').forEach(item=>{
          const title=getTitle(item,cartTitleSelectors);
          addLinks(title,item.querySelector('.sc-list-item-content')||item);
        });
      }else if(location.pathname==='/s'||location.pathname.startsWith('/s/')){
        document.querySelectorAll('.s-result-item[data-component-type="s-search-result"], div[data-asin][data-index]').forEach(item=>{
          const title=getTitle(item,searchTitleSelectors);
          addLinks(title,item.querySelector('.a-section.a-spacing-small.a-spacing-top-small, .sg-col-inner')||item);
        });
      }
    }finally{scanning=false;}
  }
  function schedule(){clearTimeout(debounceTimer);debounceTimer=setTimeout(scan,380);}
  chrome.storage.sync.get(defaults).then(data=>{config={...defaults,...data};schedule();});
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='sync') return;
    if(changes.amtkCompareEnabled)config.amtkCompareEnabled=changes.amtkCompareEnabled.newValue;
    if(changes.preferredSites)config.preferredSites=changes.preferredSites.newValue;
    // Remove stale buttons so changes in enabled site list take effect.
    document.querySelectorAll(`.${ITEM_CLASSES}`).forEach(el=>el.remove());
    schedule();
  });
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
})();
