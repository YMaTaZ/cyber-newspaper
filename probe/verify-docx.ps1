# 用真实 Word 打开 docx，验证文件合法
# 这是唯一能证明 docx 不是"看起来像 zip 的垃圾"的办法。
# 用法：powershell -ExecutionPolicy Bypass -File probe/verify-docx.ps1

$ErrorActionPreference = "Continue"
$docx = Join-Path $PSScriptRoot "out\export.docx"

if (-not (Test-Path $docx)) {
  Write-Host "找不到 $docx，先跑 node probe/test-export.mjs" -ForegroundColor Red
  exit 1
}

$full = (Resolve-Path $docx).Path
Write-Host "打开：$full" -ForegroundColor Cyan

$word = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0

  $doc = $word.Documents.Open($full, $false, $true)  # ConfirmConversions=false, ReadOnly=true

  $pages = $doc.ComputeStatistics(2)      # wdStatisticPages
  $words = $doc.ComputeStatistics(0)      # wdStatisticWords
  $chars = $doc.ComputeStatistics(3)      # wdStatisticCharacters
  $paras = $doc.Paragraphs.Count

  Write-Host ""
  Write-Host "Word 成功打开 ✓" -ForegroundColor Green
  Write-Host "  页数：$pages"
  Write-Host "  段落数：$paras"
  Write-Host "  字数：$words"
  Write-Host "  字符数：$chars"
  Write-Host ""

  # 抽查前几段文字，确认内容真的进去了
  Write-Host "前 8 段内容：" -ForegroundColor Cyan
  $n = [Math]::Min(8, $paras)
  for ($i = 1; $i -le $n; $i++) {
    $t = $doc.Paragraphs.Item($i).Range.Text -replace "[\r\n\a]", ""
    if ($t.Length -gt 70) { $t = $t.Substring(0, 70) + "…" }
    Write-Host "  [$i] $t"
  }

  $doc.Close($false)
  Write-Host ""
  Write-Host "验证通过：文件可被真实 Word 正常打开" -ForegroundColor Green
}
catch {
  Write-Host ""
  Write-Host "Word 打开失败 ✗" -ForegroundColor Red
  Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
finally {
  if ($word) {
    try { $word.Quit() } catch {}
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
  }
}
