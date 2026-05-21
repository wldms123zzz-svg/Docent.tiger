/**
 * ai-persona.js
 * AI 페르소나 인터페이스 — generate* 함수 모음
 *
 * 현재 구현: scenario-db.js의 JSON 데이터셋에서 값을 가져옴
 * 향후 구현: 각 함수를 AI API 호출로 교체
 *
 * 함수 시그니처(인자/리턴값 구조)는 AI 응답 포맷과 동일하게 유지할 것.
 */

import { SCENARIO_DB, DEFAULT_ARTWORK_ID } from './scenario-db.js';

// ─────────────────────────────────────────────
// API 키 로딩 (로컬 파일 유출 방지를 위해 오직 브라우저 localStorage만 사용)
// ─────────────────────────────────────────────
export function getApiKey() {
  return localStorage.getItem('gemini_api_key') || '';
}

// ─────────────────────────────────────────────
// 실시간 이미지 분석 결과 캐시 시스템
// ─────────────────────────────────────────────
let cachedAnalysis = null;

export function clearAnalysisCache() {
  cachedAnalysis = null;
}

export async function analyzeImage(base64Image) {
  clearAnalysisCache();
  if (!base64Image) return null;
  
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn("[AI Vision] No API Key set. Simulated analysis fallback will be handled.");
    return null;
  }
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: "너는 국립중앙박물관의 구수한 호랑이 도슨트 '호선생'이야. 입력된 카메라 프레임 이미지를 분석하고 다음 지시를 엄수해줘.\n" +
                  "1. 이미지에서 어떤 유물(예: 도자기, 향로, 가구, 불상, 혹은 주변 사물)이 보이는지 분석하고,\n" +
                  "2. 해당 유물에 대한 재미있고 구수한 해설을 '도슨트 대사'로 작성해줘. 3문단 정도의 배열로 분리하여 구성해야 해. 각 문단은 2~3줄씩, 반드시 '~란다', '~구려', '~하렴' 같은 구수한 조선시대 호랑이 말투여야 해.\n" +
                  "3. 해설 대사의 성격에 맞추어 호선생이 표현할 3D 애니메이션 추천(suggested_animation)을 4가지 키워드('hello', 'walk', 'call', 'idle') 중 반드시 하나로 정해줘. (반갑고 친근한 자랑 멘트면 'hello', 수수께끼를 내거나 유물을 둘러볼 땐 'walk', 깊이 있고 진중한 가이드 해설에는 'call', 평조의 서술에는 'idle'을 제안하렴)\n" +
                  "4. 이 해설을 바탕으로 유저가 풀 수 있는 3지선다 퀴즈를 딱 3개 만들어줘. 질문(q), 보기 3개(opts), 0-based 정답 인덱스(ans)를 작성해.\n" +
                  "5. 만약 이미지가 어둡거나 유물을 뚜렷하게 알기 힘든 상황이라도, 방 안의 모습이나 가구를 엮어서 한국 전통 미술품(예: 고려청자, 조선백자) 이야기를 해설과 퀴즈로 능청스럽게 지어내주렴. 절대 오류를 내지 마.\n" +
                  "6. 반드시 제공된 스키마에 따라 JSON 데이터 형식으로만 응답해야 해."
          },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image
            }
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          docent_explanation: {
            type: "ARRAY",
            items: { type: "STRING" }
          },
          suggested_animation: { 
            type: "STRING", 
            enum: ["hello", "walk", "call", "idle"] 
          },
          quizzes: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                q: { type: "STRING" },
                opts: {
                  type: "ARRAY",
                  items: { type: "STRING" }
                },
                ans: { type: "INTEGER" }
              },
              required: ["q", "opts", "ans"]
            }
          }
        },
        required: ["docent_explanation", "suggested_animation", "quizzes"]
      }
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (resultText) {
      const parsed = JSON.parse(resultText);
      cachedAnalysis = parsed;
      return parsed;
    }
  } catch (err) {
    console.error("[AI Vision] API error, falling back to simulated scenario:", err);
  }
  return null;
}

// ─────────────────────────────────────────────
// 🔌 AI INTEGRATION POINT
// ─────────────────────────────────────────────
/**
 * 인사말 생성
 * @param {string} artworkId
 * @returns {Promise<{text: string, animation: string}>}
 */
export async function generateGreeting(artworkId) {
  if (cachedAnalysis) {
    return {
      text: "어이쿠! 카메라 렌즈 너머로 신기한 유물이 포착되었구나! 내 얼른 자세한 해설을 들려주마! (탭!)",
      animation: cachedAnalysis.suggested_animation || 'hello',
    };
  }
  const scenario = SCENARIO_DB[artworkId] || SCENARIO_DB[DEFAULT_ARTWORK_ID];
  return {
    text: scenario.greeting,
    animation: scenario.suggested_animation || 'hello',
  };
}

// ─────────────────────────────────────────────
// 🔌 AI INTEGRATION POINT
// ─────────────────────────────────────────────
/**
 * 해설 생성 (3문단 배열)
 * @param {string} artworkId
 * @returns {Promise<{paragraphs: string[], animation: string}>}
 */
export async function generateExplanation(artworkId) {
  if (cachedAnalysis && cachedAnalysis.docent_explanation) {
    return {
      paragraphs: cachedAnalysis.docent_explanation,
      animation: cachedAnalysis.suggested_animation || 'call',
    };
  }
  const scenario = SCENARIO_DB[artworkId] || SCENARIO_DB[DEFAULT_ARTWORK_ID];
  return {
    paragraphs: scenario.explanation,
    animation: 'call',
  };
}

// ─────────────────────────────────────────────
// 🔌 AI INTEGRATION POINT
// ─────────────────────────────────────────────
/**
 * 퀴즈 생성 (3문제)
 * @param {string} artworkId
 * @returns {Promise<Array<{q: string, opts: string[], ans: number}>>}
 */
export async function generateQuiz(artworkId) {
  if (cachedAnalysis && cachedAnalysis.quizzes) {
    return cachedAnalysis.quizzes;
  }
  const scenario = SCENARIO_DB[artworkId] || SCENARIO_DB[DEFAULT_ARTWORK_ID];
  return scenario.quizzes;
}

// ─────────────────────────────────────────────
// 🔌 AI INTEGRATION POINT
// 향후 이 함수를 AI API 호출로 교체:
// const response = await fetch('/api/ai/mission', {
//   method: 'POST',
//   body: JSON.stringify({ artworkId, persona: 'ho-teacher', userProfile })
// });
// return response.json();
// ─────────────────────────────────────────────
/**
 * 미션 생성
 * @param {string} artworkId
 * @returns {Promise<{title: string, description: string, acceptText: string}>}
 */
export async function generateMission(artworkId) {
  const scenario = SCENARIO_DB[artworkId] || SCENARIO_DB[DEFAULT_ARTWORK_ID];
  return scenario.mission;
}

// ─────────────────────────────────────────────
// 🔌 AI INTEGRATION POINT
// 향후 이 함수를 AI API 호출로 교체:
// const response = await fetch('/api/ai/feedback', {
//   method: 'POST',
//   body: JSON.stringify({ isCorrect, userAnswer, artworkId, persona: 'ho-teacher' })
// });
// return response.json();
// ─────────────────────────────────────────────
/**
 * 정답/오답 피드백 생성
 * @param {boolean} isCorrect
 * @param {string} userAnswer
 * @returns {Promise<{text: string, animation: string}>}
 */
export async function generateFeedback(isCorrect, userAnswer) {
  if (isCorrect) {
    const cheers = [
      "정답이란다! 솜씨가 아주 일품이구나!",
      "오호라! 맞았구나, 가마 온도가 솟구치는도다!",
      "허허, 역시 내 해설을 귀담아들었구려!",
    ];
    return {
      text: cheers[Math.floor(Math.random() * cheers.length)],
      animation: 'hello',
    };
  } else {
    const comforts = [
      "아이고, 안타깝구나. 한 번 더 생각해 보렴!",
      "틀렸구려... 하지만 실패는 성공의 어머니란다!",
      "아쉽구나. 내 해설을 다시 귀담아듣고 재도전해 보겠느냐?",
    ];
    return {
      text: comforts[Math.floor(Math.random() * comforts.length)],
      animation: 'idle',
    };
  }
}

// ─────────────────────────────────────────────
// 🔌 AI INTEGRATION POINT
// 향후 이 함수를 AI API 호출로 교체:
// Gemini Vision API로 카메라 프레임 분석 후 동적 시나리오 생성
// ─────────────────────────────────────────────
/**
 * 작별 인사 생성
 * @param {string} artworkId
 * @returns {Promise<{text: string, animation: string}>}
 */
export async function generateFarewell(artworkId) {
  const scenario = SCENARIO_DB[artworkId] || SCENARIO_DB[DEFAULT_ARTWORK_ID];
  return {
    text: scenario.farewell,
    animation: 'hello',
  };
}

// ─────────────────────────────────────────────
// 🔌 AI INTEGRATION POINT — 양방향 대화
// Gemini API를 실시간 호출하여 사용자 질문에 호선생이 즉석 답변
// ─────────────────────────────────────────────
/**
 * 사용자 음성 질문에 대한 AI 실시간 답변 생성
 * @param {string} userText — 사용자가 말한 텍스트
 * @param {string} artworkId — 현재 작품 ID (맥락 제공용)
 * @returns {Promise<{text: string, animation: string}>}
 */
export async function generateChatReply(userText, artworkId) {
  const apiKey = getApiKey();

  if (!apiKey) {
    // API 키 미설정 시 폴백
    return {
      text: "허허, 아직 내 산령의 기운이 연결되지 않았구려. 설정에서 AI 키를 입력해 주렴.",
      animation: 'idle',
    };
  }

  const scenario = SCENARIO_DB[artworkId] || SCENARIO_DB[DEFAULT_ARTWORK_ID];
  const context = scenario.explanation ? scenario.explanation.join(' ') : '';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `너는 국립중앙박물관의 구수한 호랑이 도슨트 '호선생'이야. 반드시 '~란다', '~구려', '~하렴' 같은 구수한 말투로 대답해야 해.\n\n현재 설명 중인 작품 맥락:\n${context}\n\n사용자의 질문: "${userText}"\n\n위 질문에 호선생 말투로 2~3문장 이내로 친절하고 재미있게 답변해줘.`
          }]
        }],
        generationConfig: {
          maxOutputTokens: 200,
          temperature: 0.8,
        }
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (reply) {
      return { text: reply, animation: 'call' };
    }
    throw new Error('Empty response');
  } catch (err) {
    console.error('[ChatReply] Gemini API error:', err);
    const fallbacks = [
      "오호, 좋은 질문이로다! 허나 지금은 산령의 기운이 약해 답을 드리기 어렵구려.",
      "허허, 그 궁금증은 내가 직접 설명판 앞에서 알려주마. 조금만 기다리렴!",
    ];
    return {
      text: fallbacks[Math.floor(Math.random() * fallbacks.length)],
      animation: 'idle',
    };
  }
}
