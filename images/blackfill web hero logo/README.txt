Floating web hero logo effects applied to YOUR uploaded files

Use file:
apply_logo_white_face_black_zdepth.js

It applies:
- editable white/cream front face
- black replacement for transparent/missing Z-axis
- black outline/depth layer
- black backplate so the background cannot show through during rotation
- subtle floating/spinning animation

Your uploaded files were copied into this pack with safe names:
- floating_web_hero_logo_1.glb
- floating_web_hero_logo2_1.glb
- floating_web_hero_logo3_1.obj
- floating_web_hero_logo4_1
- floating_web_hero_logo_1_preview.jpeg

Main code:

applyLogoWhiteFaceBlackZDepth(logo, THREE, {
  faceColor: 0xf2ffe8,
  depthColor: 0x000000,
  outlineScale: 1.035,
  depthAxis: "z",
  backPlateDepth: 0.75
});

animateFloatingLogo(logo);

Tuning:
- Change faceColor to edit visible face color.
- Keep depthColor black to replace transparent Z-axis.
- Increase backPlateDepth if background still leaks.
- Change depthAxis to x/y if z is the wrong direction.
