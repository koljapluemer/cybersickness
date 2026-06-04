import 'aframe';
import type { Component } from 'aframe';
import './style.css';

type TourPoint = {
  t: number;
  position: [number, number, number];
};

type TourPath = {
  duration: number;
  points: TourPoint[];
};

type TourFlightData = {
  src: string;
  scale: number;
  offset: {
    x: number;
    y: number;
    z: number;
  };
  rotationY: number;
  lookAhead: number;
  pitch: number;
};

type TourFlightComponent = Component<TourFlightData> & {
  duration: number;
  path: TourPoint[];
  pathLoaded: boolean;
  offsetVector: InstanceType<typeof AFRAME.THREE.Vector3>;
  worldPosition: InstanceType<typeof AFRAME.THREE.Vector3>;
  lookTarget: InstanceType<typeof AFRAME.THREE.Vector3>;
  rotationEuler: InstanceType<typeof AFRAME.THREE.Euler>;
};

type HorizonHudData = {
  enabled: boolean;
};

type HorizonHudComponent = Component<HorizonHudData> & {
  cameraQuaternion: InstanceType<typeof AFRAME.THREE.Quaternion>;
  worldUpInCameraSpace: InstanceType<typeof AFRAME.THREE.Vector3>;
};

type CompassHudData = {
  enabled: boolean;
};

type CompassHudComponent = Component<CompassHudData> & {
  cameraQuaternion: InstanceType<typeof AFRAME.THREE.Quaternion>;
  forward: InstanceType<typeof AFRAME.THREE.Vector3>;
  initialYaw: number | null;
};

type PitchHudData = {
  enabled: boolean;
  flip: boolean;
};

type PitchHudComponent = Component<PitchHudData> & {
  cameraQuaternion: InstanceType<typeof AFRAME.THREE.Quaternion>;
  worldUpInCameraSpace: InstanceType<typeof AFRAME.THREE.Vector3>;
};

function samplePath(path: TourPoint[], t: number): [number, number, number] {
  if (path.length === 0) {
    return [0, 0, 0];
  }

  if (t <= path[0].t) {
    return path[0].position;
  }

  const lastPoint = path[path.length - 1];

  if (t >= lastPoint.t) {
    return lastPoint.position;
  }

  for (let index = 0; index < path.length - 1; index += 1) {
    const current = path[index];
    const next = path[index + 1];

    if (t > next.t) {
      continue;
    }

    const span = next.t - current.t;
    const alpha = span === 0 ? 0 : (t - current.t) / span;

    return [
      current.position[0] + (next.position[0] - current.position[0]) * alpha,
      current.position[1] + (next.position[1] - current.position[1]) * alpha,
      current.position[2] + (next.position[2] - current.position[2]) * alpha,
    ];
  }

  return lastPoint.position;
}

function applyWorldTransform(
  component: TourFlightComponent,
  point: [number, number, number],
  target: InstanceType<typeof AFRAME.THREE.Vector3>,
): void {
  target.set(point[0], point[1], point[2]);
  target.multiplyScalar(component.data.scale);
  target.applyEuler(component.rotationEuler);
  target.add(component.offsetVector.set(
    component.data.offset.x,
    component.data.offset.y,
    component.data.offset.z,
  ));
}

async function loadTourPath(component: TourFlightComponent): Promise<void> {
  const response = await fetch(component.data.src);

  if (!response.ok) {
    throw new Error(`Failed to load tour path from ${component.data.src}.`);
  }

  const tourPath = (await response.json()) as TourPath;

  component.path = tourPath.points;
  component.duration = tourPath.duration;
  component.pathLoaded = component.path.length > 1 && component.duration > 0;
}

AFRAME.registerComponent('tour-flight', {
  schema: {
    src: { type: 'string', default: '/tour-path.json' },
    scale: { type: 'number', default: 220 },
    offset: { type: 'vec3', default: { x: 0, y: 2.7, z: 0 } },
    rotationY: { type: 'number', default: 18 },
    lookAhead: { type: 'number', default: 1.2 },
    pitch: { type: 'number', default: 30 },
  },

  init(this: TourFlightComponent) {
    this.duration = 0;
    this.path = [];
    this.pathLoaded = false;
    this.offsetVector = new AFRAME.THREE.Vector3();
    this.worldPosition = new AFRAME.THREE.Vector3();
    this.lookTarget = new AFRAME.THREE.Vector3();
    this.rotationEuler = new AFRAME.THREE.Euler(0, 0, 0, 'YXZ');
    this.rotationEuler.set(0, AFRAME.THREE.MathUtils.degToRad(this.data.rotationY), 0);

    void loadTourPath(this).catch((error: unknown) => {
      console.error(error);
    });
  },

  update(this: TourFlightComponent) {
    this.rotationEuler.set(0, AFRAME.THREE.MathUtils.degToRad(this.data.rotationY), 0);
  },

  tick(this: TourFlightComponent, time: number) {
    if (!this.pathLoaded) {
      return;
    }

    const elapsedSeconds = (time / 1000) % this.duration;
    const currentPoint = samplePath(this.path, elapsedSeconds);
    const lookAheadPoint = samplePath(this.path, (elapsedSeconds + this.data.lookAhead) % this.duration);

    applyWorldTransform(this, currentPoint, this.worldPosition);
    applyWorldTransform(this, lookAheadPoint, this.lookTarget);

    this.el.object3D.position.copy(this.worldPosition);
    this.el.object3D.lookAt(this.lookTarget);
    this.el.object3D.rotateY(Math.PI);
    this.el.object3D.rotateX(-AFRAME.THREE.MathUtils.degToRad(this.data.pitch));
  },
});

AFRAME.registerShader('horizon-bar', {
  schema: {
    innerRadius: { type: 'number', default: 0.046, is: 'uniform' },
    outerRadius: { type: 'number', default: 0.076, is: 'uniform' },
    color: { type: 'color', default: '#123d7a', is: 'uniform' },
    opacity: { type: 'number', default: 0.92, is: 'uniform' },
  },
  vertexShader: `
    varying vec2 vLocalPos;
    void main() {
      vLocalPos = position.xy;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vLocalPos;
    uniform float innerRadius;
    uniform float outerRadius;
    uniform vec3 color;
    uniform float opacity;
    void main() {
      float dist = length(vLocalPos);
      if (dist < innerRadius || dist > outerRadius) discard;
      gl_FragColor = vec4(color, opacity);
    }
  `,
});

AFRAME.registerComponent('horizon-hud', {
  schema: {
    enabled: { type: 'boolean', default: true },
  },

  init(this: HorizonHudComponent) {
    this.cameraQuaternion = new AFRAME.THREE.Quaternion();
    this.worldUpInCameraSpace = new AFRAME.THREE.Vector3();
  },

  tick(this: HorizonHudComponent, time: number) {
    if (!this.data.enabled) {
      this.el.object3D.rotation.z = 0;
      return;
    }

    if (!this.el.sceneEl?.is('vr-mode')) {
      // Desktop: slow clockwise spin for visual validation (~16 s per revolution).
      this.el.object3D.rotation.z = -(time / 1000) * (Math.PI / 8);
      return;
    }

    const cameraObject = this.el.sceneEl.camera;

    if (!cameraObject) {
      return;
    }

    cameraObject.getWorldQuaternion(this.cameraQuaternion);

    // Project world up into camera space so the HUD can cancel head roll.
    this.worldUpInCameraSpace
      .set(0, 1, 0)
      .applyQuaternion(this.cameraQuaternion.invert());

    this.el.object3D.rotation.z = -Math.atan2(
      this.worldUpInCameraSpace.x,
      this.worldUpInCameraSpace.y,
    );
  },
});

AFRAME.registerComponent('compass-hud', {
  schema: { enabled: { type: 'boolean', default: true } },

  init(this: CompassHudComponent) {
    this.cameraQuaternion = new AFRAME.THREE.Quaternion();
    this.forward = new AFRAME.THREE.Vector3();
    this.initialYaw = null;
  },

  tick(this: CompassHudComponent, time: number) {
    if (!this.data.enabled) {
      this.el.object3D.rotation.z = 0;
      return;
    }

    if (!this.el.sceneEl?.is('vr-mode')) {
      // Desktop validation: counter-clockwise spin to distinguish from roll indicator.
      this.el.object3D.rotation.z = (time / 1000) * (Math.PI / 8);
      return;
    }

    const cameraObject = this.el.sceneEl.camera;
    if (!cameraObject) return;

    cameraObject.getWorldQuaternion(this.cameraQuaternion);

    this.forward.set(0, 0, -1).applyQuaternion(this.cameraQuaternion);
    this.forward.y = 0;
    this.forward.normalize();
    const yaw = Math.atan2(this.forward.x, -this.forward.z);

    if (this.initialYaw === null) {
      this.initialYaw = yaw;
    }

    this.el.object3D.rotation.z = yaw - this.initialYaw;
  },
});

AFRAME.registerComponent('pitch-hud', {
  schema: {
    enabled: { type: 'boolean', default: true },
    flip: { type: 'boolean', default: false },
  },

  init(this: PitchHudComponent) {
    this.cameraQuaternion = new AFRAME.THREE.Quaternion();
    this.worldUpInCameraSpace = new AFRAME.THREE.Vector3();
  },

  tick(this: PitchHudComponent, time: number) {
    if (!this.data.enabled) {
      this.el.object3D.rotation.z = 0;
      return;
    }

    if (!this.el.sceneEl?.is('vr-mode')) {
      // Desktop validation: clockwise spin, same rate as roll indicator.
      this.el.object3D.rotation.z = -(time / 1000) * (Math.PI / 8);
      return;
    }

    const cameraObject = this.el.sceneEl.camera;
    if (!cameraObject) return;

    cameraObject.getWorldQuaternion(this.cameraQuaternion);

    this.worldUpInCameraSpace
      .set(0, 1, 0)
      .applyQuaternion(this.cameraQuaternion.invert());

    const pitch = Math.atan2(this.worldUpInCameraSpace.z, this.worldUpInCameraSpace.y);
    this.el.object3D.rotation.z = this.data.flip ? -pitch : pitch;
  },
});

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App root not found.');
}

app.innerHTML = `
  <a-scene
    embedded
    renderer="antialias: true; colorManagement: true"
    background="color: #dcecf8"
    vr-mode-ui="enabled: true"
  >
    <a-assets>
      <a-asset-item id="mountain-landscape" src="/mountains/scene.gltf"></a-asset-item>
    </a-assets>

    <a-entity light="type: ambient; intensity: 0.8; color: #eef6ff"></a-entity>
    <a-entity
      light="type: directional; intensity: 1.2; color: #fff5df"
      position="6 10 3"
    ></a-entity>
    <a-sky color="#dcecf8"></a-sky>

    <a-entity
      gltf-model="#mountain-landscape"
      position="0 2.7 0"
      scale="220 220 220"
      rotation="0 18 0"
    ></a-entity>

    <a-entity tour-flight="src: /tour-path.json; scale: 220; offset: 0 2.7 0; rotationY: 18; pitch: 30">
      <a-camera
        fov="60"
        position="0 0 0"
        look-controls-enabled="false"
        wasd-controls-enabled="false"
      >
        <a-entity position="0 0 -1">
          <a-entity
            geometry="primitive: ring; radiusInner: 0.245; radiusOuter: 0.256; segmentsTheta: 128"
            material="shader: flat; color: #123d7a; opacity: 0.25; transparent: true; depthTest: false"
          ></a-entity>
          <a-entity
            horizon-hud
            geometry="primitive: plane; width: 0.76; height: 0.009"
            material="shader: horizon-bar; innerRadius: 0.245; outerRadius: 0.256; color: #123d7a; opacity: 0.92; transparent: true; depthTest: false"
          ></a-entity>
        </a-entity>

        <a-entity position="0 -0.46 -.75" rotation="-90 0 0">
          <a-entity
            geometry="primitive: ring; radiusInner: 0.354; radiusOuter: 0.370; segmentsTheta: 128"
            material="shader: flat; color: #123d7a; opacity: 0.25; transparent: true; depthTest: false"
          ></a-entity>
          <a-entity
            compass-hud
            geometry="primitive: plane; width: 0.76; height: 0.009"
            material="shader: horizon-bar; innerRadius: 0.354; outerRadius: 0.370; color: #123d7a; opacity: 0.92; transparent: true; depthTest: false"
          ></a-entity>
        </a-entity>

        <a-entity position="0.40 0 -0.5" rotation="0 90 0">
          <a-entity
            geometry="primitive: ring; radiusInner: 0.354; radiusOuter: 0.370; segmentsTheta: 128"
            material="shader: flat; color: #123d7a; opacity: 0.25; transparent: true; depthTest: false; side: double"
          ></a-entity>
          <a-entity
            pitch-hud
            geometry="primitive: plane; width: 0.76; height: 0.009"
            material="shader: horizon-bar; innerRadius: 0.354; outerRadius: 0.370; color: #123d7a; opacity: 0.92; transparent: true; depthTest: false; side: double"
          ></a-entity>
        </a-entity>

        <a-entity position="-0.40 0 -0.5" rotation="0 -90 0">
          <a-entity
            geometry="primitive: ring; radiusInner: 0.354; radiusOuter: 0.370; segmentsTheta: 128"
            material="shader: flat; color: #123d7a; opacity: 0.25; transparent: true; depthTest: false; side: double"
          ></a-entity>
          <a-entity
            pitch-hud="flip: true"
            geometry="primitive: plane; width: 0.76; height: 0.009"
            material="shader: horizon-bar; innerRadius: 0.354; outerRadius: 0.370; color: #123d7a; opacity: 0.92; transparent: true; depthTest: false; side: double"
          ></a-entity>
        </a-entity>
      </a-camera>
    </a-entity>
  </a-scene>
`;
