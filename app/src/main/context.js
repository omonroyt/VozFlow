// Contexto ligero: nombre de la app y título de la ventana activa en Windows.
// Nada de capturas de pantalla ni lectura del contenido.
const path = require('path');

let win32 = null;

function loadWin32() {
  if (win32 !== null) return win32;
  win32 = false;
  if (process.platform !== 'win32') return win32;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    win32 = {
      GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow()'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void* hWnd, void* lpString, int nMaxCount)'),
      GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void* hWnd, void* lpdwProcessId)'),
      OpenProcess: kernel32.func('void* __stdcall OpenProcess(uint32_t dwDesiredAccess, int bInheritHandle, uint32_t dwProcessId)'),
      QueryFullProcessImageNameW: kernel32.func(
        'int __stdcall QueryFullProcessImageNameW(void* hProcess, uint32_t dwFlags, void* lpExeName, void* lpdwSize)'
      ),
      CloseHandle: kernel32.func('int __stdcall CloseHandle(void* hObject)'),
    };
  } catch (err) {
    console.warn('[context] no se pudo cargar koffi:', err.message);
    win32 = false;
  }
  return win32;
}

// Nombres amigables para apps comunes.
const FRIENDLY = {
  'chrome.exe': 'Google Chrome',
  'msedge.exe': 'Microsoft Edge',
  'firefox.exe': 'Firefox',
  'code.exe': 'Visual Studio Code',
  'cursor.exe': 'Cursor',
  'windowsterminal.exe': 'Terminal',
  'cmd.exe': 'Terminal',
  'powershell.exe': 'Terminal',
  'slack.exe': 'Slack',
  'teams.exe': 'Microsoft Teams',
  'ms-teams.exe': 'Microsoft Teams',
  'outlook.exe': 'Outlook',
  'olk.exe': 'Outlook',
  'winword.exe': 'Word',
  'whatsapp.exe': 'WhatsApp',
  'claude.exe': 'Claude',
  'chatgpt.exe': 'ChatGPT',
  'notion.exe': 'Notion',
  'obsidian.exe': 'Obsidian',
};

function getActiveWindow() {
  const api = loadWin32();
  if (!api) return null;
  try {
    const hwnd = api.GetForegroundWindow();
    if (!hwnd) return null;

    const titleBuf = Buffer.alloc(512 * 2);
    const len = api.GetWindowTextW(hwnd, titleBuf, 512);
    const title = len > 0 ? titleBuf.toString('utf16le', 0, len * 2) : '';

    const pidBuf = Buffer.alloc(4);
    api.GetWindowThreadProcessId(hwnd, pidBuf);
    const pid = pidBuf.readUInt32LE(0);

    let exe = '';
    if (pid) {
      const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
      const h = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
      if (h) {
        const nameBuf = Buffer.alloc(1024 * 2);
        const sizeBuf = Buffer.alloc(4);
        sizeBuf.writeUInt32LE(1024, 0);
        if (api.QueryFullProcessImageNameW(h, 0, nameBuf, sizeBuf)) {
          const n = sizeBuf.readUInt32LE(0);
          exe = path.win32.basename(nameBuf.toString('utf16le', 0, n * 2));
        }
        api.CloseHandle(h);
      }
    }

    const key = exe.toLowerCase();
    const app = FRIENDLY[key] || exe.replace(/\.exe$/i, '');
    return { app, exe, title, pid };
  } catch (err) {
    console.warn('[context] error leyendo ventana activa:', err.message);
    return null;
  }
}

module.exports = { getActiveWindow };
