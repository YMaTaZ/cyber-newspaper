"""把封面 PNG 转成 WebP，压掉体积。

为什么用 Pillow：本机没有 ffmpeg / magick / cwebp，GDI+ 也不带 WebP 编码器
（上一版脚本就是这么报错退出的）。Pillow 12.2 已装且自带 libwebp，零安装。

为什么保 82 质量：卡片封面实际显示只有约 300px 宽，82 已看不出压缩痕；
再低会让霓虹渐变出现色带，那正是这张图的卖点。

用完即删 PNG，避免两份封面同时进包。
"""
import os
import sys

from PIL import Image, features

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PNG = os.path.join(ROOT, "ui", "assets", "cover.png")
WEBP = os.path.join(ROOT, "ui", "assets", "cover.webp")

if not features.check("webp"):
    print("x 本机 Pillow 不带 WebP 支持，换方案（不硬编）")
    sys.exit(1)

img = Image.open(PNG)
img.load()
print(f"源 PNG  {img.width}x{img.height}  {os.path.getsize(PNG) / 1024:.0f} KB")

# 存到内存再看字节数，确认编码器真的在工作
img.save(WEBP, format="WEBP", quality=82, method=6)

out_kb = os.path.getsize(WEBP) / 1024
src_kb = os.path.getsize(PNG) / 1024
print(f"转 WebP {out_kb:.0f} KB（省 {(1 - out_kb / src_kb) * 100:.0f}%）")

# 回读校验：宿主会真解码，坏文件等于装不上
chk = Image.open(WEBP)
chk.load()
box = chk.getbbox()
if (chk.width, chk.height) != (img.width, img.height):
    print(f"x 回读尺寸不符：{chk.width}x{chk.height}")
    sys.exit(1)
print(f"回读解码 OK  {chk.width}x{chk.height}  非空区域 {box}")
chk.close()

if out_kb < src_kb:
    os.remove(PNG)
    print("已删除 PNG，只留 WebP")
else:
    print("WebP 反而更大（不该发生），保留 PNG 并删 WebP")
    os.remove(WEBP)
