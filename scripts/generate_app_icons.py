"""Build crisp Windows and browser icons from simple, scalable brand shapes."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SIZE = 1024


def artwork(size=SIZE):
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    blue = Image.new("RGBA", (size, size))
    pixels = blue.load()
    for y in range(size):
        for x in range(size):
            t = min(1, max(0, (x * .45 + y * .55) / size))
            pixels[x, y] = (int(8 + 8 * t), int(169 - 119 * t), int(224 - 73 * t), 255)
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((50, 50, 974, 974), radius=225, fill=255)
    blue.putalpha(mask)
    image.alpha_composite(blue)

    d = ImageDraw.Draw(image)
    # The shopping bag, speed marks, and E are deliberately broad at 16 px.
    d.rounded_rectangle((156, 518, 267, 553), radius=17, fill="#b7fff9")
    d.rounded_rectangle((192, 580, 270, 615), radius=17, fill="#b7fff9")
    d.polygon([(344, 404), (461, 404), (514, 779), (270, 779)], fill="#16dbc9")
    d.rounded_rectangle((337, 404, 461, 779), radius=47, fill="#16dbc9")

    # Bold E silhouette, with open blue counters that survive icon scaling.
    d.rounded_rectangle((451, 407, 735, 498), radius=25, fill="white")
    d.polygon([(451, 446), (532, 446), (590, 779), (505, 779)], fill="white")
    d.rounded_rectangle((529, 560, 748, 627), radius=22, fill="white")
    d.rounded_rectangle((546, 696, 770, 780), radius=25, fill="white")

    # Handle sits above the E and is cut open with the blue background.
    d.arc((470, 260, 680, 481), 180, 360, fill="white", width=48)
    d.rounded_rectangle((470, 367, 519, 455), radius=22, fill="white")
    d.rounded_rectangle((631, 367, 680, 455), radius=22, fill="white")
    return image


def main():
    large = artwork()
    sizes = (16, 24, 32, 48, 64, 128, 256)
    layers = []
    for size in sizes:
        layer = large.resize((size, size), Image.Resampling.LANCZOS)
        if size <= 32:
            layer = layer.filter(ImageFilter.UnsharpMask(radius=.55, percent=115, threshold=2))
        layers.append(layer)
    ico = ROOT / "assets" / "icon.ico"
    layers[-1].save(ico, format="ICO", append_images=layers[:-1], sizes=[(s, s) for s in sizes])
    (ROOT / "frontend" / "public" / "favicon.ico").write_bytes(ico.read_bytes())
    large.save(ROOT / "frontend" / "public" / "favicon.png")


if __name__ == "__main__":
    main()
