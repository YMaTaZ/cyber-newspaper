# 打包脚本：产出可发布的 zip 与配套 entry.json
#
# 为什么需要它：官方打包器会把整个目录打进去，而仓库里有一堆不该随包分发的东西
# （probe/ 开发脚本、SPEC.md 设计文档、pack.ps1 自己、.git 提交历史、
#  README/LICENSE 仓库文档）。所以这里先暂存、打完再恢复。
#
# 关键约束：entry.json 里的 archive.size / archive.sha256 是**打包时**算的，
# 打包之后一个字节都不能再动 —— 市场按这两个值校验，对不上就装不上。
# 因此本脚本**不做任何事后修改 zip 的动作**，只靠打包前的暂存来保证内容干净。
# （旧版用 strip-dev-from-zip.ps1 事后删文件，导致声明的 size 比实际大一倍。）
#
# 用法：pwsh -File pack.ps1 -Publisher "Your Name"

param(
  # 发布者名，写进 entry.json 与市场登记。
  [string]$Publisher = "Cyber Newspaper Authors"
)

$ErrorActionPreference = "Continue"

$root  = $PSScriptRoot
$stash = Join-Path $env:TEMP "cns-pack-stash-$(Get-Random)"

# 不该进包的：开发物 + 仓库文档 + 版本控制
# .git 尤其要命：它含完整提交历史，打进包等于把仓库历史随安装包分发。
$devItems = @("probe", "SPEC.md", "pack.ps1", ".git", "LICENSE", "README.md", ".gitignore")

# 官方打包器位置。优先用 server 自带的（版本与宿主一致），回退到技能里的。
$hanaHome = if ($env:HANA_HOME) { $env:HANA_HOME } else { Join-Path $env:USERPROFILE ".hanako" }
$packer = $null
$srvRoot = Join-Path $hanaHome "artifacts\server"
if (Test-Path -LiteralPath $srvRoot) {
  $newest = Get-ChildItem -LiteralPath $srvRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($newest) {
    $cand = Join-Path $newest.FullName "scripts\extension-pack.mjs"
    if (Test-Path -LiteralPath $cand) { $packer = $cand }
  }
}
if (-not $packer) {
  $cand = Join-Path $hanaHome "skills\hana-app-creator\scripts\pack_app.mjs"
  if (Test-Path -LiteralPath $cand) { $packer = $cand }
}
if (-not $packer) {
  Write-Host "找不到打包器。请安装 hana-app-creator 技能，或用 HANA_HOME 指向 Hana 目录。" -ForegroundColor Red
  exit 1
}

Write-Host "打包 赛博报纸" -ForegroundColor Cyan
Write-Host "  源目录：$root"
Write-Host "  打包器：$packer"

# 1. 暂存不该进包的东西
New-Item -ItemType Directory -Force -Path $stash | Out-Null
$moved = @()
foreach ($item in $devItems) {
  $p = Join-Path $root $item
  if (Test-Path -LiteralPath $p) {
    Move-Item -LiteralPath $p -Destination (Join-Path $stash $item) -Force
    $moved += $item
  }
}
Write-Host "  已暂存：$($moved -join ', ')"

try {
  # 2. 打包（官方打包器自带静态校验，校验不过会非零退出）
  Write-Host "`n打包…" -ForegroundColor Cyan
  $dist = Join-Path $root "dist-extensions"
  if (Test-Path -LiteralPath $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $dist | Out-Null

  & node $packer --kind app --dir $root --publisher $Publisher --out $dist 2>&1 |
    Where-Object { $_ -match "wrote|error|Error|fail" } | ForEach-Object { Write-Host "  $_" }
  if ($LASTEXITCODE -ne 0) { throw "打包失败（exit $LASTEXITCODE）。" }
}
finally {
  # 3. 恢复暂存项
  #
  # 为什么不能直接 Move-Item：目标已存在时 PowerShell 会把源**当子项移进去**，
  # 得到 probe\probe\ —— 不报错，但源码目录静默结坏（真发生过，
  # 导致 16 个测试脚本全部找不到）。
  # 所以：目标不存在就整体移；目标已存在则逐项合并，同名以暂存区为准。
  foreach ($item in $moved) {
    $src = Join-Path $stash $item
    if (-not (Test-Path -LiteralPath $src)) { continue }
    $dst = Join-Path $root $item
    if (Test-Path -LiteralPath $dst) {
      if ((Get-Item -LiteralPath $dst).PSIsContainer) {
        Get-ChildItem -LiteralPath $src -Force | ForEach-Object {
          $target = Join-Path $dst $_.Name
          if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
          Move-Item -LiteralPath $_.FullName -Destination $target -Force
        }
        Remove-Item -LiteralPath $src -Recurse -Force
      } else {
        Remove-Item -LiteralPath $dst -Force
        Move-Item -LiteralPath $src -Destination $dst -Force
      }
    } else {
      Move-Item -LiteralPath $src -Destination $dst -Force
    }
  }
  Remove-Item -LiteralPath $stash -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "`n已恢复暂存项。" -ForegroundColor Cyan

  # 4. 展平自检：宁可报错也不能让嵌套静默留到下次
  $nested = Join-Path $root "probe\probe"
  if (Test-Path -LiteralPath $nested) {
    Write-Host "  ✗ 检测到 probe\probe 嵌套，恢复步骤有问题！" -ForegroundColor Red
    exit 1
  }
}

# 5. 发布包门禁 + 个人信息审计
$zipFinal = Get-ChildItem (Join-Path $root "dist-extensions") -Filter "*.zip" -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($zipFinal) {
  Write-Host "`n发布包门禁…" -ForegroundColor Cyan
  & node (Join-Path $root "probe\check-package.mjs") $zipFinal.FullName
  if ($LASTEXITCODE -ne 0) { throw "发布包内容不合格。" }

  # 个人信息审计扫两个范围：仓库源码 + 发布包。
  # 市场要求仓库公开，probe/ 与 SPEC.md 里的注释同样会被看到。
  Write-Host "`n个人信息审计…" -ForegroundColor Cyan
  & node (Join-Path $root "probe\audit-personal.mjs") $zipFinal.FullName
  if ($LASTEXITCODE -ne 0) { throw "发现个人信息残留，已中止。" }

  # 6. 声明值与实际字节必须一致
  #
  # 市场按 entry.json 的 size / sha256 校验下载，任何一个对不上都装不上。
  # 这一步是最后一道防线：本脚本不再改 zip，所以这里必须相等。
  Write-Host "`n校验声明值…" -ForegroundColor Cyan
  & node (Join-Path $root "probe\check-entry-integrity.mjs") $zipFinal.FullName
  if ($LASTEXITCODE -ne 0) { throw "entry.json 的 size/sha256 与实际 zip 不一致。" }
}
