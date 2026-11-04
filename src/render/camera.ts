/** Third-person chase camera with orbit offsets, smoothing, speed FOV and shake. */
import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/math';
import type { World } from '../sim/world';

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** User orbit offsets (radians), recentre when idle. */
  yawOffset = 0;
  pitchOffset = 0.22;
  distance = 46;
  private shake = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private yaw = 0;
  private idle = 0;
  private initialised = false;
  mode: 'chase' | 'orbit' = 'chase';
  orbitAngle = 0;
  orbitDistance = 56;
  orbitPitch = 0.18;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.5, 12000);
  }

  addShake(amount: number): void {
    this.shake = Math.min(2.5, this.shake + amount);
  }

  /** Apply look input (radians); resets the idle recentre timer. */
  orbit(dx: number, dy: number): void {
    this.yawOffset = clamp(this.yawOffset + dx, -Math.PI, Math.PI);
    this.pitchOffset = clamp(this.pitchOffset + dy, -0.35, 1.1);
    this.idle = 0;
  }

  zoom(delta: number): void {
    this.distance = clamp(this.distance + delta, 28, 110);
  }

  snap(): void {
    this.initialised = false;
  }

  update(target: THREE.Vector3, heading: number, speed: number, boost: boolean, dt: number, world: World | null, time: number): void {
    this.idle += dt;
    if (this.mode === 'chase' && this.idle > 2.5) {
      this.yawOffset = damp(this.yawOffset, 0, 1.2, dt);
      this.pitchOffset = damp(this.pitchOffset, 0.22, 1.0, dt);
    }
    let yaw: number;
    let pitch: number;
    let dist: number;
    if (this.mode === 'orbit') {
      this.orbitAngle += dt * 0.12 + this.yawOffset * 0.02;
      yaw = this.orbitAngle;
      pitch = this.orbitPitch + (this.pitchOffset - 0.22) * 0.5;
      dist = this.orbitDistance;
    } else {
      yaw = heading + this.yawOffset;
      pitch = this.pitchOffset;
      dist = this.distance * (1 + clamp(speed / 70, 0, 1) * 0.15);
    }
    if (!this.initialised) {
      this.yaw = yaw;
    } else {
      this.yaw = dampAngle(this.yaw, yaw, this.mode === 'orbit' ? 20 : 3.2, dt);
    }
    const cp = Math.cos(pitch);
    const desired = new THREE.Vector3(
      target.x + Math.sin(this.yaw) * cp * dist,
      target.y + 8 + Math.sin(pitch) * dist,
      target.z + Math.cos(this.yaw) * cp * dist,
    );
    // Keep the camera out of the cloud floor and out of terrain.
    desired.y = Math.max(desired.y, 6);
    if (world) {
      for (let i = 0; i < 4; i++) {
        const c = world.collide(desired.x, desired.y, desired.z, 3);
        if (!c) break;
        desired.y += c.depth + 2;
      }
    }
    const lookAt = new THREE.Vector3(target.x, target.y + 6, target.z);
    if (!this.initialised) {
      this.pos.copy(desired);
      this.look.copy(lookAt);
      this.initialised = true;
    } else {
      this.pos.x = damp(this.pos.x, desired.x, 6, dt);
      this.pos.y = damp(this.pos.y, desired.y, 5, dt);
      this.pos.z = damp(this.pos.z, desired.z, 6, dt);
      this.look.x = damp(this.look.x, lookAt.x, 12, dt);
      this.look.y = damp(this.look.y, lookAt.y, 10, dt);
      this.look.z = damp(this.look.z, lookAt.z, 12, dt);
    }
    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) {
      this.camera.position.x += Math.sin(time * 61) * this.shake;
      this.camera.position.y += Math.sin(time * 47 + 1) * this.shake;
      this.shake = damp(this.shake, 0, 4, dt);
    }
    this.camera.lookAt(this.look);
    const fov = 62 + clamp(speed / 70, 0, 1) * 8 + (boost ? 6 : 0);
    this.camera.fov = damp(this.camera.fov, fov, 3, dt);
    this.camera.updateProjectionMatrix();
  }
}
