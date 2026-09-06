export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // =========================================================
    // CONFIG
    // =========================================================

    const PROJECT_ID = "ghotimarket";
    const MAIN_SITE = "https://www.ghotimarket.com";

    const DEFAULT_PRODUCT_IMAGE =
      "https://i.ibb.co/RG2hrf3y/background-remove-ghoti-market.png";

    const DEFAULT_SELLER_IMAGE =
      "https://i.ibb.co/RG2hrf3y/background-remove-ghoti-market.png";

    const FIRESTORE_BASE =
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

    // =========================================================
    // REQUEST / BOT DETECTION
    // =========================================================

    const userAgent = request.headers.get("user-agent") || "";

    const isBot =
      /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Slackbot|SkypeUriPreview|Pinterest|Applebot|Googlebot|Google-InspectionTool|bingbot|Discordbot|redditbot|vkShare|Embedly|Quora Link Preview|outbrain|W3C_Validator/i.test(
        userAgent
      );

    // Only GET/HEAD should be processed.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return fetch(request);
    }

    // =========================================================
    // BOT → GENERATE OG HTML
    // =========================================================

    if (isBot) {
      try {
        const pathname = url.pathname.toLowerCase();
        const searchParams = url.searchParams;

        // =====================================================
        // 1. PRODUCT PAGE DETECTION
        // =====================================================

        const productInfo = getProductSlug(pathname, searchParams);

        if (productInfo.isProductPage && productInfo.slug) {
          const product = await getProductBySlug(productInfo.slug);

          if (product) {
            const html = buildProductHTML(product, url, MAIN_SITE);

            return new Response(html, {
              status: 200,
              headers: {
                "Content-Type": "text/html; charset=UTF-8",
                "Cache-Control":
                  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
                "X-Robots-Tag": "index, follow",
              },
            });
          }
        }

        // =====================================================
        // 2. SELLER / SHOP / PROFILE PAGE DETECTION
        // =====================================================

        const sellerInfo = getSellerIdentifier(pathname, searchParams);

        if (sellerInfo.isSellerPage && sellerInfo.identifier) {
          const seller = await getSeller(sellerInfo.identifier);

          if (seller) {
            const html = buildSellerHTML(seller, url, MAIN_SITE);

            return new Response(html, {
              status: 200,
              headers: {
                "Content-Type": "text/html; charset=UTF-8",
                "Cache-Control":
                  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
                "X-Robots-Tag": "index, follow",
              },
            });
          }
        }
      } catch (error) {
        console.error("GHOTI MARKET OG Worker Error:", error);
      }
    }

    // =========================================================
    // 3. NORMAL USERS → WWW REDIRECT
    // =========================================================

    const redirectUrl =
      MAIN_SITE + url.pathname + url.search;

    return Response.redirect(redirectUrl, 302);
  },
};


// =============================================================
// PRODUCT SLUG DETECTION
// =============================================================

function getProductSlug(pathname, searchParams) {
  const cleanPath = pathname.replace(/\/+/g, "/");

  const isProductPage =
    cleanPath.includes("/product") ||
    cleanPath.includes("/product.html");

  if (!isProductPage) {
    return {
      isProductPage: false,
      slug: null,
    };
  }

  // -----------------------------------------------------------
  // Case 1:
  // /product?product-slug=iphone-15
  // /product?slug=iphone-15
  // -----------------------------------------------------------

  let slug =
    searchParams.get("product-slug") ||
    searchParams.get("slug");

  if (slug) {
    return {
      isProductPage: true,
      slug: safeDecode(slug).trim(),
    };
  }

  // -----------------------------------------------------------
  // Case 2:
  // /product/iphone-15
  // /product.html/iphone-15
  // -----------------------------------------------------------

  const parts = cleanPath
    .split("/")
    .filter(Boolean);

  const lastPart = parts[parts.length - 1];

  if (
    lastPart &&
    ![
      "product",
      "product.html",
    ].includes(lastPart)
  ) {
    return {
      isProductPage: true,
      slug: safeDecode(lastPart).trim(),
    };
  }

  // -----------------------------------------------------------
  // Case 3:
  // /product?iphone-15
  // -----------------------------------------------------------

  for (const [key, value] of searchParams.entries()) {
    const lowerKey = key.toLowerCase();

    if (
      lowerKey === "fbclid" ||
      lowerKey === "gclid" ||
      lowerKey.startsWith("utm_")
    ) {
      continue;
    }

    if (value === "" && key.trim()) {
      return {
        isProductPage: true,
        slug: safeDecode(key).trim(),
      };
    }
  }

  return {
    isProductPage: true,
    slug: null,
  };
}


// =============================================================
// PRODUCT FIRESTORE QUERY
// =============================================================

async function getProductBySlug(slug) {
  try {
    const queryUrl =
      "https://firestore.googleapis.com/v1/projects/" +
      "ghotimarket/databases/(default)/documents:runQuery";

    const body = {
      structuredQuery: {
        from: [
          {
            collectionId: "products",
          },
        ],

        where: {
          fieldFilter: {
            field: {
              fieldPath: "slug",
            },
            op: "EQUAL",
            value: {
              stringValue: slug,
            },
          },
        },

        limit: 1,
      },
    };

    const response = await fetch(queryUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(
        "Product Firestore Error:",
        response.status
      );

      return null;
    }

    const result = await response.json();

    const document = result?.find(
      (item) => item?.document?.fields
    )?.document;

    if (!document) {
      return null;
    }

    const fields = document.fields;

    return {
      name:
        getString(fields.name) ||
        "GHOTI MARKET Product",

      description:
        getString(fields.description) ||
        "GHOTI MARKET থেকে সেরা দামে পণ্য কিনুন।",

      slug:
        getString(fields.slug) ||
        slug,

      price:
        getNumber(fields.price),

      oldPrice:
        getNumber(fields.oldPrice),

      image:
        getFirstArrayString(fields.images) ||
        DEFAULT_PRODUCT_IMAGE,

      active:
        getBoolean(fields.active, true),

      shopName:
        getString(fields.shopName) ||
        "GHOTI MARKET Seller",
    };
  } catch (error) {
    console.error("getProductBySlug Error:", error);
    return null;
  }
}


// =============================================================
// SELLER IDENTIFIER DETECTION
// =============================================================

function getSellerIdentifier(pathname, searchParams) {
  const cleanPath = pathname.replace(/\/+/g, "/");

  const parts = cleanPath
    .split("/")
    .filter(Boolean);

  const sellerPaths = [
    "seller",
    "seller.html",
    "shop",
    "shop.html",
    "profile",
    "profile.html",
  ];

  const firstPart = parts[0] || "";

  const isSellerPage =
    sellerPaths.includes(firstPart);

  if (!isSellerPage) {
    return {
      isSellerPage: false,
      identifier: null,
    };
  }

  // -----------------------------------------------------------
  // Case 1:
  // ?sellerId=abc
  // ?username=abc
  // -----------------------------------------------------------

  let identifier =
    searchParams.get("sellerId") ||
    searchParams.get("username");

  if (identifier) {
    return {
      isSellerPage: true,
      identifier: cleanIdentifier(identifier),
    };
  }

  // -----------------------------------------------------------
  // Case 2:
  // /seller/abc
  // /shop/abc
  // /profile/abc
  // -----------------------------------------------------------

  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];

    if (
      lastPart &&
      !sellerPaths.includes(lastPart)
    ) {
      return {
        isSellerPage: true,
        identifier: cleanIdentifier(lastPart),
      };
    }
  }

  // -----------------------------------------------------------
  // Case 3:
  // ?@username
  // ?username
  // -----------------------------------------------------------

  for (const [key, value] of searchParams.entries()) {
    const cleanKey = safeDecode(key).trim();

    const lowerKey = cleanKey.toLowerCase();

    if (
      lowerKey === "fbclid" ||
      lowerKey === "gclid" ||
      lowerKey.startsWith("utm_")
    ) {
      continue;
    }

    if (cleanKey.startsWith("@")) {
      return {
        isSellerPage: true,
        identifier: cleanIdentifier(cleanKey),
      };
    }

    if (value === "" && cleanKey) {
      return {
        isSellerPage: true,
        identifier: cleanIdentifier(cleanKey),
      };
    }
  }

  return {
    isSellerPage: true,
    identifier: null,
  };
}


// =============================================================
// GET SELLER
// =============================================================

async function getSeller(identifier) {
  try {
    // ---------------------------------------------------------
    // 1. public_sellers/{identifier}
    // ---------------------------------------------------------

    let response = await fetch(
      `${FIRESTORE_BASE}/public_sellers/${encodeURIComponent(identifier)}`
    );

    let data = await response.json();

    if (data?.fields) {
      return normalizeSeller(data.fields, identifier);
    }

    // ---------------------------------------------------------
    // 2. users/{identifier}
    // ---------------------------------------------------------

    response = await fetch(
      `${FIRESTORE_BASE}/users/${encodeURIComponent(identifier)}`
    );

    data = await response.json();

    if (data?.fields) {
      return normalizeSeller(data.fields, identifier);
    }

    // ---------------------------------------------------------
    // 3. Search users where username == identifier
    // ---------------------------------------------------------

    const queryUrl =
      "https://firestore.googleapis.com/v1/projects/" +
      "ghotimarket/databases/(default)/documents:runQuery";

    const body = {
      structuredQuery: {
        from: [
          {
            collectionId: "users",
          },
        ],

        where: {
          fieldFilter: {
            field: {
              fieldPath: "username",
            },
            op: "EQUAL",
            value: {
              stringValue: identifier,
            },
          },
        },

        limit: 1,
      },
    };

    response = await fetch(queryUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return null;
    }

    const result = await response.json();

    const document = result?.find(
      (item) => item?.document?.fields
    )?.document;

    if (!document) {
      return null;
    }

    return normalizeSeller(
      document.fields,
      identifier
    );
  } catch (error) {
    console.error("getSeller Error:", error);
    return null;
  }
}


// =============================================================
// NORMALIZE SELLER
// =============================================================

function normalizeSeller(fields, identifier) {
  return {
    identifier,

    name:
      getString(fields.shopName) ||
      getString(fields.name) ||
      "GHOTI MARKET Seller",

    description:
      getString(fields.shopDescription) ||
      getString(fields.description) ||
      "GHOTI MARKET-এ এই Seller-এর পণ্য দেখুন।",

    logo:
      getString(fields.shopLogo) ||
      getString(fields.photoURL) ||
      DEFAULT_SELLER_IMAGE,

    banner:
      getString(fields.shopBanner) ||
      getString(fields.banner) ||
      getString(fields.shopLogo) ||
      getString(fields.photoURL) ||
      DEFAULT_SELLER_IMAGE,

    username:
      getString(fields.username) ||
      identifier,
  };
}


// =============================================================
// PRODUCT HTML
// =============================================================

function buildProductHTML(product, url, mainSite) {
  const title =
    `${product.name} - ৳${formatPrice(product.price)} | GHOTI MARKET`;

  const description =
    truncate(
      stripHTML(product.description),
      160
    );

  const image =
    product.image || DEFAULT_PRODUCT_IMAGE;

  const canonical =
    `${mainSite}${url.pathname}${url.search}`;

  return `<!DOCTYPE html>
<html lang="bn">
<head>

<meta charset="UTF-8">

<meta name="viewport"
      content="width=device-width, initial-scale=1.0">

<title>${escapeHTML(title)}</title>

<meta name="description"
      content="${escapeAttr(description)}">

<link rel="canonical"
      href="${escapeAttr(canonical)}">

<!-- Open Graph -->

<meta property="og:title"
      content="${escapeAttr(title)}">

<meta property="og:description"
      content="${escapeAttr(description)}">

<meta property="og:image"
      content="${escapeAttr(image)}">

<meta property="og:url"
      content="${escapeAttr(canonical)}">

<meta property="og:type"
      content="product">

<meta property="og:site_name"
      content="GHOTI MARKET">

<meta property="product:price:amount"
      content="${escapeAttr(String(product.price))}">

<meta property="product:price:currency"
      content="BDT">

<!-- Twitter -->

<meta name="twitter:card"
      content="summary_large_image">

<meta name="twitter:title"
      content="${escapeAttr(title)}">

<meta name="twitter:description"
      content="${escapeAttr(description)}">

<meta name="twitter:image"
      content="${escapeAttr(image)}">

</head>

<body>

<h1>${escapeHTML(product.name)}</h1>

<p>${escapeHTML(description)}</p>

<img
  src="${escapeAttr(image)}"
  alt="${escapeAttr(product.name)}"
  width="1200"
  height="630"
>

</body>
</html>`;
}


// =============================================================
// SELLER HTML
// =============================================================

function buildSellerHTML(seller, url, mainSite) {
  const title =
    `${seller.name} | GHOTI MARKET`;

  const description =
    truncate(
      stripHTML(seller.description),
      160
    );

  const image =
    seller.banner ||
    seller.logo ||
    DEFAULT_SELLER_IMAGE;

  const canonical =
    `${mainSite}${url.pathname}${url.search}`;

  return `<!DOCTYPE html>
<html lang="bn">
<head>

<meta charset="UTF-8">

<meta name="viewport"
      content="width=device-width, initial-scale=1.0">

<title>${escapeHTML(title)}</title>

<meta name="description"
      content="${escapeAttr(description)}">

<link rel="canonical"
      href="${escapeAttr(canonical)}">

<!-- Open Graph -->

<meta property="og:title"
      content="${escapeAttr(title)}">

<meta property="og:description"
      content="${escapeAttr(description)}">

<meta property="og:image"
      content="${escapeAttr(image)}">

<meta property="og:url"
      content="${escapeAttr(canonical)}">

<meta property="og:type"
      content="profile">

<meta property="og:site_name"
      content="GHOTI MARKET">

<!-- Twitter -->

<meta name="twitter:card"
      content="summary_large_image">

<meta name="twitter:title"
      content="${escapeAttr(title)}">

<meta name="twitter:description"
      content="${escapeAttr(description)}">

<meta name="twitter:image"
      content="${escapeAttr(image)}">

</head>

<body>

<h1>${escapeHTML(seller.name)}</h1>

<p>${escapeHTML(description)}</p>

<img
  src="${escapeAttr(image)}"
  alt="${escapeAttr(seller.name)}"
  width="1200"
  height="630"
>

</body>
</html>`;
}


// =============================================================
// FIRESTORE FIELD HELPERS
// =============================================================

function getString(field) {
  if (!field) return "";

  return (
    field.stringValue ??
    ""
  );
}


function getNumber(field) {
  if (!field) return "";

  if (field.integerValue !== undefined) {
    return field.integerValue;
  }

  if (field.doubleValue !== undefined) {
    return field.doubleValue;
  }

  return "";
}


function getBoolean(field, fallback = false) {
  if (!field) return fallback;

  if (field.booleanValue !== undefined) {
    return field.booleanValue;
  }

  return fallback;
}


function getFirstArrayString(field) {
  if (!field?.arrayValue?.values) {
    return "";
  }

  for (const item of field.arrayValue.values) {
    if (item?.stringValue) {
      return item.stringValue;
    }
  }

  return "";
}


// =============================================================
// SECURITY / STRING HELPERS
// =============================================================

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function escapeAttr(value) {
  return escapeHTML(value);
}


function stripHTML(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


function truncate(value, maxLength) {
  const text = String(value ?? "").trim();

  if (text.length <= maxLength) {
    return text;
  }

  return text.substring(0, maxLength - 3) + "...";
}


function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}


function cleanIdentifier(value) {
  return safeDecode(String(value ?? ""))
    .trim()
    .replace(/^@+/, "");
}


function formatPrice(value) {
  if (value === "" || value === null || value === undefined) {
    return "";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return String(value);
  }

  return number.toLocaleString("en-US");
}
