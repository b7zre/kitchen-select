// Kitchen Select カテゴリページ用の表示ロジック（トップページのJSとは独立しています）。
// 外部由来の文字列（商品名・説明など）はすべて textContent で描画し、URLは https のみ許可します。
(function () {
  "use strict";

  const MAX_COMPARE = 3;
  const EXPIRED_COUPON_FLAG = "期限切れクーポン表記あり";
  const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });

  function validHttpsUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function makeTextElement(tag, text, className) {
    const el = document.createElement(tag);
    el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  // トップページと同じ基準で正規化します（JSONの形式は変更しません）。
  function normalize(p, index) {
    return {
      id: index,
      name: p.name,
      category: p.category,
      band: typeof p.band === "string" ? p.band : "",
      price: Number(p.price),
      image: p.image,
      url: p.url,
      reviewAverage: Number.isFinite(Number(p.reviewAverage)) && p.reviewAverage !== null && p.reviewAverage !== "" && Number(p.reviewAverage) > 0 && Number(p.reviewAverage) <= 5 ? Number(p.reviewAverage) : null,
      reviewCount: Number.isInteger(Number(p.reviewCount)) && p.reviewCount !== null && p.reviewCount !== "" && Number(p.reviewCount) >= 0 ? Number(p.reviewCount) : null,
      qualityFlags: Array.isArray(p.qualityFlags) ? [...new Set(p.qualityFlags.filter(f => typeof f === "string" && f.trim()).map(f => f.trim().slice(0, 40)))].slice(0, 5) : [],
      description: typeof p.description === "string" ? p.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000) : ""
    };
  }

  function isValidProduct(p) {
    return p && typeof p.name === "string" && p.name.trim() &&
      typeof p.category === "string" && Number.isFinite(Number(p.price)) && Number(p.price) >= 0;
  }

  function makeReview(p) {
    if (p.reviewAverage === null || p.reviewCount === null || p.reviewCount <= 0) {
      return makeTextElement("p", "レビュー情報なし", "review-unavailable");
    }
    const review = document.createElement("p");
    review.className = "review";
    review.setAttribute("aria-label", `レビュー評価 ${p.reviewAverage.toFixed(1)}点、${p.reviewCount}件`);
    review.append(makeTextElement("span", "★", "star"));
    review.append(makeTextElement("span", `${p.reviewAverage.toFixed(1)} / 5`, "score"));
    review.append(makeTextElement("span", `（${p.reviewCount.toLocaleString("ja-JP")}件）`, "count"));
    return review;
  }

  function makeDescription(p, maxLength) {
    if (!p.description) return makeTextElement("span", "商品説明なし", "review-unavailable");
    const wrapper = document.createElement("div");
    wrapper.className = "description";
    if (p.description.length <= maxLength) {
      wrapper.append(makeTextElement("span", p.description));
      return wrapper;
    }
    wrapper.append(makeTextElement("span", `${p.description.slice(0, maxLength)}…`));
    const details = document.createElement("details");
    details.append(makeTextElement("summary", "商品説明をもっと見る"));
    details.append(makeTextElement("p", p.description));
    wrapper.append(details);
    return wrapper;
  }

  function makeQualityFlags(p, withNote) {
    if (!p.qualityFlags.length) return null;
    const wrapper = document.createElement("div");
    const list = document.createElement("ul");
    list.className = "quality-flags";
    list.setAttribute("aria-label", "価格・構成の注意");
    for (const flag of p.qualityFlags) list.append(makeTextElement("li", `⚠ ${flag}`));
    wrapper.append(list);
    if (withNote) wrapper.append(makeTextElement("p", "表示価格と購入時の価格・構成が異なる場合があります。商品ページでご確認ください。", "quality-note"));
    if (withNote && p.qualityFlags.includes(EXPIRED_COUPON_FLAG)) wrapper.append(makeTextElement("p", "商品名のクーポン表記は掲載期限を過ぎています。現在のクーポンの有無は商品ページでご確認ください。", "quality-note"));
    return wrapper;
  }

  function makeAffiliateLink(p, text) {
    const url = validHttpsUrl(p.url);
    if (!url) return null;
    const link = makeTextElement("a", text, "button");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer sponsored";
    return link;
  }

  function makeImage(p) {
    const url = validHttpsUrl(p.image);
    if (!url) return null;
    const img = document.createElement("img");
    img.src = url;
    img.alt = p.name;
    img.loading = "lazy";
    return img;
  }

  // 任意設定（指定しない場合は従来どおりカテゴリーのみで絞り込みます）:
  //   minPrice / maxPrice … 表示価格で絞り込む（数値のときだけ有効）
  //   label               … 件数表示・該当なし表示で使う名前（省略時は category）
  //   onLoad(products)    … 読み込み成功後に、表示対象商品のコピーを渡して呼び出す
  function withinPrice(p, config) {
    if (Number.isFinite(config.minPrice) && p.price < config.minPrice) return false;
    if (Number.isFinite(config.maxPrice) && p.price > config.maxPrice) return false;
    return true;
  }

  function init(config) {
    const label = typeof config.label === "string" && config.label ? config.label : config.category;
    const root = document.getElementById(config.listId);
    const status = document.getElementById(config.statusId);
    const sortSelect = document.getElementById(config.sortId);
    const comparisonContainer = document.getElementById(config.comparisonId);
    const compareStatus = document.getElementById(config.compareStatusId);
    const clearComparison = document.getElementById(config.clearId);
    const selectedIds = new Set();
    let products = [];

    function makeProductCard(p) {
      const selected = selectedIds.has(p.id);
      const card = document.createElement("article");
      card.className = "product";
      if (selected) card.classList.add("selected");
      const img = makeImage(p);
      if (img) card.append(img);
      card.append(makeTextElement("h4", p.name));
      card.append(makeTextElement("p", yen.format(p.price), "price"));
      const flags = makeQualityFlags(p, true);
      if (flags) card.append(flags);
      card.append(makeReview(p));
      card.append(makeDescription(p, 110));
      const compareButton = makeTextElement("button", selected ? "✓ 比較から外す" : "＋ 比較に追加", "compare-button");
      compareButton.type = "button";
      compareButton.setAttribute("aria-pressed", String(selected));
      compareButton.disabled = !selected && selectedIds.size >= MAX_COMPARE;
      compareButton.addEventListener("click", () => {
        if (selectedIds.has(p.id)) selectedIds.delete(p.id);
        else if (selectedIds.size < MAX_COMPARE) selectedIds.add(p.id);
        render();
      });
      card.append(compareButton);
      const link = makeAffiliateLink(p, "楽天市場で商品を見る");
      if (link) card.append(link);
      return card;
    }

    function sortProducts(list) {
      const sorted = [...list];
      if (sortSelect.value === "price-asc") sorted.sort((a, b) => a.price - b.price);
      else if (sortSelect.value === "price-desc") sorted.sort((a, b) => b.price - a.price);
      return sorted;
    }

    function renderList() {
      root.replaceChildren();
      const knownKeys = new Set(config.bands.map(b => b.key));
      const groups = config.bands.map(b => ({ heading: b.heading, note: b.note, items: products.filter(p => p.band === b.key) }));
      // 想定外の band は捨てずに「その他」へ表示します。
      const others = products.filter(p => !knownKeys.has(p.band));
      if (others.length) groups.push({ heading: "その他", note: "価格帯の情報が想定外の商品です。", items: others });
      for (const group of groups) {
        if (!group.items.length) continue;
        const section = document.createElement("section");
        section.className = "band";
        section.append(makeTextElement("h3", `${group.heading}（${group.items.length}件）`));
        if (group.note) section.append(makeTextElement("p", group.note, "band-note"));
        const grid = document.createElement("div");
        grid.className = "products";
        for (const p of sortProducts(group.items)) grid.append(makeProductCard(p));
        section.append(grid);
        root.append(section);
      }
    }

    function renderComparison() {
      comparisonContainer.replaceChildren();
      const chosen = products.filter(p => selectedIds.has(p.id));
      compareStatus.textContent = chosen.length
        ? `${chosen.length}/${MAX_COMPARE}件を選択中。並べ替えを変えても選択は維持されます。`
        : `一覧から比較したい商品を最大${MAX_COMPARE}件選んでください。`;
      clearComparison.disabled = chosen.length === 0;
      if (!chosen.length) {
        comparisonContainer.append(makeTextElement("p", "比較する商品を選択すると、ここに横並びで表示されます。", "empty"));
        return;
      }
      const table = document.createElement("table");
      table.className = "compare-table";
      const tbody = document.createElement("tbody");
      const fields = [
        ["商品画像", p => makeImage(p) || makeTextElement("span", "画像なし")],
        ["商品名", p => makeTextElement("span", p.name)],
        ["価格帯", p => makeTextElement("span", (config.bands.find(b => b.key === p.band) || { heading: "その他" }).heading)],
        ["価格", p => makeTextElement("span", yen.format(p.price), "compare-price")],
        ["価格・構成の注意", p => makeQualityFlags(p, false) || makeTextElement("span", "特記事項なし", "no-flags")],
        ["レビュー評価", p => makeReview(p)],
        ["商品説明", p => makeDescription(p, 90)],
        ["商品ページ", p => makeAffiliateLink(p, "楽天市場で見る") || makeTextElement("span", "リンクなし")],
        ["選択解除", p => {
          const btn = makeTextElement("button", "この商品を外す");
          btn.type = "button";
          btn.addEventListener("click", () => { selectedIds.delete(p.id); render(); });
          return btn;
        }]
      ];
      for (const [label, makeCellContent] of fields) {
        const row = document.createElement("tr");
        const th = makeTextElement("th", label);
        th.scope = "row";
        row.append(th);
        for (const p of chosen) {
          const td = document.createElement("td");
          td.append(makeCellContent(p));
          row.append(td);
        }
        tbody.append(row);
      }
      table.append(tbody);
      comparisonContainer.append(table);
    }

    function render() {
      renderList();
      status.textContent = `${label}を${products.length}件表示中`;
      status.classList.remove("error");
      renderComparison();
    }

    function showError(message) {
      status.replaceChildren(document.createTextNode(message + " "));
      const link = makeTextElement("a", "トップページの商品一覧を見る");
      link.href = config.topUrl;
      status.append(link);
      status.classList.add("error");
    }

    // ページ側の追加表示（一覧表など）用。失敗しても商品一覧の表示は止めません。
    function notifyLoaded() {
      if (typeof config.onLoad !== "function") return;
      try {
        config.onLoad(products.map(p => ({ ...p, qualityFlags: [...p.qualityFlags] })));
      } catch (error) {
        console.error("onLoad の処理に失敗:", error);
      }
    }

    async function load() {
      try {
        const response = await fetch(config.jsonUrl, { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error("JSONが配列ではありません");
        products = data.filter(isValidProduct).map(normalize)
          .filter(p => p.category === config.category && withinPrice(p, config));
        notifyLoaded();
        if (!products.length) {
          showError(`現在表示できる${label}の商品がありません。`);
          renderComparison();
          return;
        }
        render();
      } catch (error) {
        showError("商品情報を読み込めませんでした。時間をおいて再度お試しください。");
        console.error("商品データの読み込み失敗:", error);
      }
    }

    clearComparison.addEventListener("click", () => { selectedIds.clear(); render(); });
    sortSelect.addEventListener("change", () => { if (products.length) render(); });
    load();
  }

  window.KitchenCatalog = { init };
})();
