'use strict';
const $ = id => document.getElementById(id);
const db = supabase.createClient('https://kjmyuhsiqtmchgojnxlp.supabase.co','sb_publishable_QPB4rc-SfifWe4tP2dLunQ_3kWpIpJw',{auth:{storageKey:'capcat-auth'}});
const defaultAvatar = 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#F2DEBA"/><path d="M20 42 19 15l20 12a42 42 0 0 1 22 0L81 15l-1 27c14 27-3 45-30 45S6 69 20 42Z" fill="#4E6C50"/><circle cx="38" cy="53" r="3" fill="#FAECD6"/><circle cx="62" cy="53" r="3" fill="#FAECD6"/><path d="m46 65 4 4 4-4" stroke="#FAECD6" stroke-width="3" fill="none"/></svg>');
let user, profiles=[], cats=[], filter='all', selectedBlob=null, photoSerial=0, currentCat=null, busy=false, refreshBusy=false, refreshAgain=false, avatarBlobs={};
const setStatus=(id,msg,error=false,loading=false)=>{$(id).textContent=msg;$(id).classList.toggle('error',error);if(loading){let s=document.createElement('span');s.className='spinner';$(id).prepend(s)}};
function show(id){$(id).classList.add('show');document.body.classList.add('modal-open')}
function close(id){$(id).classList.remove('show');document.body.classList.remove('modal-open')}
function banner(msg){$('banner').textContent=msg;$('banner').classList.toggle('hide',!msg)}
function errorText(e){console.error(e);return 'Bir sorun oluştu. Lütfen tekrar dene.'}

/*
 * Normalise common camera/photo formats to JPEG before uploading.
 * HEIC/HEIF and TIFF decoders are loaded lazily only when native decoding fails.
 * The existing Supabase bucket accepts JPEG; no database changes are needed.
 */
const decoderLoads=new Map();
function loadDecoder(url){
  if(!decoderLoads.has(url)){
    const promise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=url;script.async=true;
      script.onload=resolve;
      script.onerror=()=>{script.remove();reject(new Error('Fotoğraf dönüştürücüsü yüklenemedi. İnternet bağlantını kontrol et.'))};
      document.head.append(script);
    }).catch(err=>{decoderLoads.delete(url);throw err});
    decoderLoads.set(url,promise);
  }
  return decoderLoads.get(url);
}
function photoExtension(file){return (file.name||'').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]||''}
function photoFormat(file){
  const type=(file.type||'').toLowerCase(),ext=photoExtension(file);
  const common=new Set(['jpg','jpeg','png','webp','gif','bmp','avif','heic','heif','tif','tiff','jxl']);
  if(!type.startsWith('image/')&&!common.has(ext))throw new Error('Lütfen bir fotoğraf seç.');
  if(type==='image/svg+xml'||ext==='svg')throw new Error('SVG yerine bir fotoğraf seç.');
  return {type,ext,heic:['heic','heif'].includes(ext)||['image/heic','image/heif','image/heic-sequence','image/heif-sequence'].includes(type),tiff:['tif','tiff'].includes(ext)||['image/tiff','image/x-tiff'].includes(type)};
}
async function browserImage(blob){
  const url=URL.createObjectURL(blob),img=new Image();
  try{
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Görsel tarayıcıda açılamadı.'));img.src=url});
    if(!img.naturalWidth||!img.naturalHeight)throw new Error('Fotoğraf bozuk veya boş.');
    return {source:img,width:img.naturalWidth,height:img.naturalHeight,release:()=>URL.revokeObjectURL(url)};
  }catch(err){URL.revokeObjectURL(url);throw err}
}
async function heicImage(file){
  await loadDecoder('https://cdn.jsdelivr.net/npm/heic-to@1.6.7/dist/iife/heic-to.js');
  if(typeof HeicTo!=='function')throw new Error('HEIC dönüştürücü yüklenemedi.');
  const blob=await HeicTo({blob:file,type:'image/jpeg',quality:0.94});
  return browserImage(blob);
}
async function tiffImage(file){
  await loadDecoder('https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js');
  if(typeof UTIF==='undefined')throw new Error('TIFF dönüştürücü yüklenemedi.');
  const buffer=await file.arrayBuffer(),pages=UTIF.decode(buffer);
  const page=pages.find(p=>Number(p.t256?.[0])>0&&Number(p.t257?.[0])>0);
  if(!page)throw new Error('TIFF fotoğrafı okunamadı.');
  const width=Number(page.t256[0]),height=Number(page.t257[0]);
  if(width*height>25000000)throw new Error('TIFF fotoğrafı çok büyük. Daha küçük bir sürümünü seç.');
  UTIF.decodeImage(buffer,page);
  const pixels=UTIF.toRGBA8(page);
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Fotoğraf işlenemedi.');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels),width,height),0,0);
  return {source:canvas,width,height,release:()=>{canvas.width=0;canvas.height=0}};
}
async function resize(file,max=1800){
  if(!file||!file.size)throw new Error('Lütfen bir fotoğraf seç.');
  if(file.size>60*1024*1024)throw new Error('Fotoğraf çok büyük. Daha küçük bir dosya seç.');
  const format=photoFormat(file);
  let decoded;
  try{
    // Safari and newer browsers can decode some HEIC/AVIF images natively.
    try{decoded=await browserImage(file)}
    catch(nativeError){
      if(format.heic)decoded=await heicImage(file);
      else if(format.tiff)decoded=await tiffImage(file);
      else throw nativeError;
    }
    const {source,width,height}=decoded;
    if(width*height>100000000)throw new Error('Fotoğraf çözünürlüğü çok büyük.');
    const scale=Math.min(1,max/Math.max(width,height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*scale));
    canvas.height=Math.max(1,Math.round(height*scale));
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Fotoğraf işlenemedi.');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(source,0,0,canvas.width,canvas.height);
    const jpeg=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('JPEG oluşturulamadı.')),'image/jpeg',.88));
    canvas.width=0;canvas.height=0;
    return jpeg;
  }catch(err){
    if(err.message?.startsWith('Fotoğraf ')||err.message?.startsWith('TIFF ')||err.message?.startsWith('HEIC ')||err.message?.startsWith('Görsel ')||err.message?.startsWith('JPEG ')||err.message?.startsWith('Lütfen ')||err.message?.startsWith('SVG '))throw err;
    console.error('Görsel dönüştürülemedi:',err);
    throw new Error('Bu fotoğraf açılamadı. Farklı bir dosya deneyebilirsin.');
  }finally{decoded?.release()}
}
function previewBlob(blob,img){const element=$(img),previous=element.dataset.objectUrl;if(previous)URL.revokeObjectURL(previous);const url=URL.createObjectURL(blob);element.dataset.objectUrl=url;element.onload=element.onerror=()=>{URL.revokeObjectURL(url);if(element.dataset.objectUrl===url)delete element.dataset.objectUrl};element.src=url}
async function upload(blob){let path=`${user.id}/${crypto.randomUUID()}.jpg`;let {error}=await db.storage.from('capcat-images').upload(path,blob,{contentType:'image/jpeg'});if(error)throw error;return path}
const urlCache=new Map();
async function signed(path){
  if(!path)return defaultAvatar;
  const cached=urlCache.get(path);
  if(cached && cached.expires>Date.now()+5*60*1000)return cached.url;
  const {data,error}=await db.storage.from('capcat-images').createSignedUrl(path,3600);
  if(error){console.error(error);return cached?.url||defaultAvatar}
  urlCache.set(path,{url:data.signedUrl,expires:Date.now()+55*60*1000});
  return data.signedUrl;
}
async function setupAvatar(prefix){$(prefix+'Preview').src=defaultAvatar;$(prefix+'Pick').onclick=()=>$(prefix+'Photo').click();$(prefix+'Photo').onchange=async e=>{try{let b=await resize(e.target.files[0],600);avatarBlobs[prefix]=b;previewBlob(b,prefix+'Preview');setStatus(prefix+'Status','')}catch(err){setStatus(prefix+'Status',err.message,true)}}}
async function saveProfile(prefix){let name=$(prefix+'Name').value.trim();if(!name){setStatus(prefix+'Status','İsim gerekli.',true);return}let button=$(prefix+'Save');button.disabled=true;setStatus(prefix+'Status','Kaydediliyor',false,true);let path=null;try{if(!user){let {data,error}=await db.auth.signInAnonymously();if(error)throw error;user=data.user}if(avatarBlobs[prefix])path=await upload(avatarBlobs[prefix]);let record={id:user.id,name};if(path)record.avatar_path=path;let {error}=await db.from('capcat_profiles').upsert(record);if(error){if(path)await db.storage.from('capcat-images').remove([path]);throw error}avatarBlobs[prefix]=null;setStatus(prefix+'Status','');$('welcome').classList.add('hide');$('app').classList.remove('hide');close('editOverlay');startSync();await refresh()}catch(e){setStatus(prefix+'Status',errorText(e),true)}finally{button.disabled=false}}
let channel=null,connected=false,refreshTimer=null;
function queueRefresh(){
  if(!user || document.hidden)return;
  clearTimeout(refreshTimer);
  refreshTimer=setTimeout(()=>refresh(),250);
}
function startSync(){
  if(channel||!user)return;
  channel=db.channel('capcat-collection')
    .on('postgres_changes',{event:'*',schema:'public',table:'capcat_cats'},queueRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'capcat_profiles'},queueRefresh)
    .subscribe(status=>{connected=status==='SUBSCRIBED';if(connected)queueRefresh()});
}
async function refresh(){
  if(!user)return;
  if(refreshBusy){refreshAgain=true;return}
  refreshBusy=true;
  try{
    const [p,c]=await Promise.all([db.from('capcat_profiles').select('*').order('created_at'),db.from('capcat_cats').select('*').order('created_at',{ascending:false})]);
    if(p.error)throw p.error;if(c.error)throw c.error;
    const [nextProfiles,nextCats]=await Promise.all([
      Promise.all(p.data.map(async x=>({...x,url:await signed(x.avatar_path)}))),
      Promise.all(c.data.map(async x=>({...x,url:await signed(x.photo_path)})))
    ]);
    profiles=nextProfiles;cats=nextCats;
    const activePaths=new Set([...profiles.map(x=>x.avatar_path),...cats.map(x=>x.photo_path)].filter(Boolean));
    for(const path of urlCache.keys())if(!activePaths.has(path))urlCache.delete(path);
    if(!profiles.some(p=>p.id===user.id)){$('app').classList.add('hide');$('welcome').classList.remove('hide');return}
    render();banner('');
  }catch(e){console.error(e)}
  finally{refreshBusy=false;if(refreshAgain){refreshAgain=false;queueRefresh()}}
}
function avatar(url){let img=document.createElement('img');img.className='avatar';img.src=url||defaultAvatar;img.alt='';return img}
function textIfChanged(el,value){if(el.textContent!==value)el.textContent=value}
function imageIfChanged(el,url){if(el.getAttribute('src')!==url)el.setAttribute('src',url)}
function render(){
  const me=profiles.find(p=>p.id===user.id);if(!me)return;
  textIfChanged($('headerName'),me.name);imageIfChanged($('headerAvatar'),me.url);
  textIfChanged($('count'),String(cats.length));
  const strip=$('profiles'),oldPeople=new Map([...strip.children].map(el=>[el.dataset.id,el]));
  for(const p of profiles){
    let el=oldPeople.get(p.id);
    if(!el){el=document.createElement('div');el.className='person';el.dataset.id=p.id;el.append(avatar(p.url));let d=document.createElement('div');d.append(document.createElement('b'),document.createElement('small'));el.append(d);strip.append(el)}
    oldPeople.delete(p.id);imageIfChanged(el.querySelector('img'),p.url);textIfChanged(el.querySelector('b'),p.name);textIfChanged(el.querySelector('small'),`${cats.filter(c=>c.owner_id===p.id).length} kedi`);
  }
  oldPeople.forEach(el=>el.remove());
  const gallery=$('gallery'), shown=cats.filter(c=>filter==='all'||(filter==='mine'?c.owner_id===user.id:c.owner_id!==user.id));
  const oldCards=new Map([...gallery.querySelectorAll('.cat-card')].map(el=>[el.dataset.id,el]));
  if(shown.length){const empty=gallery.querySelector('.empty');if(empty)empty.remove()}
  let previous=null;
  for(const c of shown){
    const p=profiles.find(x=>x.id===c.owner_id);let card=oldCards.get(c.id);
    if(!card){
      card=document.createElement('button');card.className='cat-card';card.type='button';card.dataset.id=c.id;
      const photo=document.createElement('span');photo.className='cat-photo';const img=document.createElement('img');img.loading='lazy';photo.append(img);
      const info=document.createElement('span');info.className='cat-info';const name=document.createElement('span');name.className='cat-name';const owner=document.createElement('span');owner.className='discoverer';owner.append(avatar(p?.url),document.createElement('span'));info.append(name,owner);card.append(photo,info);
      card.onclick=()=>{const item=cats.find(x=>x.id===card.dataset.id);if(item)detail(item)};
    }
    oldCards.delete(c.id);const image=card.querySelector('.cat-photo img');imageIfChanged(image,c.url);image.alt=c.name;
    textIfChanged(card.querySelector('.cat-name'),c.name);const owner=card.querySelector('.discoverer');owner.className='discoverer '+(c.owner_id===user.id?'me':'ada');imageIfChanged(owner.querySelector('img'),p?.url||defaultAvatar);textIfChanged(owner.querySelector('span'),p?.name||'Kullanıcı');
    const desired=previous?previous.nextElementSibling:gallery.firstElementChild;if(desired!==card)gallery.insertBefore(card,desired);previous=card;
  }
  oldCards.forEach(el=>el.remove());
  if(!shown.length&&!gallery.querySelector('.empty')){let e=document.createElement('div');e.className='empty';e.innerHTML='<div class="empty-icon"><svg class="icon"><use href="#ic-cat"/></svg></div><strong>Henüz kedi yok</strong><span>İlk keşfini ekleyebilirsin.</span>';gallery.append(e)}
}
function detail(c){currentCat=c;let p=profiles.find(x=>x.id===c.owner_id);$('detailPhoto').src=c.url;$('detailName').textContent=c.name;$('detailDesc').textContent=c.description||'';$('detailOwner').textContent=p?.name||'Kullanıcı';$('detailDate').textContent=new Date(c.created_at).toLocaleDateString('tr-TR');$('deleteBtn').classList.toggle('hide',c.owner_id!==user.id);show('detailOverlay')}
$('deleteBtn').onclick=async()=>{if(!currentCat||!confirm('Bu kediyi silmek istiyor musun?'))return;let c=currentCat;let {error}=await db.from('capcat_cats').delete().eq('id',c.id);if(error){banner(errorText(error));return}await db.storage.from('capcat-images').remove([c.photo_path]);close('detailOverlay');refresh()};
for(let prefix of ['welcome','edit']){setupAvatar(prefix);$(prefix+'Form').onsubmit=e=>{e.preventDefault();saveProfile(prefix)}}
$('editProfile').onclick=()=>{let p=profiles.find(x=>x.id===user.id);$('editName').value=p.name;$('editPreview').src=p.url;avatarBlobs.edit=null;setStatus('editStatus','');show('editOverlay')};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>close(b.dataset.close));document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)close(o.id)}));document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.overlay.show').forEach(o=>close(o.id))});
document.querySelectorAll('.add-open').forEach(b=>b.onclick=()=>{show('addOverlay')});
$('uploadBox').onclick=()=>$('catPhoto').click();
$('catPhoto').onchange=async e=>{
  const seq=++photoSerial;selectedBlob=null;$('catSave').disabled=true;
  if(!e.target.files.length){setStatus('uploadStatus','');return}
  setStatus('uploadStatus','Fotoğraf hazırlanıyor',false,true);
  try{const blob=await resize(e.target.files[0]);if(seq!==photoSerial)return;selectedBlob=blob;previewBlob(blob,'catPreview');$('uploadBox').classList.add('has-image');setStatus('uploadStatus','');$('catSave').disabled=false}
  catch(err){if(seq!==photoSerial)return;setStatus('uploadStatus',err.message||'Fotoğraf açılamadı.',true);console.error(err)}
};
$('addForm').onsubmit=async e=>{
  e.preventDefault();if(!selectedBlob||busy)return;const name=$('catName').value.trim();if(!name)return;
  busy=true;$('catSave').disabled=true;setStatus('uploadStatus','Kaydediliyor',false,true);let path;
  try{path=await upload(selectedBlob);const {error}=await db.from('capcat_cats').insert({name,description:$('catDesc').value.trim()||null,photo_path:path});if(error)throw error;
    close('addOverlay');$('addForm').reset();$('uploadBox').classList.remove('has-image');selectedBlob=null;setStatus('uploadStatus','');await refresh();$('toast').classList.add('visible');setTimeout(()=>$('toast').classList.remove('visible'),2500)
  }catch(err){if(path)await db.storage.from('capcat-images').remove([path]);setStatus('uploadStatus',errorText(err),true)}
  finally{busy=false;$('catSave').disabled=!selectedBlob}
};
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));render()});
(async()=>{
  try{
    let {data,error}=await db.auth.getSession();
    if(error){if(error.status===401||error.status===403||error.code==='refresh_token_not_found'){await db.auth.signOut({scope:'local'});data={session:null}}else throw error}
    user=data.session?.user;$('loading').classList.add('hide');
    if(!user){$('welcome').classList.remove('hide');return}
    const p=await db.from('capcat_profiles').select('id').eq('id',user.id).maybeSingle();if(p.error){if(p.error.status===401||p.error.code==='PGRST301'){await db.auth.signOut({scope:'local'});user=null;$('welcome').classList.remove('hide');return}throw p.error}
    if(!p.data){
      const checked=await db.auth.getUser();
      if(checked.error && (checked.error.status===401||checked.error.status===403||checked.error.code==='user_not_found')){await db.auth.signOut({scope:'local'});user=null}
      else if(checked.error)throw checked.error;
      $('welcome').classList.remove('hide');return;
    }
    $('app').classList.remove('hide');startSync();await refresh();
  }catch(e){$('loading').classList.add('hide');$('welcome').classList.remove('hide');setStatus('welcomeStatus','Bağlantı kurulamadı. Tekrar dene.',true);console.error(e)}
})();
setInterval(()=>{
  if(document.hidden||!user||$('app').classList.contains('hide'))return;
  const renewal=[...urlCache.values()].some(x=>x.expires<Date.now()+5*60*1000);
  if(!connected||renewal)refresh();
},90000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&user&&!$('app').classList.contains('hide'))refresh()});
