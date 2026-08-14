/**
 * items3d.js - Interactive 3D Throwing Items & Splat Particle FX (Tomatoes, Champagne, Coins)
 */
/* global THREE, gsap */

import { sounds } from './audio.js';

export class ThrowItemsEngine {
  constructor(scene3D) {
    this.scene3D = scene3D;
    this.scene = scene3D.scene;
  }

  throwItem(fromPos3D, targetPos3D, itemType = 'tomato') {
    const start = new THREE.Vector3(fromPos3D.x, fromPos3D.y + 0.5, fromPos3D.z);
    const end = new THREE.Vector3(targetPos3D.x, targetPos3D.y + 0.5, targetPos3D.z);

    // Create 3D Projectile Mesh
    let geo, mat;
    if (itemType === 'tomato') {
      geo = new THREE.SphereGeometry(0.18, 16, 16);
      mat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3 });
    } else if (itemType === 'champagne') {
      geo = new THREE.CylinderGeometry(0.08, 0.12, 0.45, 12);
      mat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.2, metalness: 0.1 });
    } else if (itemType === 'coin') {
      geo = new THREE.CylinderGeometry(0.16, 0.16, 0.04, 16);
      mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.9, roughness: 0.2 });
    } else {
      geo = new THREE.SphereGeometry(0.15, 12, 12);
      mat = new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0xf97316, emissiveIntensity: 0.5 });
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(start);
    this.scene.add(mesh);

    // Parabolic Bezier Arc Flight
    const midX = (start.x + end.x) / 2;
    const midY = Math.max(start.y, end.y) + 1.8;
    const midZ = (start.z + end.z) / 2;

    const trajectory = { t: 0 };
    gsap.to(trajectory, {
      t: 1,
      duration: 0.7,
      ease: 'power1.inOut',
      onUpdate: () => {
        const t = trajectory.t;
        // Quadratic Bezier Formula: (1-t)^2*P0 + 2*(1-t)*t*P1 + t^2*P2
        mesh.position.x = Math.pow(1 - t, 2) * start.x + 2 * (1 - t) * t * midX + Math.pow(t, 2) * end.x;
        mesh.position.y = Math.pow(1 - t, 2) * start.y + 2 * (1 - t) * t * midY + Math.pow(t, 2) * end.y;
        mesh.position.z = Math.pow(1 - t, 2) * start.z + 2 * (1 - t) * t * midZ + Math.pow(t, 2) * end.z;
        mesh.rotation.x += 0.2;
        mesh.rotation.z += 0.2;
      },
      onComplete: () => {
        mesh.geometry.dispose();
        mesh.material.dispose();
        this.scene.remove(mesh);
        this.createSplatFX(end, itemType);
      }
    });
  }

  createSplatFX(pos, itemType) {
    if (itemType === 'tomato' || itemType === 'champagne') {
      sounds.playSplat();
    } else if (itemType === 'coin') {
      sounds.playChipsClink();
    }

    // Splat Particles Burst
    const count = 25;
    const pGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];

    const particleColor = itemType === 'tomato' ? 0xef4444 : itemType === 'champagne' ? 0xfef08a : 0xf59e0b;

    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;

      velocities.push({
        x: (Math.random() - 0.5) * 0.12,
        y: Math.random() * 0.14,
        z: (Math.random() - 0.5) * 0.12
      });
    }

    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pMat = new THREE.PointsMaterial({
      color: particleColor,
      size: 0.08,
      transparent: true,
      opacity: 1.0
    });

    const pSystem = new THREE.Points(pGeo, pMat);
    this.scene.add(pSystem);

    let progress = 0;
    const anim = () => {
      progress += 0.05;
      const posAttr = pGeo.attributes.position;

      for (let i = 0; i < count; i++) {
        posAttr.array[i * 3] += velocities[i].x;
        posAttr.array[i * 3 + 1] += velocities[i].y;
        posAttr.array[i * 3 + 2] += velocities[i].z;
        velocities[i].y -= 0.005; // Gravity
      }
      posAttr.needsUpdate = true;
      pMat.opacity = Math.max(0, 1 - progress);

      if (progress < 1) {
        requestAnimationFrame(anim);
      } else {
        pGeo.dispose();
        pMat.dispose();
        this.scene.remove(pSystem);
      }
    };
    anim();
  }
}
