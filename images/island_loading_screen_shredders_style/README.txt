Island loading screen — Shredders-style effect

Files:
- index.html
- style.css
- script.js
- island-logo.svg
- island-logo.png
- island-logo-white.svg

What it does:
- Uses the uploaded Island logo image as the SVG asset.
- Keeps the logo perfectly horizontal.
- Adds the Shredders-style chromatic offset/glitch look.
- Adds left-to-right sequential slice zoom loading animation.
- Includes a snowy loading-screen style background in CSS.
- Auto-hides after 2.8 seconds for demo use.

To use on your site:
1. Put all files in the same folder.
2. Copy the loadingScreen HTML block into your page.
3. Link style.css and script.js.
4. Remove or edit this line in script.js if you do not want auto-hide:
   setTimeout(hideLoading, 2800);

Adjust:
- Number of slices: change SLICES in script.js.
- Logo size: change --logo-width in style.css.
- Colors: change --glitch-pink, --glitch-cyan, --glitch-yellow in style.css.
