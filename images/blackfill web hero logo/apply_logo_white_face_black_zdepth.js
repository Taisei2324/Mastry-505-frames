// Apply this to your uploaded floating web hero logo GLB/OBJ.
// It keeps the visible face editable/white, but fills the transparent Z-axis/depth with black.
// It also adds black outline/depth and subtle floating spin.

function applyLogoWhiteFaceBlackZDepth(root, THREE, options = {}) {
  const {
    faceColor = 0xf2ffe8,
    depthColor = 0x000000,
    outlineScale = 1.035,
    depthAxis = "z",
    depthOffset = 0.035,
    backPlateDepth = 0.75,
    backPlatePadding = 0.1,
    spinSpeed = 0.006,
    floatAmount = 0.04
  } = options;

  root.userData.spinSpeed = spinSpeed;
  root.userData.floatAmount = floatAmount;
  root.userData.baseY = root.position.y;

  // Front editable face: white/cream, fully opaque.
  root.traverse((obj) => {
    if (!obj.isMesh) return;

    obj.material = new THREE.MeshStandardMaterial({
      color: faceColor,
      roughness: 0.52,
      metalness: 0.0,
      transparent: false,
      opacity: 1,
      alphaTest: 0,
      alphaMap: null,
      map: null,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide
    });

    obj.renderOrder = 30;
    obj.material.needsUpdate = true;
  });

  // Black duplicate behind/around the logo. This is the black Z-depth.
  const blackDepth = root.clone(true);
  blackDepth.name = "black_z_depth_fill";

  blackDepth.traverse((obj) => {
    if (!obj.isMesh) return;

    obj.material = new THREE.MeshStandardMaterial({
      color: depthColor,
      roughness: 0.64,
      metalness: 0.0,
      transparent: false,
      opacity: 1,
      alphaTest: 0,
      alphaMap: null,
      map: null,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide
    });

    obj.renderOrder = 8;
    obj.material.needsUpdate = true;
  });

  blackDepth.scale.multiplyScalar(outlineScale);

  if (depthAxis === "z") blackDepth.position.z -= depthOffset;
  if (depthAxis === "x") blackDepth.position.x -= depthOffset;
  if (depthAxis === "y") blackDepth.position.y -= depthOffset;

  root.add(blackDepth);

  // Black backplate fills the hollow transparent body so background won't show through on rotation.
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const localCenter = root.worldToLocal(center.clone());
  let geometry;
  const pos = localCenter.clone();

  if (depthAxis === "z") {
    geometry = new THREE.BoxGeometry(size.x + backPlatePadding, size.y + backPlatePadding, backPlateDepth);
    pos.z -= size.z / 2 + backPlateDepth / 2;
  } else if (depthAxis === "x") {
    geometry = new THREE.BoxGeometry(backPlateDepth, size.y + backPlatePadding, size.z + backPlatePadding);
    pos.x -= size.x / 2 + backPlateDepth / 2;
  } else if (depthAxis === "y") {
    geometry = new THREE.BoxGeometry(size.x + backPlatePadding, backPlateDepth, size.z + backPlatePadding);
    pos.y -= size.y / 2 + backPlateDepth / 2;
  }

  const backPlate = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: depthColor,
      roughness: 0.68,
      metalness: 0.0,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide
    })
  );

  backPlate.name = "black_z_axis_backplate";
  backPlate.position.copy(pos);
  backPlate.renderOrder = 5;
  root.add(backPlate);

  return { blackDepth, backPlate };
}

function animateFloatingLogo(root, time = performance.now() * 0.001) {
  if (!root) return;
  root.rotation.y += root.userData.spinSpeed ?? 0.006;
  root.position.y = (root.userData.baseY ?? 0) + Math.sin(time * 1.4) * (root.userData.floatAmount ?? 0.04);
}

/*
GLB example:

let logo;

loader.load("./floating_web_hero_logo_1.glb", (gltf) => {
  logo = gltf.scene;
  scene.add(logo);

  applyLogoWhiteFaceBlackZDepth(logo, THREE, {
    faceColor: 0xf2ffe8,     // editable front face
    depthColor: 0x000000,    // black replaces transparent Z-axis
    outlineScale: 1.035,
    depthAxis: "z",
    backPlateDepth: 0.75
  });
});

function render() {
  requestAnimationFrame(render);
  animateFloatingLogo(logo);
  renderer.render(scene, camera);
}
render();

If the black fill is on the wrong axis, use depthAxis: "x" or "y".
If it still leaks background, raise backPlateDepth to 1.2.
*/
