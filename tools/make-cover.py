# -*- coding: utf-8 -*-
"""把 AI 生成的插画裁成 4:3 并加上标题，输出 1600x1200 赛事封面"""
from PIL import Image, ImageDraw, ImageFont
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "A_clean_modern_product_illustr_2026-10-25T05-38-15.png")
OUT = os.path.join(ROOT, "assets", "cover-1600x1200.png")

W, H = 1600, 1200
img = Image.open(SRC).convert("RGB")

# 1) 1:1 -> 4:3：从顶部开始裁，保住头像，同时把右下角水印裁掉
side = img.width
crop_h = int(side * 3 / 4)
img = img.crop((0, 0, side, crop_h)).resize((W, H), Image.LANCZOS)

draw = ImageDraw.Draw(img, "RGBA")

# 2) 底部压一层暖色渐变，让文字更稳
BAND = 460
for i in range(BAND):
    a = int(238 * (i / BAND) ** 1.25)
    draw.rectangle([0, H - BAND + i, W, H - BAND + i + 1], fill=(48, 14, 8, a))

BD = "C:/Windows/Fonts/msyhbd.ttc"
RG = "C:/Windows/Fonts/msyh.ttc"
f_tag = ImageFont.truetype(RG, 30, index=0)
f_title = ImageFont.truetype(BD, 96, index=0)
f_sub = ImageFont.truetype(RG, 40, index=0)
f_pill = ImageFont.truetype(RG, 27, index=0)

RED = (219, 0, 7)
YEL = (255, 199, 44)
WHITE = (255, 255, 255)

# 3) 左上角赛事标签
tag_text = "WaytoAGI 1024 切磋大会 · 用餐赛道"
tw = draw.textlength(tag_text, font=f_tag)
draw.rounded_rectangle([72, 72, 72 + tw + 52, 72 + 62], radius=31, fill=(255, 255, 255, 235))
draw.text((72 + 26, 72 + 14), tag_text, font=f_tag, fill=(40, 32, 28))

# 4) 左下角主标题区
draw.text((76, H - 322), "开饭参谋", font=f_title, fill=WHITE, stroke_width=2, stroke_fill=(70, 20, 10))
draw.text((80, H - 196), "报人数、报预算，AI 摆好一桌麦当劳", font=f_sub, fill=YEL,
          stroke_width=2, stroke_fill=(64, 22, 10))

pills = ["真实菜单 105 品", "官方算价核验", "按人算忌口", "团餐一键下单"]
x = 80
for p in pills:
    pw = draw.textlength(p, font=f_pill)
    draw.rounded_rectangle([x, H - 122, x + pw + 44, H - 62], radius=30, fill=(255, 199, 44, 245))
    draw.text((x + 22, H - 113), p, font=f_pill, fill=(60, 26, 12))
    x += pw + 44 + 14

img.save(OUT, "PNG", optimize=True)
print("已生成", OUT, f"{os.path.getsize(OUT)/1024:.0f} KB", img.size)
