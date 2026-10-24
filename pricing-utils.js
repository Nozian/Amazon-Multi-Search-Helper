/* Amazon Toolkit v1.4 — extracts prices only from explicit used-offer contexts.
 * Amazon offer pages are not a stable API; unavailable and unverified are first-class states.
 */
const AMTKUsed = (() => {
  'use strict';
  const amountPattern = '(?:[￥¥]\\s*|JPY\\s*)([0-9０-９][0-9０-９,，]*)|([0-9０-９][0-9０-９,，]*)\\s*円';
  const amountRE = new RegExp(amountPattern, 'gi');
  const yenText = n => n == null ? '' : `¥${n.toLocaleString('ja-JP')}`;
  function toNumber(value) {
    const n = Number(String(value || '').replace(/[０-９]/g, c => String(c.charCodeAt(0) - 65296)).replace(/[,，\s]/g, ''));
    return Number.isSafeInteger(n) && n >= 0 && n < 1000000000 ? n : null;
  }
  function amounts(text) {
    return [...String(text || '').matchAll(amountRE)].map(m => ({number:toNumber(m[1] || m[2]), index:m.index, raw:m[0]})).filter(x => x.number != null);
  }
  function normalize(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
  function shipping(text) {
    const t = normalize(text);
    // "送料はレジで計算" is unknown, never zero.
    if(/(?:配送料|送料|配送手数料)[^。\n]{0,32}(?:レジ|注文確定|チェックアウト|お届け先|別途|計算される)/.test(t))return null;
    if(/(?:配送料無料|送料無料|送料\s*無料|無料配送|送料\s*(?:[:：]|は)?\s*(?:￥|¥)?\s*0\s*円?)/.test(t))return 0;
    const patterns = [
      /(?:配送料|送料|配送手数料)\s*(?:[:：はが+＋・]?\s*)(?:￥|¥|JPY\s*)?([0-9０-９][0-9０-９,，]*)\s*(?:円)?/i,
      /(?:\+|＋)\s*(?:￥|¥|JPY\s*)?([0-9０-９][0-9０-９,，]*)\s*(?:円)?\s*(?:配送料|送料|配送手数料)/i,
      /(?:￥|¥)\s*([0-9０-９][0-9０-９,，]*)\s*(?:円)?\s*(?:の)?\s*(?:配送料|送料|配送手数料)/i,
      /([0-9０-９][0-9０-９,，]*)\s*円\s*(?:の)?\s*(?:配送料|送料|配送手数料)/i
    ];
    for(const re of patterns) { const m=t.match(re); if(m) return toNumber(m[1]); }
    return null;
  }
  function unpack(price, fee, source, condition = '') {
    if(price == null || price <= 0)return null;
    return {
      usedPrice: yenText(price),
      usedShipping: fee == null ? '' : fee === 0 ? '無料' : yenText(fee),
      usedTotal: fee == null ? '' : yenText(price + fee),
      usedSource: source,
      usedCondition: condition
    };
  }
  function parseBlock(text, explicitUsed = false, source = 'Amazonの表示') {
    const raw=normalize(text).slice(0,2000);
    if(!raw)return null;
    const usedAt=raw.search(/中古(?:品|商品|価格|から|の出品|：|:)?|\bused\b|ほぼ新品|非常に良い/ig);
    if(usedAt < 0 && !explicitUsed) return null;
    if(/新品\s*(?:[＆&+＋・]|と|および)\s*中古/.test(raw) && !explicitUsed)return null;
    const prices=amounts(raw);
    const price=usedAt >= 0 ? prices.find(p=>p.index>usedAt && p.index<usedAt+200) : prices[0];
    if(!price)return null;
    const local=raw.slice(Math.max(0,usedAt),Math.min(raw.length,price.index+240));
    return unpack(price.number,shipping(local),source);
  }
  function extract(root, kind) {
    const selectors=kind==='wishlist' ? [
      '[id*="itemUsedPrice"]', '[id*="itemUsedAndNewPrice"]', '.itemUsedAndNewPrice',
      '[data-testid*="used-price"]', 'a[href*="condition=used"]', '[class*="used-price"]'
    ] : [
      '#usedBuyBox','#usedBuySection','#usedAccordionRow','#used-fbuybox',
      '#usedPrice','#olp-used','#olp-upd-new-used','[data-testid="used-offer"]',
      '[data-csa-c-item-type="used"]','a[href*="condition=used"]'
    ];
    for(const sel of selectors){
      for(const node of root.querySelectorAll(sel)) {
        const own=normalize(node.textContent);
        const contexts=[own];
        if(own.length<90 && node.parentElement)contexts.push(normalize(node.parentElement.textContent));
        if(own.length<45 && node.parentElement?.parentElement && normalize(node.parentElement.parentElement.textContent).length<600)contexts.push(normalize(node.parentElement.parentElement.textContent));
        const explicit=/usedPrice|usedBuy|olp-used|used-offer/i.test(sel);
        for(const txt of contexts){ const result=parseBlock(txt,explicit,kind==='wishlist'?'リスト上の表示':'Amazon商品ページ');if(result)return result; }
      }
    }
    return null;
  }
  function distinctOfferNodes(doc) {
    const selectors=[
      '#aod-offer', '.aod-offer', '#aod-offer-list > div[id*="offer"]',
      '#olpOfferList .olpOffer', '.olpOffer',
      '[data-testid="offer-listing-item"]', '[data-testid="aod-offer"]',
      '[data-csa-c-type="widget"][data-csa-c-slot-id*="offer"]'
    ];
    const seen=new Set(), list=[];
    for(const sel of selectors){
      for(const node of doc.querySelectorAll(sel)){
        if(seen.has(node)||list.some(parent=>parent.contains(node)))continue;
        // Do not treat a sub-element of an existing offer as a separate offer.
        if(node.closest('#amtk-wishlist-panel'))continue;
        seen.add(node);list.push(node);
      }
    }
    return list;
  }
  function parseOfferNode(node, explicitlyUsedPage = false) {
    const text=normalize(node.textContent).slice(0,4500);
    const condition=normalize(node.querySelector('#aod-offer-heading, .olpCondition, #aod-offer-condition, [id*="condition"], [data-testid="offer-condition"]')?.textContent || '');
    const used=/(?:中古|\bused\b|ほぼ新品|非常に良い|ほぼ良い)/i.test(condition) || /(?:中古|\bused\b)/i.test(text.slice(0,180));
    const newOnly=/(?:新品|\bnew\b)/i.test(condition) && !used;
    if(newOnly || (!used && !explicitlyUsedPage))return null;
    // Price and fee MUST come from same offer card. Shipping text alone isn't a price.
    const priceSelectors=['#aod-price .a-offscreen', '#aod-price .a-price-whole', '.olpOfferPrice', '.a-price .a-offscreen', '[data-testid="offer-price"]', '.a-price-whole'];
    let number=null;
    for(const sel of priceSelectors) {
      const e=node.querySelector(sel);
      if(!e)continue;
      const list=amounts(normalize(e.textContent));
      if(list.length){number=list[0].number;break;}
      if(/a-price-whole/.test(sel)){
        const t=normalize(e.textContent).replace(/[^0-9０-９,，]/g,'');
        if(t) {number=toNumber(t);break;}
      }
    }
    if(number==null) {
      const candidates=amounts(text);
      const nonShipping=candidates.find(x=>!/(?:送料|配送料|配送手数料)/.test(text.slice(Math.max(0,x.index-15),x.index)));
      number=nonShipping?.number ?? null;
    }
    if(number==null) return null;
    // Shipping phrase can be anywhere within *this same card*.
    const fee=shipping(text);
    return unpack(number,fee,'Amazon中古出品一覧',condition);
  }
  function fromOffers(doc, explicitlyUsedPage = true){
    const found=distinctOfferNodes(doc).map(n=>parseOfferNode(n,explicitlyUsedPage)).filter(Boolean);
    if(!found.length)return null;
    // Prefer an offer with verified item price + shipping, instead of mixing different sellers.
    const verified=found.filter(x=>x.usedTotal);
    const values=verified.length?verified:found;
    const totalNum=v=>toNumber(String(v).replace(/[^0-9０-９,，]/g,''))??Number.MAX_SAFE_INTEGER;
    values.sort((a,b)=>totalNum(a.usedTotal||a.usedPrice)-totalNum(b.usedTotal||b.usedPrice));
    return {...values[0],usedOfferCount:found.length,usedSource:verified.length?'Amazon中古出品一覧（送料込みの確認済み出品例）':'Amazon中古出品一覧（送料未確認の出品例）'};
  }
  function offersURL(productUrl){
    const asin=asinFrom(productUrl);
    return asin?`https://www.amazon.co.jp/gp/offer-listing/${asin}?condition=used`:String(productUrl||'');
  }
  function asinFrom(productUrl){
    const m=String(productUrl||'').match(/\/(?:dp|gp\/product|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
    return m?.[1]?.toUpperCase()||'';
  }
  function ajaxURL(asin) {return `https://www.amazon.co.jp/gp/aod/ajax/ref=dp_aod_ALL_mbc?asin=${encodeURIComponent(asin)}&pc=dp`;}
  function isBlocked(text,finalUrl=''){
    return /\/errors\/validateCaptcha|\/ap\/signin|\/gp\/aw\/si\.html/i.test(finalUrl) || /<title[^>]*>\s*(?:Robot Check|Amazon Sign-In|ログイン)[^<]*<\/title>|画像に表示されている文字|enter the characters you see below|name=[\"']?amzn-captcha/i.test(String(text||'').slice(0,8000));
  }
  return {parseBlock,fromWishlist:root=>extract(root,'wishlist'),fromProduct:root=>extract(root,'product'),fromOffers,offersURL,ajaxURL,asinFrom,isBlocked};
})();
