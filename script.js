const loadingEl = document.querySelector("#loading");
const canvas = document.querySelector("#scene");

if (!window.THREE) {
  loadingEl.textContent = "Failed to load three.js. Please check whether vendor/three.min.js exists.";
  throw new Error("THREE is not available");
}

const photoFiles = [
  "mmexport1745158887530.jpg",
  "mmexport1745161545395.jpg",
  "mmexport1749311214236.jpg",
  "mmexport1752412241739.jpg",
  "mmexport1752930182769.jpg",
  "mmexport1753020616961.jpg",
  "mmexport1753020619529.jpg",
  "mmexport1753020624159.jpg",
  "mmexport1753020659053.jpg",
  "mmexport1753020676810.jpg",
  "mmexport1753020685546.jpg",
  "mmexport1753020826311.jpg",
  "mmexport1753021001967.jpg",
  "wx_camera_1752906408853.jpg",
  "wx_camera_1752906719689.jpg",
  "20250720224627.jpg",
  "20250720224628.jpg",
  "20250720224633.jpg",
  "20250720224638.jpg",
  "20250720224641.jpg",
  "20250720224648.jpg",
  "20250720224651.jpg",
  "20250720224654.jpg",
  "20250720224657.jpg",
  "20250721211941.jpg",
  "20250721211946.jpg",
  "20250721212020.jpg",
  "20250721212024.jpg",
  "20250721212028.jpg",
  "20250721212031.jpg",
  "20250721212035.jpg",
  "20250721212038.jpg",
  "20250721212344.jpg"
];

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x05070f, 14, 40);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 11);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const cameraTarget = new THREE.Vector3(0, 0, 0);
let cameraDistance = 11;
let yaw = 0;
let pitch = 0.08;
let isDragging = false;
let isPhotoDragging = false;
let lastX = 0;
let lastY = 0;

const ambient = new THREE.AmbientLight(0xffffff, 0.75);
scene.add(ambient);

const key = new THREE.DirectionalLight(0xff9bd2, 0.9);
key.position.set(5, 6, 4);
scene.add(key);

const rim = new THREE.DirectionalLight(0x6dc6ff, 0.7);
rim.position.set(-6, 3, -4);
scene.add(rim);

const wallGroup = new THREE.Group();
scene.add(wallGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const photoMeshes = [];

const loader = new THREE.TextureLoader();

const PLANET_RADIUS = 0.86;
const APERTURE_RATIO = 0.7;
const APERTURE_RADIUS = PLANET_RADIUS * APERTURE_RATIO;
const planetGeom = new THREE.SphereGeometry(PLANET_RADIUS, 36, 36);
const photoWindowGeom = new THREE.CircleGeometry(APERTURE_RADIUS, 42);
const photoWindowFrameGeom = new THREE.RingGeometry(APERTURE_RADIUS * 0.98, APERTURE_RADIUS * 1.15, 42);

const HEART_SCALE_X = 0.5;
const HEART_SCALE_Y = 0.68;
const HEART_DEPTH = 0.9;
const DRAG_KICK = 0.02;
const RETURN_STIFFNESS = 0.02;
const VELOCITY_DAMPING = 0.94;
const FOCUS_TRAIL_MS = 1800;
const PULL_RADIUS = 6.2;
const PULL_STRENGTH = 0.028;
let loadedCount = 0;
let dragEnergy = 0;
const dragNoise = new THREE.Vector3();
const targetPos = new THREE.Vector3();
const springDelta = new THREE.Vector3();
const orbitOffset = new THREE.Vector3();
const trailAxisY = new THREE.Vector3(0, 1, 0);
const trailAxisX = new THREE.Vector3(1, 0, 0);
const trailBase = new THREE.Vector3();
const trailScratch = new THREE.Vector3();
const velocityStep = new THREE.Vector3();
const focusedTarget = new THREE.Vector3(0, 0.2, 4.1);
let focusTrailUntil = 0;
const focusTrailOrigin = new THREE.Vector3();
const dragPlane = new THREE.Plane();
const dragHitPoint = new THREE.Vector3();
const dragLocalPoint = new THREE.Vector3();
const dragGrabOffset = new THREE.Vector3();
const lastDragPoint = new THREE.Vector3();
const dragDelta = new THREE.Vector3();
const draggedWorldPos = new THREE.Vector3();
const cameraForward = new THREE.Vector3();
let draggedMesh = null;
const activePointers = new Map();
let isPinching = false;
let pinchStartDistance = 0;
let pinchStartCameraDistance = 0;
let lastTapTime = 0;
const lastTapPos = new THREE.Vector2();

function getPhotoRoot(object3d) {
  let current = object3d;
  while (current && !current.userData.isPhotoRoot) {
    current = current.parent;
  }
  return current && current.userData.isPhotoRoot ? current : null;
}

function fitTextureToRoundWindow(texture) {
  const image = texture.image;
  if (!image || !image.width || !image.height) return;
  const imageAspect = image.width / image.height;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  if (imageAspect > 1) {
    texture.repeat.set(1 / imageAspect, 1);
    texture.offset.set((1 - 1 / imageAspect) * 0.5, 0);
  } else {
    texture.repeat.set(1, imageAspect);
    texture.offset.set(0, (1 - imageAspect) * 0.5);
  }
  texture.needsUpdate = true;
}

function createGlassHighlightTexture() {
  const size = 256;
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;

  const cx = size * 0.36;
  const cy = size * 0.34;
  const grad = ctx.createRadialGradient(cx, cy, size * 0.02, cx, cy, size * 0.52);
  grad.addColorStop(0, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.35, "rgba(220,242,255,0.38)");
  grad.addColorStop(1, "rgba(120,170,220,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const streak = ctx.createLinearGradient(size * 0.1, size * 0.12, size * 0.86, size * 0.9);
  streak.addColorStop(0, "rgba(255,255,255,0)");
  streak.addColorStop(0.47, "rgba(255,255,255,0.18)");
  streak.addColorStop(0.53, "rgba(255,255,255,0.02)");
  streak.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = streak;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function pickConstellationHome(slot) {
  const total = Math.max(1, photoFiles.length);
  const t = (slot / total) * Math.PI * 2;
  const x2d = 16 * Math.pow(Math.sin(t), 3);
  const y2d =
    13 * Math.cos(t) -
    5 * Math.cos(2 * t) -
    2 * Math.cos(3 * t) -
    Math.cos(4 * t);

  // Rounder heart: fuller upper lobes, narrower lower tail.
  const tailWeight = (1 - Math.cos(t)) * 0.5;
  const xPinch = 1 - tailWeight * 0.28;
  const x = x2d * HEART_SCALE_X * xPinch;
  const y = y2d * HEART_SCALE_Y * 0.5 + Math.sin(slot * 0.63) * 0.1;
  const z = Math.sin(t * 2.4 + slot * 0.12) * HEART_DEPTH + Math.cos(t * 1.2) * 0.18;
  return new THREE.Vector3(x, y, z);
}

function updateLoading() {
  loadingEl.textContent = `Loading photos ${loadedCount}/${photoFiles.length}`;
  if (loadedCount >= photoFiles.length) {
    loadingEl.textContent = "Loading complete";
    setTimeout(() => {
      loadingEl.style.display = "none";
    }, 1200);
  }
}

function createPhotoMesh(file, slot) {
  const homePos = pickConstellationHome(slot);

  loader.load(
    `img/${encodeURIComponent(file)}`,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

      fitTextureToRoundWindow(texture);

      const mat = new THREE.MeshStandardMaterial({
        roughness: 0.78,
        metalness: 0.26,
        color: 0x25344d,
        emissive: new THREE.Color(0x12213a),
        emissiveIntensity: 0.24
      });

      const mesh = new THREE.Mesh(planetGeom, mat);
      const sizeJitter = 0.8 + Math.random() * 0.45;
      mesh.scale.setScalar(sizeJitter);
      mesh.position.copy(homePos);
      mesh.lookAt(0, 0, 0);
      mesh.userData.isPhotoRoot = true;
      mesh.userData.home = homePos.clone();
      mesh.userData.focused = false;
      mesh.userData.velocity = new THREE.Vector3();
      mesh.userData.noisePhase = Math.random() * Math.PI * 2;
      mesh.userData.spinSpeed = (Math.random() - 0.5) * 0.01;

      const photoWindow = new THREE.Mesh(
        photoWindowGeom,
        new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.62,
          metalness: 0.04
        })
      );
      photoWindow.position.z = PLANET_RADIUS + 0.01;
      mesh.add(photoWindow);

      const photoFrame = new THREE.Mesh(
        photoWindowFrameGeom,
        new THREE.MeshStandardMaterial({
          color: 0x9ed0ff,
          emissive: 0x355e88,
          emissiveIntensity: 0.4,
          roughness: 0.35,
          metalness: 0.7,
          side: THREE.DoubleSide
        })
      );
      photoFrame.position.z = PLANET_RADIUS + 0.012;
      mesh.add(photoFrame);

      const glassTex = createGlassHighlightTexture();
      if (glassTex) {
        const glassHighlight = new THREE.Mesh(
          photoWindowGeom,
          new THREE.MeshBasicMaterial({
            map: glassTex,
            transparent: true,
            opacity: 0.52,
            depthWrite: false,
            blending: THREE.AdditiveBlending
          })
        );
        glassHighlight.position.z = PLANET_RADIUS + 0.016;
        glassHighlight.rotation.z = Math.random() * Math.PI * 2;
        mesh.add(glassHighlight);
        mesh.userData.glassHighlight = glassHighlight;
      }

      const atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.98, 24, 24),
        new THREE.MeshBasicMaterial({
          color: 0x7fc5ff,
          transparent: true,
          opacity: 0.08,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide
        })
      );
      atmosphere.scale.setScalar(1.06);
      mesh.add(atmosphere);
      wallGroup.add(mesh);
      photoMeshes.push(mesh);
      loadedCount += 1;
      updateLoading();
    },
    undefined,
    () => {
      loadedCount += 1;
      updateLoading();
    }
  );
}

for (let i = 0; i < photoFiles.length; i += 1) {
  createPhotoMesh(photoFiles[i], i);
}

const particles = new THREE.BufferGeometry();
const particleCount = 450;
const pos = new Float32Array(particleCount * 3);
for (let i = 0; i < particleCount; i += 1) {
  pos[i * 3] = (Math.random() - 0.5) * 55;
  pos[i * 3 + 1] = (Math.random() - 0.5) * 36;
  pos[i * 3 + 2] = (Math.random() - 0.5) * 55;
}
particles.setAttribute("position", new THREE.BufferAttribute(pos, 3));
const stars = new THREE.Points(
  particles,
  new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.7 })
);
scene.add(stars);

function focusPhoto(mesh) {
  photoMeshes.forEach((item) => {
    item.userData.focused = false;
  });
  mesh.userData.focused = true;
  focusTrailOrigin.copy(mesh.position);
  focusTrailUntil = performance.now() + FOCUS_TRAIL_MS;
}

function updatePointerFromClient(clientX, clientY) {
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
}

function beginPhotoDrag(clientX, clientY) {
  updatePointerFromClient(clientX, clientY);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(photoMeshes);
  if (hits.length === 0) return false;

  draggedMesh = getPhotoRoot(hits[0].object);
  if (!draggedMesh) return false;
  isPhotoDragging = true;
  camera.getWorldDirection(cameraForward);
  draggedMesh.getWorldPosition(draggedWorldPos);
  dragPlane.setFromNormalAndCoplanarPoint(cameraForward, draggedWorldPos);
  if (raycaster.ray.intersectPlane(dragPlane, dragHitPoint)) {
    dragLocalPoint.copy(dragHitPoint);
    wallGroup.worldToLocal(dragLocalPoint);
    dragGrabOffset.copy(draggedMesh.position).sub(dragLocalPoint);
    lastDragPoint.copy(dragLocalPoint);
  } else {
    dragGrabOffset.set(0, 0, 0);
    lastDragPoint.copy(draggedMesh.position);
  }
  return true;
}

function updatePhotoDrag(clientX, clientY) {
  if (!isPhotoDragging || !draggedMesh) return;
  updatePointerFromClient(clientX, clientY);
  raycaster.setFromCamera(pointer, camera);
  if (raycaster.ray.intersectPlane(dragPlane, dragHitPoint)) {
    dragLocalPoint.copy(dragHitPoint);
    wallGroup.worldToLocal(dragLocalPoint);
    dragDelta.copy(dragLocalPoint).sub(lastDragPoint);
    lastDragPoint.copy(dragLocalPoint);
    draggedMesh.position.copy(dragLocalPoint).add(dragGrabOffset);
    draggedMesh.userData.velocity.addScaledVector(dragDelta, 0.7);
    dragEnergy = Math.min(2.4, dragEnergy + dragDelta.length() * 0.3);
  }
}

function clearPhotoDrag() {
  isPhotoDragging = false;
  draggedMesh = null;
}

window.addEventListener("dblclick", (event) => {
  updatePointerFromClient(event.clientX, event.clientY);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(photoMeshes);
  if (hits.length > 0) {
    const root = getPhotoRoot(hits[0].object);
    if (root) focusPhoto(root);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "r") {
    photoMeshes.forEach((item) => {
      item.userData.focused = false;
    });
  }
});

canvas.style.touchAction = "none";

canvas.addEventListener("pointerdown", (event) => {
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (event.pointerType === "touch") {
    canvas.setPointerCapture(event.pointerId);
  }

  if (activePointers.size === 2) {
    const touches = [...activePointers.values()];
    const dx = touches[0].x - touches[1].x;
    const dy = touches[0].y - touches[1].y;
    pinchStartDistance = Math.hypot(dx, dy);
    pinchStartCameraDistance = cameraDistance;
    isPinching = true;
    isDragging = false;
    clearPhotoDrag();
    return;
  }

  const beganPhotoDrag = beginPhotoDrag(event.clientX, event.clientY);
  if (beganPhotoDrag) return;

  isDragging = true;
  lastX = event.clientX;
  lastY = event.clientY;
  const now = performance.now();
  const tapDelta = now - lastTapTime;
  if (event.pointerType === "touch" && tapDelta < 280) {
    if (lastTapPos.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) < 20) {
      updatePointerFromClient(event.clientX, event.clientY);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(photoMeshes);
      if (hits.length > 0) {
        const root = getPhotoRoot(hits[0].object);
        if (root) focusPhoto(root);
      }
    }
  }
  lastTapTime = now;
  lastTapPos.set(event.clientX, event.clientY);
});

window.addEventListener("pointerup", (event) => {
  activePointers.delete(event.pointerId);
  if (activePointers.size < 2) {
    isPinching = false;
  }
  isDragging = false;
  clearPhotoDrag();
});

window.addEventListener("pointercancel", () => {
  activePointers.clear();
  isPinching = false;
  isDragging = false;
  clearPhotoDrag();
});

window.addEventListener("pointermove", (event) => {
  if (activePointers.has(event.pointerId)) {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  if (isPinching && activePointers.size >= 2) {
    const touches = [...activePointers.values()];
    const dx = touches[0].x - touches[1].x;
    const dy = touches[0].y - touches[1].y;
    const currentDistance = Math.max(12, Math.hypot(dx, dy));
    const ratio = pinchStartDistance / currentDistance;
    cameraDistance = pinchStartCameraDistance * ratio;
    cameraDistance = Math.max(5, Math.min(18, cameraDistance));
    return;
  }

  if (isPhotoDragging && draggedMesh) {
    updatePhotoDrag(event.clientX, event.clientY);
    return;
  }

  if (!isDragging) return;
  const dx = event.clientX - lastX;
  const dy = event.clientY - lastY;
  yaw -= dx * 0.005;
  pitch = Math.max(-0.65, Math.min(0.65, pitch - dy * 0.004));
  dragEnergy = Math.min(2.2, dragEnergy + Math.hypot(dx, dy) * 0.0018);
  lastX = event.clientX;
  lastY = event.clientY;
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  cameraDistance += event.deltaY * 0.01;
  cameraDistance = Math.max(5, Math.min(18, cameraDistance));
}, { passive: false });

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

function animate() {
  const dt = Math.min(clock.getDelta(), 1 / 24);
  const frameFactor = dt * 60;
  const t = clock.getElapsedTime();
  if (!isDragging && !isPhotoDragging && !isPinching) yaw += 0.0018;
  dragEnergy *= Math.pow(isDragging || isPhotoDragging ? 0.965 : 0.91, frameFactor);

  const cosPitch = Math.cos(pitch);
  camera.position.x = Math.sin(yaw) * cosPitch * cameraDistance;
  camera.position.y = Math.sin(pitch) * cameraDistance + 1.2;
  camera.position.z = Math.cos(yaw) * cosPitch * cameraDistance;
  camera.lookAt(cameraTarget);

  wallGroup.rotation.y += 0.0015 * frameFactor;
  stars.rotation.y += 0.00035 * frameFactor;
  stars.rotation.x = Math.sin(t * 0.08) * 0.05;

  const now = performance.now();
  const trailLeft = Math.max(0, focusTrailUntil - now);
  const trailPower = trailLeft / FOCUS_TRAIL_MS;
  const draggedPos = draggedMesh ? draggedMesh.position : null;

  photoMeshes.forEach((mesh, i) => {
    const home = mesh.userData.home;
    const velocity = mesh.userData.velocity;
    const phase = mesh.userData.noisePhase + i * 0.31;
    const floatY = Math.sin(t * 1.3 + phase) * 0.08;
    const swirl = Math.sin(t * 0.6 + phase) * 0.04;

    if (isDragging && dragEnergy > 0.01) {
      dragNoise.set(
        (Math.random() - 0.5) * DRAG_KICK * dragEnergy,
        (Math.random() - 0.5) * DRAG_KICK * dragEnergy,
        (Math.random() - 0.5) * DRAG_KICK * dragEnergy
      );
      velocity.addScaledVector(dragNoise, frameFactor);
    }
    if (draggedMesh && mesh !== draggedMesh && draggedPos) {
      springDelta.copy(draggedPos).sub(mesh.position);
      const dist = Math.max(0.001, springDelta.length());
      if (dist < PULL_RADIUS) {
        const influence = 1 - dist / PULL_RADIUS;
        springDelta.normalize();
        velocity.addScaledVector(
          springDelta,
          PULL_STRENGTH * influence * influence * frameFactor * (0.8 + dragEnergy)
        );
      }
    }

    targetPos.set(home.x + swirl, home.y + floatY, home.z + Math.cos(t * 0.52 + phase) * 0.04);
    if (!mesh.userData.focused && trailPower > 0.001) {
      trailBase.copy(home).sub(focusTrailOrigin);
      trailScratch.copy(trailBase).applyAxisAngle(trailAxisY, trailPower * 1.25 + phase * 0.05);
      trailScratch.applyAxisAngle(trailAxisX, Math.sin(t * 2.8 + phase) * 0.18 * trailPower);
      orbitOffset.copy(trailScratch).sub(trailBase).multiplyScalar(0.7 + trailPower * 1.6);
      targetPos.add(orbitOffset);
    }
    if (mesh !== draggedMesh) {
      springDelta.copy(targetPos).sub(mesh.position);
      velocity.addScaledVector(springDelta, RETURN_STIFFNESS * frameFactor);
      velocity.multiplyScalar(Math.pow(VELOCITY_DAMPING, frameFactor));
      velocityStep.copy(velocity).multiplyScalar(frameFactor);
      mesh.position.add(velocityStep);
    } else {
      velocity.multiplyScalar(Math.pow(0.84, frameFactor));
    }

    if (mesh.userData.focused) {
      mesh.position.lerp(focusedTarget, 1 - Math.pow(0.92, frameFactor));
    }
    // Keep every photo window facing the viewer.
    mesh.lookAt(camera.position);
    if (mesh.userData.glassHighlight) {
      mesh.userData.glassHighlight.material.opacity = 0.4 + Math.sin(t * 2.1 + phase) * 0.12;
      mesh.userData.glassHighlight.rotation.z += 0.0015 * frameFactor;
    }
  });

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

updateLoading();
animate();
