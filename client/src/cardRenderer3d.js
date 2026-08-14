/**
 * cardRenderer3d.js - 3D Card Meshes, Hand Fan Layout in Camera View, 3D Opponent Hands & Animations
 */
/* global THREE, gsap */

import { createCardFaceTexture, createCardBackTexture } from './cards.js';
import { sounds } from './audio.js';

export class CardRenderer3D {
  constructor(scene3D) {
    this.scene3D = scene3D;
    this.scene = scene3D.scene;
    this.cardMeshes = new Map(); // cardId -> Mesh
    this.handCards = [];
    this.tablePairMeshes = [];
    this.deckMeshes = [];
    this.opponentCardMeshes = [];
    this.trumpMesh = null;
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
    const cardWidth = 0.76;
    const cardHeight = 1.06;
    const cardThickness = 0.008;

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

    const materials = [edgeMat, edgeMat, topMat, bottomMat, edgeMat, edgeMat];
    const mesh = new THREE.Mesh(geo, materials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { card, isFaceUp };

    return mesh;
  }

  /**
   * Renders Local Player's Hand Cards in Clear Bottom Screen Camera View
   */
  renderLocalHand(cards) {
    this.handCards = cards;

    // Remove old hand meshes not present in current cards
    const currentHandIds = new Set(cards.map(c => c.id));
    for (const [id, mesh] of this.cardMeshes.entries()) {
      if (mesh.userData.isHand && !currentHandIds.has(id)) {
        if (mesh.geometry) mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
        else if (mesh.material) mesh.material.dispose();
        this.scene.remove(mesh);
        this.cardMeshes.delete(id);
      }
    }

    const total = cards.length;
    if (total === 0) return;

    // Fan Parameters calibrated precisely for Camera Y=4.6, Z=5.2
    const maxSpread = Math.min(0.55, total * 0.08);
    const baseY = 1.85;
    const baseZ = 3.35;
    const arcRadius = 3.6;

    cards.forEach((card, i) => {
      let mesh = this.cardMeshes.get(card.id);
      const isNew = !mesh;

      if (isNew) {
        mesh = this.createCardMesh(card, true);
        mesh.userData.isHand = true;
        mesh.position.set(0, 3.5, 0); // Deal from deck
        this.scene.add(mesh);
        this.cardMeshes.set(card.id, mesh);
      }

      const progress = total === 1 ? 0.5 : i / (total - 1);
      const angle = (progress - 0.5) * maxSpread;

      const targetX = Math.sin(angle) * arcRadius;
      const targetZ = baseZ - (Math.cos(angle) * 0.25) + (i * 0.02);
      const targetY = baseY - (Math.abs(progress - 0.5) * 0.12);

      if (isNew) {
        gsap.to(mesh.position, {
          x: targetX,
          y: targetY,
          z: targetZ,
          duration: 0.5,
          delay: i * 0.06,
          ease: 'power2.out',
          onStart: () => sounds.playCardSlide()
        });
        gsap.to(mesh.rotation, {
          x: -0.65,
          y: 0,
          z: -angle * 0.85,
          duration: 0.5,
          delay: i * 0.06,
          ease: 'power2.out'
        });
      } else {
        gsap.to(mesh.position, { x: targetX, y: targetY, z: targetZ, duration: 0.25, ease: 'power2.out' });
        gsap.to(mesh.rotation, { x: -0.65, y: 0, z: -angle * 0.85, duration: 0.25, ease: 'power2.out' });
      }
    });
  }

  /**
   * Renders 3D Opponents' Card Backs around the table
   */
  renderOpponentsHands(players, localPlayerId) {
    this.opponentCardMeshes.forEach(m => {
      if (m.geometry) m.geometry.dispose();
      if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose());
      else if (m.material) m.material.dispose();
      this.scene.remove(m);
    });
    this.opponentCardMeshes = [];

    const total = players.length;
    const seatPositions = this.scene3D.getSeatPositions(total);
    const localIdx = players.findIndex(p => p.id === localPlayerId);

    players.forEach((p, i) => {
      if (p.id === localPlayerId || p.cardsCount <= 0) return;

      const relativeIdx = (i - localIdx + total) % total;
      const seatPos = seatPositions[relativeIdx];
      const count = Math.min(6, p.cardsCount);

      for (let c = 0; c < count; c++) {
        const dummyCard = { suit: 'spades', rank: 6, id: `opp_${p.id}_${c}` };
        const mesh = this.createCardMesh(dummyCard, false);
        mesh.scale.set(0.65, 0.65, 0.65);

        const offsetAngle = (c - (count - 1) / 2) * 0.12;
        mesh.position.set(
          seatPos.x * 0.8 + Math.sin(offsetAngle) * 0.3,
          0.3 + (c * 0.01),
          seatPos.z * 0.8
        );
        mesh.rotation.set(-0.3, -Math.atan2(seatPos.x, -seatPos.z), offsetAngle);

        this.scene.add(mesh);
        this.opponentCardMeshes.push(mesh);
      }
    });
  }

  /**
   * Renders Deck Stack and Perpendicular Trump Card
   */
  renderDeckAndTrump(remainingCount, trumpCard) {
    if (!trumpCard) return;

    // Trump Card (Horizontal, Face UP under deck)
    if (!this.trumpMesh) {
      this.trumpMesh = this.createCardMesh(trumpCard, true);
      this.trumpMesh.position.set(-1.9, 0.04, -0.3);
      this.trumpMesh.rotation.set(0, Math.PI / 2, 0);
      this.scene.add(this.trumpMesh);
    }

    // Deck Pile Meshes (Stacked Face DOWN)
    const visualStackCount = Math.min(8, Math.max(1, Math.ceil(remainingCount / 5)));

    this.deckMeshes.forEach(m => this.scene.remove(m));
    this.deckMeshes = [];

    if (remainingCount > 1) {
      for (let i = 0; i < visualStackCount; i++) {
        const dummyCard = { suit: trumpCard.suit, rank: 6, id: `deck_${i}` };
        const mesh = this.createCardMesh(dummyCard, false);
        mesh.position.set(-1.9 + (Math.random() * 0.02), 0.06 + (i * 0.016), -0.3 + (Math.random() * 0.02));
        mesh.rotation.set(0, (Math.random() - 0.5) * 0.06, 0);
        this.scene.add(mesh);
        this.deckMeshes.push(mesh);
      }
    } else if (remainingCount <= 0 && this.trumpMesh) {
      this.scene.remove(this.trumpMesh);
      this.trumpMesh = null;
    }
  }

  /**
   * Renders Active Attack & Defense Cards on Table Center
   */
  renderTablePairs(pairs) {
    const activePairIds = new Set(pairs.flatMap(p => [p.attack.id, p.defense ? p.defense.id : null]).filter(Boolean));
    for (const [id, mesh] of this.cardMeshes.entries()) {
      if (mesh.userData.isTable && !activePairIds.has(id)) {
        this.scene.remove(mesh);
        this.cardMeshes.delete(id);
      }
    }

    const totalPairs = pairs.length;
    const spacing = 1.05;
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

        attackMesh.position.set(0, 1.8, 2.2);
        gsap.to(attackMesh.position, {
          x: posX,
          y: 0.05,
          z: 0.1,
          duration: 0.4,
          ease: 'power2.out',
          onStart: () => sounds.playCardSlide(),
          onComplete: () => sounds.playCardSnap()
        });
        gsap.to(attackMesh.rotation, {
          x: 0,
          y: 0,
          z: (Math.random() - 0.5) * 0.15,
          duration: 0.4
        });
      }

      // Defense Card
      if (pair.defense) {
        let defMesh = this.cardMeshes.get(pair.defense.id);
        if (!defMesh) {
          defMesh = this.createCardMesh(pair.defense, true);
          defMesh.userData.isTable = true;
          this.scene.add(defMesh);
          this.cardMeshes.set(pair.defense.id, defMesh);

          defMesh.position.set(posX, 1.4, 0.8);
          gsap.to(defMesh.position, {
            x: posX + 0.14,
            y: 0.09,
            z: -0.16,
            duration: 0.35,
            ease: 'back.out(1.4)',
            onComplete: () => sounds.playCardSnap()
          });
          gsap.to(defMesh.rotation, {
            x: 0,
            y: 0,
            z: 0.28,
            duration: 0.35
          });
        }
      }
    });
  }

  /**
   * User Touch / Click Raycasting for Drag & Play
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
          gsap.to(topMesh.position, { y: topMesh.position.y + 0.3, z: topMesh.position.z - 0.15, duration: 0.15 });
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
