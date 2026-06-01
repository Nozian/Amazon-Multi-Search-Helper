// content_amazon.js (デバッグログ機能付き 最終確定版)

/**
 * 検索リンク(<a>タグ)を生成する関数
 * @param {string} name - サイト名
 * @param {string} baseUrl - ベースURL
 * @param {string} queryParamOrPath - クエリパラメータまたはパスのテンプレート
 * @param {string} note - ボタンの注釈
 * @param {string} bookTitle - 検索する本のタイトル
 * @returns {HTMLAnchorElement} - 生成された<a>要素
 */
function createExternalSearchLink(name, baseUrl, queryParamOrPath, note, bookTitle) {
    const cleanedTitle = bookTitle.replace(/(\s*\(.*\)|\[.*\]|【.*】|\s*第?\d+巻)/g, '').trim();
    const encodedTitle = encodeURIComponent(cleanedTitle);
    let searchUrl;

    if (queryParamOrPath.includes('【検索語句】')) {
        searchUrl = baseUrl + queryParamOrPath.replace('【検索語句】', encodedTitle);
    } else {
        searchUrl = `${baseUrl}?${queryParamOrPath}=${encodedTitle}`;
    }

    const link = document.createElement('a');
    link.href = searchUrl;
    link.textContent = name;
    link.title = note || `「${bookTitle}」を${name}で検索`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    if (name.includes('Kindle')) link.title += ' Kindle';
    if (name.includes('図書館')) link.title += ' 図書館';
    if (name.includes('ブックオフ') || name.includes('バリューブックス') || name.includes('メルカリ')) link.title += ' 中古';

    return link;
}

function getPageType() {
    const url = window.location.href;
    if (url.includes('/wishlist/') || url.includes('/hz/wishlist/')) {
        return 'wishlist';
    } else if (url.includes('/s?') || url.includes('/s/ref=') || url.includes('/s?k=')) {
        return 'search_results';
    } else if (url.includes('/dp/') || url.includes('/gp/product/')) {
        return 'product_detail';
    } else if (url.includes('/gp/cart') || url.includes('/buy/signin')) {
        return 'cart';
    } else if (url.includes('/s')) {
        return 'search_results';
    }
    return 'unknown';
}

function extractBookTitleFromProductPage() {
    const titleSelectors = [
        '#productTitle', '#ebooksProductTitle', 'h1#title',
        '.parseasinTitle #btAsinTitle', 'span[data-hook="product-title"]'
    ];
    for (const selector of titleSelectors) {
        const titleElement = document.querySelector(selector);
        if (titleElement) return titleElement.textContent.trim();
    }
    return null;
}

function getAttachElementAndTitleForSearchItem(searchItemElement) {
    const titleSelectors = [
        'h2 a span.a-text-normal', '.s-title-instructions-style span.a-text-normal',
        '.a-size-medium.a-color-base.a-text-normal', '.a-size-base-plus.a-color-base.a-text-normal',
        '.a-link-normal.s-underline-text.s-underline-link-text.s-link-style.a-text-normal'
    ];
    let title = null;
    for (const selector of titleSelectors) {
        const titleElement = searchItemElement.querySelector(selector);
        if (titleElement) {
            title = titleElement.textContent.trim();
            break;
        }
    }
    const attachPointSelectors = [
        '.a-section.a-spacing-small.a-spacing-top-small', '.a-row.a-spacing-micro',
        '.s-price-instructions-style', '.sg-col-inner', '.a-section.a-spacing-none.a-spacing-top-small',
        '.a-row.a-spacing-base'
    ];
    let attachElement = null;
    for (const selector of attachPointSelectors) {
        attachElement = searchItemElement.querySelector(selector);
        if (attachElement) break;
    }
    return { title, attachElement: attachElement || searchItemElement };
}

function getAttachElementAndTitleForWishlistItem(itemElement) {
    const titleSelectors = [
        'a[id^="itemName_"]', 'a[id*="itemName"]', 'h2 a',
        '.a-link-normal[title]', '.a-text-normal', '.a-size-base-plus'
    ];
    let title = null;
    for (const selector of titleSelectors) {
        const titleElement = itemElement.querySelector(selector);
        if (titleElement) {
            title = titleElement.textContent.trim() || titleElement.getAttribute('title')?.trim();
            if (title) break;
        }
    }
    if (!title) {
        const img = itemElement.querySelector('img');
        if (img) title = img.getAttribute('alt') || img.getAttribute('aria-label');
    }
    const attachPointSelectors = [
        '.item-action-buttons', '.a-fixed-left-grid-col.a-col-right',
        '.a-row.item-main-price-info-spacing-top', '.g-item-sortable', '.a-box-inner'
    ];
    let attachElement = null;
    for (const selector of attachPointSelectors) {
        attachElement = itemElement.querySelector(selector);
        if (attachElement) break;
    }
    return { title, attachElement: attachElement || itemElement };
}

function getAttachElementAndTitleForCartItem(cartItemElement) {
    const titleSelectors = [
        'span.sc-product-title', 'span[data-action="atc-title"]', 'a.sc-product-link',
        'span.a-truncate-full', '.a-size-medium.a-color-base.sc-product-title',
        'span.sc-a-size-base-plus.sc-product-title'
    ];
    let title = null;
    for (const selector of titleSelectors) {
        const titleElement = cartItemElement.querySelector(selector);
        if (titleElement) {
            title = titleElement.textContent.trim() || titleElement.getAttribute('title')?.trim();
            if (title) break;
        }
    }
    const attachPointSelectors = [
        '.sc-action-unit', '.sc-list-item-content', '.a-accordion-content',
        '.sc-list-item-col-right', '.a-spacing-base.a-spacing-top-base'
    ];
    let attachElement = null;
    for (const selector of attachPointSelectors) {
        attachElement = cartItemElement.querySelector(selector);
        if (attachElement) break;
    }
    return { title, attachElement: attachElement || cartItemElement };
}

async function getSearchServices() {
    return new Promise((resolve) => {
        // このリストは固定なので変更しません
        const services = [
            { id: 'kindle', name: 'Kindle', enabled: true, baseUrl: 'https://www.amazon.co.jp/s', queryParamOrPath: 'k', note: 'Amazon Kindle版を検索' },
            { id: 'kinokuniya', name: '紀伊國屋', enabled: true, baseUrl: 'https://www.kinokuniya.co.jp/disp/CSfDispListPage_001.jsp', queryParam: 'q', note: '紀伊國屋書店で検索' },
            { id: 'honto', name: 'honto', enabled: true, baseUrl: 'https://honto.jp/netstore/search.html', queryParam: 'k', note: 'hontoで検索（紙・電子・店舗在庫横断）' },
            { id: 'tsutaya', name: 'TSUTAYA', enabled: true, baseUrl: 'https://store-tsutaya.tsite.jp/search/result/', queryParam: 'keyword', note: 'TSUTAYAオンラインで検索' },
            { id: 'yodobashi', name: 'ヨドバシ', enabled: true, baseUrl: 'https://www.yodobashi.com/', queryParam: 'word', note: 'ヨドバシ.comで検索' },
            { id: 'bookoff', name: 'ブックオフ', enabled: true, baseUrl: 'https://shopping.bookoff.co.jp/search/keyword/', queryParamOrPath: '【検索語句】', note: 'ブックオフオンラインで検索' },
            { id: 'valuebooks', name: 'バリューブックス', enabled: true, baseUrl: 'https://www.valuebooks.jp/search', queryParam: 'keyword', note: 'バリューブックスで検索' },
            { id: 'library', name: '図書館', enabled: true, baseUrl: 'https://calil.jp/search', queryParam: 'q', note: 'カーリルで図書館を横断検索' },
            { id: 'nearbyBookstores', name: '近くの書店', enabled: true, baseUrl: 'https://www.google.com/maps/search/', queryParamOrPath: '【検索語句】+書店', note: 'Googleマップで近くの書店を検索' },
            { id: 'nearbyBookoff', name: '近くのブックオフ', enabled: true, baseUrl: 'https://www.google.com/maps/search/', queryParamOrPath: '【検索語句】+ブックオフ', note: 'Googleマップで近くのブックオフを検索' },
            { id: 'rakutenBooks', name: '楽天ブックス', enabled: true, baseUrl: 'https://books.rakuten.co.jp/search', queryParam: 'sitem', note: '楽天ブックスで検索' },
            { id: 'rakutenBookoff', name: '楽天ブックオフ', enabled: true, baseUrl: 'https://search.rakuten.co.jp/search/mall/', queryParamOrPath: '【検索語句】/?sid=275488', note: '楽天市場のブックオフ支店で検索' },
            { id: 'rakutenValuebooks', name: '楽天バリューブックス', enabled: true, baseUrl: 'https://search.rakuten.co.jp/search/mall/', queryParamOrPath: '【検索語句】/?sid=273418', note: '楽天市場のバリューブックス支店で検索' },
            { id: 'mercari', name: 'メルカリ', enabled: true, baseUrl: 'https://jp.mercari.com/search', queryParam: 'keyword', note: 'メルカリで中古本を検索' },
            { id: 'rakutenAll', name: '楽天市場全体', enabled: true, baseUrl: 'https://search.rakuten.co.jp/search/mall/', queryParamOrPath: '【検索語句】/', note: '楽天市場全体で検索' },
            { id: 'bookmeter', name: '読書メーター', enabled: true, baseUrl: 'https://bookmeter.com/search', queryParam: 'keyword', note: '読書メーターで読書レビューを検索' }
        ];
        resolve(services);
    });
}

async function getPreferredSites() {
    return new Promise((resolve) => {
        const defaultSites = [
            'kindle', 'kinokuniya', 'honto', 'tsutaya', 'yodobashi', 'bookoff',
            'valuebooks', 'library', 'nearbyBookstores', 'nearbyBookoff',
            'rakutenBooks', 'rakutenBookoff', 'rakutenValuebooks', 'mercari',
            'rakutenAll', 'bookmeter'
        ];
        // ★ ログ3: Amazonページで、これから設定を読み込むことを宣言
        console.log('【Amazonページ】これから設定をストレージから読み込みます...');
        chrome.storage.sync.get({ preferredSites: defaultSites }, (data) => {
            // ★ ログ4: 実際にストレージから読み込んだ設定内容を表示
            console.log('【Amazonページ】読み込んだ設定:', data.preferredSites);
            resolve(data.preferredSites || []);
        });
    });
}

async function filterSearchServicesByPreferences() {
    const allServices = await getSearchServices();
    const preferredSites = await getPreferredSites();

    const filteredServices = allServices.filter(service => preferredSites.includes(service.id));

    // ★ ログ5: 最終的にどのボタンを表示することになったかを表示
    console.log('【Amazonページ】最終的に表示するボタン:', filteredServices.map(s => s.name));

    return filteredServices;
}

function addSearchButtons(bookTitle, attachToElement, pageType, insertionMethod = 'append') {
    if (!bookTitle || !attachToElement || attachToElement.querySelector('.multi-search-buttons-container')) {
        return;
    }

    const allButtonsContainer = document.createElement('div');
    allButtonsContainer.className = 'multi-search-buttons-container';

    filterSearchServicesByPreferences().then(enabledServices => {
        if (enabledServices.length === 0) {
            return;
        }

        enabledServices.forEach(service => {
            const searchLink = createExternalSearchLink(
                service.name,
                service.baseUrl,
                service.queryParamOrPath || service.queryParam,
                service.note,
                bookTitle
            );
            if (searchLink) {
                allButtonsContainer.appendChild(searchLink);
            }
        });

        if (allButtonsContainer.hasChildNodes()) {
            if (insertionMethod === 'prepend') {
                attachToElement.prepend(allButtonsContainer);
            } else {
                attachToElement.appendChild(allButtonsContainer);
            }
        }
    }).catch(error => {
        console.error("Amazon Multi-Search Helper: Error fetching enabled services:", error);
    });
}

let mainProcessingDebounceTimer;

function runMainProcessing() {
    const page = getPageType();

    if (page === 'wishlist') {
        document.querySelectorAll('div[data-item-index], li[data-itemid], .g-item-sortable').forEach(itemElement => {
            const { title, attachElement } = getAttachElementAndTitleForWishlistItem(itemElement);
            if (title && attachElement) addSearchButtons(title, attachElement, 'wishlist');
        });
    } else if (page === 'search_results') {
        document.querySelectorAll('.s-result-item[data-component-type="s-search-result"], div[data-asin][data-index]').forEach(itemElement => {
            const { title, attachElement } = getAttachElementAndTitleForSearchItem(itemElement);
            if (title && attachElement) addSearchButtons(title, attachElement, 'search_results');
        });
    } else if (page === 'product_detail') {
        const bookTitle = extractBookTitleFromProductPage();
        if (bookTitle) {
            const attachPointSelectors = [
                '#buybox_feature_div .a-box-inner',
                '#desktop_buybox',
                '#buybox',
                '#centerCol'
            ];
            let attachPoint = null;
            for (const selector of attachPointSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    attachPoint = element;
                    break;
                }
            }
            if (attachPoint) {
                addSearchButtons(bookTitle, attachPoint, 'product_detail', 'prepend');
            }
        }
    } else if (page === 'cart') {
        document.querySelectorAll('.sc-list-item, div[data-item-id]').forEach(itemElement => {
            const { title, attachElement } = getAttachElementAndTitleForCartItem(itemElement);
            if (title && attachElement) {
                addSearchButtons(title, attachElement, 'cart');
            }
        });
    }
}

function debouncedMainProcessing() {
    clearTimeout(mainProcessingDebounceTimer);
    mainProcessingDebounceTimer = setTimeout(runMainProcessing, 750);
}

if (document.readyState === "complete" || document.readyState === "interactive") {
    debouncedMainProcessing();
} else {
    document.addEventListener("DOMContentLoaded", debouncedMainProcessing);
}

const observer = new MutationObserver(() => debouncedMainProcessing());
const observerTarget = document.getElementById('a-page') || document.body;
observer.observe(observerTarget, { childList: true, subtree: true });

let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        debouncedMainProcessing();
    }
}).observe(document, { subtree: true, childList: true });

console.log("Amazon Multi-Search Helper content script loaded.");