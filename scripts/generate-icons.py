"""
DustNote icon generator — converts 尘心笔记.webp to all platform icon formats.

Generates:
- Desktop Tauri icons (icon.png/ico/icns, Square*.png, StoreLogo, tray-icon, sized PNGs)
- Android launcher icons (ic_launcher.png, ic_launcher_round.png, ic_launcher_foreground.png)
- Web favicon (favicon.ico, apple-touch-icon.png, logo.png for UI)
- Miniprogram logo (logo.png for UI)
"""

from PIL import Image
from pathlib import Path
import shutil

SRC = Path(r"E:\workspace\dustnote\server\src\尘心笔记.webp")
ROOT = Path(r"E:\workspace\dustnote")

# --- Load source and crop to square ---
img = Image.open(SRC).convert("RGBA")
w, h = img.size  # 2048 x 2040
side = min(w, h)
left = (w - side) // 2
top = (h - side) // 2
square = img.crop((left, top, left + side, top + side))
print(f"Source: {w}x{h} -> cropped to {side}x{side}")

def save_resized(src_img, size, path):
    """Resize and save a PNG icon."""
    resized = src_img.resize((size, size), Image.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    resized.save(path, "PNG")
    print(f"  {path.relative_to(ROOT)} ({size}x{size})")

# ============================================================
# 1. Desktop Tauri icons
# ============================================================
print("\n=== Desktop Tauri Icons ===")
icons_dir = ROOT / "desktop" / "src-tauri" / "icons"

# Standard PNG sizes
png_sizes = {
    "icon.png": 512,
    "32x32.png": 32,
    "64x64.png": 64,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "tray-icon.png": 32,
}
for name, size in png_sizes.items():
    save_resized(square, size, icons_dir / name)

# Windows Store logos (square sizes)
store_logos = {
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}
for name, size in store_logos.items():
    save_resized(square, size, icons_dir / name)

# ICO (multi-resolution Windows icon)
ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
ico_path = icons_dir / "icon.ico"
square.save(ico_path, format="ICO", sizes=ico_sizes)
print(f"  {ico_path.relative_to(ROOT)} (ICO {ico_sizes})")

# ICNS (macOS icon) — Pillow supports ICNS with specific sizes
icns_sizes = [(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)]
icns_path = icons_dir / "icon.icns"
# Pillow ICNS requires the image to be at least 1024x1024 for the largest size
icns_base = square.resize((1024, 1024), Image.LANCZOS)
icns_base.save(icns_path, format="ICNS")
print(f"  {icns_path.relative_to(ROOT)} (ICNS)")

# ============================================================
# 2. Android launcher icons
# ============================================================
print("\n=== Android Launcher Icons ===")
res_dir = ROOT / "mobile" / "android" / "app" / "src" / "main" / "res"

# ic_launcher.png and ic_launcher_round.png (same image for both)
# mdpi=48, hdpi=72, xhdpi=96, xxhdpi=144, xxxhdpi=192
android_densities = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
for density, size in android_densities.items():
    save_resized(square, size, res_dir / density / "ic_launcher.png")
    save_resized(square, size, res_dir / density / "ic_launcher_round.png")

# ic_launcher_foreground.png (adaptive icon foreground)
# mdpi=108, hdpi=162, xhdpi=216, xxhdpi=324, xxxhdpi=432
# The foreground should be on transparent background with padding for the safe zone.
# We place the logo at ~67% of the canvas (72/108 safe zone ratio).
fg_densities = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}
for density, canvas_size in fg_densities.items():
    # Create transparent canvas, paste logo at 67% size centered
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    logo_size = int(canvas_size * 0.67)
    logo_resized = square.resize((logo_size, logo_size), Image.LANCZOS)
    offset = ((canvas_size - logo_size) // 2, (canvas_size - logo_size) // 2)
    canvas.paste(logo_resized, offset, logo_resized)
    fg_path = res_dir / density / "ic_launcher_foreground.png"
    canvas.save(fg_path, "PNG")
    print(f"  {fg_path.relative_to(ROOT)} ({canvas_size}x{canvas_size} fg)")

# ============================================================
# 3. Web icons
# ============================================================
print("\n=== Web Icons ===")
web_public = ROOT / "web" / "public"

# favicon.ico (multi-resolution)
favicon_ico = web_public / "favicon.ico"
square.save(favicon_ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print(f"  {favicon_ico.relative_to(ROOT)} (favicon.ico)")

# favicon.png (64x64, for modern browsers)
save_resized(square, 64, web_public / "favicon.png")

# apple-touch-icon.png (180x180)
save_resized(square, 180, web_public / "apple-touch-icon.png")

# logo.png (256x256, for UI usage)
save_resized(square, 256, web_public / "logo.png")

# Keep favicon.svg as fallback but also generate a new one? No — replace with PNG.
# We'll update index.html to use favicon.ico + favicon.png instead of SVG.

# ============================================================
# 4. Miniprogram logo
# ============================================================
print("\n=== Miniprogram Logo ===")
mini_assets = ROOT / "miniprogram" / "src" / "assets"
mini_assets.mkdir(parents=True, exist_ok=True)
save_resized(square, 256, mini_assets / "logo.png")

# Also copy to miniprogram src for direct import
save_resized(square, 128, mini_assets / "logo-small.png")

print("\n=== ALL ICONS GENERATED SUCCESSFULLY ===")
