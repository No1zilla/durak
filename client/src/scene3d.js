/**
 * scene3d.js - Three.js 3D Scene, Dynamic 2-6 Seat Camera Framing, Lighting & Luxury Table
 */

export class Scene3D {
  constructor(containerElement) {
    this.container = containerElement;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.tableMesh = null;
    this.feltMesh = null;
    this.lights = {};
    this.particles = null;
    this.playerCount = 4;
    this.tableColor = '#114227'; // Default emerald velvet

    this.init();
  }

  init() {
    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#07090e');
    this.scene.fog = new THREE.FogExp2('#07090e', 0.035);

    // 2. Camera
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    this.updateCameraForPlayerCount(4, false);

    // 3. Renderer with High DPI & Antialiasing
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.container.appendChild(this.renderer.domElement);

    // 4. Lights
    this.setupLighting();

    // 5. Table Geometry & Materials
    this.buildTable();

    // 6. Ambient Dust Particles
    this.buildParticles();

    // Resize Handler
    window.addEventListener('resize', () => this.onResize());

    // Render Loop
    this.animate();
  }

  setupLighting() {
    // Ambient Light
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(ambient);

    // Key Spotlight on Table Center
    const spot = new THREE.SpotLight(0xfff1d6, 2.5);
    spot.position.set(0, 8, 2);
    spot.angle = Math.PI / 4;
    spot.penumbra = 0.5;
    spot.castShadow = true;
    spot.shadow.mapSize.width = 1024;
    spot.shadow.mapSize.height = 1024;
    spot.shadow.bias = -0.001;
    this.scene.add(spot);
    this.lights.spot = spot;

    // Fill Light from Front
    const fill = new THREE.DirectionalLight(0xa5c4f2, 0.8);
    fill.position.set(0, 4, 6);
    this.scene.add(fill);
    this.lights.fill = fill;

    // Rim Gold Light
    const rim = new THREE.PointLight(0xd4af37, 1.2, 12);
    rim.position.set(0, 3, -4);
    this.scene.add(rim);
    this.lights.rim = rim;
  }

  buildTable() {
    const tableGroup = new THREE.Group();

    // Outer Wooden Rim (Octagon)
    const rimRadius = 4.2;
    const rimGeo = new THREE.CylinderGeometry(rimRadius, rimRadius + 0.2, 0.4, 8);
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x22130c,
      roughness: 0.35,
      metalness: 0.1
    });
    const rimMesh = new THREE.Mesh(rimGeo, woodMat);
    rimMesh.position.y = -0.2;
    rimMesh.receiveShadow = true;
    tableGroup.add(rimMesh);

    // Gold Brass Inlay Ring
    const brassGeo = new THREE.TorusGeometry(3.7, 0.03, 16, 64);
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      metalness: 0.9,
      roughness: 0.2
    });
    const brassMesh = new THREE.Mesh(brassGeo, brassMat);
    brassMesh.rotation.x = Math.PI / 2;
    brassMesh.position.y = 0.01;
    tableGroup.add(brassMesh);

    // Velvet Felt Top Surface
    const feltGeo = new THREE.CylinderGeometry(3.68, 3.68, 0.05, 32);
    this.feltMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.tableColor),
      roughness: 0.85,
      metalness: 0.05
    });
    this.feltMesh = new THREE.Mesh(feltGeo, this.feltMat);
    this.feltMesh.position.y = 0.0;
    this.feltMesh.receiveShadow = true;
    tableGroup.add(this.feltMesh);

    this.tableMesh = tableGroup;
    this.scene.add(tableGroup);
  }

  setTableColor(hexColor) {
    this.tableColor = hexColor;
    if (this.feltMat) {
      this.feltMat.color.set(hexColor);
    }
  }

  buildParticles() {
    const count = 70;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 8;
      positions[i + 1] = Math.random() * 4 + 0.5;
      positions[i + 2] = (Math.random() - 0.5) * 8;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xd4af37,
      size: 0.04,
      transparent: true,
      opacity: 0.4
    });

    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);
  }

  /**
   * Procedural Camera Framing for 2 to 6 Players
   */
  updateCameraForPlayerCount(count, animate = true) {
    this.playerCount = Math.max(2, Math.min(6, count));

    // Dynamic targets based on player count
    let targetY = 5.2;
    let targetZ = 6.2;
    let targetAngleX = -0.68;

    if (this.playerCount === 2) {
      targetY = 4.6;
      targetZ = 5.6;
      targetAngleX = -0.62;
    } else if (this.playerCount === 6) {
      targetY = 5.8;
      targetZ = 7.0;
      targetAngleX = -0.74;
    }

    if (animate && window.gsap) {
      gsap.to(this.camera.position, {
        y: targetY,
        z: targetZ,
        duration: 1.2,
        ease: 'power2.out'
      });
      gsap.to(this.camera.rotation, {
        x: targetAngleX,
        duration: 1.2,
        ease: 'power2.out'
      });
    } else {
      this.camera.position.set(0, targetY, targetZ);
      this.camera.rotation.set(targetAngleX, 0, 0);
    }
  }

  /**
   * Calculates 3D Seat Positions around Table for 2-6 Players
   * Index 0 is always the local user at bottom (Z > 0)
   */
  getSeatPositions(totalPlayers) {
    const count = Math.max(2, Math.min(6, totalPlayers));
    const radius = 3.6;
    const positions = [];

    // Angle offsets relative to user at 270 deg (bottom)
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 1.5) + (i * (Math.PI * 2 / count));
      const x = Math.cos(angle) * radius;
      const z = -Math.sin(angle) * radius * 0.85;
      positions.push({ x, y: 0.3, z, index: i });
    }

    return positions;
  }

  /**
   * Converts 3D Vector into 2D Screen Pixel Coordinates (for DOM HUD Badges)
   */
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

    // Slow ambient particle float
    if (this.particles) {
      this.particles.rotation.y += 0.0008;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
