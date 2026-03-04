Option Explicit

' 本 VBS ファイルと同階層にある、本 VBS ファイル名と同名のディレクトリを対象にランダム再生を開始する

' 終了時に GitBash ウィンドウを閉じないようにする
WScript.CreateObject("WScript.Shell").Run "C:\git-sdk-64\usr\bin\mintty.exe --icon C:\git-sdk-64\git-bash.exe --exec '/usr/bin/bash' --login -i -c 'node ""$(pwd)/random-play.js"" """ & Replace(WScript.ScriptName, ".vbs", "") & """ ; read -p ""Finished""'", 1, False

' 終了時に GitBash ウィンドウを自動的に閉じる
'WScript.CreateObject("WScript.Shell").Run "C:\git-sdk-64\usr\bin\mintty.exe --icon C:\git-sdk-64\git-bash.exe --exec '/usr/bin/bash' --login -i -c 'node ""$(pwd)/random-play.js"" """ & Replace(WScript.ScriptName, ".vbs", "") & """'", 1, False
