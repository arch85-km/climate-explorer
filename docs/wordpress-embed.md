# Embedding in WordPress

`dist/epw-visualiser.html` is a single self-contained page: all CSS and JavaScript
are inline, there are no external requests, and nothing is uploaded anywhere — the
`.epw` file a student drops is read locally by the browser.

It ships with **no weather data**. The page opens on an empty state explaining what
an EPW file is and where to download one free, and the student supplies their own.
That keeps the page free of any third-party data you would otherwise be
redistributing to every visitor. (See "Bundling your own example" in the README if
you want a file you hold the rights to loaded automatically instead.)

It is about **650 KB**, roughly half of which is the bundled London example climate
that makes the page useful the moment it loads. Serve it with gzip enabled (most
hosts do by default) and it arrives in about 360 KB.

There are two ways to put it in a WordPress page. **Use the iframe method** unless
you have a specific reason not to.

---

## Method 1 — iframe (recommended)

An iframe gives the app its own document, so your theme's stylesheet cannot
restyle it, `wpautop` cannot mangle the markup, and no plugin's jQuery can collide
with it. This is the method to use for a page students will actually rely on.

### 1. Upload the file

WordPress blocks `.html` uploads in the Media Library by default. Either:

- **Via SFTP / your host's file manager (simplest):** upload
  `epw-visualiser.html` to `wp-content/uploads/apps/epw-visualiser.html`.
  Its URL is then `https://example.com/wp-content/uploads/apps/epw-visualiser.html`.
- **Or allow HTML uploads** by adding this to your child theme's `functions.php`:

  ```php
  add_filter( 'upload_mimes', function ( $mimes ) {
      // Only administrators may upload HTML.
      if ( current_user_can( 'manage_options' ) ) {
          $mimes['html'] = 'text/html';
      }
      return $mimes;
  } );
  ```

### 2. Add a Custom HTML block to the page

Replace the `src` with your uploaded URL.

```html
<div class="epw-embed" style="position:relative;width:100%">
  <iframe
    id="epw-visualiser"
    src="/wp-content/uploads/apps/epw-visualiser.html"
    title="EPW Climate Explorer"
    loading="lazy"
    allowfullscreen
    style="width:100%;height:900px;border:0;border-radius:8px;display:block"
  ></iframe>
</div>

<script>
// The app posts its height whenever the layout changes, so the iframe can grow
// and shrink with it instead of being pinned to a guessed height.
(function () {
  var frame = document.getElementById('epw-visualiser');
  window.addEventListener('message', function (event) {
    if (!frame || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (data && data.type === 'epwviz:height' && typeof data.height === 'number') {
      frame.style.height = Math.max(640, Math.min(2400, data.height)) + 'px';
    }
  });
})();
</script>
```

`allowfullscreen` is what lets **Presentation mode** go fullscreen from inside the
iframe. Without it the mode still works, it just stays within the page.

### 3. Mobile height

The height sync handles most cases. If you want a fixed height instead, a good
starting point is `900px` on desktop and `680px` on phones:

```html
<style>
  #epw-visualiser { height: 900px; }
  @media (max-width: 782px) { #epw-visualiser { height: 680px; } }
</style>
```

---

## Method 2 — pasting directly into a Custom HTML block

Use this only if you cannot upload a file. It works, but the page then shares a
document with your theme, so theme CSS and plugin scripts are in play.

1. Open `dist/epw-visualiser.html` in a text editor.
2. Copy everything from `<style>` to the closing `</script>` — that is, the
   contents of `<head>`'s style block, the `<div id="epwviz"></div>`, and the
   script block. Do **not** copy the `<!DOCTYPE>`, `<html>`, `<head>` or `<body>`
   tags.
3. Paste into a **Custom HTML** block (not a Paragraph block — the classic editor
   and `wpautop` will insert `<p>` and `<br>` tags into the JavaScript and break it).
4. Give the app a height, since it no longer has the standalone page's `100vh`:

   ```html
   <div id="epwviz" class="epwviz-embedded" style="height:900px"></div>
   ```

   The `epwviz-embedded` class is already handled in the stylesheet.

### If it looks wrong after pasting

Almost every problem here is the theme reaching into the app:

- **Buttons or selects look like the theme's** — your theme uses `!important` on
  global control styles. Move to the iframe method.
- **The layout is squashed** — the container has no height. Set one explicitly.
- **Nothing renders and the console shows a syntax error** — the editor rewrote
  the JavaScript. Use the Custom HTML block, or the iframe method.

---

## Security and privacy notes for a teaching site

- The page makes **no network requests at all**. Weather files are read with the
  browser's File API and never leave the student's machine. The only outbound links
  are the two download sources named on the empty state, which open in a new tab.
- No third-party code and no third-party data are redistributed by the page.
- There is no server component, no cookie, no local storage, and no analytics.
- A `Content-Security-Policy` of `default-src 'none'; script-src 'unsafe-inline';
  style-src 'unsafe-inline'; img-src data:` is sufficient. The inline allowances
  are required because the whole app is inline by design.

---

## Browser support

- **2D views** work anywhere with Canvas 2D — every browser since about 2013.
- **3D views** need WebGL. If it is unavailable the 3D views show a short message
  pointing the student at the 2D views, and nothing else breaks.
- Tested on Chromium. The app uses no vendor-prefixed or experimental APIs beyond
  `-webkit-` fallbacks already included.
