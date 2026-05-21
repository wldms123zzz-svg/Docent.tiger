/**
 * celadon-shader.js
 * 고려청자 비취빛 PBR 재질 (박물관 조명 톤)
 *
 * 미술사적 근거:
 *  - 청자의 비취빛은 "철분(0.6~3%)이 환원소성에서 변환된 발색 + 유약층의 미세 기포에
 *    의한 빛의 산란"이 본질. 단일 albedo로는 재현 불가능하며, 다음 4개 레이어가 필요:
 *      (1) Base substrate: 어두운 옥색 (#1a3d34 ~ #2d5f4f)
 *      (2) Subsurface tint: 청록 굴절광 (transmission + thickness)
 *      (3) Clearcoat: 유약 광택 (clearcoat=0.9, roughness=0.05)
 *      (4) Iridescence: 박물관 스팟 조명에서 보이는 미세 무지개 간섭
 *
 *  - 박물관 조명 톤 = 낮은 ambient (0.15~0.25) + 강한 directional spot (>3000 lux 환산)
 *    HDRI는 어두운 갤러리 환경맵을 사용하거나 절차적으로 합성.
 */

const CELADON_PRESETS = {
  // 청자 박물관 조명 톤 — 어둡고 깊은 옥색, 고광택
  MUSEUM_DARK: {
    color:             0xbae8e0,   // 대폭 밝고 화사하게 파스텔 민트/옥색으로 상향
    metalness:         0.0,        
    roughness:         0.08,       // 표면을 더 곱고 반짝이게
    transmission:      0.12,       // 어두운 잔상을 줄이기 위해 투명도를 낮추고 베이스 컬러 비중 상향
    thickness:         0.15,       
    ior:               1.52,       
    attenuationColor:  0x6bc4b5,   
    attenuationDistance: 0.5,
    clearcoat:         0.95,       
    clearcoatRoughness:0.02,       
    iridescence:       0.05,       
    iridescenceIOR:    1.35,
    iridescenceThicknessRange: [100, 300],
    sheen:             0.0,
    envMapIntensity:   2.2,        // 환경맵 반사 강도 증가
    emissive:          0x225547,   // 자체발광 기저색을 좀 더 맑게
    emissiveIntensity: 0.45,       // 그림자를 완전히 지우고 자체 뽀샤시함을 살리도록 대폭 증가
  },
  // 국보 청자상감운학문매병 톤 — 밝고 반투명 (참고용)
  HERITAGE_BRIGHT: {
    color: 0x4a8576, metalness: 0.0, roughness: 0.15,
    transmission: 0.55, thickness: 0.5, ior: 1.5,
    clearcoat: 0.85, clearcoatRoughness: 0.06,
    iridescence: 0.2, envMapIntensity: 1.6,
    emissive: 0x0a2018, emissiveIntensity: 0.04,
  },
};

/**
 * 모델 내 모든 메시에 청자 머티리얼을 강제 주입.
 * 원본 .glb의 base map은 유지하되 청자 색조로 tint 합성.
 *
 * @param {THREE.Object3D} root  - GLTF scene root
 * @param {string} preset        - CELADON_PRESETS 키
 * @param {object} overrides     - 부분 덮어쓰기
 * @returns {THREE.MeshPhysicalMaterial[]} 적용된 머티리얼 배열
 */
export function applyCeladonMaterial(root, preset = 'MUSEUM_DARK', overrides = {}) {
  const cfg = { ...CELADON_PRESETS[preset], ...overrides };
  const applied = [];

  root.traverse((node) => {
    if (!node.isMesh) return;

    // 원본 텍스처 보존 (노멀맵·AO는 그대로 활용)
    const original = node.material;
    const baseMap   = original?.map         ?? null;
    const normalMap = original?.normalMap   ?? null;
    const aoMap     = original?.aoMap       ?? null;

    const mat = new THREE.MeshPhysicalMaterial({
      color:               new THREE.Color(cfg.color),
      map:                 baseMap,       // Three.js가 자동으로 color와 baseMap을 합성(tint)합니다.
      normalMap,
      normalScale:         new THREE.Vector2(0.6, 0.6),
      aoMap,
      aoMapIntensity:      1.0,

      metalness:           cfg.metalness,
      roughness:           cfg.roughness,

      transmission:        cfg.transmission,
      thickness:           cfg.thickness,
      ior:                 cfg.ior,
      attenuationColor:    new THREE.Color(cfg.attenuationColor ?? 0xffffff),
      attenuationDistance: cfg.attenuationDistance ?? Infinity,

      clearcoat:           cfg.clearcoat,
      clearcoatRoughness:  cfg.clearcoatRoughness,

      iridescence:         cfg.iridescence,
      iridescenceIOR:      cfg.iridescenceIOR ?? 1.3,
      iridescenceThicknessRange: cfg.iridescenceThicknessRange ?? [100, 400],

      sheen:               cfg.sheen ?? 0,
      envMapIntensity:     cfg.envMapIntensity,
      emissive:            new THREE.Color(cfg.emissive ?? 0x000000),
      emissiveIntensity:   cfg.emissiveIntensity ?? 0,

      transparent:         false, // 물리 굴절(transmission)은 transparent가 false여야 투명도 렌더링 꼬임 없이 예쁘게 나옵니다.
      side:                THREE.FrontSide,
    });

    // onBeforeCompile 셰이더 커스텀 인젝션 임시 주석 처리 (WebGL 컴파일 에러 방지)
    /*
    if (baseMap) {
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `
          #ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D( map, vMapUv );
            // 그레이스케일화 후 청자 톤 곱하기 — 원본 텍스처의 명암 디테일 보존
            float luma = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            sampledDiffuseColor.rgb = mix(vec3(luma), sampledDiffuseColor.rgb, 0.25);
            diffuseColor *= sampledDiffuseColor;
          #endif
          `
        );
      };
    }
    */

    node.material = mat;
    node.castShadow = true;
    node.receiveShadow = true;
    applied.push(mat);
  });

  return applied;
}

/**
 * 박물관 조명 셋업 — Three.js Scene에 직접 주입.
 * 실측 박물관 조명 시뮬레이션:
 *  - Ambient: 0.85 (전폭적인 조도 상향)
 *  - Key spot: 정면 상단 45°, 흰빛 크림 색온도, 강도 4.8
 *  - Rim: 후방 측면, 강도 1.2
 *  - Fill: 하단 약광, 강도 0.5
 */
export function setupMuseumLighting(scene) {
  const lights = [];

  const ambient = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambient); lights.push(ambient);

  const key = new THREE.SpotLight(0xfffaed, 4.8, 8, Math.PI / 6, 0.45, 1.5);
  key.position.set(1.2, 2.4, 1.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0005;
  scene.add(key); lights.push(key);

  const rim = new THREE.DirectionalLight(0xffffff, 1.2);
  rim.position.set(-1.8, 1.2, -1.5);
  scene.add(rim); lights.push(rim);

  const fill = new THREE.HemisphereLight(0xffffff, 0x333333, 0.5);
  scene.add(fill); lights.push(fill);

  return lights;
}

/**
 * 절차적 환경맵 — HDRI 외부 의존 없이 박물관 톤 큐브맵 생성.
 * 모바일 로딩 시간 절감 (별도 .hdr 파일 다운로드 0).
 */
export function createMuseumEnvMap(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  // 그라디언트 캔버스 → 텍스처
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.00, '#1a1f28');   // 천장 (어두움)
  grad.addColorStop(0.45, '#2d3848');   // 벽 상단
  grad.addColorStop(0.55, '#3a4858');   // 작품 조명 영역 (가장 밝음)
  grad.addColorStop(0.70, '#1f2530');   // 벽 하단
  grad.addColorStop(1.00, '#0a0d12');   // 바닥
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);
  // 스팟 조명 하이라이트 4개 (작품 조명 시뮬)
  ['#fff0d8','#fff0d8','#88bcff','#fff0d8'].forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(64 + i*128, 120, 40, 12, 0, 0, Math.PI*2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const envMap = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return envMap;
}

export { CELADON_PRESETS };
