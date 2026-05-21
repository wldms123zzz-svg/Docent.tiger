/**
 * flow-controller.js
 * 도슨트 흐름 상태 머신 (FSM)
 *
 * 흐름:
 *   IDLE → APPEARING → GREETING → EXPLAINING → QUIZ → QUIZ_RESULT → MISSION → COMPLETE
 *
 * 설계 원칙:
 *   - 상태 전이 시 transition lock으로 next() 중복 호출 무시 (idempotency)
 *   - 각 상태에서 TTS 재생 완료를 await한 뒤 다음 단계 진행
 *   - 카메라 점유 유지: 흐름 진행 중 카메라가 끊기지 않도록 주의
 *   - 메모리: 새 발화 전 stopSpeaking() 호출
 */

import { speak, stopSpeaking } from './tts.js';
import {
  generateGreeting,
  generateExplanation,
  generateQuiz,
  generateMission,
  generateFeedback,
  generateFarewell,
  generateChatReply,
  analyzeImage,
  clearAnalysisCache,
} from './ai-persona.js';

// ─────────────────────────────────────────────
// 상태 정의
// ─────────────────────────────────────────────
export const FLOW_STATES = {
  IDLE:        'IDLE',         // 대기
  APPEARING:   'APPEARING',    // 캐릭터 등장 중
  GREETING:    'GREETING',     // 인사말 재생 중
  EXPLAINING:  'EXPLAINING',   // 설명 재생 중
  CHATTING:    'CHATTING',     // 🎙️ 양방향 대화 중
  QUIZ:        'QUIZ',         // 퀴즈 표시 중
  QUIZ_RESULT: 'QUIZ_RESULT',  // 정답/오답 피드백
  MISSION:     'MISSION',      // 미션 표시
  COMPLETE:    'COMPLETE',     // 완료
};

// ─────────────────────────────────────────────
// FlowController 클래스
// ─────────────────────────────────────────────
export class FlowController extends EventTarget {
  /**
   * @param {object} deps — 외부 의존성 주입
   * @param {function} deps.setAnimation  — (motionName: string) => void
   * @param {function} deps.setSpeechBubble — (text: string) => void
   * @param {function} deps.showQuizUI — (quiz, onAnswer) => void
   * @param {function} deps.hideQuizUI — () => void
   * @param {function} deps.showResultUI — (isSuccess, data) => void
   * @param {function} deps.hideResultUI — () => void
   * @param {function} deps.showMissionUI — (mission, onAccept) => void
   * @param {function} deps.hideMissionUI — () => void
   * @param {function} deps.updateKilnTemp — (temp) => void
   * @param {string}   deps.artworkId — 작품 식별자
   */
  constructor(deps) {
    super();
    this.deps = deps;
    this.state = FLOW_STATES.IDLE;
    this._transitioning = false; // transition lock

    // 내부 데이터
    this.artworkId = deps.artworkId || 'camera-scan';
    this.explanationParagraphs = [];
    this.currentParagraph = 0;
    this.quizzes = [];
    this.currentQuizIdx = 0;
    this.kilnTemp = 1000;
    this.correctCount = 0;
  }

  // ─────────────────────────────────────────
  // 상태 전이 (transition lock 보호)
  // ─────────────────────────────────────────
  async _transition(newState, handler) {
    if (this._transitioning) {
      console.warn(`[Flow] Ignoring transition to ${newState} — already transitioning`);
      return;
    }
    this._transitioning = true;
    const prevState = this.state;
    this.state = newState;

    this.dispatchEvent(new CustomEvent('state-change', {
      detail: { from: prevState, to: newState }
    }));

    try {
      await handler();
    } catch (err) {
      console.error(`[Flow] Error in state ${newState}:`, err);
    } finally {
      this._transitioning = false;
    }
  }

  // ─────────────────────────────────────────
  // 공개 API: 흐름 시작
  // ─────────────────────────────────────────
  async start() {
    await this._enterAppearing();
  }

  // ─────────────────────────────────────────
  // 공개 API: 다음 단계 진행 (사용자 탭)
  // ─────────────────────────────────────────
  async next() {
    if (this._transitioning) return; // idempotency

    switch (this.state) {
      case FLOW_STATES.GREETING:
        await this._enterExplaining();
        break;
      case FLOW_STATES.EXPLAINING:
        // 다음 문단이 있으면 이어서, 없으면 퀴즈로
        this.currentParagraph++;
        if (this.currentParagraph < this.explanationParagraphs.length) {
          await this._playParagraph();
        } else {
          await this._enterQuiz();
        }
        break;
      case FLOW_STATES.QUIZ_RESULT:
        // 다음 퀴즈 또는 미션으로
        this.currentQuizIdx++;
        if (this.currentQuizIdx < this.quizzes.length) {
          await this._showNextQuiz();
        } else {
          await this._enterMission();
        }
        break;
      default:
        break;
    }
  }

  // ─────────────────────────────────────────
  // 공개 API: 🎙️ 양방향 대화 (사용자 음성 질문 → AI 답변)
  // 어떤 상태에서든 마이크 버튼으로 호출 가능
  // ─────────────────────────────────────────
  async chat(userText) {
    if (!userText || !userText.trim()) return;
    const prevState = this.state;

    await this._transition(FLOW_STATES.CHATTING, async () => {
      // 사용자 질문을 말풍선에 잠시 표시
      this.deps.setSpeechBubble(`🎙️ "${userText}"`);
      this.deps.setAnimation('idle');
      await this._delay(600);

      // AI 응답 생성
      const reply = await generateChatReply(userText, this.artworkId);
      this.deps.setAnimation(reply.animation || 'call');
      this.deps.setSpeechBubble(reply.text);
      await speak(reply.text);
      this.deps.setAnimation('idle');
    });

    // 대화 후 이전 상태 복귀
    this.state = prevState;
  }

  // ─────────────────────────────────────────
  // 내부: APPEARING
  // ─────────────────────────────────────────
  async _enterAppearing() {
    await this._transition(FLOW_STATES.APPEARING, async () => {
      this.deps.setAnimation('walk');
      this.deps.setSpeechBubble('');
      // 등장 연출 (0.8초 대기)
      await this._delay(800);
      await this._enterGreeting();
    });
  }

  // ─────────────────────────────────────────
  // 내부: GREETING
  // ─────────────────────────────────────────
  async _enterGreeting() {
    await this._transition(FLOW_STATES.GREETING, async () => {
      const { text, animation } = await generateGreeting(this.artworkId);
      this.deps.setAnimation(animation);
      this.deps.setSpeechBubble(text);
      await speak(text);
      // TTS 끝나면 idle로 전환, 사용자 탭 대기
      this.deps.setAnimation('idle');
    });
  }

  // ─────────────────────────────────────────
  // 내부: EXPLAINING
  // ─────────────────────────────────────────
  async _enterExplaining() {
    await this._transition(FLOW_STATES.EXPLAINING, async () => {
      // 1. 카메라 프레임 캡처 및 AI 실시간 분석 연출
      if (this.deps.captureFrame) {
        this.deps.setSpeechBubble("가마의 영험한 기운으로 비추고 있는 작품을 분석 중이란다... 잠시만 기다리려무나!");
        this.deps.setAnimation('walk');
        const base64Img = this.deps.captureFrame();
        if (base64Img) {
          await analyzeImage(base64Img);
        }
      }

      const { paragraphs, animation } = await generateExplanation(this.artworkId);
      this.explanationParagraphs = paragraphs;
      this.currentParagraph = 0;
      await this._playParagraph();
    });
  }

  async _playParagraph() {
    const text = this.explanationParagraphs[this.currentParagraph];
    this.deps.setAnimation('call');
    this.deps.setSpeechBubble(text);

    this.dispatchEvent(new CustomEvent('paragraph-change', {
      detail: {
        index: this.currentParagraph,
        total: this.explanationParagraphs.length,
        text,
      }
    }));

    await speak(text);
    this.deps.setAnimation('idle');
    // 탭 대기 — next()에서 다음 문단 또는 퀴즈 전환
  }

  // ─────────────────────────────────────────
  // 내부: QUIZ
  // ─────────────────────────────────────────
  async _enterQuiz() {
    await this._transition(FLOW_STATES.QUIZ, async () => {
      this.quizzes = await generateQuiz(this.artworkId);
      this.currentQuizIdx = 0;
      this.kilnTemp = 1000;
      this.correctCount = 0;

      const introText = "허허, 이제 내 이야기를 잘 들었는지 퀴즈로 확인해 보자꾸나!";
      this.deps.setSpeechBubble(introText);
      this.deps.setAnimation('hello');
      await speak(introText);

      await this._showNextQuiz();
    });
  }

  async _showNextQuiz() {
    const quiz = this.quizzes[this.currentQuizIdx];
    this.deps.setAnimation('call');
    this.deps.updateKilnTemp(this.kilnTemp);

    this.deps.showQuizUI(quiz, async (selectedIdx) => {
      await this._handleAnswer(selectedIdx);
    });
  }

  async _handleAnswer(selectedIdx) {
    const quiz = this.quizzes[this.currentQuizIdx];
    const isCorrect = selectedIdx === quiz.ans;

    await this._transition(FLOW_STATES.QUIZ_RESULT, async () => {
      const feedback = await generateFeedback(isCorrect, quiz.opts[selectedIdx]);
      this.deps.setAnimation(feedback.animation);
      this.deps.setSpeechBubble(feedback.text);

      if (isCorrect) {
        this.correctCount++;
        this.kilnTemp = 1000 + this.correctCount * 100;
        this.deps.updateKilnTemp(this.kilnTemp);
      }

      await speak(feedback.text);

      if (!isCorrect) {
        // 오답: 같은 문제 재시도
        await this._delay(600);
        await this._showNextQuiz();
        return;
      }

      // 정답: 자동 진행
      this.deps.setAnimation('idle');
      await this._delay(400);
      await this.next(); // 다음 퀴즈 또는 미션
    });
  }

  // ─────────────────────────────────────────
  // 내부: MISSION
  // ─────────────────────────────────────────
  async _enterMission() {
    await this._transition(FLOW_STATES.MISSION, async () => {
      this.deps.hideQuizUI();

      const mission = await generateMission(this.artworkId);
      const completeText = "대단하구나! 가마 온도가 1300도에 도달하여 영롱하고 아름다운 자기가 구워져 나왔단다!";
      this.deps.setSpeechBubble(completeText);
      this.deps.setAnimation('hello');
      await speak(completeText);

      this.deps.showMissionUI(mission, async () => {
        this.deps.hideMissionUI();
        await this._enterComplete();
      });
    });
  }

  // ─────────────────────────────────────────
  // 내부: COMPLETE
  // ─────────────────────────────────────────
  async _enterComplete() {
    await this._transition(FLOW_STATES.COMPLETE, async () => {
      const { text, animation } = await generateFarewell(this.artworkId);
      this.deps.setAnimation(animation);
      this.deps.setSpeechBubble(text);
      await speak(text);
      this.deps.setAnimation('idle');

      this.dispatchEvent(new CustomEvent('flow-complete'));
    });
  }

  // ─────────────────────────────────────────
  // 리셋
  // ─────────────────────────────────────────
  reset() {
    stopSpeaking();
    this._transitioning = false;
    this.state = FLOW_STATES.IDLE;
    this.currentParagraph = 0;
    this.currentQuizIdx = 0;
    this.kilnTemp = 1000;
    this.correctCount = 0;
    this.quizzes = [];
    this.explanationParagraphs = [];
    this.deps.hideQuizUI();
    this.deps.hideResultUI();
    this.deps.hideMissionUI();
  }

  // ─────────────────────────────────────────
  // 유틸리티
  // ─────────────────────────────────────────
  _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
