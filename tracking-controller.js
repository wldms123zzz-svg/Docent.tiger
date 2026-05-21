/**
 * tracking-controller.js
 * Hybrid WebAR Virtual Docent — Dual Tracking State Machine
 *
 * 핵심 설계 원칙:
 *  (1) 단일 MediaStream 공유: getUserMedia()는 앱 생애주기 동안 1회만 호출.
 *      State 전환 시 비디오 트랙은 유지하고 "트래킹 알고리즘"만 hot-swap.
 *  (2) 좌표계 스위칭: NAVIGATION은 디바이스 자세(world frame),
 *      EXPLANATION은 마커 호모그래피(marker frame)를 캐릭터에 주입.
 *  (3) 트랜지션 큐: 좌표계 점프로 인한 시각적 단절을 방지하기 위해
 *      0.6초 페이드+이동 트윈을 강제 삽입.
 */

export const STATES = Object.freeze({
  BOOT: 'BOOT',
  NAVIGATION: 'NAVIGATION',
  EXPLANATION: 'EXPLANATION',
  TRANSITION: 'TRANSITION',
});

export class TrackingController extends EventTarget {
  constructor({ videoEl, sceneEl, characterEl, debug = false }) {
    super();
    this.video = videoEl;
    this.scene = sceneEl;
    this.character = characterEl;
    this.debug = debug;

    this.state = STATES.BOOT;
    this.mediaStream = null;

    // 트래커 인스턴스 핸들 (mode 모듈에서 주입)
    this.worldTracker = null;     // WebXR hit-test / DeviceOrientation fallback
    this.markerTracker = null;    // MindAR or AR.js NFT

    // 마지막 알려진 캐릭터 transform (트랜지션 보간용)
    this.lastTransform = { position: [0, 0, -1.5], rotation: [0, 0, 0] };
  }

  log(...args) { if (this.debug) console.log('[TC]', ...args); }

  // ──────────────────────────────────────────────
  // 1. 카메라 부트스트랩 (전체 세션 1회)
  // ──────────────────────────────────────────────
  async bootstrapCamera() {
    if (this.mediaStream) return this.mediaStream;
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1280 },
          height: { ideal: 720  },
          // iOS Safari는 frameRate hint를 일부 무시하므로 ideal만 기재
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      this.video.srcObject = this.mediaStream;
      this.video.setAttribute('playsinline', '');
      this.video.muted = true;
      await this.video.play();
      this.log('camera OK', this.video.videoWidth, this.video.videoHeight);
      return this.mediaStream;
    } catch (err) {
      this.dispatchEvent(new CustomEvent('camera-error', { detail: err }));
      throw err;
    }
  }

  // ──────────────────────────────────────────────
  // 2. State 진입 (idempotent)
  // ──────────────────────────────────────────────
  async enter(target) {
    if (this.state === target) return;
    if (this.state === STATES.TRANSITION) return; // 중복 진입 차단
    const prev = this.state;
    this.state = STATES.TRANSITION;
    this.dispatchEvent(new CustomEvent('state-change', {
      detail: { from: prev, to: target },
    }));

    // 이전 트래커 정지 (카메라는 유지)
    if (prev === STATES.NAVIGATION && this.worldTracker?.pause) {
      this.worldTracker.pause();
    }
    if (prev === STATES.EXPLANATION && this.markerTracker?.stop) {
      await this.markerTracker.stop();
    }

    // 캐릭터 페이드아웃 (시각적 봉합)
    await this._fadeCharacter(0, 250);

    // 신규 트래커 활성화
    if (target === STATES.NAVIGATION) {
      if (!this.worldTracker) throw new Error('worldTracker not registered');
      await this.worldTracker.start();
      // this._applyAnimation('Armature|walking_man|baselayer');
    } else if (target === STATES.EXPLANATION) {
      if (!this.markerTracker) throw new Error('markerTracker not registered');
      await this.markerTracker.start();
      // this._applyAnimation('Armature|Call_Gesture|baselayer');
    }

    await this._fadeCharacter(1, 350);
    this.state = target;
  }

  // ──────────────────────────────────────────────
  // 3. 트래커 등록 (mode 모듈에서 호출)
  // ──────────────────────────────────────────────
  registerWorldTracker(tracker)  { this.worldTracker  = tracker; }
  registerMarkerTracker(tracker) { this.markerTracker = tracker; }

  // ──────────────────────────────────────────────
  // 4. 마커 감지 핸들러 — 외부 트래커에서 호출
  // ──────────────────────────────────────────────
  onMarkerFound(markerId, transformMatrix) {
    if (this._lostTimer) {
      clearTimeout(this._lostTimer);
      this._lostTimer = null;
    }
    if (this.state !== STATES.NAVIGATION && this.state !== STATES.BOOT) return;
    this.dispatchEvent(new CustomEvent('marker-found', {
      detail: { markerId, transformMatrix },
    }));
    this.enter(STATES.EXPLANATION);
  }

  onMarkerLost(markerId) {
    if (this.state !== STATES.EXPLANATION) return;
    if (this._lostTimer) return;
    
    // 모바일 흔들림 방지: 2.5초 동안 마커 재인식이 안 될 때만 복귀
    this._lostTimer = setTimeout(() => {
      this.dispatchEvent(new CustomEvent('marker-lost', { detail: { markerId } }));
      this.enter(STATES.NAVIGATION);
      this._lostTimer = null;
    }, 2500);
  }

  // ──────────────────────────────────────────────
  // 5. 캐릭터 transform 주입 (트래커 → 매 프레임)
  // ──────────────────────────────────────────────
  pushTransform({ position, rotation, scale = 1 }) {
    // 캐릭터 화면 좌하단 고정 방식을 적용했으므로, 트래커의 실시간 위치 덮어쓰기를 비활성화하여 안정적 뷰 확보.
    return;
  }

  // ──────────────────────────────────────────────
  // 6. 애니메이션 트리거
  // ──────────────────────────────────────────────
  _applyAnimation(clipName) {
    if (!this.character) return;
    this.character.setAttribute('animation-mixer', {
      clip: clipName,
      loop: 'repeat',
      crossFadeDuration: 0.3,
    });
  }

  _fadeCharacter(targetOpacity, duration) {
    return new Promise(resolve => {
      if (!this.character) return resolve();
      const obj = this.character.object3D;
      const start = performance.now();
      const from = obj.userData._opacity ?? 1;
      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const v = from + (targetOpacity - from) * t;
        obj.traverse((n) => {
          if (n.material) {
            n.material.transparent = true;
            n.material.opacity = v;
          }
        });
        obj.userData._opacity = v;
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  // ──────────────────────────────────────────────
  // 7. 종료
  // ──────────────────────────────────────────────
  async destroy() {
    if (this.worldTracker?.stop)  await this.worldTracker.stop();
    if (this.markerTracker?.stop) await this.markerTracker.stop();
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
  }
}

// ──────────────────────────────────────────────
// World Tracker 구현 (8th Wall 대체 — 무료 폴백)
// ──────────────────────────────────────────────
export class WorldTrackerFallback {
  constructor(controller) {
    this.ctrl = controller;
    this.running = false;
    this.useWebXR = false;
    this.xrSession = null;
    this._orientHandler = null;
    this._yaw = 0; this._pitch = 0;
  }

  async start() {
    this.running = true;
    // 1순위: WebXR immersive-ar with hit-test (Android Chrome)
    if (navigator.xr && await navigator.xr.isSessionSupported?.('immersive-ar')) {
      try {
        this.xrSession = await navigator.xr.requestSession('immersive-ar', {
          requiredFeatures: ['hit-test', 'local-floor'],
        });
        this.useWebXR = true;
        this._initXRLoop();
        return;
      } catch (e) {
        console.warn('[WorldTracker] WebXR fail, fallback to orientation', e);
      }
    }
    // 2순위: DeviceOrientation 폴백 (iOS Safari)
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      // iOS 13+ 권한 요청 — 사용자 제스처 컨텍스트에서 호출되어야 함
      try { await DeviceOrientationEvent.requestPermission(); } catch (_) {}
    }
    this._orientHandler = (e) => {
      const THREE = window.THREE || (window.AFRAME && window.AFRAME.THREE);
      if (!THREE) {
        console.warn('[WorldTrackerFallback] THREE.js is not loaded yet.');
        return;
      }
      // alpha:Z, beta:X, gamma:Y → yaw/pitch 근사
      this._yaw   = THREE.MathUtils.degToRad(e.alpha || 0);
      this._pitch = THREE.MathUtils.degToRad((e.beta  || 0) - 90);
      // 바닥면 1.4m 전방, 0.4m 아래 가정 — 평균 신장 기준 휴리스틱
      const dist = 1.4;
      const x = Math.sin(this._yaw) * dist;
      const z = -Math.cos(this._yaw) * dist;
      this.ctrl.pushTransform({
        position: [x, -0.4, z],
        rotation: [0, this._yaw + Math.PI, 0],
        scale: 0.35,
      });
    };
    window.addEventListener('deviceorientation', this._orientHandler);
  }

  _initXRLoop() {
    // WebXR hit-test 풀-구현은 분량상 생략하고 핵심만:
    // - 매 프레임 viewer space에서 ray 발사 → hit pose 추출
    // - 첫 안정적 hit를 anchor로 채택 후 character.transform 주입
    // 실제 컴페티션 빌드에서는 three.js + WebXRManager 통합 권장.
    console.log('[WorldTracker] WebXR session active (hit-test loop placeholder)');
  }

  pause() {
    // 카메라/세션은 유지하고 콜백만 차단
    this.running = false;
  }

  async stop() {
    this.running = false;
    if (this._orientHandler) {
      window.removeEventListener('deviceorientation', this._orientHandler);
      this._orientHandler = null;
    }
    if (this.xrSession) {
      await this.xrSession.end().catch(() => {});
      this.xrSession = null;
    }
  }
}
