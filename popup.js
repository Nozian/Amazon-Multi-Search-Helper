document.addEventListener('DOMContentLoaded', function() {
  // 設定ページを開く
  document.getElementById('openOptions').addEventListener('click', function() {
    chrome.runtime.openOptionsPage();
  });

  // Notionの開発ログを開く
  document.getElementById('openNotion').addEventListener('click', function() {
    chrome.tabs.create({
      url: 'https://water-gorilla-0e5.notion.site/Amazon-Multi-Search-Helper-2058765fc612805ba74ceab750d75c84?source=copy_link'
    });
  });

  // Twitterを開く
  document.getElementById('openTwitter').addEventListener('click', function() {
    chrome.tabs.create({
      url: 'https://x.com/NoizyNozian'
    });
  });

  // ウェブアプリを開く (GitHubリポジトリへ変更)
  document.getElementById('openWebApp').addEventListener('click', function() {
    chrome.tabs.create({
      url: 'https://github.com/Nozian/automatic-memory'
    });
  });
}); 