/**
 * scene3d.js - AAA 3D Scene with Asset Textures, Room Panorama, Velvet Felt, Lighting & Dynamic Camera
 */
/* global THREE, gsap */

export class Scene3D {
  constructor(containerElement) {
    this.container = containerElement;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.textureLoader = new THREE.TextureLoader();
    this.tableGroup = null;
    this.feltMesh = null;
    this.lights = {};
    this.chipStacks = [];
    this.playerCount = 4;
    this.tableColor = '#0b2b1b';

    this.init();
  }

  init() {
    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#04060a');
    this.scene.fog = new THREE.FogExp2('#04060a', 0.035);

    // 2. Camera with Cinematic Angle & Perspective
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 100);
    this.updateCameraForPlayerCount(4, false);

    // 3. Renderer with High Dynamic Range & Soft Shadows
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) {
      console.warn('WebGL high-performance failed, trying basic WebGLRenderer:', e);
      try {
        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
      } catch (e2) {
        console.error('WebGL is not available in this environment:', e2);
        this.renderer = null;
      }
    }

    if (this.renderer) {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 0.95;
      this.renderer.setClearColor(0x000000, 0); // Transparent canvas to show casino lounge background

      if (this.container) {
        this.container.appendChild(this.renderer.domElement);
      }
    }

    // 4. Build VIP Casino Room Environment with Panorama Asset
    this.buildVIPEnvironment();

    // 5. Build Table with Felt Asset Texture
    this.buildLuxuryTable();

    // 6. Setup Lighting
    this.setupLighting();

    // 7. Add 3D Decorative Chip Stacks
    this.buildDecorChips();

    // Resize
    window.addEventListener('resize', () => this.onResize());

    // Loop
    this.animate();
  }

  buildVIPEnvironment() {
    // 1. Luxury Casino Lounge Backdrop Plane (Directly in 3D Scene)
    const bgPlaneGeo = new THREE.PlaneGeometry(18, 14);
    const bgTexture = this.textureLoader.load('assets/table/casino_bg_portrait.jpg');
    bgTexture.colorSpace = THREE.SRGBColorSpace;

    const bgPlaneMat = new THREE.MeshBasicMaterial({
      map: bgTexture,
      toneMapped: false
    });

    const bgPlane = new THREE.Mesh(bgPlaneGeo, bgPlaneMat);
    bgPlane.position.set(0, 6.2, -4.5);
    this.scene.add(bgPlane);

    // 2. HD PBR Environment Map for Real Physical Reflections on Gold, Wood, and Cards
    this.textureLoader.load('assets/table/casino_room_pano.jpg', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      if (this.renderer) {
        try {
          const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
          pmremGenerator.compileEquirectangularShader();
          const envMap = pmremGenerator.fromEquirectangular(tex).texture;
          this.scene.environment = envMap;
          pmremGenerator.dispose();
        } catch (e) {
          console.warn('PMREM environment fallback:', e);
        }
      }
    });
  }

  setupLighting() {
    const ambient = new THREE.AmbientLight(0xffeedd, 0.35);
    this.scene.add(ambient);

    // Warm Chandelier Overhead Spotlight
    const chandelierSpot = new THREE.SpotLight(0xffeedd, 1.4);
    chandelierSpot.position.set(0, 8.0, 0);
    chandelierSpot.angle = Math.PI / 3.0;
    chandelierSpot.penumbra = 0.6;
    chandelierSpot.castShadow = true;
    chandelierSpot.shadow.mapSize.width = 2048;
    chandelierSpot.shadow.mapSize.height = 2048;
    chandelierSpot.shadow.bias = -0.0002;
    this.scene.add(chandelierSpot);
    this.lights.chandelierSpot = chandelierSpot;

    // Front Fill Soft Light
    const frontFill = new THREE.DirectionalLight(0xfff5ea, 0.35);
    frontFill.position.set(0, 5, 5);
    this.scene.add(frontFill);
    this.lights.frontFill = frontFill;

    // Golden Rim Glow
    const rimPoint = new THREE.PointLight(0xd4af37, 1.0, 16);
    rimPoint.position.set(0, 4.0, -4.0);
    this.scene.add(rimPoint);
    this.lights.rimPoint = rimPoint;
  }

  buildLuxuryTable() {
    this.tableGroup = new THREE.Group();

    // 1. Master Pure Emerald Velvet Felt Texture (Clean, No text)
    const feltTexture = this.textureLoader.load('assets/table/felt_emerald_pure.jpg');
    feltTexture.colorSpace = THREE.SRGBColorSpace;
    feltTexture.minFilter = THREE.LinearFilter;
    feltTexture.magFilter = THREE.LinearFilter;
    feltTexture.generateMipmaps = true;

    // Polished Mahogany Wood for Sides
    const mahoganyTexture = this.textureLoader.load('assets/table/mahogany_rim.jpg');
    mahoganyTexture.colorSpace = THREE.SRGBColorSpace;
    mahoganyTexture.wrapS = THREE.RepeatWrapping;
    mahoganyTexture.repeat.set(4, 1);

    const tableRadius = 3.6;
    const tableGeo = new THREE.CylinderGeometry(tableRadius, tableRadius + 0.35, 0.35, 8);
    
    // Multi-material: sides mahogany, top octagonal felt
    const sideMat = new THREE.MeshStandardMaterial({
      map: mahoganyTexture,
      roughness: 0.22,
      metalness: 0.18,
      envMapIntensity: 1.6
    });

    const topMat = new THREE.MeshStandardMaterial({
      map: feltTexture,
      roughness: 0.65,
      metalness: 0.05,
      envMapIntensity: 0.6
    });

    this.tableMesh = new THREE.Mesh(tableGeo, [sideMat, topMat, sideMat]);
    this.tableMesh.position.y = 0;
    this.tableMesh.rotation.y = Math.PI / 8; // Align flat side to bottom
    this.tableMesh.receiveShadow = true;
    this.tableGroup.add(this.tableMesh);

    // 2. Golden Brass Lip Ring
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.95,
      roughness: 0.12,
      envMapIntensity: 2.2
    });

    // 3. Dark Leather Padded Armrest Ring
    const leatherGeo = new THREE.TorusGeometry(tableRadius + 0.10, 0.18, 16, 8);
    const leatherMat = new THREE.MeshStandardMaterial({
      color: 0x140e0b,
      roughness: 0.45,
      metalness: 0.08,
      envMapIntensity: 0.8
    });
    const leatherMesh = new THREE.Mesh(leatherGeo, leatherMat);
    leatherMesh.rotation.x = Math.PI / 2;
    leatherMesh.rotation.z = Math.PI / 8;
    leatherMesh.position.y = 0.10;
    this.tableGroup.add(leatherMesh);

    // 4. 8 Golden Baroque Corner Ornaments on the Octagon
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI / 4) + (Math.PI / 8);
      const cornerX = Math.cos(angle) * (tableRadius + 0.08);
      const cornerZ = Math.sin(angle) * (tableRadius + 0.08);
      
      const cornerGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.05, 16);
      const cornerMesh = new THREE.Mesh(cornerGeo, brassMat);
      cornerMesh.position.set(cornerX, 0.12, cornerZ);
      this.tableGroup.add(cornerMesh);
    }

    this.scene.add(this.tableGroup);
  }

  updateCameraForPlayerCount(count, animate = true) {
    this.playerCount = Math.max(2, Math.min(6, count));

    // Cinematic Overview Angle showing Table and Upper Casino Lounge
    const targetY = 4.8;
    const targetZ = 6.2;
    const targetAngleX = -0.58;

    if (this.camera) {
      if (animate && window.gsap) {
        gsap.to(this.camera.position, { y: targetY, z: targetZ, duration: 1.0, ease: 'power2.out' });
        gsap.to(this.camera.rotation, { x: targetAngleX, duration: 1.0, ease: 'power2.out' });
      } else {
        this.camera.position.set(0, targetY, targetZ);
        this.camera.rotation.set(targetAngleX, 0, 0);
      }
    }
  }

  getSeatPositions(totalPlayers) {
    const count = Math.max(2, Math.min(6, totalPlayers));
    const radius = 3.6;
    const positions = [];

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 1.5) + (i * (Math.PI * 2 / count));
      const x = Math.cos(angle) * radius;
      const z = -Math.sin(angle) * radius * 0.82;
      positions.push({ x, y: 0.3, z, index: i });
    }

    return positions;
  }

  setTableColor(hexColor) {
    this.tableColor = hexColor;
    if (this.feltMat) {
      this.feltMat.color.set(hexColor);
    }
  }

  buildDecorChips() {
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
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
