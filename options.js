// options.js (初期化フラグを導入した最終解決版)
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('site-selection-form');
    const saveButton = document.getElementById('save-settings');
    const confirmationMessage = document.getElementById('save-confirmation');

    // ★★★ ここからが新しいロジックです ★★★
    const initializeSettings = () => {
        // 「設定データ」と「初期化フラグ」の両方を読み込む
        chrome.storage.sync.get(['preferredSites', 'settingsInitialized'], (data) => {

            // もし「初期化フラグ」が存在しないなら、初回起動と判断する
            if (data.settingsInitialized !== true) {
                console.log('【設定ページ】初回起動を検出。全サイト選択の初期設定を強制的に保存します。');
                const allSiteValues = Array.from(form.elements['site']).map(input => input.value);
                
                // 「全サイト選択データ」と「初期化完了フラグ(true)」を同時に保存する
                chrome.storage.sync.set({ 
                    preferredSites: allSiteValues, 
                    settingsInitialized: true 
                }, () => {
                    // 保存完了後、画面に全選択状態を反映
                    checkTheBoxes(allSiteValues);
                    console.log('【設定ページ】初期設定の保存と反映が完了しました。');
                });

            } else {
                // 2回目以降の起動なら、保存されている設定を素直に読み込む
                console.log('【設定ページ】既存の設定を読み込みました:', data.preferredSites);
                checkTheBoxes(data.preferredSites);
            }
        });
    };
    // ★★★ ここまでが新しいロジックです ★★★

    // 渡されたサイトリストに基づいてチェックボックスをON/OFFするシンプルな関数
    const checkTheBoxes = (sitesToEnable) => {
        Array.from(form.elements['site']).forEach(input => {
            input.checked = sitesToEnable.includes(input.value);
        });
    };
    
    // 設定を保存する関数（変更なし）
    const saveSitePreferences = () => {
        const selectedSites = Array.from(form.elements['site'])
            .filter(input => input.checked)
            .map(input => input.value);

        chrome.storage.sync.set({ preferredSites: selectedSites }, () => {
            confirmationMessage.textContent = '設定が反映されました！ (Settings have been saved!)';
            confirmationMessage.style.display = 'block';
            setTimeout(() => { confirmationMessage.style.opacity = '1'; }, 10);
            setTimeout(() => {
                confirmationMessage.style.opacity = '0';
                setTimeout(() => { confirmationMessage.style.display = 'none'; }, 500);
            }, 3000);
        });
    };

    // --- 実行部分 ---
    initializeSettings();
    saveButton.addEventListener('click', (event) => {
        event.preventDefault();
        saveSitePreferences();
    });

    chrome.storage.sync.get({
        preferredSites: [
            'kindle', 'kinokuniya', 'honto', 'tsutaya', 'yodobashi', 'bookoff',
            'valuebooks', 'library', 'nearbyBookstores', 'nearbyBookoff',
            'rakutenBooks', 'rakutenBookoff', 'rakutenValuebooks', 'mercari',
            'rakutenAll', 'bookmeter'
        ]
    }, (data) => {
        const preferredSites = data.preferredSites;
        const checkboxes = document.querySelectorAll('.site-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = preferredSites.includes(checkbox.value);
        });
    });
});