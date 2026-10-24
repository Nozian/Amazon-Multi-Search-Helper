/* Amazon Multi-Search Helper の検索先16種類を継承。 */
const SITES = [
  {id:'kindle', name:'Kindle', base:'https://www.amazon.co.jp/s', param:'k'},
  {id:'kinokuniya', name:'紀伊國屋', base:'https://www.kinokuniya.co.jp/disp/CSfDispListPage_001.jsp', param:'q'},
  {id:'honto', name:'honto', base:'https://honto.jp/netstore/search.html', param:'k'},
  {id:'tsutaya', name:'TSUTAYA', base:'https://store-tsutaya.tsite.jp/search/result/', param:'keyword'},
  {id:'yodobashi', name:'ヨドバシ', base:'https://www.yodobashi.com/', param:'word'},
  {id:'bookoff', name:'ブックオフ', base:'https://shopping.bookoff.co.jp/search/keyword/', path:true},
  {id:'valuebooks', name:'バリューブックス', base:'https://www.valuebooks.jp/search', param:'keyword'},
  {id:'library', name:'図書館（カーリル）', base:'https://calil.jp/search', param:'q'},
  {id:'nearbyBookstores', name:'近くの書店', base:'https://www.google.com/maps/search/', path:true, suffix:' 書店'},
  {id:'nearbyBookoff', name:'近くのブックオフ', base:'https://www.google.com/maps/search/', path:true, suffix:' ブックオフ'},
  {id:'rakutenBooks', name:'楽天ブックス', base:'https://books.rakuten.co.jp/search', param:'sitem'},
  {id:'rakutenBookoff', name:'楽天ブックオフ', base:'https://search.rakuten.co.jp/search/mall/', path:true, extras:{sid:'275488'}},
  {id:'rakutenValuebooks', name:'楽天バリューブックス', base:'https://search.rakuten.co.jp/search/mall/', path:true, extras:{sid:'273418'}},
  {id:'mercari', name:'メルカリ', base:'https://jp.mercari.com/search', param:'keyword'},
  {id:'rakutenAll', name:'楽天市場全体', base:'https://search.rakuten.co.jp/search/mall/', path:true},
  {id:'bookmeter', name:'読書メーター', base:'https://bookmeter.com/search', param:'keyword'}
];
const DEFAULT_SITES = SITES.map(site => site.id);
function cleanBookTitle(title) {
  // 原版のタイトル正規化を踏襲。ただし括弧が複数ある場合の過剰削除を避ける。
  return String(title||'').replace(/\s*\([^()]*\)|\[[^\]]*\]|【[^】]*】|\s*第?\d+巻/g, '').trim().slice(0,220);
}
function siteUrl(site, title) {
  const q=cleanBookTitle(title);
  const url=new URL(site.base);
  if(site.path) {
    url.pathname=url.pathname.replace(/\/$/,'')+'/'+encodeURIComponent(q+(site.suffix||''))+(site.extras?'/':'');
    Object.entries(site.extras||{}).forEach(([k,v])=>url.searchParams.set(k,v));
  } else { url.searchParams.set(site.param,q); }
  return url.href;
}
