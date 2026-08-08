#!/usr/bin/env python3
"""Turn a source photo into the AVIF/WebP/JPEG set the page expects.

    python3 tools/add-photo.py <slot> <source-image>

<slot> is one of the ids below; it decides the crop aspect so the file
carries no pixels the layout would throw away. Writes
assets/<slot>.{avif,webp,jpg} and prints the <picture> block to paste
into index.html in place of that slot's dashed <div class="img-slot">.

Requires Pillow:  python3 -m pip install --user Pillow
"""
import sys, os
from PIL import Image

# slot id -> (widest CSS width, CSS height, corner radius) as the page lays it out
SLOTS = {
    'hero-install':    (560, 220, 12),
    'reason-payments': (360, 150, 10),
    'reason-credit':   (360, 150, 10),
    'design-preview':  (440, 240, 12),
    'battery-program': (468, 200, 8),
    'install-photo':   (600, 280, 12),
    'reason-bill':     (360, 150, 10),
}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in SLOTS:
        print(__doc__)
        print('slots: ' + ', '.join(SLOTS))
        return 1

    slot, src = sys.argv[1], sys.argv[2]
    css_w, css_h, radius = SLOTS[slot]
    aspect = css_w / css_h
    target_w = css_w * 2   # 2x for retina

    im = Image.open(src).convert('RGB')
    w, h = im.size

    # Centre-crop to the display aspect, matching object-fit: cover.
    if w / h > aspect:
        new_w = round(h * aspect)
        im = im.crop(((w - new_w) // 2, 0, (w - new_w) // 2 + new_w, h))
    else:
        new_h = round(w / aspect)
        im = im.crop((0, (h - new_h) // 2, w, (h - new_h) // 2 + new_h))

    # Never upscale — a small source stays small rather than going soft.
    if im.width > target_w:
        im = im.resize((target_w, round(target_w / aspect)), Image.LANCZOS)

    out = os.path.join(ROOT, 'assets', slot)
    im.save(out + '.avif', quality=62)
    im.save(out + '.webp', quality=80, method=6)
    im.save(out + '.jpg', quality=82, optimize=True, progressive=True)

    for ext in ('avif', 'webp', 'jpg'):
        size = os.path.getsize(out + '.' + ext) / 1024
        print(f'  assets/{slot}.{ext}  {size:.0f} KB')

    print(f'\nPaste this over the <div class="img-slot" ...> for "{slot}":\n')
    print(f'''<picture>
  <source srcset="assets/{slot}.avif" type="image/avif">
  <source srcset="assets/{slot}.webp" type="image/webp">
  <img class="img-real" src="assets/{slot}.jpg" alt="DESCRIBE THE PHOTO"
       width="{im.width}" height="{im.height}" loading="lazy" decoding="async"
       style="height:{css_h}px;--radius:{radius}px">
</picture>''')
    print('\nKeep the alt text truthful — it is read aloud and shown if the image fails.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
