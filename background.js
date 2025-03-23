// background.js (Service Worker)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 'expandUrl' 액션 → HEAD로 최종 리다이렉트 주소 추적 (프라이버시 보호)
  if (request.action === "expandUrl") {
    // 프라이버시 보호 강화 옵션 추가
    const headers = {
      'DNT': '1',                      // Do Not Track 헤더
      'Cache-Control': 'no-store',     // 캐시 방지
      'Pragma': 'no-cache'             // 캐시 방지 (레거시)
    };
    
    // HEAD 메서드로 요청하여 본문 다운로드 방지
    // credentials: 'omit'으로 쿠키가 전송되지 않도록 설정
    fetch(request.url, {
      method: "HEAD",
      headers: headers,
      redirect: "follow",
      credentials: 'omit', // 쿠키 전송 방지
      cache: 'no-store'    // 캐시 사용 안함
    })
      .then(response => {
        sendResponse({ finalUrl: response.url });
      })
      .catch(error => {
        sendResponse({ error: String(error) });
      });
    return true; // 비동기 응답
  }
});

// 확장 프로그램의 어떠한 통계 데이터도 수집하지 않음
// 사용자 활동에 대한 정보는 외부로 전송되지 않음