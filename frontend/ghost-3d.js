import * as THREE from 'three';

const SHADER_HEX = {
  stasis:    { accent: 0x2563eb, eye: 0x60a5fa, shell: 0xdbeafe },
  void:      { accent: 0xa855f7, eye: 0xc084fc, shell: 0xe9d5ff },
  arc:       { accent: 0x38bdf8, eye: 0x7dd3fc, shell: 0xe2e8f0 },
  solar:     { accent: 0xf59e0b, eye: 0xfbbf24, shell: 0xfef3c7 },
  strand:    { accent: 0x10b981, eye: 0x34d399, shell: 0xd1fae5 },
  prismatic: { accent: 0xe879f9, eye: 0x38bdf8, shell: 0xf1f5f9 },
  vanguard:  { accent: 0xf5a623, eye: 0x38bdf8, shell: 0xf1f5f9 },
};

export class DestinyGhost3DAvatar {
  constructor(wrapperEl, getStateFn, getAudioLevelFn, onPokeFn) {
    this.wrapper = wrapperEl;
    this.getState = getStateFn;
    this.getAudioLevel = getAudioLevelFn;
    this.onPoke = onPokeFn;
    this.running = false;
    this.rafId = null;
    this.time = 0;
    this.pokeSpin = 0;
    this.blinkTimer = 0;
    this.blinkScale = 1;
    this.smoothAudio = 0;
    this.curLookX = 0;
    this.curLookY = 0;
    this.wings = [];
    this.initScene();
  }

  initScene() {
    const oldCanvas = this.wrapper.querySelector('#ghostCanvas');
    const canvas = document.createElement('canvas');
    canvas.id = 'ghostCanvas3D';
    canvas.className = 'ghost-3d-canvas';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.cursor = 'pointer';

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    if (oldCanvas) {
      oldCanvas.style.display = 'none';
      oldCanvas.insertAdjacentElement('afterend', canvas);
    } else {
      this.wrapper.prepend(canvas);
    }
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camera.position.set(0, 0.06, 5.2);

    // 3-Point Bungie-style Rim + Key Lighting
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.95);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(2.8, 3.6, 4.2);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.45);
    rimLight.position.set(-3.2, -1.8, -2.5);
    this.scene.add(rimLight);

    // Root Ghost Group
    this.ghostRoot = new THREE.Group();
    this.scene.add(this.ghostRoot);

    // Materials
    this.shellMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.34,
      metalness: 0.22,
    });
    this.accentMat = new THREE.MeshStandardMaterial({
      color: 0xf5a623,
      roughness: 0.28,
      metalness: 0.58,
      emissive: 0xf5a623,
      emissiveIntensity: 0.14,
    });
    this.chassisMat = new THREE.MeshStandardMaterial({
      color: 0x161d2b,
      roughness: 0.42,
      metalness: 0.82,
    });
    this.eyeMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
    });

    // 1. Central Titanium Core Sphere
    const coreGeo = new THREE.SphereGeometry(0.62, 32, 24);
    const coreMesh = new THREE.Mesh(coreGeo, this.chassisMat);
    this.ghostRoot.add(coreMesh);

    // Recessed Optic Housing Bezel (+Z)
    const bezelGeo = new THREE.TorusGeometry(0.41, 0.065, 14, 32);
    const bezelMesh = new THREE.Mesh(bezelGeo, this.chassisMat);
    bezelMesh.position.z = 0.5;
    this.ghostRoot.add(bezelMesh);

    const trimRingGeo = new THREE.TorusGeometry(0.45, 0.022, 10, 32);
    const trimRingMesh = new THREE.Mesh(trimRingGeo, this.accentMat);
    trimRingMesh.position.z = 0.48;
    this.ghostRoot.add(trimRingMesh);

    // 2. Glowing Ocular Eye / Iris
    this.irisGroup = new THREE.Group();
    this.irisGroup.position.z = 0.56;
    this.ghostRoot.add(this.irisGroup);

    const eyeDisc = new THREE.Mesh(new THREE.CircleGeometry(0.32, 32), this.eyeMat);
    this.irisGroup.add(eyeDisc);

    const innerRingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const innerRing = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.16, 28), innerRingMat);
    innerRing.position.z = 0.01;
    this.irisGroup.add(innerRing);

    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x050810, transparent: true, opacity: 0.72 });
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), pupilMat);
    pupil.position.z = 0.015;
    this.irisGroup.add(pupil);

    // Internal Core Glow Light bouncing onto inside of shell plates
    this.coreLight = new THREE.PointLight(0x38bdf8, 2.2, 5.5);
    this.coreLight.position.set(0, 0, 0.85);
    this.ghostRoot.add(this.coreLight);

    // 3. Iconic 8-Pointed Destiny Generalist Shell Plates
    this.cardinalRing = new THREE.Group();
    this.diagonalRing = new THREE.Group();
    this.ghostRoot.add(this.cardinalRing);
    this.ghostRoot.add(this.diagonalRing);

    const makeWingPlate = (length, width, depth, isCardinal) => {
      const wingGroup = new THREE.Group();
      // Faceted diamond-pointed armor plate
      const shape = new THREE.Shape();
      shape.moveTo(0, length);
      shape.lineTo(width * 0.56, length * 0.25);
      shape.lineTo(width * 0.42, -length * 0.2);
      shape.lineTo(0, -length * 0.34);
      shape.lineTo(-width * 0.42, -length * 0.2);
      shape.lineTo(-width * 0.56, length * 0.25);
      shape.closePath();

      const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
        depth: depth,
        bevelEnabled: true,
        bevelThickness: 0.06,
        bevelSize: 0.045,
        bevelSegments: 2,
      });
      extrudeGeo.center();

      const plate = new THREE.Mesh(extrudeGeo, isCardinal ? this.shellMat : this.chassisMat);
      wingGroup.add(plate);

      // Metallic trim stripe on each plate
      const stripeGeo = new THREE.BoxGeometry(width * 0.22, length * 0.72, depth + 0.13);
      const stripe = new THREE.Mesh(stripeGeo, isCardinal ? this.accentMat : this.shellMat);
      stripe.position.y = length * 0.08;
      wingGroup.add(stripe);

      return wingGroup;
    };

    // 4 Cardinal Primary Plates (Top, Right, Bottom, Left)
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const wing = makeWingPlate(0.76, 0.52, 0.22, true);
      const restDist = 0.84;
      wing.rotation.z = angle;
      wing.position.set(-Math.sin(angle) * restDist, Math.cos(angle) * restDist, 0.06);
      this.cardinalRing.add(wing);
      this.wings.push({
        mesh: wing,
        angle,
        restDist,
        restZ: 0.06,
        isCardinal: true,
        phase: i * 1.15,
      });
    }

    // 4 Diagonal Secondary Spikes (NE, SE, SW, NW)
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const wing = makeWingPlate(0.64, 0.4, 0.18, false);
      const restDist = 0.78;
      wing.rotation.z = angle;
      wing.position.set(-Math.sin(angle) * restDist, Math.cos(angle) * restDist, -0.14);
      this.diagonalRing.add(wing);
      this.wings.push({
        mesh: wing,
        angle,
        restDist,
        restZ: -0.14,
        isCardinal: false,
        phase: i * 1.3 + 0.5,
      });
    }

    // 4. Holographic Speech / Scan Ring
    const holoGeo = new THREE.TorusGeometry(1.48, 0.022, 8, 64);
    this.holoMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.0,
    });
    this.holoRing = new THREE.Mesh(holoGeo, this.holoMat);
    this.holoRing.position.z = -0.1;
    this.scene.add(this.holoRing);

    // Click / tap Ghost for playful in-game barrel spin + chirp!
    canvas.addEventListener('click', () => {
      this.pokeSpin = Math.PI * 2;
      if (typeof this.onPoke === 'function') this.onPoke();
    });

    this.resize();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.wrapper);
  }

  resize() {
    if (!this.wrapper || !this.renderer || !this.camera) return;
    const w = Math.max(100, this.wrapper.clientWidth || 220);
    const h = Math.max(100, this.wrapper.clientHeight || 220);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    this._lastTs = performance.now();
    const tick = (ts) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (ts - this._lastTs) / 1000);
      this._lastTs = ts;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  update(dt) {
    this.time += dt;
    const st = this.getState ? this.getState() : {};
    const isSpeaking = Boolean(st.isSpeaking);
    const isThinking = Boolean(st.isThinking);
    const isListening = Boolean(st.isListening);

    // Update subclass/shader palette smoothly
    const sh = SHADER_HEX[st.shader] || SHADER_HEX[st.subclass] || SHADER_HEX.vanguard;
    const targetEye = isListening ? 0x10b981 : sh.eye;
    this.accentMat.color.lerp(new THREE.Color(sh.accent), dt * 4);
    this.accentMat.emissive.lerp(new THREE.Color(sh.accent), dt * 4);
    this.eyeMat.color.lerp(new THREE.Color(targetEye), dt * 6);
    this.coreLight.color.lerp(new THREE.Color(targetEye), dt * 6);
    this.holoMat.color.lerp(new THREE.Color(targetEye), dt * 6);

    // Real voice amplitude (with lifelike synthetic speech cadence fallback for SpeechSynthesis)
    let rawAudio = typeof this.getAudioLevel === 'function' ? this.getAudioLevel() : 0;
    if (isSpeaking && rawAudio < 0.02) {
      rawAudio = 0.28 + Math.abs(Math.sin(this.time * 11.5) * Math.cos(this.time * 4.3)) * 0.55;
    }
    this.smoothAudio += (rawAudio - this.smoothAudio) * Math.min(1, dt * 16);

    // Eye Blink
    this.blinkTimer += dt;
    if (this.blinkTimer > 4.2 && this.blinkTimer < 4.34 && !isSpeaking) {
      this.blinkScale += (0.08 - this.blinkScale) * Math.min(1, dt * 28);
    } else {
      if (this.blinkTimer >= 4.34) this.blinkTimer = 0;
      const targetScale = isSpeaking ? (1 + this.smoothAudio * 0.24) : 1;
      this.blinkScale += (targetScale - this.blinkScale) * Math.min(1, dt * 14);
    }
    this.irisGroup.scale.set(
      isSpeaking ? 1 + this.smoothAudio * 0.16 : 1,
      this.blinkScale,
      1
    );
    this.coreLight.intensity = isSpeaking
      ? 2.4 + this.smoothAudio * 3.8
      : (isThinking ? 2.8 + Math.sin(this.time * 8) * 0.8 : 2.1);

    // Look-at cursor + expressive in-game talking head nods & curious tilts
    const cursorX = (st.cursor?.x || 0) * 0.38;
    const cursorY = (st.cursor?.y || 0) * 0.28;
    const talkNodX = isSpeaking ? Math.sin(this.time * 6.5) * (0.08 + this.smoothAudio * 0.22) : 0;
    const talkTurnY = isSpeaking ? Math.sin(this.time * 3.1) * 0.22 : Math.sin(this.time * 0.7) * 0.08;
    const talkRollZ = isSpeaking
      ? Math.cos(this.time * 4.2) * (0.08 + this.smoothAudio * 0.14)
      : Math.sin(this.time * 0.9) * 0.06;

    this.curLookX += (cursorX + talkTurnY - this.curLookX) * Math.min(1, dt * 7);
    this.curLookY += (cursorY + talkNodX - this.curLookY) * Math.min(1, dt * 7);

    // Playful poke spin decay
    if (this.pokeSpin > 0.01) {
      const step = this.pokeSpin * Math.min(1, dt * 7);
      this.pokeSpin -= step;
    } else {
      this.pokeSpin = 0;
    }

    // Buoyant Destiny Ghost hover
    const hoverY = Math.sin(this.time * 2.1) * 0.12 + (isSpeaking ? this.smoothAudio * 0.14 : 0);
    const hoverZ = isListening ? 0.35 : (isSpeaking ? this.smoothAudio * 0.18 : 0);
    this.ghostRoot.position.set(
      Math.cos(this.time * 1.1) * 0.04,
      hoverY,
      hoverZ
    );
    this.ghostRoot.rotation.set(
      this.curLookY,
      this.curLookX + this.pokeSpin,
      talkRollZ
    );

    // Shell ring rotation (counter-rotating during Thinking, expressive flutter when Speaking!)
    if (isThinking) {
      this.cardinalRing.rotation.z += dt * 1.85;
      this.diagonalRing.rotation.z -= dt * 1.35;
    } else if (isSpeaking) {
      this.cardinalRing.rotation.z += dt * (0.38 + this.smoothAudio * 1.45);
      this.diagonalRing.rotation.z -= dt * (0.24 + this.smoothAudio * 0.95);
    } else {
      this.cardinalRing.rotation.z += dt * 0.14;
      this.diagonalRing.rotation.z -= dt * 0.09;
    }

    // Individual 8-plate radial expansion & speech flutter (like Destiny 2 Ghost opening when talking!)
    for (const w of this.wings) {
      let expand = Math.sin(this.time * 2.2 + w.phase) * 0.03;
      if (isSpeaking) {
        expand += this.smoothAudio * (w.isCardinal ? 0.32 : 0.22) + Math.sin(this.time * 14 + w.phase) * this.smoothAudio * 0.05;
      } else if (isThinking) {
        expand += 0.16 + Math.sin(this.time * 7 + w.phase) * 0.06;
      } else if (isListening) {
        expand -= 0.04;
      }
      const dist = w.restDist + expand;
      w.mesh.position.set(
        -Math.sin(w.angle) * dist,
        Math.cos(w.angle) * dist,
        w.restZ + (isSpeaking ? this.smoothAudio * (w.isCardinal ? 0.1 : -0.06) : 0)
      );
      // Slight pitch tilt outward when Ghost opens its shell to speak
      w.mesh.rotation.x = isSpeaking ? (this.smoothAudio * 0.28) : (isThinking ? 0.14 : 0.02);
    }

    // Holographic audio/listening ring
    const targetHoloOpacity = isSpeaking ? (0.25 + this.smoothAudio * 0.55) : (isListening ? 0.55 : 0);
    this.holoMat.opacity += (targetHoloOpacity - this.holoMat.opacity) * Math.min(1, dt * 8);
    const ringScale = isSpeaking ? (1 + this.smoothAudio * 0.22) : (1 + Math.sin(this.time * 5) * 0.05);
    this.holoRing.scale.set(ringScale, ringScale, 1);
    this.holoRing.rotation.z += dt * (isSpeaking ? 1.2 : 0.6);
  }
}
