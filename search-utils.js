/* Google / DuckDuckGo の検索 URL からキーワードを取り出す。外部送信なし。 */
(function (root) {
  "use strict";

  function getSearchInfo(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return null;

    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const hostname = url.hostname.toLowerCase();
    let engine;

    if (
      /^(?:www\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/.test(hostname) &&
      (url.pathname === "/search" || url.pathname === "/search/")
    ) {
      engine = "Google";
    } else if (hostname === "duckduckgo.com" || hostname.endsWith(".duckduckgo.com")) {
      engine = "DuckDuckGo";
    } else {
      return null;
    }

    const query = url.searchParams.get("q")?.trim();
    if (!query) return null;

    return { engine, query };
  }

  function makeAmazonUrl(query) {
    const url = new URL("https://www.amazon.co.jp/s");
    url.searchParams.set("k", query);
    return url.href;
  }

  function isSameAmazonSearch(rawUrl, query) {
    try {
      const url = new URL(rawUrl);
      return (
        url.protocol === "https:" &&
        (url.hostname === "www.amazon.co.jp" || url.hostname === "amazon.co.jp") &&
        (url.pathname === "/s" || url.pathname === "/s/") &&
        url.searchParams.get("k") === query
      );
    } catch {
      return false;
    }
  }

  root.SearchToAmazon = { getSearchInfo, makeAmazonUrl, isSameAmazonSearch };

  // Node.js で機能をテストできるようにする（Chrome では使われない）。
  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.SearchToAmazon;
  }
})(typeof self !== "undefined" ? self : globalThis);
