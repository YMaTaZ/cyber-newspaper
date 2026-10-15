# 手写绘制应用图标，替掉生成图里那团去不掉的烟雾。
#
# 为什么不用像素清理：实测发现拖影与纸张颗粒是同一种材料
# （近中性灰、L 30~200），按阈值筛会命中上半区 17.3% 的像素，
# 那不是修图，是磨图。所以放弃修补。
#
# 为什么不再烧一次额度：图标本体就是矩形 + 色块 + 方点，
# 几何图形用代码画比让模型画更准，而且零成本、可复现、硬边可控。
# 生成的那张坏就坏在"软"：烟雾、纸纹过渡都不符合瑞士风格的硬边要求。
#
# 方点而不是圆点：母题是"半调网点=像素格"，方形同时是两者，
# 缩到 32px 也不会糊成一团。
#
# 用法：powershell -File draw-icon.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot   # 项目根 = 本脚本所在 probe/ 的上一级
$icon = "$root\assets\icon.png"
$S = 256

# 配色：沿用日报的墨青底 + 蓝钢强调，与界面同源
$ink    = [System.Drawing.Color]::FromArgb(255, 22, 34, 44)    # #16222C
$paper  = [System.Drawing.Color]::FromArgb(255, 243, 240, 232) # 暖白
$steel  = [System.Drawing.Color]::FromArgb(255, 83, 125, 150)  # #537D96

$bmp = New-Object System.Drawing.Bitmap($S, $S, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
# 硬边：不开抗锯齿。瑞士风格要的是刀切的分隔线
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half

$bPaper = New-Object System.Drawing.SolidBrush($paper)
$bSteel = New-Object System.Drawing.SolidBrush($steel)
$bInk   = New-Object System.Drawing.SolidBrush($ink)

# 背景
$g.FillRectangle($bInk, 0, 0, $S, $S)

# ---- 报纸主体（偏左下，给右上留出网点区）----
$bodX = 40;  $bodY = 78;  $bodW = 132; $bodH = 118
$g.FillRectangle($bPaper, $bodX, $bodY, $bodW, $bodH)

# 报头横带
$g.FillRectangle($bSteel, $bodX, $bodY, $bodW, 26)

# 左上图块
$g.FillRectangle($bSteel, ($bodX + 14), ($bodY + 38), 42, 40)

# 右侧文字条（三行）
for ($i = 0; $i -lt 3; $i++) {
  $g.FillRectangle($bSteel, ($bodX + 66), ($bodY + 38 + $i * 15), 52, 7)
}
# 底部通栏两行
for ($i = 0; $i -lt 2; $i++) {
  $g.FillRectangle($bSteel, ($bodX + 14), ($bodY + 88 + $i * 14), 104, 6)
}

# ---- 折页：主体右侧一条白纸 + 底部蓝色折角 ----
$flX = ($bodX + $bodW); $flW = 22
$g.FillRectangle($bPaper, $flX, ($bodY + 12), $flW, ($bodH - 12))
# 折角三角（用多边形，硬边）
$tri = New-Object System.Drawing.Point[] 3
$tri[0] = New-Object System.Drawing.Point($flX, ($bodY + $bodH - 26))
$tri[1] = New-Object System.Drawing.Point(($flX + $flW), ($bodY + $bodH))
$tri[2] = New-Object System.Drawing.Point($flX, ($bodY + $bodH))
$g.FillPolygon($bSteel, $tri)

# ---- 半调网点 / 像素格：右上角，方块由大到小 ----
# 三列，每列方块尺寸递减，读起来既是印刷加网也是像素阵列
$cols = @(
  @{ x = 182; y = 30; sz = 16 },
  @{ x = 202; y = 30; sz = 12 },
  @{ x = 220; y = 30; sz = 8 }
)
foreach ($c in $cols) {
  for ($r = 0; $r -lt 3; $r++) {
    $sz = [Math]::Max(3, ($c.sz - $r * 3))
    $g.FillRectangle($bPaper, $c.x, ($c.y + $r * ($c.sz + 4)), $sz, $sz)
  }
}

$g.Dispose()

$out = New-Object System.IO.MemoryStream
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
[System.IO.File]::WriteAllBytes($icon, $out.ToArray())
$out.Dispose()
Write-Host ("已生成 assets\icon.png  {0}x{1}  {2:N0} KB" -f $S, $S, ((Get-Item $icon).Length / 1KB))

# ---- 小尺寸可读性预览：图标最终就靠这个判断好坏 ----
foreach ($sz in @(32, 48, 64, 128)) {
  $bytes = [System.IO.File]::ReadAllBytes($icon)
  $ms = New-Object System.IO.MemoryStream(,$bytes)
  $src = New-Object System.Drawing.Bitmap($ms)
  $nb = New-Object System.Drawing.Bitmap($sz, $sz)
  $ng = [System.Drawing.Graphics]::FromImage($nb)
  # 缩小用最近邻，看的是"真实显示时糊不糊"，不是插值好不好看
  $ng.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $ng.DrawImage($src, 0, 0, $sz, $sz)
  $ng.Dispose(); $src.Dispose(); $ms.Dispose()
  $o2 = New-Object System.IO.MemoryStream
  $nb.Save($o2, [System.Drawing.Imaging.ImageFormat]::Png)
  [System.IO.File]::WriteAllBytes("$root\probe\out\icon-drawn-$sz.png", $o2.ToArray())
  $o2.Dispose(); $nb.Dispose()
  Write-Host "   probe\out\icon-drawn-$sz.png"
}

# 拼一张对照图：256 原图 + 三个小尺寸并排，一眼看出缩后是否还认得出
$sheet = New-Object System.Drawing.Bitmap((256 + 32 + 48 + 64 + 48), 256)
$sg = [System.Drawing.Graphics]::FromImage($sheet)
$sg.Clear([System.Drawing.Color]::FromArgb(255, 250, 247, 240))
$bytes = [System.IO.File]::ReadAllBytes($icon)
$ms = New-Object System.IO.MemoryStream(,$bytes)
$full = New-Object System.Drawing.Bitmap($ms)
$sg.DrawImage($full, 0, 0, 256, 256)
$x = 268
foreach ($sz in @(32, 48, 64)) {
  $sg.DrawImage($full, $x, [int]((256 - $sz) / 2), $sz, $sz)
  $x += $sz + 20
}
$sg.Dispose(); $full.Dispose(); $ms.Dispose()
$o3 = New-Object System.IO.MemoryStream
$sheet.Save($o3, [System.Drawing.Imaging.ImageFormat]::Png)
[System.IO.File]::WriteAllBytes("$root\probe\out\icon-sheet.png", $o3.ToArray())
$o3.Dispose(); $sheet.Dispose()
Write-Host "   probe\out\icon-sheet.png（256 / 32 / 48 / 64 对照）"
