export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const MAIN_SITE = "https://www.ghotimarket.com";

    // 1. Only allow GET and HEAD requests
    if (request.method !== "GET" && request.method !== "HEAD") {
      return fetch(request);
    }

    // 2. Ignore non-document assets (CSS, JS, Images, Fonts, APIs etc.)
    if (!isDocumentRequest(request, url)) {
      return fetch(request);
    }

    const isCrawler = isSocialCrawler(request);
    const hasMarker = hasTrueMarker(url);

    // =========================================================
    // CASE A & D/E/F/G: SOCIAL CRAWLER (NO REDIRECT EVER)
    // =========================================================
    if (isCrawler) {
      try {
        const pathname = url.pathname;
        const searchParams = url.searchParams;

        // Product Preview for Crawler
        const productInfo = getProductSlug(pathname, searchParams);
        if (productInfo.isProductPage && productInfo.slug) {
          const cleanSlug = removeTrueMarker(productInfo.slug);
          const product = await getProductBySlug(cleanSlug);
          
          if (product && product.active !== false) {
            const html = buildProductHTML(product, url, MAIN_SITE);
            return new Response(request.method === "HEAD" ? null : html, {
              status: 200,
              headers: {
                "Content-Type": "text/html; charset=UTF-8",
                "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
                "X-Robots-Tag": "index, follow",
                "Vary": "User-Agent",
              },
            });
          }
        }

        // Seller/Shop Preview for Crawler
        const sellerInfo = getSellerIdentifier(pathname, searchParams);
        if (sellerInfo.isSellerPage && sellerInfo.identifier) {
          const cleanIdentifierVal = removeTrueMarker(sellerInfo.identifier);
          const seller = await getSeller(cleanIdentifierVal);

          if (seller) {
            const html = buildSellerHTML(seller, url, MAIN_SITE);
            return new Response(request.method === "HEAD" ? null : html, {
              status: 200,
              headers: {
                "Content-Type": "text/html; charset=UTF-8",
                "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
                "X-Robots-Tag": "index, follow",
                "Vary": "User-Agent",
              },
            });
          }
        }
      } catch (error) {
        console.error("GHOTI MARKET Crawler OG Error:", error);
      }

      // If crawler hits but no product/seller matched, just pass-through
      return fetch(request);
    }

    // =========================================================
    // CASE B: NORMAL BROWSER + ALREADY HAS "-true" MARKER
    // =========================================================
    if (hasMarker) {
      return fetch(request);
    }

    // =========================================================
    // CASE A: NORMAL BROWSER + ORIGINAL URL (NEEDS ONE-TIME REDIRECT)
    // =========================================================
    const productInfoCheck = getProductSlug(url.pathname, url.searchParams);
    const sellerInfoCheck = getSellerIdentifier(url.pathname, url.searchParams);

    if (productInfoCheck.isProductPage || sellerInfoCheck.isSellerPage) {
      const newUrl = addTrueMarker(url);
      return Response.redirect(newUrl.toString(), 302);
    }

    // Fallback pass-through for other pages
    return fetch(request);
  },
};

// =============================================================
// DOCUMENT REQUEST CHECK (ASSET / API BYPASS)
// =============================================================

function isDocumentRequest(request, url) {
  const pathname = url.pathname.toLowerCase();
  
  // Skip common static asset extensions
  const ignoredExtensions = [
    ".css", ".js", ".png", ".jpg", ".jpeg", ".webp", ".gif", 
    ".svg", ".ico", ".json", ".xml", ".txt", ".woff", ".woff2", 
    ".ttf", ".map", ".pdf", ".zip"
  ];

  if (ignoredExtensions.some(ext => pathname.endsWith(ext))) {
    return false;
  }

  // Skip API or backend requests
  if (pathname.startsWith("/api/") || pathname.includes("firestore")) {
    return false;
  }

  // Check Accept header for HTML if present
  const acceptHeader = request.headers.get("accept") || "";
  if (acceptHeader && !acceptHeader.includes("text/html") && !acceptHeader.includes("*/*")) {
    return false;
  }

  return true;
}

// =============================================================
// SOCIAL CRAWLER DETECTION
// =============================================================

function isSocialCrawler(request) {
  const userAgent = request.headers.get("user-agent") || "";
  return /facebookexternalhit|Facebot|Twitterbot|Slackbot|TelegramBot|LinkedInBot|Discordbot|Pinterestbot|WhatsApp|SkypeUriPreview|Applebot|vkShare|Embedly|Quora Link Preview|outbrain|W3C_Validator|bot|crawler|spider|preview/i.test(
    userAgent
  );
}

// =============================================================
// "-true" MARKER UTILS
// =============================================================

function hasTrueMarker(url) {
  // Check path parts
  const parts = url.pathname.split("/").filter(Boolean);
  for (const part of parts) {
    if (/-true$/i.test(part)) return true;
  }

  // Check query keys and values
  for (const [key, value] of url.searchParams.entries()) {
    if (/-true$/i.test(key) || /-true$/i.test(value)) {
      return true;
    }
  }

  return false;
}

function removeTrueMarker(value) {
  if (!value) return "";
  return String(value).replace(/-true$/i, "").trim();
}

function addTrueMarker(url) {
  const newUrl = new URL(url.toString());
  const searchParams = newUrl.searchParams;
  let modified = false;

  // 1. Check if there's an empty key slug (e.g. ?tarimmer-vih72aiz)
  const entries = Array.from(searchParams.entries());
  for (const [key, value] of entries) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "fbclid" || lowerKey === "gclid" || lowerKey.startsWith("utm_")) {
      continue;
    }

    if (value === "" && key.trim() && !/-true$/i.test(key)) {
      searchParams.delete(key);
      searchParams.set(`${key}-true`, "");
      modified = true;
      break;
    }
  }

  // 2. Check explicit slug/username parameters if key-only wasn't modified
  if (!modified) {
    for (const paramName of ["slug", "product-slug", "username", "sellerId", "sellerUsername"]) {
      if (searchParams.has(paramName)) {
        const val = searchParams.get(paramName);
        if (val && !/-true$/i.test(val)) {
          searchParams.set(paramName, `${val}-true`);
          modified = true;
          break;
        }
      }
    }
  }

  // 3. Check path-based slug if query wasn't modified
  if (!modified) {
    const parts = newUrl.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const lastPart = parts[parts.length - 1];
      const lower = lastPart.toLowerCase();
      if (!["product", "product.html", "seller", "seller.html", "shop", "shop.html", "profile", "profile.html"].includes(lower)) {
        if (!/-true$/i.test(lastPart)) {
          parts[parts.length - 1] = `${lastPart}-true`;
          newUrl.pathname = "/" + parts.join("/");
          modified = true;
        }
      }
    }
  }

  return newUrl;
}

// =============================================================
// PRODUCT SLUG DETECTION
// =============================================================

function getProductSlug(pathname, searchParams) {
  const cleanPath = pathname.replace(/\/+/g, "/").toLowerCase();
  const isProductPage =
    cleanPath === "/product" ||
    cleanPath === "/product/" ||
    cleanPath === "/product.html" ||
    cleanPath === "/product.html/" ||
    cleanPath.startsWith("/product/") ||
    cleanPath.startsWith("/product.html/");

  if (!isProductPage) {
    return { isProductPage: false, slug: null };
  }

  let slug = searchParams.get("product-slug") || searchParams.get("slug");
  if (slug) {
    return { isProductPage: true, slug: safeDecode(slug).trim() };
  }

  const parts = pathname.replace(/\/+/g, "/").split("/").filter(Boolean);
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    const lowerLastPart = lastPart.toLowerCase();
    if (lowerLastPart !== "product" && lowerLastPart !== "product.html") {
      return { isProductPage: true, slug: safeDecode(lastPart).trim() };
    }
  }

  for (const [key, value] of searchParams.entries()) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "fbclid" || lowerKey === "gclid" || lowerKey.startsWith("utm_")) {
      continue;
    }
    if (value === "" && key.trim()) {
      return { isProductPage: true, slug: safeDecode(key).trim() };
    }
  }

  return { isProductPage: true, slug: null };
}

// =============================================================
// GET PRODUCT FROM FIRESTORE
// =============================================================

async function getProductBySlug(slug) {
  try {
    const FIRESTORE_BASE = "https://firestore.googleapis.com/v1/projects/ghotimarket/databases/(default)/documents";
    const queryUrl = `${FIRESTORE_BASE.replace("/documents", "/documents:runQuery")}`;

    const body = {
      structuredQuery: {
        from: [{ collectionId: "products" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "slug" },
            op: "EQUAL",
            value: { stringValue: slug },
          },
        },
        limit: 1,
      },
    };

    const response = await fetch(queryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) return null;

    const result = await response.json();
    const document = result?.find(item => item?.document?.fields)?.document;
    if (!document) return null;

    const fields = document.fields;
    const DEFAULT_IMAGE = "https://i.ibb.co/RG2hrf3y/background-remove-ghoti-market.png";

    return {
      name: getString(fields.name) || "GHOTI MARKET Product",
      description: getString(fields.description) || "GHOTI MARKET থেকে সেরা দামে পণ্য কিনুন।",
      slug: getString(fields.slug) || slug,
      price: getNumber(fields.price),
      oldPrice: getNumber(fields.oldPrice),
      image: getFirstArrayString(fields.images) || DEFAULT_IMAGE,
      active: getBoolean(fields.active, true),
      shopName: getString(fields.shopName) || "GHOTI MARKET Seller",
    };
  } catch (error) {
    return null;
  }
}

// =============================================================
// SELLER IDENTIFIER DETECTION
// =============================================================

function getSellerIdentifier(pathname, searchParams) {
  const cleanPath = pathname.replace(/\/+/g, "/").toLowerCase();
  const parts = cleanPath.split("/").filter(Boolean);
  const sellerPaths = ["seller", "seller.html", "shop", "shop.html", "profile", "profile.html"];
  const firstPart = parts[0] || "";

  if (!sellerPaths.includes(firstPart)) {
    return { isSellerPage: false, identifier: null };
  }

  let identifier = searchParams.get("sellerId") || searchParams.get("username") || searchParams.get("sellerUsername");
  if (identifier) {
    return { isSellerPage: true, identifier: cleanIdentifier(identifier) };
  }

  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    if (lastPart && !sellerPaths.includes(lastPart)) {
      return { isSellerPage: true, identifier: cleanIdentifier(lastPart) };
    }
  }

  for (const [key, value] of searchParams.entries()) {
    const cleanKey = safeDecode(key).trim();
    const lowerKey = cleanKey.toLowerCase();
    if (lowerKey === "fbclid" || lowerKey === "gclid" || lowerKey.startsWith("utm_")) continue;
    if (cleanKey.startsWith("@")) return { isSellerPage: true, identifier: cleanIdentifier(cleanKey) };
    if (value === "" && cleanKey) return { isSellerPage: true, identifier: cleanIdentifier(cleanKey) };
  }

  return { isSellerPage: true, identifier: null };
}

// =============================================================
// GET SELLER FROM FIRESTORE
// =============================================================

async function getSeller(identifier) {
  try {
    const FIRESTORE_BASE = "https://firestore.googleapis.com/v1/projects/ghotimarket/databases/(default)/documents";
    let response = await fetch(`${FIRESTORE_BASE}/public_sellers/${encodeURIComponent(identifier)}`);
    let data = await response.json();
    if (data?.fields) return normalizeSeller(data.fields, identifier);

    response = await fetch(`${FIRESTORE_BASE}/users/${encodeURIComponent(identifier)}`);
    data = await response.json();
    if (data?.fields) return normalizeSeller(data.fields, identifier);

    const queryUrl = `${FIRESTORE_BASE.replace("/documents", "/documents:runQuery")}`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: "users" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "username" },
            op: "EQUAL",
            value: { stringValue: identifier },
          },
        },
        limit: 1,
      },
    };

    response = await fetch(queryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) return null;
    const result = await response.json();
    const document = result?.find(item => item?.document?.fields)?.document;
    if (!document) return null;

    return normalizeSeller(document.fields, identifier);
  } catch (error) {
    return null;
  }
}

function normalizeSeller(fields, identifier) {
  const DEFAULT_IMAGE = "https://i.ibb.co/RG2hrf3y/background-remove-ghoti-market.png";
  return {
    identifier,
    name: getString(fields.shopName) || getString(fields.name) || "GHOTI MARKET Seller",
    description: getString(fields.shopDescription) || getString(fields.description) || "GHOTI MARKET-এ এই Seller-এর পণ্য দেখুন।",
    logo: getString(fields.shopLogo) || getString(fields.photoURL) || DEFAULT_IMAGE,
    banner: getString(fields.shopBanner) || getString(fields.banner) || getString(fields.shopLogo) || getString(fields.photoURL) || DEFAULT_IMAGE,
    username: getString(fields.username) || identifier,
  };
}

// =============================================================
// HTML BUILDERS (WITH CLEAN CANONICAL URLS)
// =============================================================

function buildProductHTML(product, url, mainSite) {
  const title = `${product.name} - ৳${formatPrice(product.price)} | GHOTI MARKET`;
  const description = truncate(stripHTML(product.description), 160);
  const image = product.image || "https://i.ibb.co/RG2hrf3y/background-remove-ghoti-market.png";
  
  // Clean canonical and og:url (removing -true marker for SEO)
  const cleanSearch = new URLSearchParams(url.search);
  for (const [key, value] of Array.from(cleanSearch.entries())) {
    if (/-true$/i.test(key)) {
      cleanSearch.delete(key);
      cleanSearch.set(removeTrueMarker(key), value);
    }
    if (/-true$/i.test(value)) {
      cleanSearch.set(key, removeTrueMarker(value));
    }
  }
  let cleanSearchStr = cleanSearch.toString();
  cleanSearchStr = cleanSearchStr ? `?${cleanSearchStr}` : "";
  const canonical = `${mainSite}${url.pathname}${cleanSearchStr}`;

  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHTML(title)}</title>
<meta name="description" content="${escapeAttr(description)}">
<link rel="canonical" href="${escapeAttr(canonical)}">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:image" content="${escapeAttr(image)}">
<meta property="og:url" content="${escapeAttr(canonical)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="GHOTI MARKET">
<meta property="product:price:amount" content="${escapeAttr(String(product.price))}">
<meta property="product:price:currency" content="BDT">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(title)}">
<meta name="twitter:description" content="${escapeAttr(description)}">
<meta name="twitter:image" content="${escapeAttr(image)}">
</head>
<body>
<h1>${escapeHTML(product.name)}</h1>
<p>${escapeHTML(description)}</p>
<img src="${escapeAttr(image)}" alt="${escapeAttr(product.name)}" width="1200" height="630">
</body>
</html>`;
}

function buildSellerHTML(seller, url, mainSite) {
  const title = `${seller.name} | GHOTI MARKET`;
  const description = truncate(stripHTML(seller.description), 160);
  const image = seller.banner || seller.logo || "https://i.ibb.co/RG2hrf3y/background-remove-ghoti-market.png";
  
  const cleanSearch = new URLSearchParams(url.search);
  for (const [key, value] of Array.from(cleanSearch.entries())) {
    if (/-true$/i.test(key)) {
      cleanSearch.delete(key);
      cleanSearch.set(removeTrueMarker(key), value);
    }
    if (/-true$/i.test(value)) {
      cleanSearch.set(key, removeTrueMarker(value));
    }
  }
  let cleanSearchStr = cleanSearch.toString();
  cleanSearchStr = cleanSearchStr ? `?${cleanSearchStr}` : "";
  const canonical = `${mainSite}${url.pathname}${cleanSearchStr}`;

  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHTML(title)}</title>
<meta name="description" content="${escapeAttr(description)}">
<link rel="canonical" href="${escapeAttr(canonical)}">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:image" content="${escapeAttr(image)}">
<meta property="og:url" content="${escapeAttr(canonical)}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="GHOTI MARKET">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(title)}">
<meta name="twitter:description" content="${escapeAttr(description)}">
<meta name="twitter:image" content="${escapeAttr(image)}">
</head>
<body>
<h1>${escapeHTML(seller.name)}</h1>
<p>${escapeHTML(description)}</p>
<img src="${escapeAttr(image)}" alt="${escapeAttr(seller.name)}" width="1200" height="630">
</body>
</html>`;
}

// =============================================================
// FIRESTORE FIELD HELPERS
// =============================================================

function getString(field) { return field?.stringValue ?? ""; }
function getNumber(field) { return field?.integerValue ?? field?.doubleValue ?? ""; }
function getBoolean(field, fallback = false) { return field?.booleanValue ?? fallback; }
function getFirstArrayString(field) {
  if (!field?.arrayValue?.values) return "";
  for (const item of field.arrayValue.values) {
    if (item?.stringValue) return item.stringValue;
  }
  return "";
}

// =============================================================
// STRING & SECURITY HELPERS
// =============================================================

function escapeHTML(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeAttr(value) { return escapeHTML(value); }
function stripHTML(value) { return String(value ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(); }
function truncate(value, maxLength) {
  const text = String(value ?? "").trim();
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}
function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}
function cleanIdentifier(value) {
  return safeDecode(String(value ?? "")).trim().replace(/^@+/, "");
}
function formatPrice(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString("en-US");
}
