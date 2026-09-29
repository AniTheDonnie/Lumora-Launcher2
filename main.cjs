
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const { spawn, spawnSync } = require('child_process');
const AdmZip = require('adm-zip');
const { Client } = require('minecraft-launcher-core');
const { Authflow, Titles } = require('prismarine-auth');

let win;
let activeMinecraft = null;
const runningServers = new Map();

function dataFile(){ return path.join(app.getPath('userData'), 'lumora-data.json'); }
function loadData(){
  try { return JSON.parse(fs.readFileSync(dataFile(),'utf8')); }
  catch { return {instances:[], servers:[], accounts:[], settings:{rgb:true,accent:'#7c3aed'}, activeInstance:null}; }
}
function saveData(d){ fs.mkdirSync(app.getPath('userData'),{recursive:true}); fs.writeFileSync(dataFile(),JSON.stringify(d,null,2)); }
function safeName(v){ return String(v||'New').replace(/[<>:"/\\|?*\x00-\x1F]/g,'-').trim().slice(0,80)||'New'; }
function createWindow(){
  win=new BrowserWindow({
    width:1440,height:900,minWidth:1050,minHeight:650,backgroundColor:'#07090f',
    autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false}
  });
  win.loadFile(path.join(__dirname,'src','index.html'));
}
function emit(channel,data){ if(win && !win.isDestroyed()) win.webContents.send(channel,data); }

app.whenReady().then(createWindow);
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});

ipcMain.handle('paths',()=>({userData:app.getPath('userData')}));
ipcMain.handle('open-data-folder',()=>shell.openPath(app.getPath('userData')));
ipcMain.handle('open-path',(_,p)=>shell.openPath(p));
ipcMain.handle('open-external',(_,url)=>{if(/^https?:\/\//i.test(url))return shell.openExternal(url);return false;});

ipcMain.handle('get-settings',()=>loadData().settings);
ipcMain.handle('save-settings',(_,s)=>{const d=loadData();d.settings={...d.settings,...s};saveData(d);return d.settings;});

ipcMain.handle('list-instances',()=>loadData().instances);
ipcMain.handle('set-active-instance',(_,id)=>{const d=loadData();d.activeInstance=id;saveData(d);return true;});

ipcMain.handle('create-instance',(_,input)=>{
  const d=loadData(), name=safeName(input.name), id=crypto.randomUUID();
  const dir=path.join(app.getPath('userData'),'instances',id);
  for(const x of ['mods','resourcepacks','shaderpacks','saves','config'])fs.mkdirSync(path.join(dir,x),{recursive:true});
  const instance={id,name,version:String(input.version||'1.21.8'),loader:String(input.loader||'Vanilla'),ramMb:Number(input.ramMb)||4096,path:dir,createdAt:new Date().toISOString(),installed:false};
  fs.writeFileSync(path.join(dir,'instance.json'),JSON.stringify(instance,null,2));
  d.instances.push(instance);d.activeInstance=id;saveData(d);return {ok:true,instance};
});

ipcMain.handle('check-java',()=>{
  const r=spawnSync('java',['-version'],{encoding:'utf8',windowsHide:true});
  const raw=(r.stderr||r.stdout||'').trim();
  if(r.error)return {ok:false,error:r.error.message};
  const m=raw.match(/version "([^"]+)"/);return {ok:true,version:m?m[1]:raw.split(/\r?\n/)[0]||'Unknown Java'};
});

function buildAuthObject(mc){
  return {
    access_token:mc.token,
    client_token:crypto.randomUUID(),
    uuid:mc.profile.id,
    name:mc.profile.name,
    user_properties:JSON.stringify({}),
    meta:{type:'msa',demo:false,xuid:'',clientId:''}
  };
}

ipcMain.handle('login-microsoft',async()=>{
  try{
    const d=loadData();
    const cache=path.join(app.getPath('userData'),'auth-cache');
    fs.mkdirSync(cache,{recursive:true});
    let codeShown=false;
    const auth=new Authflow('lumora-user',cache,{
      flow:'live',
      authTitle:Titles.MinecraftJava,
      deviceType:'Win32'
    },(code)=>{
      codeShown=true;
      emit('ms-device-code',code);
    });
    const mc=await auth.getMinecraftJavaToken({fetchProfile:true,fetchEntitlements:true});
    if(!mc || !mc.profile)throw new Error('Minecraft profile was not returned.');
    const account={id:mc.profile.id,name:mc.profile.name};
    d.accounts=[account];saveData(d);
    return {ok:true,account};
  }catch(e){return {ok:false,error:e.message};}
});

function download(url,dest){
  return new Promise((resolve,reject)=>{
    const file=fs.createWriteStream(dest);
    const req=https.get(url,res=>{
      if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){
        file.close();try{fs.unlinkSync(dest)}catch{}
        return download(res.headers.location,dest).then(resolve).catch(reject);
      }
      if(res.statusCode!==200){file.close();try{fs.unlinkSync(dest)}catch{};return reject(new Error('HTTP '+res.statusCode));}
      let total=Number(res.headers['content-length']||0),done=0;
      res.on('data',b=>{done+=b.length;emit('download-progress',{done,total});});
      res.pipe(file);
      file.on('finish',()=>file.close(()=>resolve(dest)));
    });
    req.on('error',e=>{file.close();try{fs.unlinkSync(dest)}catch{};reject(e);});
  });
}
function safeJoin(root,rel){
  rel=String(rel).replace(/\\/g,'/');
  if(rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || rel.split('/').includes('..'))throw new Error('Unsafe modpack path: '+rel);
  const p=path.resolve(root,rel), r=path.resolve(root);
  if(p!==r&&!p.startsWith(r+path.sep))throw new Error('Unsafe modpack path: '+rel);
  return p;
}
async function installMrpack(file, instance){
  const zip=new AdmZip(file);
  const entry=zip.getEntry('modrinth.index.json');
  if(!entry)throw new Error('This is not a valid Modrinth .mrpack: modrinth.index.json is missing.');
  const index=JSON.parse(entry.getData().toString('utf8'));
  if(index.formatVersion!==1 || index.game!=='minecraft')throw new Error('Unsupported Modrinth pack format.');
  const root=instance.path;
  if(index.dependencies?.minecraft)instance.version=index.dependencies.minecraft;
  if(index.dependencies?.['fabric-loader'])instance.loader='Fabric';
  else if(index.dependencies?.['quilt-loader'])instance.loader='Quilt';
  else if(index.dependencies?.forge)instance.loader='Forge';
  else if(index.dependencies?.neoforge)instance.loader='NeoForge';

  const files=index.files||[];
  for(let i=0;i<files.length;i++){
    const f=files[i];
    if(f.env?.client==='unsupported')continue;
    const dest=safeJoin(root,f.path);
    fs.mkdirSync(path.dirname(dest),{recursive:true});
    if(fs.existsSync(dest))continue;
    const url=(f.downloads||[])[0];
    if(!url)throw new Error('No download URL for '+f.path);
    await download(url,dest);
    emit('task-progress',{task:'modpack',current:i+1,total:files.length,name:f.path});
  }

  for(const folder of ['overrides','client-overrides']){
    const entries=zip.getEntries().filter(e=>e.entryName.startsWith(folder+'/')&&!e.isDirectory);
    for(const e of entries){
      const rel=e.entryName.slice(folder.length+1);
      const dest=safeJoin(root,rel);
      fs.mkdirSync(path.dirname(dest),{recursive:true});
      fs.writeFileSync(dest,e.getData());
    }
  }
  instance.pack={name:index.name,versionId:index.versionId,summary:index.summary||''};
  return instance;
}
ipcMain.handle('import-mrpack',async()=>{
  const picked=await dialog.showOpenDialog(win,{filters:[{name:'Modrinth Modpack',extensions:['mrpack']}],properties:['openFile']});
  if(picked.canceled)return {ok:false,canceled:true};
  const d=loadData(), base=d.instances.find(x=>x.id===d.activeInstance);
  if(!base)return {ok:false,error:'Select or create an instance first.'};
  try{
    const updated=await installMrpack(picked.filePaths[0],base);
    const i=d.instances.findIndex(x=>x.id===base.id);d.instances[i]=updated;saveData(d);
    return {ok:true,instance:updated};
  }catch(e){return {ok:false,error:e.message};}
});

async function launchInstance(id){
  const d=loadData(), instance=d.instances.find(x=>x.id===id);
  if(!instance)return {ok:false,error:'Instance not found.'};
  const java=spawnSync('java',['-version'],{encoding:'utf8',windowsHide:true});
  if(java.error)return {ok:false,error:'Java was not found. Install a compatible Java runtime or add java.exe to PATH.'};

  try{
    // MCLC handles the official version metadata, libraries, assets and vanilla launch.
    // For modpacks, files are installed into the instance directory first.
    const launcher=new Client();
    const auth=await getSavedMinecraftAuth();
    if(!auth)return {ok:false,error:'Sign in with Microsoft first.'};

    const opts={
      authorization:auth,
      root:instance.path,
      cache:path.join(app.getPath('userData'),'minecraft-cache'),
      version:{number:instance.version,type:'release'},
      memory:{max:Math.max(1024,instance.ramMb)+'M',min:Math.min(1024,Math.max(512,instance.ramMb))+'M'},
      javaPath:'java',
      overrides:{gameDirectory:instance.path},
    };
    emit('launch-status',{status:'downloading',instance:instance.name});
    activeMinecraft=await launcher.launch(opts);
    launcher.on('debug',e=>emit('minecraft-log',{line:String(e)}));
    launcher.on('data',e=>emit('minecraft-log',{line:String(e)}));
    launcher.on('download-status',e=>emit('minecraft-progress',e));
    launcher.on('close',code=>{activeMinecraft=null;emit('launch-status',{status:'closed',code});});
    emit('launch-status',{status:'started',instance:instance.name});
    return {ok:true};
  }catch(e){activeMinecraft=null;return {ok:false,error:e.message};}
});

async function getSavedMinecraftAuth(){
  const d=loadData();
  if(!d.accounts?.length)return null;
  const cache=path.join(app.getPath('userData'),'auth-cache');
  const auth=new Authflow('lumora-user',cache,{flow:'live',authTitle:Titles.MinecraftJava,deviceType:'Win32'});
  const mc=await auth.getMinecraftJavaToken({fetchProfile:true,fetchEntitlements:true});
  if(!mc?.profile)throw new Error('Microsoft authentication did not return a Minecraft profile.');
  return buildAuthObject(mc);
}

ipcMain.handle('install-instance',async(_,id)=>launchInstance(id));
ipcMain.handle('launch-instance',async(_,id)=>launchInstance(id));
ipcMain.handle('stop-minecraft',()=>{try{if(activeMinecraft)activeMinecraft.kill();activeMinecraft=null;return {ok:true}}catch(e){return {ok:false,error:e.message}}});

ipcMain.handle('list-servers',()=>loadData().servers);
ipcMain.handle('create-server',(_,input)=>{
  const d=loadData(),name=safeName(input.name),id=crypto.randomUUID(),dir=path.join(app.getPath('userData'),'servers',id);
  fs.mkdirSync(dir,{recursive:true});
  const server={id,name,software:String(input.software||'Vanilla'),ramMb:Number(input.ramMb)||4096,path:dir,createdAt:new Date().toISOString()};
  fs.writeFileSync(path.join(dir,'server-profile.json'),JSON.stringify(server,null,2));d.servers.push(server);saveData(d);return {ok:true,server};
});
ipcMain.handle('start-server',(_,id)=>{
  const s=loadData().servers.find(x=>x.id===id);if(!s)return {ok:false,error:'Server profile not found.'};
  if(runningServers.has(id))return {ok:false,error:'Server is already running.'};
  const jar=path.join(s.path,'server.jar');if(!fs.existsSync(jar))return {ok:false,error:'server.jar is missing. Put the server software jar in the server folder first.'};
  const child=spawn('java',[`-Xms${Math.max(512,s.ramMb)}M`,`-Xmx${Math.max(512,s.ramMb)}M`,'-jar','server.jar','nogui'],{cwd:s.path});
  runningServers.set(id,child);child.stdout?.on('data',x=>emit('server-log',{id,line:x.toString()}));child.stderr?.on('data',x=>emit('server-log',{id,line:x.toString()}));child.on('exit',()=>runningServers.delete(id));
  return {ok:true,pid:child.pid};
});
ipcMain.handle('stop-server',(_,id)=>{const c=runningServers.get(id);if(!c)return {ok:false,error:'Server is not running.'};c.kill();runningServers.delete(id);return {ok:true}});

ipcMain.handle('search-modrinth',async(_,query)=>{
  try{
    const u='https://api.modrinth.com/v2/search?query='+encodeURIComponent(query)+'&limit=20';
    const r=await fetch(u,{headers:{'User-Agent':'LUMORA-Launcher/0.3'}});
    if(!r.ok)throw new Error('Modrinth HTTP '+r.status);
    const j=await r.json();
    return {ok:true,hits:(j.hits||[]).map(p=>({id:p.project_id,title:p.title,slug:p.slug,description:p.description,downloads:p.downloads,type:p.project_type,icon:p.icon_url}))};
  }catch(e){return {ok:false,error:e.message};}
});
ipcMain.handle('project-versions',async(_,id,mc,loader)=>{
  try{
    const params=new URLSearchParams();
    if(mc)params.set('game_versions',JSON.stringify([mc]));
    if(loader)params.set('loaders',JSON.stringify([loader.toLowerCase()]));
    const r=await fetch('https://api.modrinth.com/v2/project/'+encodeURIComponent(id)+'/version?'+params.toString(),{headers:{'User-Agent':'LUMORA-Launcher/0.3'}});
    if(!r.ok)throw new Error('Modrinth HTTP '+r.status);
    return {ok:true,versions:await r.json()};
  }catch(e){return {ok:false,error:e.message};}
});
