const {contextBridge,ipcRenderer}=require('electron');
// Test-host controls only; never included by the application preload.
contextBridge.exposeInMainWorld('fixtureWindow',{zoom:factor=>ipcRenderer.invoke('fixture:zoom',factor),review:()=>ipcRenderer.invoke('fixture:review')});
