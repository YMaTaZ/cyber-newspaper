# 打包脚本：产出可发布的 zip 与配套 entry.json
#
# 用法：pwsh -File pack.ps1 -Publisher "Your Name"
#
# 【为什么不搬走源文件】
# 旧流程是「把 probe/ 等开发物 Move 到临时目录 → 打包 → Move 回来」。
# 它有个致命的单点故障：进程在打包途中被打断，finally 就跑不完，
# 源码整批留在临时目录里（真发生过，整个 probe/ 就这么消失了）。
# 现在改成反向：把要发布的部分 **复制** 到临时目录再打包，
# 源目录全程只读，任何时刻中断都不会丢东西。
#
# 【为什么不在打包后修改 zip】
# entry.json 里的 archive.size / sha256 是打包那一刻算的。
# 之后再动 zip 一个字节，声明值就作废，市场校验必然失败、包永远装不上
# （旧版用 strip-dev-from-zip 事后删文件，声明 6144448 而实际 3089432，正好差一倍）。
# 所以要排除的东西必须在打包**之前**就不在目录里。

param(
  # 发布者名，写进 entry.json 与市场登记。
  [string]$Publisher = "Cyber Newspaper Authors"
)

$ErrorActionPreference = "Continue"

$root  = $PSScriptRoot
$appId = (Get-Content (Join-Path $root "manifest.json") -Raw -Encoding UTF8 |
  ConvertFrom-Json).id
# 打包器沿用宿主的一条硬规则：App 目录名必须跟 manifest.id 一字不差。
# 所以临时输入目录不能叫随便什么名字，得叫 $appId。
$stamp = Get-Random
$stage = Join-Path $env:TEMP "cns-pack-$stamp\$appId"   # 干净的打包输入
$work  = Join-Path $env:TEMP "cns-pack-$stamp-out"      # 打包输出

# 不进包的东西：开发物、版本库、仓库文档、发布目录本身
# docs/ 是 PR 审阅用的截图，给市场投稿看，不是应用运行时需要的东西
$excludeDirs  = @("probe", ".git", "dist-extensions", "node_modules", "docs")
$excludeFiles = @("SPEC.md", "pack.ps1", ".gitignore")

# 打包器位置：优先用 server 自带的（版本与宿主一致），回退到技能里的
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
  Write-Host "找不到打包器。安装 hana-app-creator 技能，或用 HANA_HOME 指向 Hana 目录。" -ForegroundColor Red
  exit 1
}

Write-Host "打包 赛博报纸" -ForegroundColor Cyan
Write-Host "  源目录（全程只读）：$root"
Write-Host "  打包器：$packer"

# ---------- 1. 复制出干净的打包输入 ----------
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$xd = ($excludeDirs  | ForEach-Object { "/XD"; $_ })
$xf = ($excludeFiles | ForEach-Object { "/XF"; $_ })
# robocopy 的退出码 0-7 都是成功，只有 >=8 才是失败；不能直接看 $LASTEXITCODE -ne 0
$rcArgs = @($root, $stage, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP") + $xd + $xf
& robocopy @rcArgs | Out-Null
$rc = $LASTEXITCODE
$global:LASTEXITCODE = 0          # 清掉 robocopy 的非零退出码，别被当成错误
if ($rc -ge 8) {
  Write-Host "  ✗ 复制失败（robocopy $rc）" -ForegroundColor Red
  exit 1
}
$kept = (Get-ChildItem $stage -Force | Select-Object -ExpandProperty Name) -join ", "
Write-Host "  打包输入：$kept"

if ($Publisher -eq "Cyber Newspaper Authors") {
  Write-Host "  ⚠ publisher 用的是占位值，正式发布请传 -Publisher" -ForegroundColor Yellow
}

# ---------- 2. 打包（官方打包器自带静态校验，不过就非零退出）----------
Write-Host "`n打包…" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $work | Out-Null
& node $packer --kind app --dir $stage --publisher $Publisher --out $work 2>&1 |
  Where-Object { $_ -match "wrote|error|Error|fail" } | ForEach-Object { Write-Host "  $_" }
$packExit = $LASTEXITCODE

# ---------- 3. 产物搬回 dist-extensions，清临时区 ----------
$dist = Join-Path $root "dist-extensions"
$produced = @()
if ($packExit -eq 0 -and (Test-Path -LiteralPath $work)) {
  New-Item -ItemType Directory -Force -Path $dist | Out-Null
  Get-ChildItem $dist -File -ErrorAction SilentlyContinue | Remove-Item -Force
  $produced = Get-ChildItem $work -File | ForEach-Object {
    Copy-Item $_.FullName -Destination (Join-Path $dist $_.Name) -Force
    Join-Path $dist $_.Name
  }
}
foreach ($d in @((Split-Path $stage -Parent), $work)) {
  Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue
}
if ($packExit -ne 0 -or -not $produced) {
  Write-Host "`n✗ 打包失败（exit $packExit）。源目录未被改动，可直接重试。" -ForegroundColor Red
  exit 1
}

$zip = $produced | Where-Object { $_ -like "*.zip" } | Select-Object -First 1
Write-Host "`n产物：$(Split-Path $zip -Leaf)" -ForegroundColor Green
Write-Host "  大小：$("{0:N0} KB" -f ((Get-Item $zip).Length / 1KB))"

# ---------- 4. 门禁：包内容、个人信息、声明值 ----------
Write-Host "`n发布包门禁…" -ForegroundColor Cyan
& node (Join-Path $root "probe\check-package.mjs") $zip
if ($LASTEXITCODE -ne 0) { throw "发布包内容不合格。" }

# 扫两个范围：仓库源码 + 发布包。市场要求仓库公开，
# probe/ 与 SPEC.md 里的注释同样会被看到。
Write-Host "`n个人信息审计…" -ForegroundColor Cyan
& node (Join-Path $root "probe\audit-personal.mjs") $zip
if ($LASTEXITCODE -ne 0) { throw "发现个人信息残留，已中止。" }

# 市场按 entry.json 的 size/sha256 校验下载，对不上就装不上。
# 本脚本不再事后改 zip，所以这里必须相等 —— 这道是最后防线。
Write-Host "`n校验声明值…" -ForegroundColor Cyan
& node (Join-Path $root "probe\check-entry-integrity.mjs") $zip
if ($LASTEXITCODE -ne 0) { throw "entry.json 的 size/sha256 与实际 zip 不一致。" }

# 装完后用它核对「本机跑的就是这一版」
Write-Host "`n已装版本核对（应显示源码同一版本）…" -ForegroundColor Cyan
& node (Join-Path $root "probe\verify-installed.mjs")
