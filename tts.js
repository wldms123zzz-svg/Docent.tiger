/**
 * tts.js
 * 호선생 TTS(음성 합성) 모듈
 *
 * - 브라우저 내장 SpeechSynthesis API 사용 (별도 서버 불필요)
 * - speak()는 Promise를 반환하여, 음성 재생이 끝나야 다음 단계로 넘어감
 * - iOS Safari 정책: 최초 사용자 제스처 안에서 warmup() 호출 필수
 * - 메모리 관리: 새 발화 전 speechSynthesis.cancel() 자동 호출
 */

// ─────────────────────────────────────────────
// iOS Safari TTS 웜업 (사용자 제스처 컨텍스트 내에서 호출)
// ─────────────────────────────────────────────
export function warmupTTS() {
  if ('speechSynthesis' in window) {
    const dummy = new SpeechSynthesisUtterance('');
    dummy.volume = 0;
    speechSynthesis.speak(dummy);
    // 보이스 목록 초기 로딩 강제
    speechSynthesis.getVoices();
  }
}

// ─────────────────────────────────────────────
// 한국어 음성으로 텍스트 읽기
// 재생 완료 시 Promise resolve
// pitch/rate는 캐릭터 페르소나에 맞춰 조정 가능
//   → 호랑이 호선생은 약간 굵고 천천히 (pitch: 0.85, rate: 0.95)
// ─────────────────────────────────────────────
export function speak(text, options = {}) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) {
      console.warn('[TTS] SpeechSynthesis not supported');
      resolve();
      return;
    }

    // 메모리 관리: 이전 발화 즉시 정리
    speechSynthesis.cancel();

    // UI 안내문 제거 (예: "(탭!)" 같은 인터랙션 힌트)
    const cleanText = text.replace(/\(탭!\)/g, '').replace(/\(터치!\)/g, '').trim();
    if (!cleanText) {
      resolve();
      return;
    }

    const utter = new SpeechSynthesisUtterance(cleanText);
    utter.lang = 'ko-KR';
    utter.rate = options.rate || 0.95;
    utter.pitch = options.pitch || 0.85;  // 호랑이 캐릭터용 낮은 톤
    utter.volume = options.volume ?? 1.0;

    // 한국어 음성 우선 매칭 (남성 목소리 선호)
    const voices = speechSynthesis.getVoices();
    const koMale = voices.find(v =>
      (v.lang === 'ko-KR' || v.lang === 'ko_KR') && v.name.includes('Male')
    );
    const koAny = voices.find(v =>
      v.lang.startsWith('ko')
    );
    if (koMale) {
      utter.voice = koMale;
    } else if (koAny) {
      utter.voice = koAny;
    }

    utter.onend = () => resolve();
    utter.onerror = () => resolve(); // 에러여도 흐름은 계속

    speechSynthesis.speak(utter);
  });
}

// ─────────────────────────────────────────────
// 음성 즉시 중단
// ─────────────────────────────────────────────
export function stopSpeaking() {
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
  }
}
