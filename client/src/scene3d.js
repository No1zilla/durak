/**
 * scene3d.js - AAA Hyper-Realistic 3D Scene: VIP Casino Lounge Environment, PBR Velvet Felt, 
 * Mahogany & Leather Rim, Chandelier Lighting, 3D Chip Stacks & Atmospheric Depth
 */

export class Scene3D {
  constructor(containerElement) {
    this.container = containerElement;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.tableGroup = null;
    this.feltMesh = null;
    this.lights = {};
    this.chipStacks = [];
    this.playerCount = 4;
    this.tableColor = '#0b2b1b'; // Deep Emerald Velvet

    this.init();
  }

  init() {
    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05070b');
    this.scene.fog = new THREE.FogExp2('#05070b', 0.035);

    // 2. Camera with Cinematic Angle & Perspective
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 100);
    this.updateCameraForPlayerCount(4, false);

    // 3. Renderer with High Dynamic Range & Soft Shadows
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.container.appendChild(this.renderer.domElement);

    // 4. Build VIP Casino Room Environment
    this.buildVIPEnvironment();

    // 5. Build Hyper-Detailed Table
    this.buildLuxuryTable();

    // 6. Build Chandelier & Studio Lighting
    this.setupLighting();

    // 7. Add 3D Decorative Chip Stacks
    this.buildDecorChips();

    // Resize
    window.addEventListener('resize', () => this.onResize());

    // Loop
    this.animate();
  }

  buildVIPEnvironment() {
    // Large Room Sphere / Cylinder with Luxury Wood Paneling & Ambient Warm Lights
    const roomGeo = new THREE.CylinderGeometry(14, 14, 12, 32, 1, true);
    const roomCanvas = document.createElement('canvas');
    roomCanvas.width = 1024;
    roomCanvas.height = 512;
    const ctx = roomCanvas.getContext('2d');

    // Dark Mahogany Wall panels with gold trim & soft lamp glow
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, roomCanvas.width, roomCanvas.height);

    for (let x = 0; x < roomCanvas.width; x += 128) {
      // Wood panel
      const grad = ctx.createLinearGradient(x, 0, x + 128, 0);
      grad.addColorStop(0, '#150d0a');
      grad.addColorStop(0.5, '#24140e');
      grad.addColorStop(1, '#120b08');
      ctx.fillStyle = grad;
      ctx.fillRect(x + 4, 30, 120, roomCanvas.height - 60);

      // Gold frame line
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.3)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 8, 36, 112, roomCanvas.height - 72);

      // Sconce wall lamp warm glow
      const lampGrad = ctx.createRadialGradient(x + 64, 180, 5, x + 64, 180, 90);
      lampGrad.addColorStop(0, 'rgba(255, 215, 130, 0.7)');
      lampGrad.addColorStop(0.5, 'rgba(255, 180, 80, 0.2)');
      lampGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = lampGrad;
      ctx.fillRect(x, 90, 128, 180);
    }

    const roomTexture = new THREE.CanvasTexture(roomCanvas);
    roomTexture.wrapS = THREE.RepeatWrapping;
    roomTexture.repeat.set(4, 1);

    const roomMat = new THREE.MeshBasicMaterial({
      map: roomTexture,
      side: THREE.BackSide
    });

    const roomMesh = new THREE.Mesh(roomGeo, roomMat);
    roomMesh.position.y = 3;
    this.scene.add(roomMesh);
  }

  setupLighting() {
    // Ambient Warm Base
    const ambient = new THREE.AmbientLight(0xffeedd, 0.6);
    this.scene.add(ambient);

    // Warm Chandelier Overhead Spotlights (Main key light)
    const chandelierSpot = new THREE.SpotLight(0xffe8c6, 3.2);
    chandelierSpot.position.set(0, 7.5, 0);
    chandelierSpot.angle = Math.PI / 3;
    chandelierSpot.penumbra = 0.6;
    chandelierSpot.castShadow = true;
    chandelierSpot.shadow.mapSize.width = 2048;
    chandelierSpot.shadow.mapSize.height = 2048;
    chandelierSpot.shadow.bias = -0.0005;
    this.scene.add(chandelierSpot);
    this.lights.chandelierSpot = chandelierSpot;

    // Front Fill Soft Light (for cards and avatars)
    const frontFill = new THREE.DirectionalLight(0xfff5ea, 0.9);
    frontFill.position.set(0, 5, 5);
    this.scene.add(frontFill);
    this.lights.frontFill = frontFill;

    // Golden Rim Glow
    const rimPoint = new THREE.PointLight(0xd4af37, 1.8, 14);
    rimPoint.position.set(0, 4, -4);
    this.scene.add(rimPoint);
    this.lights.rimPoint = rimPoint;

    // Side Accent Lights for depth
    const leftFill = new THREE.PointLight(0x38bdf8, 0.4, 10);
    leftFill.position.set(-5, 3, 0);
    this.scene.add(leftFill);

    const rightFill = new THREE.PointLight(0xf59e0b, 0.4, 10);
    rightFill.position.set(5, 3, 0);
    this.scene.add(rightFill);
  }

  buildLuxuryTable() {
    this.tableGroup = new THREE.Group();

    // 1. Generate PBR Procedural Velvet Felt Texture with Gold Filigree
    const feltTexture = this.generateFeltTexture(this.tableColor);

    // Felt Surface
    const feltRadius = 3.6;
    const feltGeo = new THREE.CylinderGeometry(feltRadius, feltRadius, 0.08, 64);
    this.feltMat = new THREE.MeshStandardMaterial({
      map: feltTexture,
      roughness: 0.75,
      metalness: 0.1
    });
    this.feltMesh = new THREE.Mesh(feltGeo, this.feltMat);
    this.feltMesh.position.y = 0;
    this.feltMesh.receiveShadow = true;
    this.tableGroup.add(this.feltMesh);

    // 2. Inner Golden Brass Lip Ring
    const brassGeo = new THREE.TorusGeometry(feltRadius + 0.02, 0.035, 16, 64);
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xe6ca65,
      metalness: 0.92,
      roughness: 0.18
    });
    const brassMesh = new THREE.Mesh(brassGeo, brassMat);
    brassMesh.rotation.x = Math.PI / 2;
    brassMesh.position.y = 0.04;
    this.tableGroup.add(brassMesh);

    // 3. Dark Leather Padded Armrest Ring (Beveled Torus)
    const leatherGeo = new THREE.TorusGeometry(feltRadius + 0.28, 0.26, 24, 64);
    const leatherMat = new THREE.MeshStandardMaterial({
      color: 0x140e0b,
      roughness: 0.4,
      metalness: 0.05
    });
    const leatherMesh = new THREE.Mesh(leatherGeo, leatherMat);
    leatherMesh.rotation.x = Math.PI / 2;
    leatherMesh.position.y = -0.02;
    leatherMesh.castShadow = true;
    leatherMesh.receiveShadow = true;
    this.tableGroup.add(leatherMesh);

    // 4. Polished Mahogany Outer Wooden Base (Octagon)
    const woodRadius = feltRadius + 0.55;
    const woodGeo = new THREE.CylinderGeometry(woodRadius, woodRadius + 0.3, 0.55, 8);
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x24120a,
      roughness: 0.28,
      metalness: 0.12
    });
    const woodMesh = new THREE.Mesh(woodGeo, woodMat);
    woodMesh.position.y = -0.32;
    woodMesh.castShadow = true;
    woodMesh.receiveShadow = true;
    this.tableGroup.add(woodMesh);

    // 5. Outer Brass Trim Ring
    const outerBrassGeo = new THREE.TorusGeometry(woodRadius + 0.05, 0.025, 16, 64);
    const outerBrass = new THREE.Mesh(outerBrassGeo, brassMat);
    outerBrass.rotation.x = Math.PI / 2;
    outerBrass.position.y = -0.15;
    this.tableGroup.add(outerBrass);

    this.scene.add(this.tableGroup);
  }

  generateFeltTexture(baseColorHex) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    // 1. Base Velvet Gradient with Vignette Darkening
    const grad = ctx.createRadialGradient(512, 512, 80, 512, 512, 500);
    grad.addColorStop(0, baseColorHex);
    grad.addColorStop(0.7, '#071b11');
    grad.addColorStop(1, '#030d08');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 1024);

    // 2. Subtle Micro Velvet Noise
    for (let i = 0; i < 20000; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255, 255, 255, 0.015)' : 'rgba(0, 0, 0, 0.025)';
      ctx.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
    }

    // 3. Ornate Golden Inset Border
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.5)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(512, 512, 440, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(212, 175, 55, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(512, 512, 426, 0, Math.PI * 2);
    ctx.stroke();

    // 4. Subtle Suit Watermarks in Center
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.font = '60px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♠', 512, 380);
    ctx.fillText('♥', 644, 512);
    ctx.fillText('♣', 512, 644);
    ctx.fillText('♦', 380, 512);

    // Center Gold Ring
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.2)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(512, 512, 180, 0, Math.PI * 2);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  setTableColor(hexColor) {
    this.tableColor = hexColor;
    if (this.feltMat) {
      this.feltMat.map = this.generateFeltTexture(hexColor);
      this.feltMat.needsUpdate = true;
    }
  }

  buildDecorChips() {
    // Stacks of luxury chips on table edge
    const chipPositions = [
      { x: -2.8, z: 0.9, color: 0xef4444, count: 8 },
      { x: -2.9, z: 0.6, color: 0x10b981, count: 12 },
      { x: 2.8, z: 0.9, color: 0x1e3a8a, count: 6 },
      { x: 2.9, z: 0.6, color: 0xf59e0b, count: 10 }
    ];

    chipPositions.forEach(stack => {
      const chipGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.035, 20);
      const chipMat = new THREE.MeshStandardMaterial({
        color: stack.color,
        roughness: 0.3,
        metalness: 0.2
      });

      for (let i = 0; i < stack.count; i++) {
        const chip = new THREE.Mesh(chipGeo, chipMat);
        chip.position.set(
          stack.x + (Math.random() - 0.5) * 0.02,
          0.06 + (i * 0.036),
          stack.z + (Math.random() - 0.5) * 0.02
        );
        chip.rotation.y = Math.random() * Math.PI;
        chip.castShadow = true;
        chip.receiveShadow = true;
        this.scene.add(chip);
        this.chipStacks.push(chip);
      }
    });
  }

  /**
   * Procedural Camera Framing for 2 to 6 Players
   */
  updateCameraForPlayerCount(count, animate = true) {
    this.playerCount = Math.max(2, Math.min(6, count));

    let targetY = 4.6;
    let targetZ = 5.2;
    let targetAngleX = -0.72;

    if (this.playerCount === 2) {
      targetY = 4.2;
      targetZ = 4.8;
      targetAngleX = -0.66;
    } else if (this.playerCount === 6) {
      targetY = 5.2;
      targetZ = 5.8;
      targetAngleX = -0.76;
    }

    if (animate && window.gsap) {
      gsap.to(this.camera.position, {
        y: targetY,
        z: targetZ,
        duration: 1.0,
        ease: 'power2.out'
      });
      gsap.to(this.camera.rotation, {
        x: targetAngleX,
        duration: 1.0,
        ease: 'power2.out'
      });
    } else {
      this.camera.position.set(0, targetY, targetZ);
      this.camera.rotation.set(targetAngleX, 0, 0);
    }
  }

  getSeatPositions(totalPlayers) {
    const count = Math.max(2, Math.min(6, totalPlayers));
    const radius = 3.6;
    const positions = [];

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 1.5) + (i * (Math.PI * 2 / count));
      const x = Math.cos(angle) * radius;
      const z = -Math.sin(angle) * radius * 0.85;
      positions.push({ x, y: 0.3, z, index: i });
    }

    return positions;
  }

  toScreenPosition(position3D) {
    const vector = new THREE.Vector3(position3D.x, position3D.y, position3D.z);
    vector.project(this.camera);

    const widthHalf = window.innerWidth / 2;
    const heightHalf = window.innerHeight / 2;

    return {
      x: (vector.x * widthHalf) + widthHalf,
      y: -(vector.y * heightHalf) + heightHalf,
      visible: vector.z < 1.0
    };
  }

  onResize() {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.renderer.render(this.scene, this.camera);
  }
}
