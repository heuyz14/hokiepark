"""Render the HokiePark app icons from assets/icon-master.png into public/icons/.

    python3 scripts/make-icons.py        (needs Pillow: python3 -m pip install --user Pillow)

Output is committed; rerun only when the artwork changes. The master lives in assets/ rather than
public/ so the 1 MB original isn't copied into dist/ by the build.

Three shapes, because the platforms want different things:
  * icon-192 / icon-512  - the artwork as drawn, transparent corners kept.
  * apple-touch-icon     - opaque, full-bleed square: iOS applies its OWN rounded mask, and
                           transparent corners composite to black outside it.
  * icon-512-maskable    - Android may crop to a circle, so the artwork is inset into the central
                           ~80% "safe zone" on a solid ground.
"""

from PIL import Image

SRC = "assets/icon-master.png"
OUT = "public/icons"
# Sampled from the master: the deep maroon the artwork sits on.
GROUND = (93, 9, 40)
SAFE_ZONE = 0.80  # Android maskable spec: keep content within the central 80%


def load() -> Image.Image:
    return Image.open(SRC).convert("RGBA")


def flatten(img: Image.Image) -> Image.Image:
    """Composite onto the icon's own ground so no transparency survives."""
    bg = Image.new("RGBA", img.size, (*GROUND, 255))
    return Image.alpha_composite(bg, img).convert("RGB")


def resize(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.LANCZOS)


def maskable(img: Image.Image, size: int) -> Image.Image:
    inner = resize(img, int(size * SAFE_ZONE))
    canvas = Image.new("RGBA", (size, size), (*GROUND, 255))
    off = (size - inner.width) // 2
    canvas.paste(inner, (off, off), inner)
    return canvas.convert("RGB")


def main() -> None:
    master = load()
    resize(master, 192).save(f"{OUT}/icon-192.png")
    resize(master, 512).save(f"{OUT}/icon-512.png")
    flatten(resize(master, 180)).save(f"{OUT}/apple-touch-icon.png")
    maskable(master, 512).save(f"{OUT}/icon-512-maskable.png")
    print("wrote icon-192, icon-512, apple-touch-icon, icon-512-maskable")


if __name__ == "__main__":
    main()
