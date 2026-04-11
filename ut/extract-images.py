"""
Extract base64 images from an HTML file (body, CSS, and JS).
- Saves each image as img-01.png, img-02.png, etc. in an /images folder
- Adds data-img-id to <img> tags, replaces base64 with local paths everywhere
- Outputs the modified HTML as article-tagged.html
"""

import re, base64, os, sys, hashlib

html_path = sys.argv[1] if len(sys.argv) > 1 else "article.html"

with open(html_path, "r", encoding="utf-8") as f:
    html = f.read()

os.makedirs("images", exist_ok=True)

counter = 0
b64_to_path = {}  # cache to avoid duplicating identical images

def save_image(data_uri):
    """Save a base64 data URI to disk. Returns (img_id, local_path)."""
    global counter

    # Deduplicate: hash the full base64 content
    content_hash = hashlib.md5(data_uri.encode()).hexdigest()
    if content_hash in b64_to_path:
        return b64_to_path[content_hash]

    counter += 1
    img_id = f"img-{counter:02d}"

    mime_match = re.match(r"data:image/(\w+);base64,(.+)", data_uri, re.DOTALL)
    if not mime_match:
        return None

    ext = mime_match.group(1).replace("jpeg", "jpg")
    b64 = mime_match.group(2).strip()

    img_bytes = base64.b64decode(b64)
    filepath = f"images/{img_id}.{ext}"
    with open(filepath, "wb") as out:
        out.write(img_bytes)
    print(f"{img_id}: saved as {filepath} ({len(img_bytes) // 1024}KB)")

    result = (img_id, filepath)
    b64_to_path[content_hash] = result
    return result


# --- Pass 1: <img> tags in the body ---
def replace_img_tag(match):
    data_uri = match.group(1)
    result = save_image(data_uri)
    if not result:
        return match.group(0)
    img_id, filepath = result
    full_tag = match.group(0)
    tagged = full_tag.replace("<img", f'<img data-img-id="{img_id}"', 1)
    tagged = re.sub(r'src="data:image/[^"]*"', f'src="{filepath}"', tagged)
    return tagged

def replace_img_tag_unquoted(match):
    data_uri = match.group(2)
    result = save_image(data_uri)
    if not result:
        return match.group(0)
    img_id, filepath = result
    return f'<img data-img-id="{img_id}"{match.group(1)} src="{filepath}"{match.group(3)}>'

# Match src with quotes OR without quotes
html = re.sub(
    r'<img[^>]*?\ssrc="(data:image/[^"]+)"[^>]*?>',
    replace_img_tag,
    html,
    flags=re.DOTALL
)
html = re.sub(
    r'<img([^>]*?)\ssrc=(data:image/[^\s>]+)([^>]*?)>',
    lambda m: replace_img_tag_unquoted(m),
    html,
    flags=re.DOTALL
)


# --- Pass 2: CSS url("data:image/...") in <style> blocks and inline styles ---
def replace_css_url(match):
    data_uri = match.group(1)
    result = save_image(data_uri)
    if not result:
        return match.group(0)
    img_id, filepath = result
    return f'url("{filepath}")'

html = re.sub(
    r'url\("(data:image/[^"]+)"\)',
    replace_css_url,
    html
)

# Also handle url('...') with single quotes
html = re.sub(
    r"url\('(data:image/[^']+)'\)",
    lambda m: replace_css_url(m) if save_image(m.group(1)) else m.group(0),
    html
)


# --- Pass 3: base64 data URIs in JS strings (double and single quoted) ---
def replace_js_string(match):
    quote = match.group(1)
    data_uri = match.group(2)
    result = save_image(data_uri)
    if not result:
        return match.group(0)
    img_id, filepath = result
    return f'{quote}{filepath}{quote}'

html = re.sub(
    r"""(["'])(data:image/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+)\1""",
    replace_js_string,
    html
)


# --- Write outputs ---
out_path = html_path.replace(".html", "-tagged.html")
with open(out_path, "w", encoding="utf-8") as f:
    f.write(html)

print(f"\n{counter} images extracted to /images")
print(f"Tagged HTML written to {out_path}")

# Generate skeleton legend file
with open("images-legend.md", "w", encoding="utf-8") as f:
    f.write("# Image Legend\n\n")
    for i in range(1, counter + 1):
        f.write(f"- img-{i:02d}: \n")

print(f"Legend skeleton written to images-legend.md — fill it in!")