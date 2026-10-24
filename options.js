'use strict';
const area=document.getElementById('sites');
const status=document.getElementById('status');
const boxes=new Map();
for(const s of SITES){
  const label=document.createElement('label');
  const check=document.createElement('input');check.type='checkbox';check.value=s.id;
  const name=document.createElement('span');name.textContent=s.name;
  label.append(check,name);area.appendChild(label);boxes.set(s.id,check);
}
function setChecks(ids){for(const [id,box] of boxes)box.checked=ids.includes(id);}
chrome.storage.sync.get({preferredSites:DEFAULT_SITES}).then(data=>setChecks(data.preferredSites)).catch(err=>status.textContent=err.message);
document.getElementById('all').addEventListener('click',()=>setChecks(DEFAULT_SITES));
document.getElementById('none').addEventListener('click',()=>setChecks([]));
document.getElementById('save').addEventListener('click',async()=>{
  try{await chrome.storage.sync.set({preferredSites:[...boxes].filter(([,box])=>box.checked).map(([id])=>id)});status.textContent='✓ 検索先の設定を保存しました。';}
  catch(err){status.textContent='保存に失敗しました: '+err.message;}
});
