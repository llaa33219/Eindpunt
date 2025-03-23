// content-script.js
(function() {
  //----------------------------------------------------------------
  // A. 백그라운드 → 실패 시 직접 fetch (개인정보 보호 강화)
  //----------------------------------------------------------------
  async function directFetchFinalUrl(originUrl) {
    try {
      // 프라이버시 보호 강화 옵션 추가
      const headers = {
        'DNT': '1',                      // Do Not Track 헤더
        'Cache-Control': 'no-store',     // 캐시 방지
        'Pragma': 'no-cache'             // 캐시 방지 (레거시)
      };
      
      // mode: 'no-cors'로 요청시 크레덴셜 전송 방지
      // credentials: 'omit'으로 쿠키가 전송되지 않도록 설정
      // redirect: 'manual'로 직접 리다이렉트를 처리하지 않음
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3초 타임아웃
      
      const res = await fetch(originUrl, { 
        method: "HEAD", // GET 대신 HEAD 사용하여 본문 다운로드 방지
        headers: headers,
        credentials: 'omit', // 쿠키 전송 방지
        redirect: "follow",
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return res.url;
    } catch {
      return null;
    }
  }

  function getFinalUrl(originUrl, callback) {
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      directFetchFinalUrl(originUrl).then(url => url && callback && callback(url));
      return;
    }
    try {
      // 확장 프로그램 내부에서만 처리되는 메시지
      chrome.runtime.sendMessage({ 
        action: "expandUrl", 
        url: originUrl,
        timestamp: Date.now() // 중복 요청 방지를 위한 타임스탬프
      }, response => {
        if (chrome.runtime.lastError) {
          directFetchFinalUrl(originUrl).then(url => url && callback && callback(url));
          return;
        }
        if (response && response.finalUrl) {
          callback?.(response.finalUrl);
        } else {
          directFetchFinalUrl(originUrl).then(url => url && callback && callback(url));
        }
      });
    } catch {
      directFetchFinalUrl(originUrl).then(url => url && callback && callback(url));
    }
  }

  //----------------------------------------------------------------
  // B. /redirect?external=... 에서 실제 URL만 추출
  //----------------------------------------------------------------
  function parseRedirectExternalUrl(href) {
    // e.g. "/redirect?external=https://naver.me/AAAAAA"
    // playentry.org에서는 보통 "https://playentry.org/redirect?external=..."
    // 로 나타날 수도 있음. (절대 경로)
    // 1) URL 전체에서 /redirect?external= 뒤의 값 추출
    const reg = /\/redirect\?external=([^]+)/i;
    const match = href.match(reg);
    if (match) {
      // match[1] = "https://naver.me/AAAAAA" (URL 인코딩이 있을 수도?)
      // URLDecode 한번 시도
      try {
        return decodeURIComponent(match[1]);
      } catch {
        // decode 실패시 그냥 raw
        return match[1];
      }
    }
    return href;
  }

  //----------------------------------------------------------------
  // B-2. href와 텍스트 내용이 같은지 확인하는 함수
  //----------------------------------------------------------------
  function shouldProcessAnchor(a) {
    const href = a.href;
    const text = a.textContent.trim();
    
    // 1. 텍스트와 href가 정확히 같은 경우 (대소문자 무시)
    if (href.toLowerCase() === text.toLowerCase()) return true;
    
    // 2. http/https 제거하고 소문자로 변환 후 비교
    const normalizedHref = href.replace(/^https?:\/\//i, '').toLowerCase();
    const normalizedText = text.replace(/^https?:\/\//i, '').toLowerCase();
    if (normalizedHref === normalizedText) return true;
    
    // 3. /redirect?external= 형태인 경우
    const extractedUrl = parseRedirectExternalUrl(href);
    if (extractedUrl !== href) { // redirect 형태인 경우
      // 추출된 URL과 텍스트 비교 (대소문자 무시)
      if (extractedUrl.toLowerCase() === text.toLowerCase()) return true;
      
      // http/https 제거 후 비교
      const normalizedExtractedUrl = extractedUrl.replace(/^https?:\/\//i, '').toLowerCase();
      if (normalizedExtractedUrl === normalizedText) return true;
      
      // 텍스트에서 http/https를 제거한 결과와 
      // /redirect?external= 뒤의 값에서 http/https 제거한 결과 비교
      const textWithoutProtocol = text.replace(/^https?:\/\//i, '').toLowerCase();
      const extractedUrlWithoutProtocol = extractedUrl.replace(/^https?:\/\//i, '').toLowerCase();
      if (textWithoutProtocol === extractedUrlWithoutProtocol) return true;
    }
    
    return false;
  }

  //----------------------------------------------------------------
  // C. linkify: div 내 텍스트 → <a>
  //----------------------------------------------------------------
  const httpRegex = /(https?:\/\/[^\s"'<>]+)/g;
  function linkifyDivText(div) {
    const childNodes = Array.from(div.childNodes);
    childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue;
        if (text && httpRegex.test(text)) {
          const html = text.replace(httpRegex, match => {
            return `<a href="${match}" target="_blank" rel="noreferrer">${match}</a>`;
          });
          const span = document.createElement("span");
          span.innerHTML = html;
          div.replaceChild(span, node);
        }
      }
    });
  }

  //----------------------------------------------------------------
  // D. replaceAnchor: href → 최종 URL, 텍스트는 한국어 체크
  //----------------------------------------------------------------
  function replaceAnchor(a) {
    // 조건을 만족하는 링크만 처리
    if (!shouldProcessAnchor(a)) return;
    
    // 먼저 /redirect?external=... 인지 검사
    const rawHref = a.href;
    const realUrl = parseRedirectExternalUrl(rawHref);

    getFinalUrl(realUrl, finalUrl => {
      if (finalUrl) {
        // playentry.org 도메인 여부 확인 (프로토콜 제외)
        const isPlayentryDomain = finalUrl.replace(/^https?:\/\//i, '').toLowerCase().startsWith('playentry.org/');
        
        if (isPlayentryDomain) {
          // playentry.org 도메인인 경우 직접 링크로 설정
          a.href = finalUrl;
          
          // 텍스트 내 한글 있으면 그대로
          const hasKorean = /[\uAC00-\uD7A3]/.test(a.textContent);
          if (!hasKorean) {
            a.textContent = finalUrl;
          }
        } else {
          // playentry.org 도메인이 아닌 경우 /redirect?external= 형식 유지
          const externalPath = `/redirect?external=${encodeURIComponent(finalUrl)}`;
          a.href = externalPath;
          
          // 텍스트 내 한글 있으면 그대로
          const hasKorean = /[\uAC00-\uD7A3]/.test(a.textContent);
          if (!hasKorean) {
            a.textContent = finalUrl;
          }
        }
      }
    });
  }

  //----------------------------------------------------------------
  // E. findInShadow: ShadowRoot까지 순회
  //----------------------------------------------------------------
  function findInShadow(root, selector) {
    const found = Array.from(root.querySelectorAll(selector));
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
    while (walker.nextNode()) {
      if (walker.currentNode.shadowRoot) {
        found.push(...findInShadow(walker.currentNode.shadowRoot, selector));
      }
    }
    return found;
  }

  //----------------------------------------------------------------
  // F. IntersectionObserver (divObserver, anchorObserver)
  //----------------------------------------------------------------

  const divObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const div = entry.target;
        linkifyDivText(div);
        // 새로 생긴 a태그 등록
        const newAnchors = div.querySelectorAll('a[href^="http"], a[href^="/redirect"]');
        newAnchors.forEach(a => anchorObserver.observe(a));

        divObserver.unobserve(div);
      }
    });
  }, {
    root: null,
    rootMargin: "500px 0px 500px 0px",
    threshold: 0
  });

  const anchorObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const a = entry.target;
        replaceAnchor(a);
        anchorObserver.unobserve(a);
      }
    });
  }, {
    root: null,
    rootMargin: "500px 0px 500px 0px",
    threshold: 0
  });

  //----------------------------------------------------------------
  // G. 관찰 등록 함수 (부분일치 클래스 + a[href^="http"])
  //----------------------------------------------------------------
  function registerObserversIn(node) {
    // data-converted 속성이 없거나 "false"인 div 요소만 선택
    const divs = node.querySelectorAll
      ? node.querySelectorAll('div[class*="css-6wq60h"][class*="e1i41bku"]:not([data-converted="true"])')
      : [];
    divs.forEach(d => divObserver.observe(d));

    // 링크 선택자 개선: /redirect로 시작하는 링크도 포함
    const anchors = node.querySelectorAll
      ? node.querySelectorAll('a[href^="http"], a[href^="/redirect"]')
      : [];
    anchors.forEach(a => anchorObserver.observe(a));
  }

  //----------------------------------------------------------------
  // H. 전체 초기 등록
  //----------------------------------------------------------------
  function registerAll() {
    // data-converted 속성이 없거나 "false"인 div 요소만 선택
    const allDivs = findInShadow(document, 'div[class*="css-6wq60h"][class*="e1i41bku"]:not([data-converted="true"])');
    allDivs.forEach(d => divObserver.observe(d));

    // 링크 선택자 개선: /redirect로 시작하는 링크도 포함
    const allAs = findInShadow(document, 'a[href^="http"], a[href^="/redirect"]');
    allAs.forEach(a => anchorObserver.observe(a));
  }

  //----------------------------------------------------------------
  // I. MutationObserver
  //----------------------------------------------------------------
  const mo = new MutationObserver(muts => {
    for (const mut of muts) {
      if (mut.addedNodes && mut.addedNodes.length > 0) {
        mut.addedNodes.forEach(n => {
          if (n.nodeType === Node.ELEMENT_NODE) {
            // data-converted 속성 확인 추가
            if (n.matches?.('div[class*="css-6wq60h"][class*="e1i41bku"]:not([data-converted="true"])')) {
              divObserver.observe(n);
            }
            // 링크 선택자 개선: /redirect로 시작하는 링크도 포함
            if (n.matches?.('a[href^="http"], a[href^="/redirect"]')) {
              anchorObserver.observe(n);
            }
            registerObserversIn(n);
          }
        });
      }
    }
  });

  //----------------------------------------------------------------
  // J. fallback 주기 검사
  //----------------------------------------------------------------
  setInterval(() => {
    registerAll();
  }, 3000);

  //----------------------------------------------------------------
  // K. 실행
  //----------------------------------------------------------------
  registerAll();
  mo.observe(document.body, { childList: true, subtree: true });
})();