# Random Play

Windows 環境において、対象のディレクトリ配下にある動画ファイルを VLC でランダム再生するツール。

「ディレクトリ内のファイルを順次ランダム再生しながら、適宜不要なファイルは削除したい」という目的から作成しました。

- [MPC-HC](https://github.com/clsid2/mpc-hc) は「再生中のファイルを削除」する機能があるが、「ディレクトリ内の動画ファイルをランダム再生」する動作がファイル数に応じて遅くなる
- VLC は「ディレクトリ内の動画ファイルをランダム再生」する負荷が少なく高速に動作するが、「再生中のファイルを削除」する機能が標準では存在せず、プラグインも動作が安定しなかった


## 機能

- CLI と Web UI にて、以下の機能を提供する
    - 再生中の動画をスキップする
    - 再生中の動画ファイル名をリネームする (先頭にアンダースコアを付与する・後でファイルの削除や移動などを行うための目印として)
- CLI ではキーボード入力により、「スキップ」「リネーム」「ブラウザウィンドウの起動」「終了」処理が行える
- Web UI は `http://localhost:3000/` で起動し、ボタンの押下もしくはアクセスキーによるキーボード操作により「スキップ」「リネーム」「ブラウザウィンドウの位置調整」「終了」処理が行える


## ディレクトリ・ファイル構成

次のようにファイル群を配置する。

```
C:\PATH\TO\DIRECTORY\
├ random-play.js       … メイン処理用の JS ファイル・`random-play.js` 内に本ファイル名の指定がある
├ target-directory.vbs … 起動用ファイル・`random-play.vbs` を `target-directory` ディレクトリと同名にリネームして配置する
├ target-directory.csv … `target-direcotry` ディレクトリ内のファイル一覧を管理する CSV ファイル (JS ファイルにて自動生成・自動更新)・ファイル名、再生回数、スキップ回数、最終再生日時を記録する
└ target-directory\    … ランダム再生したい動画ファイルが格納されているディレクトリ
   └ 動画….mp4
```


## 必要な環境・ツール

- Windows 環境 : WSL ではなく Windows ホスト
    - WSH (VBScript) : メイン JS ファイルを起動するためのエントリポイントは VBScript ファイルで実装してある
    - PowerShell : メイン JS ファイル内で、ウィンドウ操作のために PowerShell を経由した Windows API のコールが実装されている
- [Node.js](https://github.com/coreybutler/nvm-windows)
    - メイン JS ファイルは Node.js で実行する
    - Node.js 組み込みモジュールだけで実装されているため npm インストール等は不要、単一 JS ファイルで動作する
    - `http://localhost:3000/` で Web UI が起動する
- [VLC](https://www.videolan.org/vlc/index.ja.html)
    - 動画ファイルの再生プレイヤーとして利用している
    - メイン JS ファイル内に実行ファイルのパスを定義してある
    - RC (リモートコントロール) 用のポート `4212` を使用して操作している
- [FFmpeg](https://www.gyan.dev/ffmpeg/builds/)
    - 動画ファイルの時間を計測するために使用している
    - メイン JS ファイル内では `ffmpeg` に環境変数 PATH が通っている前提で実装してある
- [GitBash (Git SDK)](https://github.com/git-for-windows/git-sdk-64)
    - メイン JS ファイルを起動するためのターミナルウィンドウとして利用する
    - 起動用 VBScript ファイル内に `mintty.exe` へのパスを記載している
    - メイン JS ファイル内でのウィンドウ位置操作でも `mintty` プロセスを前提とした実装になっている点に留意
- [Brave](https://brave.com/ja/)
    - CLI からの Web UI の起動・ブラウザウィンドウ位置操作のため、メイン JS ファイル内にプロセス名 `brave` を定義してある
    - Chromium 系のブラウザであれば動作するよう調整してある


## Links

- [Neo's World](https://neos21.net/)
