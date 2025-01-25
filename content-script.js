// content-script.js
(function() {
    //----------------------------------------------------------------
    // A. 백그라운드 → 실패 시 직접 fetch
    //----------------------------------------------------------------
    async function directFetchFinalUrl(originUrl) {
      try {
        const res = await fetch(originUrl, { method: "GET", redirect: "follow" });
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
        chrome.runtime.sendMessage({ action: "expandUrl", url: originUrl }, response => {
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
      // 먼저 /redirect?external=... 인지 검사
      const rawHref = a.href;
      const realUrl = parseRedirectExternalUrl(rawHref);
  
      getFinalUrl(realUrl, finalUrl => {
        if (finalUrl) {
          a.href = finalUrl;
          // 텍스트 내 한글 있으면 그대로
          const hasKorean = /[\uAC00-\uD7A3]/.test(a.textContent);
          if (!hasKorean) {
            a.textContent = finalUrl;
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
          const newAnchors = div.querySelectorAll('a[href^="http"]');
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
      const divs = node.querySelectorAll
        ? node.querySelectorAll('div[class*="css-6wq60h"][class*="e1i41bku"]')
        : [];
      divs.forEach(d => divObserver.observe(d));
  
      const anchors = node.querySelectorAll
        ? node.querySelectorAll('a[href^="http"]')
        : [];
      anchors.forEach(a => anchorObserver.observe(a));
    }
  
    //----------------------------------------------------------------
    // H. 전체 초기 등록
    //----------------------------------------------------------------
    function registerAll() {
      const allDivs = findInShadow(document, 'div[class*="css-6wq60h"][class*="e1i41bku"]');
      allDivs.forEach(d => divObserver.observe(d));
  
      const allAs = findInShadow(document, 'a[href^="http"]');
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
              if (n.matches?.('div[class*="css-6wq60h"][class*="e1i41bku"]')) {
                divObserver.observe(n);
              }
              if (n.matches?.('a[href^="http"]')) {
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
  