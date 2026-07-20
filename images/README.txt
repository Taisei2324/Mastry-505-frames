Island frame-by-frame Shredders-style wave loader

This version follows your frame examples more closely:
- The word is split into individual vertical pieces.
- A wave center travels left to right.
- The active piece becomes huge.
- Nearby pieces become medium.
- Far pieces stay smaller.
- The pieces start separated and progressively compress into the full logo.
- The right side grows later, matching your frame sequence.
- Final full logo locks cleanly.

Tune in script.js:
- SLICE_COUNT: number of pieces.
- DURATION: animation length.
- peak formula: controls how wide the wave is.
- scale: controls how large each wave piece gets.
- xSpread/yDrop: controls separated piece positions.

Files:
- index.html
- style.css
- script.js
- island-wave-logo.svg
- island-wave-logo.png
