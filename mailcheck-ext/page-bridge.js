// ページ側（MAINワールド）で動く小さなスクリプト。
// Gmailの内部ID（ik）を拡張機能側へ渡すだけで、それ以外は何もしない。
(function () {
  function send() {
    try {
      var ik = window.GLOBALS && window.GLOBALS[9];
      if (ik) window.postMessage({ __mailcheck: true, ik: String(ik) }, location.origin);
    } catch (e) {}
  }
  send();
  setTimeout(send, 2000);
  setTimeout(send, 8000);
  window.addEventListener('message', function (e) {
    if ((e.source === window || e.origin === location.origin) && e.data && e.data.__mailcheck_req) send();
  });
})();
