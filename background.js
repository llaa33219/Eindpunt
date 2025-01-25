// background.js (Service Worker)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 'expandUrl' 액션 → GET으로 최종 리다이렉트 주소 추적
    if (request.action === "expandUrl") {
      fetch(request.url, {
        method: "GET",
        redirect: "follow"
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
  