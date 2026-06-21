#!/usr/env/bin node

const fs           = require('node:fs');
const path         = require('node:path');
const childProcess = require('node:child_process');
const net          = require('node:net');
const http         = require('node:http');
const url          = require('node:url');


// ====================================================================================================


const DIRECTORY_NAME         = process.argv[2];                                   // 対象のディレクトリ名

const VIDEO_DIR              = path.resolve(__dirname, DIRECTORY_NAME);           // 本 JS の隣にあるディレクトリを開く
const CSV_PATH               = path.resolve(__dirname, `${DIRECTORY_NAME}.csv`);  // 本 JS の隣に同名の CSV ファイルを置く
const VLC_PATH               = 'C:/Program Files/VideoLAN/VLC/vlc.exe';           // VLC プレイヤーのパス
const RC_PORT                = 4212;                                              // VLC プレイヤーの RC ポート
const BROWSER_PROCESS_NAME   = 'brave';                                           // 操作対象とするブラウザ名

const GIT_BASH_WINDOW_X      = -6;                                                // GitBash ウィンドウを画面左上に置く (`0` だと隙間ができてしまうため)
const GIT_BASH_WINDOW_Y      = -1;                                                // GitBash ウィンドウの位置
const GIT_BASH_WINDOW_WIDTH  = 545;                                               // GitBash ウィンドウの幅・テキストが適度な長さになるように
const GIT_BASH_WINDOW_HEIGHT = 608;                                               // GitBash ウィンドウの高さ
const VLC_WINDOW_X           = GIT_BASH_WINDOW_WIDTH + (GIT_BASH_WINDOW_X) - 14;  // VLC ウィンドウを GitBash ウィンドウとブラウザウィンドウの右側に置く
const VLC_WINDOW_Y           = 0;                                                 // VLC ウィンドウの位置
const VLC_WINDOW_WIDTH       = 2200 - VLC_WINDOW_X;                               // VLC ウィンドウの幅
const VLC_WINDOW_HEIGHT      = 1192;                                              // Y = 0 の場合にタスクバーにかからない高さ
const BROWSER_WINDOW_X       = -6;                                                // ブラウザウィンドウを画面左下に置く (`0` だと隙間ができてしまうため)
const BROWSER_WINDOW_Y       = 600;                                               // ブラウザウィンドウの位置
const BROWSER_WINDOW_WIDTH   = 545;                                               // ブラウザウィンドウの幅
const BROWSER_WINDOW_HEIGHT  = 592;                                               // ブラウザウィンドウの高さ

const SKIP_THRESHOLD         = 0.8;                                               // 再生位置が 80% 未満ならスキップとみなす
const PORT                   = 3000;                                              // HTTP サーバのポート


// ====================================================================================================


// キー操作とフロントエンド操作で処理できるようにグローバルに持たせる
let currentEntry  = null;
let currentClient = null;

const playedInSession = [];  // セッション中に再生済みのファイルを記録する
let isGoingBack = false;  // 「戻る」操作中か否か

process.on('unhandledRejection', async (error, promise) => {
  console.error('Unhandled Rejection', error, promise);
  fs.writeFileSync('unhandled.txt', new Date().toISOString() + '\n' + error.toString(), 'utf-8');
  await new Promise(resolve => setTimeout(resolve, 3000));
});

process.on('uncaughtException', async error => {
  console.error('Uncaught Exception', error);
  fs.writeFileSync('uncaught.txt', new Date().toISOString() + '\n' + error.toString(), 'utf-8');
  await new Promise(resolve => setTimeout(resolve, 3000));
  process.abort();
});

/** CSV ファイルを読み込んで連想配列として返す */
function loadStats() {
  // CSV ファイルが存在しなかったらヘッダだけ作る
  if(!fs.existsSync(CSV_PATH)) fs.writeFileSync(CSV_PATH, 'file-name,play-count,skip-count,last-played-at\n');
  // CSV ファイルのヘッダ行を削って動画ファイル一覧を取得する
  const lines = fs.readFileSync(CSV_PATH, 'utf8')
    .split('\n')
    .slice(1)
    .filter(Boolean);
  // CSV の内容から連想配列を作成して返す
  const stats = {};
  lines.forEach(line => {
    const [fileName, playCount, skipCount, lastPlayedAt] = line.split(',');
    stats[fileName] = {
      fileName    : fileName,
      playCount   : Number.parseInt(playCount),
      skipCount   : Number.parseInt(skipCount),
      lastPlayedAt: lastPlayedAt || ''
    };
  });
  return stats;
}

/** Stats の情報を CSV ファイルに書き込む */
function saveStats(stats) {
  let text = 'file-name,play-count,skip-count,last-played-at\n';
  Object.values(stats).forEach(stat => {
    text += `${stat.fileName},${stat.playCount},${stat.skipCount},${stat.lastPlayedAt}\n`;
  });
  fs.writeFileSync(CSV_PATH, text);
}

/** 配下のディレクトリ内の動画ファイルを再帰的に取得する */
function getAllVideos(dir, base = '') {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for(const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(base, entry.name);
    if(entry.isDirectory()) {
      results = results.concat(getAllVideos(fullPath, relativePath));
    }
    else if((/\.(mp4)$/i).test(entry.name)) {
      results.push(relativePath.replace((/\\/g), '/'));
    }
  }
  return results;
}

/** ディレクトリ内のファイル一覧を取得して連想配列を作成する */
function syncFiles(stats) {
  const files = getAllVideos(VIDEO_DIR);
  // 削除された動画ファイルが CSV ファイルに残らないようにする
  const newStats = {};
  files.forEach(fileName => {
    if(stats[fileName]) {
      newStats[fileName] = stats[fileName];
    }
    else {
      newStats[fileName] = {
        fileName    : fileName,
        playCount   : 0,
        skipCount   : 0,
        lastPlayedAt: ''
      };
    }
  });
  return newStats;
}

/** 重み付きランダム取得アルゴリズム */
function weightedPick(statsList) {
  const weights = statsList.map(stat => 100 / (1 + stat.playCount + stat.skipCount * 2));
  const total = weights.reduce((accumulator, weight) => accumulator + weight, 0);
  let randomValue = Math.random() * total;
  for(let i = 0; i < statsList.length; i++) {
    if((randomValue -= weights[i]) <= 0) return statsList[i];
  }
  return statsList[0];
}

/** FFmpeg を用いて動画長を取得する */
function getDuration(file) {
  return new Promise((resolve) => {
    const ffmpegProcess = childProcess.spawn('ffmpeg', ['-i', '--', file]);
    let stderr = '';
    ffmpegProcess.stderr.on('data', data => { stderr += data.toString(); });
    ffmpegProcess.on('close', () => {
      const match = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if(!match) return resolve(0);
      const hours   = Number.parseInt(match[1]);
      const minutes = Number.parseInt(match[2]);
      const seconds = Number.parseFloat(match[3]);
      resolve((hours * 3600) + (minutes * 60) + seconds);
    });
  });
}

/** 動画ファイルを削除扱いにする : PowerShell 呼び出しでゴミ箱に入れようとすると NAS だと完全削除になってしまい、ローカルでも複数回実行されてしまう問題があったのでリネームにする */
function rename(targetEntry) {
  if(targetEntry == null) return console.warn('Rename : Target Entry Is Null');
  
  const fullPath = path.join(VIDEO_DIR, targetEntry.fileName);
  if(!fs.existsSync(fullPath)) return console.warn('Rename : Target File Does Not Exist');
  
  const dir = path.dirname(fullPath);
  const base = path.basename(fullPath);
  if(base.startsWith('_')) return console.warn('Rename : Target File Is Already Renamed');
  
  const newPath = path.join(dir, '_' + base);
  fs.renameSync(fullPath, newPath);
  console.log(`Rename : Renamed : ${targetEntry.fileName}`);
  console.log(`  → ${path.basename(newPath)}`);
}

/** VLC ウィンドウの位置を調整する */
function arrangeVlcWindow() {
  childProcess.spawn('powershell.exe', [
    '-NoProfile',
    '-WindowStyle', 'Hidden',
    '-Command',
    `
      $code = @"
        using System;
        using System.Runtime.InteropServices;
        public class Win {
          [DllImport("user32.dll")]
          public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
        }
      \n"@;
      Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue;
      $vlc = Get-Process vlc -ErrorAction SilentlyContinue | Select-Object -First 1;
      if($vlc -and $vlc.MainWindowHandle -ne 0) {
        [Win]::MoveWindow($vlc.MainWindowHandle, ${VLC_WINDOW_X}, ${VLC_WINDOW_Y}, ${VLC_WINDOW_WIDTH}, ${VLC_WINDOW_HEIGHT}, $true);
      }
    `
  ]).unref();
}

/** GitBash ウィンドウにフォーカスを当てる */
function focusGitBashWindow() {
  childProcess.spawn('powershell.exe', [
    '-NoProfile',
    '-WindowStyle', 'Hidden',
    '-Command',
    `
      $code = @"
        using System;
        using System.Runtime.InteropServices;
        public class Win {
          [DllImport("user32.dll")]
          public static extern bool SetForegroundWindow(IntPtr hWnd);
          [DllImport("user32.dll")]
          public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
        }
      \n"@;
      Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue;
      $mintty = Get-Process mintty -ErrorAction SilentlyContinue | Select-Object -First 1;
      if($mintty -and $mintty.MainWindowHandle -ne 0) {
        [Win]::ShowWindowAsync($mintty.MainWindowHandle, 9);
        [Win]::SetForegroundWindow($mintty.MainWindowHandle);
      }
    `
  ]).unref();
}

/** ブラウザウィンドウの位置を調整する : 複数プロセス存在することを前提にしている */
function arrangeBrowserWindow() {
  childProcess.spawn('powershell.exe', [
    '-NoProfile',
    '-WindowStyle', 'Hidden',
    '-Command',
    `
      $code = @"
        using System;
        using System.Runtime.InteropServices;
        public class Win {
          [DllImport("user32.dll")]
          public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
        }
      \n"@;
      Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue;
      $browserWindows = Get-Process ${BROWSER_PROCESS_NAME} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
      foreach($proc in $browserWindows) {
        [Win]::MoveWindow($proc.MainWindowHandle, ${BROWSER_WINDOW_X}, ${BROWSER_WINDOW_Y}, ${BROWSER_WINDOW_WIDTH}, ${BROWSER_WINDOW_HEIGHT}, $true);
      }
    `
  ]).unref();
}

/** VLC RC に終了するコマンドを投げる */
function gracefulQuit() {
  //console.log(`[${new Date().toISOString()}] gracefulQuit Called`, { clientIsNull: currentClient == null, clientDestroyed: currentClient?.destroyed });
  if(currentClient != null && !currentClient.destroyed) {
    currentClient.write('quit\n', error => {
      if(error != null) console.error(`[${new Date().toISOString()}] gracefulQuit Write Error`, error);
    });
  }
}

/** 動画ファイル再生中にキー入力を受け付けるようにする */
function setupKeyControls() {
  // 過去のリスナを削除しておく
  process.stdin.removeAllListeners('data');
  
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async key => {
    // `q` で終了する
    if(key === 'q') {
      console.log('[CLI] Exiting...');
      gracefulQuit();
      
      process.exit();
    }
    // `d` で動画ファイルを削除する
    if(key === 'd') {
      console.log('[CLI] Renaming...');
      gracefulQuit();
      
      const targetEntry = currentEntry;  // Wait 中に書き換わるため控えておく
      await new Promise(resolve => setTimeout(resolve, 500));
      rename(targetEntry);
    }
    // `s` でスキップし次の動画ファイルに移動する
    if(key === 's') {
      console.log('[CLI] Skipping...');
      gracefulQuit();
    }
    // `p` で1つ前のファイルに戻る
    if(key === 'p') {
      if(playedInSession.length <= 1) return console.log('[CLI] No Previous Video');
      console.log('[CLI] Going Back...');
      isGoingBack = true;
      gracefulQuit();
    }
    // `b` でブラウザウィンドウを開けるようにしておく
    if(key === 'b') {
      console.log('[CLI] Open Browser Window');
      childProcess.spawn('powershell', ['-Command', `Start-Process "${BROWSER_PROCESS_NAME}.exe" "http://localhost:${PORT}/"`]).unref();
      await new Promise(resolve => setTimeout(resolve, 500));
      arrangeBrowserWindow();
    }
  });
}

/** VLC で動画を再生する */
async function playVideo(entry, stats) {
  const fullPath = path.join(VIDEO_DIR, entry.fileName);
  console.log(`Playing : ${entry.fileName}`);
  
  const duration = await getDuration(fullPath);
  
  const vlc = childProcess.spawn(VLC_PATH, [
    '--extraintf', 'rc',
    '--rc-host', `127.0.0.1:${RC_PORT}`,
    '--rc-quiet',
    '--',
    fullPath,
  ]);
  await new Promise(resolve => setTimeout(resolve, 750));
  //vlc.on('error', error => console.error(`[${new Date().toISOString()}] vlc Process Error`, error));
  //vlc.stderr.on('data', data => console.error(`[${new Date().toISOString()}] vlc stderr`, data.toString()));
  
  const client = new net.Socket();
  let pollTimer = null;
  let position     = 0;  // 再生位置の記録
  let prevPosition = 0;  // 「次を再生」ボタンの押下検知用
  client.connect(RC_PORT, '127.0.0.1', () => {
    client.write('get_time\n');
    pollTimer = setInterval(() => {
      if(client != null && !client.destroyed) client.write('get_time\n');
    }, 300);
  });
  client.on('data', data => {
    const text = data.toString().trim();
    const num = Number.parseInt(text);
    if(!Number.isNaN(num)) {
      // 「次を再生」ボタン押下の検知 : 5秒以上再生していた状態から突然1秒以下に戻ったら「次を再生」ボタン押下と判定する
      if(prevPosition > 1 && num <= 1 && !client.destroyed) gracefulQuit();
      
      prevPosition = position;
      position = num;
    }
  });
  //client.on('close', hadError => { console.log(`[${new Date().toISOString()}] client Close`, hadError); });
  // ECONNRESET 発生時のための処理
  client.on('error', error => {
    console.error(`[${new Date().toISOString()}] client Error`, error);
    client.destroy();
  });
  
  arrangeVlcWindow();  // VLC ウィンドウの位置を調整する
  currentEntry  = entry;
  currentClient = client;
  setupKeyControls();  // キー操作できるようにする
  //focusGitBashWindow();  // NOTE : VLC に奪われたフォーカスを取り返す際は有効にする
  
  return new Promise(resolve => {
    vlc.on('exit', () => {
      //console.log(`[${new Date().toISOString()}] vlc On Exit`);
      if(pollTimer != null) clearInterval(pollTimer);  // タイマーを止める
      client.destroy();
      entry.playCount++;
      entry.lastPlayedAt = new Date().toISOString();
      if(duration > 0 && position < duration * SKIP_THRESHOLD) entry.skipCount++;
      saveStats(stats);
      resolve();
    });
  });
}

/** メインループ */
async function mainLoop() {
  // CSV ファイルの初回読み込み・動画ファイルが増えた場合の同期・CSV ファイルの更新を済ませておく */
  let stats = loadStats();
  stats = syncFiles(stats);
  saveStats(stats);
  
  const statsList = Object.values(stats);
  
  // 「戻る」操作中なら履歴から取り出す
  let entry;
  if(isGoingBack) {
    isGoingBack = false;
    const prevFileName = playedInSession.pop();  // 現在再生中を取り除く
    const targetFileName = playedInSession.pop();  // 1つ前を取り出す
    entry = stats[targetFileName] ?? weightedPick(statsList);  // 見つからなければランダムに抽出する
  }
  else {
    const unplayed = statsList.filter(stat => !playedInSession.includes(stat.fileName));
    if(unplayed.length === 0) playedInSession.length = 0;
    const candidates = playedInSession.length === 0 ? statsList : unplayed;
    entry = weightedPick(candidates);
  }
  playedInSession.push(entry.fileName);
  
  // 再生する
  await playVideo(entry, stats);
  // 再度ループする
  mainLoop();
}

/** メイン関数 */
(async () => {
  if(DIRECTORY_NAME == null) {
    console.error('No Directory Name');
    return process.exit(1);
  }
  
  console.log('Random Play : Ctrl+C Is Unavailable');
  console.log('[q]Exit [d]Delete [s]Skip [p]Prev [b]Browser');
  
  // Web サーバを立てる
  http.createServer(async (req, res) => {
    const path = url.parse(req.url, true).pathname;
    
    if(path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Random Play</title>
            <style>
              html { font-family: sans-serif; font-weight: bold; }
              button { display: block; width: 100%; padding-block: 1.5rem; font-weight: bold; cursor: pointer; }
            </style>
          </head>
          <body>
            <p>${VIDEO_DIR}</p>
            <p><button onclick="fetch('/q')" accesskey="q">Quit</button></p>
            <p><button onclick="fetch('/s')" accesskey="s">Skip</button></p>
            <p><button onclick="fetch('/d')" accesskey="d">Delete</button></p>
            <p><button onclick="fetch('/p')" accesskey="p">Previous</button></p>
            <p><button onclick="fetch('/a')" accesskey="aq">Arrange</button></p>
          </body>
        </html>
      `);
      return;
    }
    
    if(path === '/q') {
      console.log('[Server] Exiting...');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Exiting OK');
      
      gracefulQuit();
      process.exit();
      return;
    }
    if(path === '/d') {
      console.log('[Server] Renaming...');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Rename OK');
      
      gracefulQuit();
      const targetEntry = currentEntry;  // Wait 中に書き換わるため控えておく
      await new Promise(resolve => setTimeout(resolve, 500));
      rename(targetEntry);
      return;
    }
    if(path === '/s') {
      console.log('[Server] Skipping...');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Skipping OK');
      
      gracefulQuit();
      return;
    }
    if(path === '/p') {
      console.log('[Server] Going Back...');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Prev OK');
      
      if(playedInSession.length <= 1) return;
      isGoingBack = true;
      gracefulQuit();
      return;
    }
    if(path === '/a') {
      console.log('[Server] Arrange Browser Window...');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Arrange OK');
      
      arrangeBrowserWindow();
      return;
    }
    
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }).listen(PORT, () => { console.log(`[Server] Running http://localhost:${PORT}`); });
  
  await new Promise(resolve => setTimeout(resolve, 750));
  // GitBash ウィンドウの位置を調整する
  childProcess.spawn('powershell.exe', [
    '-NoProfile',
    '-WindowStyle', 'Hidden',
    '-Command',
    `
      $code = @"
        using System;
        using System.Runtime.InteropServices;
        public class Win {
          [DllImport("user32.dll")]
          public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
        }
      \n"@;
      Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue;
      $mintty = Get-Process mintty -ErrorAction SilentlyContinue | Select-Object -First 1;
      if($mintty -and $mintty.MainWindowHandle -ne 0) {
        [Win]::MoveWindow($mintty.MainWindowHandle, ${GIT_BASH_WINDOW_X}, ${GIT_BASH_WINDOW_Y}, ${GIT_BASH_WINDOW_WIDTH}, ${GIT_BASH_WINDOW_HEIGHT}, $true);
      }
    `
  ]).unref();
  
  // ブラウザウィンドウを開いて調整する
  childProcess.spawn('powershell', ['-Command', `Start-Process "${BROWSER_PROCESS_NAME}.exe" "http://localhost:${PORT}/"`]).unref();
  await new Promise(resolve => setTimeout(resolve, 500));
  arrangeBrowserWindow();
  
  // メインループを実行する
  mainLoop();
})();
