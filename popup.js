'use strict';
const $=id=>document.getElementById(id);
const defaults={amtkCompareEnabled:true,amtkWishlistEnabled:true,amtkWishlistCols:6,amtkAutoUsedEnabled:true,amtkPriceConcurrency:2};
let busy=false;
let matchCount=0;
function say(msg,err=false){$('status').textContent=msg;$('status').classList.toggle('error',err);}
function listKeywords(items){
  const ul=$('preview');ul.replaceChildren();
  for(const info of items.slice(0,30)){
    const li=document.createElement('li'),q=document.createElement('span'),eng=document.createElement('span');
    q.className='kw';q.textContent=info.query;eng.className='engine';eng.textContent=info.engine;li.append(q,eng);ul.appendChild(li);
  }
  if(items.length>30){const li=document.createElement('li');li.textContent=`ほか ${items.length-30} 件`;ul.appendChild(li);}
  if(items.length===0){const li=document.createElement('li');li.textContent='対象の検索タブはありません';ul.appendChild(li);}
}
async function refresh(){
  try{
    const [tabs,store]=await Promise.all([chrome.tabs.query({}),chrome.storage.local.get('lastConversion')]);
    const matching=tabs.map(x=>SearchToAmazon.getSearchInfo(x.url)).filter(Boolean);
    matchCount=matching.length;$('count').textContent=matchCount;listKeywords(matching);
    $('convert').disabled=busy||matchCount===0;
    $('undo').disabled=busy||!Array.isArray(store.lastConversion)||store.lastConversion.length===0;
  }catch(err){say(`タブの確認に失敗: ${err.message}`,true);}
}
async function run(type){
  if(busy)return;
  busy=true;$('convert').disabled=$('undo').disabled=$('refresh').disabled=true;
  say(type==='convert-all'?'タブを変換しています…':'元の検索結果に戻しています…');
  try{
    const result=await chrome.runtime.sendMessage({type});
    if(!result?.ok)throw Error(result?.error||'実行に失敗しました');
    say(type==='convert-all'?`${result.changed} 件をAmazon検索へ変換しました。${result.failed?` 失敗 ${result.failed} 件`:''}`:`${result.restored} 件を復元しました。${result.skipped?` 未復元 ${result.skipped} 件`:''}`);
  }catch(err){say(`実行できませんでした: ${err.message}`,true);}finally{busy=false;$('refresh').disabled=false;await refresh();}
}
async function load(){
  try{const c=await chrome.storage.sync.get(defaults);
    $('compareEnabled').checked=!!c.amtkCompareEnabled;
    $('wishlistEnabled').checked=!!c.amtkWishlistEnabled;
    $('autoUsedEnabled').checked=!!c.amtkAutoUsedEnabled;
    $('wishlistCols').value=String(Math.min(10,Math.max(1,Number(c.amtkWishlistCols)||6)));
    $('priceConcurrency').value=String(Math.min(3,Math.max(1,Number(c.amtkPriceConcurrency)||2)));
    await refresh();
  }catch(err){say(`設定読込に失敗: ${err.message}`,true);}
}
for(const [id,key] of [['compareEnabled','amtkCompareEnabled'],['wishlistEnabled','amtkWishlistEnabled'],['autoUsedEnabled','amtkAutoUsedEnabled']]){
  $(id).addEventListener('change',async e=>{try{await chrome.storage.sync.set({[key]:e.target.checked});say('設定を保存しました。Amazonページに反映されます。');}catch(err){say(err.message,true);}});
}
$('wishlistCols').addEventListener('change',async e=>{try{await chrome.storage.sync.set({amtkWishlistCols:Number(e.target.value)});say('表示列数を保存しました。選択した列数で表示します。');}catch(err){say(err.message,true);}});
$('priceConcurrency').addEventListener('change',async e=>{try{await chrome.storage.sync.set({amtkPriceConcurrency:Number(e.target.value)});say('同時照合数を保存しました。');}catch(err){say(err.message,true);}});
$('convert').addEventListener('click',()=>run('convert-all'));
$('undo').addEventListener('click',()=>run('undo'));
$('refresh').addEventListener('click',refresh);
$('sites').addEventListener('click',()=>chrome.runtime.openOptionsPage());
load();

async function showAIKeyStatus(){
 try{const v=await chrome.storage.session.get('amtkGeminiKey');
  $('aiKeyStatus').textContent=v.amtkGeminiKey?'AIキー設定済み（Chrome終了まで有効）':'AIキー未設定。通常検索と説明の収集は使えます。';
 }catch(e){$('aiKeyStatus').textContent='APIキーの状態を取得できません';}
}
$('saveAiKey').addEventListener('click',async()=>{
 const value=$('aiApiKey').value.trim();
 if(!value){say('APIキーを入力してください。',true);return;}
 try{await chrome.storage.session.set({amtkGeminiKey:value});$('aiApiKey').value='';await showAIKeyStatus();say('AIキーを一時設定しました。ブラウザ終了時に消えます。');}
 catch(e){say('キーの設定に失敗: '+e.message,true);}
});
$('clearAiKey').addEventListener('click',async()=>{await chrome.storage.session.remove('amtkGeminiKey');$('aiApiKey').value='';await showAIKeyStatus();say('AIキーを削除しました。');});
void showAIKeyStatus();

async function loadAIModel(){const cfg=await chrome.storage.sync.get({amtkGeminiModel:'gemini-2.5-flash'});$('aiModel').value=cfg.amtkGeminiModel;}
$('aiModel').addEventListener('change',async e=>{await chrome.storage.sync.set({amtkGeminiModel:e.target.value});say('AIモデルを保存しました。');});
void loadAIModel();
