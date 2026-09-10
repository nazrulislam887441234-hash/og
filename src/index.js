export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const PROJECT_ID = "ghotimarket";
    const DEFAULT_IMAGE =
      "https://i.ibb.co/RG2hrf3y/background-remove-ghoti-market.png";

    /*
     * ============================================================
     * METHOD CHECK
     * ============================================================
     */

    if (request.method !== "GET" && request.method !== "HEAD") {
      return fetch(request);
    }

    /*
     * ============================================================
     * ONLY SOCIAL CRAWLERS / BOTS
     * ============================================================
     */

    const crawler = isSocialCrawler(request);

    /*
     * Normal browser/user:
     * Worker কিছু করবে না।
     */
    if (!crawler) {
      return fetch(request);
    }

    const pathname = url.pathname;
    const searchParams = url.searchParams;

    try {
      /*
       * ============================================================
       * PRODUCT PAGE
       * ============================================================
       */

      const productInfo = getProductSlug(pathname, searchParams);

      if (productInfo.isProductPage && productInfo.slug) {
        /*
         * যদি URL-এ -true না থাকে,
         * crawler-কে একবার -true URL-এ পাঠানো হবে।
         *
         * Example:
         *
         * ?tarimmer-vih72aiz
         *
         * ↓
         *
         * ?tarimmer-vih72aiz-true
         */

        if (!productInfo.isTrueUrl) {
          const redirectUrl = buildTrueUrl(url, productInfo);

          return new Response(null, {
            status: 302,
            headers: {
              Location: redirectUrl.toString(),
              "Cache-Control": "no-store",
            },
          });
        }

        /*
         * এখানে এসে -true URL।
         *
         * তাই আর redirect হবে না।
         *
         * getProductSlug() ইতিমধ্যে -true বাদ দিয়ে
         * আসল slug দিয়েছে।
         */

        const product = await getProductBySlug(productInfo.slug);

        if (product && product.active !== false) {
          const html = buildProductHTML(product, url);

          return new Response(
            request.method === "HEAD" ? null : html,
            {
              status: 200,
              headers: {
                "Content-Type": "text/html; charset=UTF-8",
                "Cache-Control":
                  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
                "X-Robots-Tag": "index, follow",
                "Vary": "User-Agent",
              },
            }
          );
        }
      }

      /*
       * ============================================================
       * SELLER PAGE
       * ============================================================
       */

      const sellerInfo = getSellerIdentifier(pathname, searchParams);

      if (sellerInfo.isSellerPage && sellerInfo.identifier) {
        /*
         * প্রথমবার:
         *
         * sellerId=abc
         *
         * ↓
         *
         * sellerId=abc-true
         *
         * এরপর আর redirect হবে না।
         */

        if (!sellerInfo.isTrueUrl) {
          const redirectUrl = buildTrueUrl(url, sellerInfo);

          return new Response(null, {
            status: 302,
            headers: {
              Location: redirectUrl.toString(),
              "Cache-Control": "no-store",
            },
          });
        }

        /*
         * -true বাদ দেওয়া আসল seller identifier
         */

        const seller = await getSeller(
          sellerInfo.identifier,
          sellerInfo.source
        );

        if (seller) {
          const html = buildSellerHTML(seller, url);

          return new Response(
            request.method === "HEAD" ? null : html,
            {
              status: 200,
              headers: {
                "Content-Type": "text/html; charset=UTF-8",
                "Cache-Control":
                  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
                "X-Robots-Tag": "index, follow",
                "Vary": "User-Agent",
              },
            }
          );
        }
      }
    } catch (error) {
      console.error(
        "GHOTI MARKET OG Worker Error:",
        error
      );
    }

    /*
     * কোনো data না পেলে original request-এ ফিরে যাবে।
     */

    return fetch(request);
  },
};


/*
 * ================================================================
 * SOCIAL CRAWLER DETECTION
 * ================================================================
 */

function isSocialCrawler(request) {
  const userAgent =
    request.headers.get("user-agent") || "";

  return /facebookexternalhit|Facebot|Twitterbot|Slackbot|TelegramBot|LinkedInBot|Discordbot|Pinterestbot|WhatsApp|SkypeUriPreview|Applebot|vkShare|Embedly|Quora Link Preview|outbrain|W3C_Validator|bot|crawler|spider|preview/i.test(
    userAgent
  );
}


/*
 * ================================================================
 * PRODUCT SLUG
 * ================================================================
 *
 * Supported:
 *
 * /product.html?tarimmer-vih72aiz
 *
 * /product.html?tarimmer-vih72aiz-true
 *
 * /product.html?product-slug=tarimmer-vih72aiz
 *
 * /product.html?product-slug=tarimmer-vih72aiz-true
 *
 * /product/tarimmer-vih72aiz
 *
 * /product/tarimmer-vih72aiz-true
 *
 * ================================================================
 */

function getProductSlug(pathname, searchParams) {
  const cleanPath = pathname
    .replace(/\/+/g, "/")
    .toLowerCase();

  const isProductPage =
    cleanPath === "/product" ||
    cleanPath === "/product/" ||
    cleanPath === "/product.html" ||
    cleanPath === "/product.html/" ||
    cleanPath.startsWith("/product/") ||
    cleanPath.startsWith("/product.html/");

  if (!isProductPage) {
    return {
      isProductPage: false,
      slug: null,
      isTrueUrl: false,
      source: null,
    };
  }

  /*
   * ------------------------------------------------------------
   * product-slug=
   * ------------------------------------------------------------
   */

  let slug =
    searchParams.get("product-slug") ||
    searchParams.get("slug");

  if (slug) {
    const decoded = safeDecode(slug).trim();

    const isTrueUrl = hasTrueSuffix(decoded);

    return {
      isProductPage: true,
      slug: removeTrueSuffix(decoded),
      isTrueUrl,
      source: "value",
      originalValue: slug,
    };
  }

  /*
   * ------------------------------------------------------------
   * PATH:
   *
   * /product/tarimmer-vih72aiz
   * ------------------------------------------------------------
   */

  const parts = pathname
    .replace(/\/+/g, "/")
    .split("/")
    .filter(Boolean);

  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];

    const lowerLastPart =
      lastPart.toLowerCase();

    if (
      lowerLastPart !== "product" &&
      lowerLastPart !== "product.html"
    ) {
      const decoded = safeDecode(lastPart).trim();

      const isTrueUrl = hasTrueSuffix(decoded);

      return {
        isProductPage: true,
        slug: removeTrueSuffix(decoded),
        isTrueUrl,
        source: "path",
      };
    }
  }

  /*
   * ------------------------------------------------------------
   * BARE QUERY:
   *
   * ?tarimmer-vih72aiz
   *
   * ?tarimmer-vih72aiz-true
   * ------------------------------------------------------------
   */

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
      const decodedKey =
        safeDecode(key).trim();

      const isTrueUrl =
        hasTrueSuffix(decodedKey);

      return {
        isProductPage: true,
        slug: removeTrueSuffix(decodedKey),
        isTrueUrl,
        source: "key",
        originalKey: key,
      };
    }
  }

  return {
    isProductPage: true,
    slug: null,
    isTrueUrl: false,
    source: null,
  };
}


/*
 * ================================================================
 * SELLER IDENTIFIER
 * ================================================================
 *
 * IMPORTANT:
 * /profile এবং /profile.html
 * এখন seller preview system-এর বাইরে রাখা হয়েছে।
 *
 * Supported:
 *
 * /seller?sellerId=abc
 * /seller?sellerId=abc-true
 *
 * /shop?sellerId=abc
 * /shop?sellerId=abc-true
 *
 * /seller?username=abc
 * /seller?username=abc-true
 *
 * /seller?@womenfashion
 * /seller?@womenfashion-true
 *
 * /seller/abc
 * /seller/abc-true
 *
 * ================================================================
 */

function getSellerIdentifier(pathname, searchParams) {
  const cleanPath = pathname
    .replace(/\/+/g, "/")
    .toLowerCase();

  const parts = cleanPath
    .split("/")
    .filter(Boolean);

  /*
   * ============================================================
   * PROFILE IS NOT A SELLER PREVIEW PAGE
   * ============================================================
   *
   * /profile
   * /profile/
   * /profile.html
   * /profile.html/
   * /profile/anything
   *
   * সবসময় Worker-এর seller preview system থেকে বাদ।
   * ============================================================
   */

  if (
    cleanPath === "/profile" ||
    cleanPath === "/profile/" ||
    cleanPath === "/profile.html" ||
    cleanPath === "/profile.html/" ||
    cleanPath.startsWith("/profile/") ||
    cleanPath.startsWith("/profile.html/")
  ) {
    return {
      isSellerPage: false,
      identifier: null,
      isTrueUrl: false,
      source: null,
    };
  }

  const sellerPaths = [
    "seller",
    "seller.html",
    "shop",
    "shop.html",
  ];

  const firstPart = parts[0] || "";

  if (!sellerPaths.includes(firstPart)) {
    return {
      isSellerPage: false,
      identifier: null,
      isTrueUrl: false,
      source: null,
    };
  }

  /*
   * ============================================================
   * sellerId=
   *
   * IMPORTANT:
   * sellerId হলে users collection-এর document ID খোঁজা হবে।
   * ============================================================
   */

  const sellerId =
    searchParams.get("sellerId");

  if (sellerId) {
    const decoded =
      safeDecode(sellerId).trim();

    const isTrueUrl =
      hasTrueSuffix(decoded);

    return {
      isSellerPage: true,
      identifier: cleanIdentifier(
        removeTrueSuffix(decoded)
      ),
      isTrueUrl,
      source: "sellerId",
      originalValue: sellerId,
    };
  }

  /*
   * ============================================================
   * username=
   *
   * username হলে users collection-এর
   * username field দিয়ে query হবে।
   * ============================================================
   */

  const username =
    searchParams.get("username") ||
    searchParams.get("sellerUsername");

  if (username) {
    const decoded =
      safeDecode(username).trim();

    const isTrueUrl =
      hasTrueSuffix(decoded);

    return {
      isSellerPage: true,
      identifier: cleanIdentifier(
        removeTrueSuffix(decoded)
      ),
      isTrueUrl,
      source: "username",
      originalValue: username,
    };
  }

  /*
   * ============================================================
   * PATH:
   *
   * /seller/abc
   * /shop/abc
   * ============================================================
   */

  if (parts.length >= 2) {
    const lastPart =
      parts[parts.length - 1];

    if (
      lastPart &&
      !sellerPaths.includes(lastPart)
    ) {
      const decoded =
        safeDecode(lastPart).trim();

      const isTrueUrl =
        hasTrueSuffix(decoded);

      return {
        isSellerPage: true,
        identifier: cleanIdentifier(
          removeTrueSuffix(decoded)
        ),
        isTrueUrl,
        source: "path",
      };
    }
  }

  /*
   * ============================================================
   * BARE QUERY:
   *
   * ?@womenfashion
   *
   * ?@womenfashion-true
   *
   * ============================================================
   */

  for (const [key, value] of searchParams.entries()) {
    const cleanKey =
      safeDecode(key).trim();

    const lowerKey =
      cleanKey.toLowerCase();

    if (
      lowerKey === "fbclid" ||
      lowerKey === "gclid" ||
      lowerKey.startsWith("utm_")
    ) {
      continue;
    }

    if (
      cleanKey.startsWith("@")
    ) {
      const isTrueUrl =
        hasTrueSuffix(cleanKey);

      return {
        isSellerPage: true,
        identifier: cleanIdentifier(
          removeTrueSuffix(cleanKey)
        ),
        isTrueUrl,
        source: "key",
        originalKey: key,
      };
    }

    if (value === "" && cleanKey) {
      const isTrueUrl =
        hasTrueSuffix(cleanKey);

      return {
        isSellerPage: true,
        identifier: cleanIdentifier(
          removeTrueSuffix(cleanKey)
        ),
        isTrueUrl,
        source: "key",
        originalKey: key,
      };
    }
  }

  return {
    isSellerPage: true,
    identifier: null,
    isTrueUrl: false,
    source: null,
  };
}


/*
 * ================================================================
 * BUILD -TRUE URL
 * ================================================================
 *
 * IMPORTANT:
 * Original URL-এর host 그대로 থাকবে।
 *
 * ghotimarket.com
 * অথবা
 * www.ghotimarket.com
 *
 * যেটা দিয়ে request আসবে সেটাই থাকবে।
 * ================================================================
 */

function buildTrueUrl(url, info) {
  const newUrl = new URL(url.toString());

  /*
   * PRODUCT VALUE
   *
   * ?product-slug=abc
   * →
   * ?product-slug=abc-true
   */

  if (
    info.source === "value" &&
    info.originalValue
  ) {
    if (
      newUrl.searchParams.has("product-slug")
    ) {
      const current =
        newUrl.searchParams.get("product-slug");

      newUrl.searchParams.set(
        "product-slug",
        addTrueSuffix(current)
      );
    } else if (
      newUrl.searchParams.has("slug")
    ) {
      const current =
        newUrl.searchParams.get("slug");

      newUrl.searchParams.set(
        "slug",
        addTrueSuffix(current)
      );
    }

    return newUrl;
  }

  /*
   * PRODUCT / SELLER PATH
   *
   * /product/abc
   * →
   * /product/abc-true
   *
   * /seller/abc
   * →
   * /seller/abc-true
   */

  if (info.source === "path") {
    const pathParts =
      newUrl.pathname
        .split("/")
        .filter(Boolean);

    if (pathParts.length > 0) {
      const lastIndex =
        pathParts.length - 1;

      pathParts[lastIndex] =
        addTrueSuffix(
          safeDecode(
            pathParts[lastIndex]
          )
        );

      newUrl.pathname =
        "/" + pathParts.join("/");
    }

    return newUrl;
  }

  /*
   * sellerId=
   */

  if (
    info.source === "sellerId" &&
    newUrl.searchParams.has("sellerId")
  ) {
    const current =
      newUrl.searchParams.get("sellerId");

    newUrl.searchParams.set(
      "sellerId",
      addTrueSuffix(current)
    );

    return newUrl;
  }

  /*
   * username=
   */

  if (
    info.source === "username"
  ) {
    if (
      newUrl.searchParams.has("username")
    ) {
      const current =
        newUrl.searchParams.get("username");

      newUrl.searchParams.set(
        "username",
        addTrueSuffix(current)
      );
    } else if (
      newUrl.searchParams.has("sellerUsername")
    ) {
      const current =
        newUrl.searchParams.get(
          "sellerUsername"
        );

      newUrl.searchParams.set(
        "sellerUsername",
        addTrueSuffix(current)
      );
    }

    return newUrl;
  }

  /*
   * Bare query key
   *
   * ?tarimmer-vih72aiz
   * →
   * ?tarimmer-vih72aiz-true
   *
   * ?@womenfashion
   * →
   * ?@womenfashion-true
   */

  if (
    info.source === "key" &&
    info.originalKey
  ) {
    const oldKey =
      info.originalKey;

    const newKey =
      addTrueSuffix(
        safeDecode(oldKey)
      );

    const params =
      new URLSearchParams();

    for (const [key, value] of newUrl.searchParams.entries()) {
      if (key === oldKey && value === "") {
        params.append(newKey, "");
      } else {
        params.append(key, value);
      }
    }

    newUrl.search =
      params.toString();

    return newUrl;
  }

  return newUrl;
}


/*
 * ================================================================
 * PRODUCT FIRESTORE
 * ================================================================
 */

async function getProductBySlug(slug) {
  try {
    const FIRESTORE_BASE =
      "https://firestore.googleapis.com/v1/projects/ghotimarket/databases/(default)/documents";

    const queryUrl =
      `${FIRESTORE_BASE.replace(
        "/documents",
        "/documents:runQuery"
      )}`;

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

    const response = await fetch(
      queryUrl,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      return null;
    }

    const result =
      await response.json();

    const document =
      result?.find(
        item =>
          item?.document?.fields
      )?.document;

    if (!document) {
      return null;
    }

    const fields =
      document.fields;

    return {
      name:
        getString(fields.name) ||
        "GHOTI MARKET Product",

      description:
        getString(
          fields.description
        ) ||
        "GHOTI MARKET থেকে সেরা দামে পণ্য কিনুন।",

      slug:
        getString(fields.slug) ||
        slug,

      price:
        getNumber(fields.price),

      oldPrice:
        getNumber(fields.oldPrice),

      image:
        getFirstArrayString(
          fields.images
        ) ||
        "https://i.ibb.co/RG2hrf3y/background-remove-ghoti-market.png",

      active:
        getBoolean(
          fields.active,
          true
        ),

      shopName:
        getString(
          fields.shopName
        ) ||
        "GHOTI MARKET Seller",
    };
  } catch (error) {
    console.error(
      "Product Firestore Error:",
      error
    );

    return null;
  }
}


/*
 * ================================================================
 * SELLER FIRESTORE
 * ================================================================
 *
 * sellerId:
 *     users/{sellerId}
 *
 * username:
 *     users collection
 *     where username == identifier
 *
 * ================================================================
 */

async function getSeller(identifier, source = null) {
  try {
    const FIRESTORE_BASE =
      "https://firestore.googleapis.com/v1/projects/ghotimarket/databases/(default)/documents";

    /*
     * ------------------------------------------------------------
     * 1. sellerId হলে সরাসরি users/{sellerId}
     * ------------------------------------------------------------
     */

    if (source === "sellerId") {
      const response =
        await fetch(
          `${FIRESTORE_BASE}/users/${encodeURIComponent(
            identifier
          )}`
        );

      const data =
        await response.json();

      if (data?.fields) {
        return normalizeSeller(
          data.fields,
          identifier
        );
      }

      return null;
    }

    /*
     * ------------------------------------------------------------
     * 2. username হলে users collection-এর username field
     * ------------------------------------------------------------
     */

    if (
      source === "username" ||
      source === "key"
    ) {
      return await getSellerByUsername(
        identifier
      );
    }

    /*
     * ------------------------------------------------------------
     * 3. PATH / fallback
     * ------------------------------------------------------------
     */

    let response =
      await fetch(
        `${FIRESTORE_BASE}/public_sellers/${encodeURIComponent(
          identifier
        )}`
      );

    let data =
      await response.json();

    if (data?.fields) {
      return normalizeSeller(
        data.fields,
        identifier
      );
    }

    /*
     * users/{identifier}
     */

    response =
      await fetch(
        `${FIRESTORE_BASE}/users/${encodeURIComponent(
          identifier
        )}`
      );

    data =
      await response.json();

    if (data?.fields) {
      return normalizeSeller(
        data.fields,
        identifier
      );
    }

    /*
     * username fallback
     */

    return await getSellerByUsername(
      identifier
    );
  } catch (error) {
    console.error(
      "Seller Firestore Error:",
      error
    );

    return null;
  }
}


/*
 * ================================================================
 * USERNAME SEARCH
 * ================================================================
 */

async function getSellerByUsername(
  username
) {
  try {
    const FIRESTORE_BASE =
      "https://firestore.googleapis.com/v1/projects/ghotimarket/databases/(default)/documents";

    const queryUrl =
      `${FIRESTORE_BASE.replace(
        "/documents",
        "/documents:runQuery"
      )}`;

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
              stringValue: username,
            },
          },
        },

        limit: 1,
      },
    };

    const response =
      await fetch(
        queryUrl,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify(body),
        }
      );

    if (!response.ok) {
      return null;
    }

    const result =
      await response.json();

    const document =
      result?.find(
        item =>
          item?.document?.fields
      )?.document;

    if (!document) {
      return null;
    }

    return normalizeSeller(
      document.fields,
      username
    );
  } catch (error) {
    console.error(
      "Username Search Error:",
      error
    );

    return null;
  }
}


/*
 * ================================================================
 * SELLER NORMALIZE
 * ================================================================
 */

function normalizeSeller(
  fields,
  identifier
) {
  const DEFAULT_IMAGE =
    "https://i.ibb.co/RG2hrf3y/background-remove-ghoti-market.png";

  return {
    identifier,

    name:
      getString(
        fields.shopName
      ) ||
      getString(
        fields.name
      ) ||
      "GHOTI MARKET Seller",

    description:
      getString(
        fields.shopDescription
      ) ||
      getString(
        fields.description
      ) ||
      "GHOTI MARKET-এ এই Seller-এর পণ্য দেখুন।",

    logo:
      getString(
        fields.shopLogo
      ) ||
      getString(
        fields.photoURL
      ) ||
      DEFAULT_IMAGE,

    banner:
      getString(
        fields.shopBanner
      ) ||
      getString(
        fields.banner
      ) ||
      getString(
        fields.shopLogo
      ) ||
      getString(
        fields.photoURL
      ) ||
      DEFAULT_IMAGE,

    username:
      getString(
        fields.username
      ) ||
      identifier,
  };
}


/*
 * ================================================================
 * PRODUCT OG HTML
 * ================================================================
 */

function buildProductHTML(
  product,
  url
) {
  const title =
    `${product.name} - ৳${formatPrice(
      product.price
    )} | GHOTI MARKET`;

  const description =
    truncate(
      stripHTML(
        product.description
      ),
      160
    );

  const image =
    product.image ||
    "https://i.ibb.co/RG2hrf3y/background-remove-ghoti-market.png";

  /*
   * Current request-এর exact host ব্যবহার হবে।
   *
   * www.ghotimarket.com
   * অথবা
   * ghotimarket.com
   */

  const canonical =
    url.toString();

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
content="${escapeAttr(
  String(product.price)
)}">

<meta property="product:price:currency"
content="BDT">

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

<h1>${escapeHTML(
    product.name
  )}</h1>

<p>${escapeHTML(
    description
  )}</p>

<img
src="${escapeAttr(image)}"
alt="${escapeAttr(product.name)}"
width="1200"
height="630">

</body>
</html>`;
}


/*
 * ================================================================
 * SELLER OG HTML
 * ================================================================
 */

function buildSellerHTML(
  seller,
  url
) {
  const title =
    `${seller.name} | GHOTI MARKET`;

  const description =
    truncate(
      stripHTML(
        seller.description
      ),
      160
    );

  const image =
    seller.banner ||
    seller.logo ||
    "https://i.ibb.co/RG2hrf3y/background-remove-ghoti-market.png";

  const canonical =
    url.toString();

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

<h1>${escapeHTML(
    seller.name
  )}</h1>

<p>${escapeHTML(
    description
  )}</p>

<img
src="${escapeAttr(image)}"
alt="${escapeAttr(seller.name)}"
width="1200"
height="630">

</body>
</html>`;
}


/*
 * ================================================================
 * TRUE SUFFIX HELPERS
 * ================================================================
 */

function hasTrueSuffix(value) {
  return /-true$/i.test(
    String(value ?? "").trim()
  );
}


function removeTrueSuffix(value) {
  return String(value ?? "")
    .trim()
    .replace(/-true$/i, "");
}


function addTrueSuffix(value) {
  const clean =
    String(value ?? "").trim();

  if (!clean) {
    return clean;
  }

  if (hasTrueSuffix(clean)) {
    return clean;
  }

  return `${clean}-true`;
}


/*
 * ================================================================
 * GENERAL HELPERS
 * ================================================================
 */

function getString(field) {
  return field?.stringValue ?? "";
}


function getNumber(field) {
  return (
    field?.integerValue ??
    field?.doubleValue ??
    ""
  );
}


function getBoolean(
  field,
  fallback = false
) {
  return (
    field?.booleanValue ??
    fallback
  );
}


function getFirstArrayString(field) {
  if (
    !field?.arrayValue?.values
  ) {
    return "";
  }

  for (
    const item of field.arrayValue.values
  ) {
    if (item?.stringValue) {
      return item.stringValue;
    }
  }

  return "";
}


function escapeHTML(value) {
  return String(value ?? "")
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#39;"
    );
}


function escapeAttr(value) {
  return escapeHTML(value);
}


function stripHTML(value) {
  return String(value ?? "")
    .replace(
      /<[^>]*>/g,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function truncate(
  value,
  maxLength
) {
  const text =
    String(value ?? "").trim();

  if (
    text.length <= maxLength
  ) {
    return text;
  }

  return (
    text.substring(
      0,
      maxLength - 3
    ) + "..."
  );
}


function safeDecode(value) {
  try {
    return decodeURIComponent(
      value
    );
  } catch {
    return value;
  }
}


function cleanIdentifier(value) {
  return safeDecode(
    String(value ?? "")
  )
    .trim()
    .replace(/^@+/, "");
}


function formatPrice(value) {
  if (
    value === "" ||
    value === null ||
    value === undefined
  ) {
    return "";
  }

  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return String(value);
  }

  return number.toLocaleString(
    "en-US"
  );
}
