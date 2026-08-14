/**
 * cardRenderer3d.js - 3D Card Meshes, Raycasting, Drag & Drop, Bezier Flight Animations & Hand Fan
 */

import { createCardFaceTexture, createCardBackTexture } from './cards.js';
import { sounds } from './audio.js';

export class CardRenderer3D {
  constructor(scene3D) {
    this.scene3D = scene3D;
    this.scene = scene3D.scene;
    this.cardMeshes = new Map(); // cardId -> Mesh
    this.handCards = []; // Array of card objects currently in local player's hand
    this.tablePairMeshes = []; // [{ attackMesh, defenseMesh }]
    this.deckMeshes = [];
    this.trumpMesh = null;
    this.discardMeshes = [];
    this.activeDeckSkin = 'deck_classic';

    this.selectedCard = null;
    this.hoveredCard = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.onCardPlayRequested = () => {};

    this.initInteraction();
  }

  setDeckSkin(skinId) {
    this.activeDeckSkin = skinId;
  }

  createCardMesh(card, isFaceUp = true) {
    const cardWidth = 0.72;
    const cardHeight = 1.0;
    const cardThickness = 0.006;

    const geo = new THREE.BoxGeometry(cardWidth, cardThickness, cardHeight);

    const faceTexture = isFaceUp ? createCardFaceTexture(card.suit, card.rank) : null;
    const backTexture = createCardBackTexture(this.activeDeckSkin);

    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xefefea, roughness: 0.8 });
    const topMat = new THREE.MeshStandardMaterial({
      map: isFaceUp ? faceTexture : backTexture,
      roughness: 0.35,
      metalness: 0.05
    });
    const bottomMat = new THREE.MeshStandardMaterial({
      map: isFaceUp ? backTexture : faceTexture,
      roughness: 0.35,
      metalness: 0.05
    });

    // Materials order for BoxGeometry: right, left, top(Y+), bottom(Y-), front(Z+), back(Z-)
    const materials = [edgeMat, edgeMat, topMat, bottomMat, edgeMat, edgeMat];
    const mesh = new THREE.Mesh(geo, materials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { card, isFaceUp };

    return mesh;
  }

  /**
   * Updates & Animates Local Player's Hand into a Fan Layout at Bottom
   */
  renderLocalHand(cards) {
    this.handCards = cards;

    // Clear old hand meshes
    const currentHandIds = new Set(cards.map(c => c.id));
    for (const [id, mesh] of this.cardMeshes.entries()) {
      if (mesh.userData.isHand && !currentHandIds.has(id)) {
        this.scene.remove(mesh);
        this.cardMeshes.delete(id);
      }
    }

    const total = cards.length;
    if (total === 0) return;

    const maxSpreadAngle = Math.min(0.45, total * 0.07);
    const arcRadius = 4.2;
    const baseY = 0.85;
    const baseZ = 2.4;

    cards.forEach((card, i) => {
      let mesh = this.cardMeshes.get(card.id);
      const isNew = !mesh;

      if (isNew) {
        mesh = this.createCardMesh(card, true);
        mesh.userData.isHand = true;
        mesh.position.set(0, 4, 0); // Deal from deck
        this.scene.add(mesh);
        this.cardMeshes.set(card.id, mesh);
      }

      // Compute Fan Angle & Position
      const progress = total === 1 ? 0.5 : i / (total - 1);
      const angle = (progress - 0.5) * maxSpreadAngle;

      const targetX = Math.sin(angle) * arcRadius;
      const targetZ = baseZ - (Math.cos(angle) * 0.3) + (i * 0.015);
      const targetY = baseY - (Math.abs(progress - 0.5) * 0.15);

      if (isNew) {
        gsap.to(mesh.position, {
          x: targetX,
          y: targetY,
          z: targetZ,
          duration: 0.6,
          delay: i * 0.05,
          ease: 'power2.out',
          onStart: () => sounds.playCardSlide()
        });
        gsap.to(mesh.rotation, {
          x: -0.4,
          y: 0,
          z: -angle * 0.9,
          duration: 0.6,
          delay: i * 0.05,
          ease: 'power2.out'
        });
      } else {
        gsap.to(mesh.position, { x: targetX, y: targetY, z: targetZ, duration: 0.3, ease: 'power2.out' });
        gsap.to(mesh.rotation, { x: -0.4, y: 0, z: -angle * 0.9, duration: 0.3, ease: 'power2.out' });
      }
    });
  }

  /**
   * Renders Deck Stack and Trump Card
   */
  renderDeckAndTrump(remainingCount, trumpCard) {
    if (!trumpCard) return;

    // Trump Card (Horizontal under deck)
    if (!this.trumpMesh) {
      this.trumpMesh = this.createCardMesh(trumpCard, true);
      this.trumpMesh.position.set(-2.0, 0.02, -0.4);
      this.trumpMesh.rotation.set(0, Math.PI / 2, 0);
      this.scene.add(this.trumpMesh);
    }

    // Deck Pile Meshes (up to 6 stacked cards representing remaining deck)
    const visualStackCount = Math.min(8, Math.max(1, Math.ceil(remainingCount / 5)));
    
    // Clear old deck meshes
    this.deckMeshes.forEach(m => this.scene.remove(m));
    this.deckMeshes = [];

    if (remainingCount > 1) {
      for (let i = 0; i < visualStackCount; i++) {
        const dummyCard = { suit: trumpCard.suit, rank: 6, id: `deck_${i}` };
        const mesh = this.createCardMesh(dummyCard, false);
        mesh.position.set(-2.0 + (Math.random() * 0.02), 0.03 + (i * 0.015), -0.4 + (Math.random() * 0.02));
        mesh.rotation.set(0, (Math.random() - 0.5) * 0.06, 0);
        this.scene.add(mesh);
        this.deckMeshes.push(mesh);
      }
    } else if (remainingCount === 1) {
      // Only trump card remains visible
    } else {
      // Deck empty
      if (this.trumpMesh) {
        this.scene.remove(this.trumpMesh);
        this.trumpMesh = null;
      }
    }
  }

  /**
   * Renders Active Attack & Defense Cards on Table Center
   */
  renderTablePairs(pairs) {
    // Clear removed pairs
    const activePairIds = new Set(pairs.flatMap(p => [p.attack.id, p.defense ? p.defense.id : null]).filter(Boolean));
    for (const [id, mesh] of this.cardMeshes.entries()) {
      if (mesh.userData.isTable && !activePairIds.has(id)) {
        this.scene.remove(mesh);
        this.cardMeshes.delete(id);
      }
    }

    const totalPairs = pairs.length;
    const spacing = 1.0;
    const startX = -((totalPairs - 1) * spacing) / 2;

    pairs.forEach((pair, idx) => {
      const posX = startX + (idx * spacing);

      // Attack Card
      let attackMesh = this.cardMeshes.get(pair.attack.id);
      if (!attackMesh) {
        attackMesh = this.createCardMesh(pair.attack, true);
        attackMesh.userData.isTable = true;
        this.scene.add(attackMesh);
        this.cardMeshes.set(pair.attack.id, attackMesh);

        // Bezier Toss Animation to table
        attackMesh.position.set(0, 1.5, 2.0);
        gsap.to(attackMesh.position, {
          x: posX,
          y: 0.04,
          z: 0.1,
          duration: 0.45,
          ease: 'power2.out',
          onStart: () => sounds.playCardSlide(),
          onComplete: () => sounds.playCardSnap()
        });
        gsap.to(attackMesh.rotation, {
          x: 0,
          y: 0,
          z: (Math.random() - 0.5) * 0.15,
          duration: 0.45
        });
      }

      // Defense Card (if defended)
      if (pair.defense) {
        let defMesh = this.cardMeshes.get(pair.defense.id);
        if (!defMesh) {
          defMesh = this.createCardMesh(pair.defense, true);
          defMesh.userData.isTable = true;
          this.scene.add(defMesh);
          this.cardMeshes.set(pair.defense.id, defMesh);

          defMesh.position.set(posX, 1.2, 0.5);
          gsap.to(defMesh.position, {
            x: posX + 0.12,
            y: 0.08,
            z: -0.15,
            duration: 0.4,
            ease: 'back.out(1.4)',
            onComplete: () => sounds.playCardSnap()
          });
          gsap.to(defMesh.rotation, {
            x: 0,
            y: 0,
            z: 0.25,
            duration: 0.4
          });
        }
      }
    });
  }

  /**
   * User Touch / Click Raycasting for Drag & Drop
   */
  initInteraction() {
    const onPointerMove = (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.scene3D.camera);
      const handMeshes = Array.from(this.cardMeshes.values()).filter(m => m.userData.isHand);
      const intersects = this.raycaster.intersectObjects(handMeshes);

      if (intersects.length > 0) {
        const topMesh = intersects[0].object;
        if (this.hoveredCard !== topMesh) {
          if (this.hoveredCard) this.resetHover(this.hoveredCard);
          this.hoveredCard = topMesh;
          gsap.to(topMesh.position, { y: topMesh.position.y + 0.25, z: topMesh.position.z - 0.1, duration: 0.15 });
        }
      } else if (this.hoveredCard) {
        this.resetHover(this.hoveredCard);
        this.hoveredCard = null;
      }
    };

    const onPointerDown = (e) => {
      this.raycaster.setFromCamera(this.mouse, this.scene3D.camera);
      const handMeshes = Array.from(this.cardMeshes.values()).filter(m => m.userData.isHand);
      const intersects = this.raycaster.intersectObjects(handMeshes);

      if (intersects.length > 0) {
        this.selectedCard = intersects[0].object;
        sounds.playCardSlide();
      }
    };

    const onPointerUp = (e) => {
      if (this.selectedCard) {
        // If card was dragged or clicked, trigger play event
        const card = this.selectedCard.userData.card;
        this.onCardPlayRequested(card);
        this.selectedCard = null;
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
  }

  resetHover(mesh) {
    if (!mesh) return;
    this.renderLocalHand(this.handCards);
  }
}
