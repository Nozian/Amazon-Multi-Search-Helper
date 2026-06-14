// メッセージリスナーを設定
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'openOptionsPage') {
        // 拡張機能の設定ページを開く
        chrome.runtime.openOptionsPage();
    }
});
