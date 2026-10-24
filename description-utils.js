/* Extract only human-readable product details, without collecting personal account data. */
const AMTKDescription=(()=>{
 'use strict';
 function clean(s){return String(s||'').replace(/\s+/g,' ').trim();}
 function extract(doc){
   const selectors=['#productDescription p','#productDescription','#bookDescription_feature_div .a-expander-content',
   '#bookDescription_feature_div','#feature-bullets li span.a-list-item',
   '#detailBullets_feature_div li','#productFactsDesktopExpander li','#aplus_feature_div .aplus-v2 p'];
   const seen=new Set(),out=[];
   for(const s of selectors){
     for(const n of doc.querySelectorAll(s).item ? doc.querySelectorAll(s) : []){
       const text=clean(n.textContent);
       if(text.length<14||seen.has(text)||out.some(x=>x.includes(text)))continue;
       if(/^(画像|商品画像|星[0-9]|カスタマーレビュー|Amazon.co.jp)/.test(text))continue;
       seen.add(text);out.push(text);
       if(out.join(' ').length>1600)break;
     }
     if(out.join(' ').length>1600)break;
   }
   if(!out.length){
     const m=doc.querySelector('meta[name="description"]');
     const fallback=clean(m?.getAttribute('content'));
     if(fallback.length>60&&!/amazonの(通販|サイト)|Amazon.co.jpで/.test(fallback))out.push(fallback);
   }
   return out.join('　').slice(0,1800);
 }
 return {extract};
})();
