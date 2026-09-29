
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');

let win;
const runningServers = new Map();

function dataFile(){
  return path.join(app.getPath('userData'), 'lumora-data.json');
}
function loadData(){
  try { return JSON.parse(fs.readFileSync(dataFile(),'utf8')); }
  catch { return {instances:[], servers:[], settings:{rgb:true,accent:'#7c3aed'}}; }
}
function saveData(data){
  fs.mkdirSync(app.getPath('userData'), {recursive:true});
  fs.writeFileSync(dataFile(), JSON.stringify(data,null,2), 'utf8');
}
function safeName(v){
  return String(v||'New').replace(/[<>:"/\\|?*\x00-\x1F]/g,'-').trim().slice(0,80) || 'New';
}
function createWindow(){
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1050, minHeight: 650,
    backgroundColor:'#07090f', autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false}
  });
  win.loadFile(path.join(__dirname,'src','index.html'));
}
app.whenReady().then(createWindow);
app.on('window-all-closed',()=>{ if(process.platform!=='darwin') app.quit(); });

ipcMain.handle('paths',()=>({userData:app.getPath('userData')}));
ipcMain.handle('open-data-folder',()=>shell.openPath(app.getPath('userData')));
ipcMain.handle('open-path',(_,p)=>shell.openPath(p));
ipcMain.handle('open-external',(_,url)=>{
  if(typeof url==='string' && /^https?:\/\//i.test(url)) return shell.openExternal(url);
  return false;
});

ipcMain.handle('get-settings',()=>loadData().settings);
ipcMain.handle('save-settings',(_,settings)=>{
  const d=loadData(); d.settings={...d.settings,...settings}; saveData(d); return d.settings;
});

ipcMain.handle('list-instances',()=>loadData().instances);
ipcMain.handle('create-instance',(_,input)=>{
  const d=loadData();
  const name=safeName(input.name);
  const id=crypto.randomUUID();
  const dir=path.join(app.getPath('userData'),'instances',id);
  fs.mkdirSync(path.join(dir,'mods'),{recursive:true});
  fs.mkdirSync(path.join(dir,'resourcepacks'),{recursive:true});
  fs.mkdirSync(path.join(dir,'shaderpacks'),{recursive:true});
  fs.mkdirSync(path.join(dir,'saves'),{recursive:true});
  const instance={id,name,version:String(input.version||'1.21.8'),loader:String(input.loader||'Vanilla'),ramMb:Number(input.ramMb)||4096,path:dir,createdAt:new Date().toISOString()};
  fs.writeFileSync(path.join(dir,'instance.json'),JSON.stringify(instance,null,2));
  d.instances.push(instance); saveData(d); return {ok:true,instance};
});

ipcMain.handle('list-servers',()=>loadData().servers);
ipcMain.handle('create-server',(_,input)=>{
  const d=loadData(); const name=safeName(input.name); const id=crypto.randomUUID();
  const dir=path.join(app.getPath('userData'),'servers',id);
  fs.mkdirSync(dir,{recursive:true});
  const server={id,name,software:String(input.software||'Vanilla'),ramMb:Number(input.ramMb)||4096,path:dir,createdAt:new Date().toISOString()};
  fs.writeFileSync(path.join(dir,'server-profile.json'),JSON.stringify(server,null,2));
  d.servers.push(server); saveData(d); return {ok:true,server};
});

ipcMain.handle('check-java',()=>{
  const r=spawnSync('java',['-version'],{encoding:'utf8',windowsHide:true});
  const raw=(r.stderr||r.stdout||'').trim();
  if(r.error) return {ok:false,error:r.error.message};
  const m=raw.match(/version "([^"]+)"/);
  return {ok:true,version:m?m[1]:raw.split(/\r?\n/)[0]||'Unknown Java'};
});

ipcMain.handle('start-server',(_,id)=>{
  const s=loadData().servers.find(x=>x.id===id);
  if(!s) return {ok:false,error:'Server profile not found.'};
  if(runningServers.has(id)) return {ok:false,error:'Server is already running.'};
  const jar=path.join(s.path,'server.jar');
  if(!fs.existsSync(jar)) return {ok:false,error:'server.jar was not found in this server folder.'};
  const child=spawn('java',[`-Xms${Math.max(512,s.ramMb)}M`,`-Xmx${Math.max(512,s.ramMb)}M`,'-jar','server.jar','nogui'],{cwd:s.path,windowsHide:false});
  runningServers.set(id,child);
  child.on('exit',()=>runningServers.delete(id));
  return {ok:true,pid:child.pid};
});
ipcMain.handle('stop-server',(_,id)=>{
  const child=runningServers.get(id);
  if(!child) return {ok:false,error:'Server is not running.'};
  child.kill();
  runningServers.delete(id);
  return {ok:true};
});

ipcMain.handle('search-modrinth',async(_,query)=>{
  try{
    const url='https://api.modrinth.com/v2/search?query='+encodeURIComponent(query)+'&limit=12';
    const res=await fetch(url,{headers:{'User-Agent':'LUMORA-Launcher/0.2'}});
    if(!res.ok) throw new Error('Modrinth returned HTTP '+res.status);
    const data=await res.json();
    return {ok:true,hits:(data.hits||[]).map(p=>({title:p.title,slug:p.slug,description:p.description,downloads:p.downloads,project_type:p.project_type}))};
  }catch(e){return {ok:false,error:e.message};}
});
