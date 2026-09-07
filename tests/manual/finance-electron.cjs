// Isolated renderer host only. Never load the application main process or live data.
const {app,BrowserWindow,session,ipcMain}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {fileURLToPath}=require('node:url');
const profile=process.env.FINANCE_UI_PROFILE,proxy=process.env.FINANCE_UI_PROXY;
if(!profile || !proxy)throw new Error('Explicit synthetic profile and network-denial proxy required.');
const root=path.resolve(__dirname,'../..');
const allowed=[path.join(root,'ui'),path.join(root,'assets'),profile].map(value=>fs.realpathSync(value)+path.sep);
const data=path.join(profile,'electron-profile');fs.mkdirSync(data,{mode:0o700});
app.setPath('userData',data);app.setPath('sessionData',data);
app.commandLine.appendSwitch('remote-debugging-port','0');
app.commandLine.appendSwitch('proxy-server',proxy);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.whenReady().then(()=>{
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
    let permitted=details.url==='about:blank' || details.url.startsWith('data:');
    if(details.url.startsWith('file:')){
      try{const file=fs.realpathSync(fileURLToPath(details.url));permitted=allowed.some(prefix=>file.startsWith(prefix));}catch{permitted=false;}
    }
    callback({cancel:!permitted});
  });
  const window=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,preload:path.join(__dirname,'finance-electron-preload.cjs')}});
  ipcMain.handle('fixture:zoom',(event,factor)=>{
    if(event.sender!==window.webContents || ![1,2].includes(factor))throw new Error('Invalid fixture zoom');
    window.webContents.setZoomFactor(factor);
  });
  ipcMain.handle('fixture:review',event=>{
    if(process.env.FINANCE_VOICEOVER_CHECK!=='1' || event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame)throw new Error('Human review not enabled.');
    window.setTitle('SYNTHETIC ONLY - VoiceOver review');window.show();window.focus();
  });
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.loadURL('about:blank');
});
app.on('window-all-closed',()=>app.quit());
