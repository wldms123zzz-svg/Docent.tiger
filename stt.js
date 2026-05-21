/**
 * stt.js
 * 음성 인식(Speech-to-Text) 모듈
 *
 * - 브라우저 내장 SpeechRecognition API 사용
 * - 마이크 버튼 누르면 듣기 시작, 말이 끝나면 자동 종료 후 텍스트 반환
 * - Promise 기반: const userText = await listen();
 */

// ─────────────────────────────────────────────
// 브라우저 호환 SpeechRecognition 참조
// ─────────────────────────────────────────────
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

/**
 * 음성 인식 지원 여부
 */
export function isSTTSupported() {
  return !!SpeechRecognition;
}

/**
 * 마이크로 음성을 듣고 텍스트로 반환
 * @param {object} options
 * @param {string} options.lang — 인식 언어 (기본: 'ko-KR')
 * @param {function} options.onStart — 인식 시작 콜백
 * @param {function} options.onEnd — 인식 종료 콜백
 * @returns {Promise<string>} 인식된 텍스트
 */
export function listen(options = {}) {
  return new Promise((resolve, reject) => {
    if (!SpeechRecognition) {
      reject(new Error('SpeechRecognition not supported'));
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = options.lang || 'ko-KR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onstart = () => {
      if (options.onStart) options.onStart();
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      resolve(transcript);
    };

    recognition.onerror = (event) => {
      console.warn('[STT] Error:', event.error);
      // 에러여도 빈 문자열로 resolve (흐름 유지)
      resolve('');
    };

    recognition.onend = () => {
      if (options.onEnd) options.onEnd();
    };

    recognition.start();
  });
}

/**
 * 현재 진행 중인 인식 중단
 */
let _activeRecognition = null;

export function startListening(options = {}) {
  return new Promise((resolve, reject) => {
    if (!SpeechRecognition) {
      resolve('');
      return;
    }

    stopListening(); // 기존 세션 정리

    _activeRecognition = new SpeechRecognition();
    _activeRecognition.lang = options.lang || 'ko-KR';
    _activeRecognition.interimResults = false;
    _activeRecognition.maxAlternatives = 1;
    _activeRecognition.continuous = false;

    _activeRecognition.onstart = () => {
      if (options.onStart) options.onStart();
    };

    _activeRecognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      resolve(transcript);
    };

    _activeRecognition.onerror = (e) => {
      console.warn('[STT] SpeechRecognition error:', e.error);
      resolve('');
    };
    _activeRecognition.onend = () => {
      if (options.onEnd) options.onEnd();
      _activeRecognition = null;
    };

    try {
      _activeRecognition.start();
    } catch (e) {
      console.error('[STT] Failed to start recognition:', e);
      resolve('');
    }
  });
}

export function stopListening() {
  if (_activeRecognition) {
    try { _activeRecognition.stop(); } catch (_) {}
    _activeRecognition = null;
  }
}
