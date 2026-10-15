# 打包脚本：排除开发物，产出可发布的 zip
#
# 为什么需要它：probe/ 与 SPEC.md 是开发期产物，不该进用户的应用目录。
# 官方 pack_app.mjs 会打包整个目录，所以这里先暂存开发物，打完再恢复。
#
# 用法：pwsh -File pack.ps1 -Publisher "Your Name"

param(
  # 发布者名，会写进包的 entry.json 与市场登记。不传则用占位值。
  [string]$Publisher = "Cyber Newspaper Authors"
)

$ErrorActionPreference = "Continue"

$root  = $PSScriptRoot
$stash = Join-Path $env:TEMP "digest-pack-stash-$(Get-Random)"
$devItems = @("probe", "SPEC.md")
# 脚手架位置：随 hana-app-creator 技能安装，可用 HANA_HOME 覆盖。
$hanaHome = if ($env:HANA_HOME) { $env:HANA_HOME } else { Join-Path $env:USERPROFILE ".hanako" }
$creator = Join-Path $hanaHome "skills\hana-app-creator"

if (-not (Test-Path -LiteralPath (Join-Path $creator "scripts\pack_app.mjs"))) {
  Write-Host "找不到打包器：$creator\scripts\pack_app.mjs" -ForegroundColor Red
  Write-Host "请先安装 hana-app-creator 技能，或用 HANA_HOME 指向正确的 Hana 目录。" -ForegroundColor Yellow
  exit 1
}

Write-Host "打包 赛博报纸" -ForegroundColor Cyan
Write-Host "  源目录：$root"

# 1. 暂存开发物
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
  # 2. 静态校验
  Write-Host "`n静态校验…" -ForegroundColor Cyan
  $out = (& node "$creator\scripts\validate_app.mjs" --dir $root --json 2>$null | Out-String)
  $json = ($out -split "`n" | Where-Object { $_.TrimStart().StartsWith("{") } | Select-Object -First 1)
  if ($json) {
    $r = $json | ConvertFrom-Json
    if ($r.summary.errors -gt 0) {
      Write-Host "  校验失败，$($r.summary.errors) 个错误：" -ForegroundColor Red
      $r.issues | Where-Object { $_.severity -eq "error" } | ForEach-Object { Write-Host "    [$($_.code)] $($_.message)" }
      throw "静态校验未通过，已中止打包。"
    }
    Write-Host "  通过（$($r.summary.errors) 错误 / $($r.summary.warnings) 警告）" -ForegroundColor Green
  } else {
    Write-Host "  未能解析校验输出，继续打包。" -ForegroundColor Yellow
  }

  # 3. 打包
  Write-Host "`n打包…" -ForegroundColor Cyan
  $dist = Join-Path $root "dist-extensions"
  if (Test-Path -LiteralPath $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
  (& node "$creator\scripts\pack_app.mjs" --dir $root --publisher $Publisher --out $dist 2>$null) |
    Where-Object { $_ -match "wrote|error|Error" } | ForEach-Object { Write-Host "  $_" }

  # 4. 核验包内不含开发物
  $zip = Get-ChildItem $dist -Filter "*.zip" | Select-Object -First 1
  if ($zip) {
    Write-Host "`n产物：$($zip.FullName)" -ForegroundColor Green
    Write-Host "  大小：$("{0:N0} KB" -f ($zip.Length / 1KB))"
    try {
      $list = & tar -tf $zip.FullName
      $bad = $list | Where-Object { $_ -match "^(probe/|SPEC\.md)" }
      if ($bad) {
        Write-Host "  警告：包内仍含开发物：" -ForegroundColor Yellow
        $bad | Select-Object -First 5 | ForEach-Object { Write-Host "    $_" }
      } else {
        Write-Host "  开发物检查：通过（不含 probe/ 与 SPEC.md）" -ForegroundColor Green
      }
    } catch {
      Write-Host "  (tar 不可用，跳过包内容检查)" -ForegroundColor Yellow
    }
  }
}
finally {
  # 5. 恢复开发物
  #
  # 为什么不能直接 Move-Item：目标目录已存在时，PowerShell 会把源**当子项移进去**，
  # 得到 probe\probe\ —— 不报错，但源码目录静默结坏（本次真发生过，
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
  Write-Host "`n开发物已恢复。" -ForegroundColor Cyan

  # 6. 展平自检：宁可报错也不能让嵌套静默留到下次
  $nested = Join-Path $root "probe\probe"
  if (Test-Path -LiteralPath $nested) {
    Write-Host "  ✗ 检测到 probe\probe 嵌套，恢复步骤有问题！" -ForegroundColor Red
    exit 1
  }
}

# 7. 剔除包内开发物 + 发布包门禁
#
# 为什么在 finally 之后：第 1 步把 probe/ 暂存走了，打包时
# probe\strip-dev-from-zip.ps1 根本不在目录里，清理必须在恢复完执行。
# 为什么不能只靠第 4 步的 tar 检查：它只匹配 probe/ 与 SPEC.md，
# pack.ps1 自己进了包它看不见（实际发生过），而检查清单必须比犯错范围宽。
$zipFinal = Get-ChildItem (Join-Path $root "dist-extensions") -Filter "*.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($zipFinal) {
  Write-Host "`n清理发布包…" -ForegroundColor Cyan
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "probe\strip-dev-from-zip.ps1") $zipFinal.FullName
  if ($LASTEXITCODE -ne 0) { throw "发布包清理未通过。" }

  Write-Host "`n发布包门禁…" -ForegroundColor Cyan
  & node (Join-Path $root "probe\check-package.mjs") $zipFinal.FullName
  if ($LASTEXITCODE -ne 0) { throw "发布包内容不合格。" }

  # 8. 个人信息审计
  #
  # 为什么单独一步：check-package 只看包，而市场要求仓库公开，
  # probe/ 与 SPEC.md 里的注释同样会被看到。两处都扫才不会漏。
  # 这一步没有"警告"档：要么无个人身份残留，要么不发包。
  Write-Host "`n个人信息审计…" -ForegroundColor Cyan
  & node (Join-Path $root "probe\audit-personal.mjs") $zipFinal.FullName
  if ($LASTEXITCODE -ne 0) { throw "发现个人信息残留，已中止。" }
}
