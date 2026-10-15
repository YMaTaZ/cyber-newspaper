# 从产出的 zip 里剔除不该进入发布包的开发物。
#
# 为什么需要：pack_app.mjs 打包整个目录，pack.ps1 只暂存了 probe/ 与 SPEC.md。
# 打包脚本自己躺在根目录，就跟着进了包 —— 开源包里带一个 Windows 专用打包脚本，
# 既无意义也暴露本地开发环境。
#
# 为什么不用手写 ZIP 重排：中央目录、CRC、偏移量必须自洽，自己拼极易产出
# "看起来正常但打不开"的包。Open(src, Update) + Delete() 交给框架维护。
#
# 为什么加载两个程序集：ZipFile 在 System.IO.Compression.FileSystem，
# ZipArchiveMode / ZipArchiveEntry 在 System.IO.Compression。
# 只加载前者会在运行时报 Unable to find type [..ZipArchiveMode]。
#
# 用法：powershell -File strip-dev-from-zip.ps1 <zip 路径>

param([Parameter(Mandatory = $true)][string]$ZipPath)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (-not (Test-Path -LiteralPath $ZipPath)) {
  Write-Host "  x 找不到 zip：$ZipPath" -ForegroundColor Red
  exit 1
}

# 明确不该出现在发布包里的东西
$dropPatterns = @("^pack\.ps1$", "^SPEC\.md$", "^probe/", "^dist-extensions/", "^\.git")

$zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Update)
$dropped = 0
try {
  $drop = @($zip.Entries | Where-Object {
        $n = $_.FullName
        foreach ($re in $dropPatterns) { if ($n -match $re) { return $true } }
        return $false
      })
  if ($drop.Count -eq 0) {
    Write-Host "  - 包内无开发物，未改动"
  } else {
    $names = ($drop | ForEach-Object { $_.FullName }) -join ", "
    foreach ($e in $drop) { $e.Delete(); $dropped++ }
    Write-Host "  + 已剔除 $dropped 项：$names"
  }
}
finally {
  $zip.Dispose()
}

# 剔除后回读校验：zip 仍可解析、关键文件在位、开发物确实没了
$check = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
  $names = @($check.Entries | ForEach-Object { $_.FullName })
  $missing = @("manifest.json", "index.js") | Where-Object { $names -notcontains $_ }
  if ($missing) {
    Write-Host "  x 剔除后关键文件缺失：$($missing -join ',')" -ForegroundColor Red
    exit 1
  }
  $still = @($names | Where-Object { $n = $_; ($dropPatterns | Where-Object { $n -match $_ }).Count -gt 0 })
  if ($still) {
    Write-Host "  x 开发物仍在包内：$($still -join ',')" -ForegroundColor Red
    exit 1
  }
  Write-Host "  - 校验通过：共 $($names.Count) 项，manifest.json 与 index.js 在位"
}
finally {
  $check.Dispose()
}
