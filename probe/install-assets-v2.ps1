# 把生成的 v2 吉祥物图落到发布位置。
#
# 用法：powershell -File install-assets-v2.ps1 <icon.jpg> <cover.jpg>
#
# 为什么参数化而不是写死文件名：生成图的落盘名带随机后缀，每次都不一样；
# 写死就等于每次手改脚本。
#
# 为什么全程走 MemoryStream：System.Drawing 的 FromFile 会锁源文件，
# 再往同一路径 Save 报 "A generic error occurred in GDI+"（本次踩过）。
#
# 尺寸：icon 出 256（宿主对超过 256 的图本来就降采样，多出的是白给体积）；
# cover 出 800x1200，够卡片封面显示，也把体积压住。

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot   # 项目根 = 本脚本所在 probe/ 的上一级
if ($args.Count -lt 2) {
  Write-Host "用法: install-assets-v2.ps1 <icon 源图> <cover 源图>" -ForegroundColor Red
  exit 1
}
$iconSrc = $args[0]
$coverSrc = $args[1]
foreach ($s in @($iconSrc, $coverSrc)) {
  if (-not (Test-Path -LiteralPath $s)) {
    Write-Host "x 源图不存在: $s" -ForegroundColor Red
    exit 1
  }
}

function Load-Bitmap($path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $ms = New-Object System.IO.MemoryStream(,$bytes)
  return @{ bmp = New-Object System.Drawing.Bitmap($ms); ms = $ms }
}

function Save-Png($bmp, $path) {
  $out = New-Object System.IO.MemoryStream
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  [System.IO.File]::WriteAllBytes($path, $out.ToArray())
  $out.Dispose()
}

function Convert-To($src, $dst, $w, $h) {
  $p = Load-Bitmap $src
  $img = $p.bmp
  $srcW = $img.Width; $srcH = $img.Height
  $nb = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($nb)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  # 源图比例与目标不一致时按短边裁切，避免拉伸变形
  $srcRatio = $srcW / $srcH
  $dstRatio = $w / $h
  if ([Math]::Abs($srcRatio - $dstRatio) -gt 0.01) {
    if ($srcRatio -gt $dstRatio) {
      $cropW = [int]($srcH * $dstRatio)
      $x0 = [int](($srcW - $cropW) / 2)
      $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)), (New-Object System.Drawing.Rectangle($x0, 0, $cropW, $srcH)), [System.Drawing.GraphicsUnit]::Pixel)
    } else {
      $cropH = [int]($srcW / $dstRatio)
      $y0 = [int](($srcH - $cropH) / 2)
      $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)), (New-Object System.Drawing.Rectangle(0, $y0, $srcW, $cropH)), [System.Drawing.GraphicsUnit]::Pixel)
    }
  } else {
    $g.DrawImage($img, 0, 0, $w, $h)
  }
  $g.Dispose(); $img.Dispose(); $p.ms.Dispose()
  Save-Png $nb $dst
  $nb.Dispose()
  Write-Host ("   {0}  {1}x{2} 源 -> {3}x{4}  {5:N0} KB" -f (Split-Path $dst -Leaf), $srcW, $srcH, $w, $h, ((Get-Item $dst).Length / 1KB))
}

Convert-To $iconSrc "$root\assets\icon.png" 256 256
Convert-To $coverSrc "$root\ui\assets\cover.png" 800 1200

# 小尺寸可读性预览：图标好坏只看缩后
foreach ($sz in @(32, 48, 64)) {
  $p = Load-Bitmap "$root\assets\icon.png"
  $nb = New-Object System.Drawing.Bitmap($sz, $sz)
  $g = [System.Drawing.Graphics]::FromImage($nb)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($p.bmp, 0, 0, $sz, $sz)
  $g.Dispose(); $p.bmp.Dispose(); $p.ms.Dispose()
  Save-Png $nb "$root\probe\out\icon-v2-$sz.png"
  $nb.Dispose()
}
# 封面在卡片里的实际观感
$p2 = Load-Bitmap "$root\ui\assets\cover.png"
$nb2 = New-Object System.Drawing.Bitmap(300, 450)
$g2 = [System.Drawing.Graphics]::FromImage($nb2)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.DrawImage($p2.bmp, 0, 0, 300, 450)
$g2.Dispose(); $p2.bmp.Dispose(); $p2.ms.Dispose()
Save-Png $nb2 "$root\probe\out\cover-v2-300.png"
$nb2.Dispose()
Write-Host "   预览: probe\out\icon-v2-{32,48,64}.png, cover-v2-300.png"

# 封面转 WebP：这张图细节密，无损 PNG 会涨到 2.7MB（实测）。
# 不接这一步就等于下次换图后静默地把发布包体积翻倍，所以写在流程里而不是靠人记。
Write-Host "`n封面转 WebP…" -ForegroundColor Cyan
& python "$root\probe\to-webp.py"
if ($LASTEXITCODE -ne 0) { throw "WebP 转换未通过。" }
