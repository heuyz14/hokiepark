"""One-off: render the HokiePark app icons into public/icons/. Run: python3 scripts/make-icons.py
Committed output; only rerun if the branding changes. Needs Pillow."""
from PIL import Image, ImageDraw, ImageFont

MAROON, ORANGE, WHITE = (134, 31, 65), (229, 117, 31), (255, 255, 255)
FONT = "/System/Library/Fonts/Helvetica.ttc"

def icon(size: int, maskable: bool) -> Image.Image:
    # Maskable icons must keep content inside the central ~80% "safe zone"; other icons get rounded corners
    # from the OS (iOS) so we ship a full-bleed square for apple-touch-icon.
    img = Image.new("RGB", (size, size), MAROON)
    d = ImageDraw.Draw(img)
    scale = 0.62 if maskable else 0.78
    band = int(size * 0.07)
    d.rectangle([0, size - band * 2, size, size - band], fill=ORANGE)  # orange stripe, VT chrome echo
    font = ImageFont.truetype(FONT, int(size * scale), index=1)  # index 1 = Helvetica Bold
    bbox = d.textbbox((0, 0), "P", font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1] - size * 0.03), "P", font=font, fill=WHITE)
    return img

for name, size, maskable in [("apple-touch-icon.png", 180, False), ("icon-192.png", 192, False), ("icon-512.png", 512, False), ("icon-512-maskable.png", 512, True)]:
    icon(size, maskable).save(f"public/icons/{name}", optimize=True)
    print("wrote", name)
