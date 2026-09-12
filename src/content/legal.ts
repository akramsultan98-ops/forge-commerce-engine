// Legal page templates. These are sensible starting points written for FORGE's actual behaviour —
// they are NOT legal advice. Have them reviewed for your jurisdiction before going live.

export type LegalDoc = "privacy" | "terms" | "cookies" | "returns" | "affiliate-disclosure";

export const LEGAL_UPDATED = "2026-09-12";

export const LEGAL: Record<LegalDoc, { title: string; sections: Array<{ h: string; p: string[] }> }> = {
  privacy: {
    title: "Privacy policy",
    sections: [
      { h: "What we collect", p: ["Page views and clicks on this site: the page, the link clicked, the campaign parameters in the URL (utm_*), the referring site, a coarse device type and — when provided by our hosting provider — your country.", "IP addresses are never stored in readable form: we keep a keyed hash so we can filter abuse and bots.", "If you accept analytics cookies, a random visitor identifier is stored in a first-party cookie so repeat visits aren't double-counted. If you decline, no identifier is set.", "If you subscribe to product alerts, we store your email address, language and the date you consented."] },
      { h: "What we don't do", p: ["We don't use third-party advertising trackers, sell personal data, or build advertising profiles.", "We don't write or display fake reviews, and we don't show fabricated urgency or scarcity."] },
      { h: "Purchases", p: ["When you click through to a merchant, the merchant's own privacy policy applies to your purchase. Affiliate networks may tell us that a purchase happened and the commission earned; they do not share your name or address with us."] },
      { h: "Your rights", p: ["You can ask us to access, correct or delete your data, or unsubscribe from alerts at any time, using the contact address on this site."] },
      { h: "Retention", p: ["Analytics events are kept for up to 25 months; subscriber data until you unsubscribe."] },
    ],
  },
  terms: {
    title: "Terms of use",
    sections: [
      { h: "About FORGE", p: ["FORGE publishes product research and links to products sold by third-party merchants or our store partners. Each product page says who sells it."] },
      { h: "Information on this site", p: ["Scores, trends and estimates are editorial analysis based on the data we hold, and each metric is labelled with its source (live data, estimate, AI inference, operator input or demo data). They are not guarantees of quality, availability or price.", "Prices and availability are shown as of our last check. The merchant's checkout is the final authority on price, shipping, taxes and stock."] },
      { h: "Purchases from merchants", p: ["Purchases made through links on this site are contracts between you and the merchant. Their terms, warranties and return policies apply."] },
      { h: "Acceptable use", p: ["Don't attempt to disrupt the site, scrape it at scale, or misuse tracked links."] },
    ],
  },
  cookies: {
    title: "Cookie policy",
    sections: [
      { h: "Strictly necessary", p: ["forge_locale and forge_currency remember your language and currency. forge_consent remembers your cookie choice. Operator sign-in uses a secure, httpOnly session cookie that is only set in the admin area."] },
      { h: "Analytics (optional)", p: ["forge_vid is a random identifier used only to count unique visitors and keep A/B-test variants consistent. It is set only after you click “Allow” and removed if you decline."] },
      { h: "No third-party cookies", p: ["FORGE itself sets no advertising or third-party tracking cookies. Merchants you visit after clicking a link may set their own cookies (for example, to credit an affiliate referral) under their own policies."] },
    ],
  },
  returns: {
    title: "Returns & refunds",
    sections: [
      { h: "Products sold by merchants", p: ["Most products on FORGE are sold and shipped by the merchant you check out with. Their return window, condition requirements and refund timelines apply — please check them before ordering."] },
      { h: "Products sold through our store partners", p: ["Where a product is sold through a FORGE store partner, the returns policy shown at that checkout applies. Shipping times shown on FORGE are supplier estimates."] },
      { h: "Need help?", p: ["Contact the merchant first; if you can't resolve an issue, contact us and we'll help where we can — and we'll stop featuring merchants that don't honour their policies."] },
    ],
  },
  "affiliate-disclosure": {
    title: "Affiliate disclosure",
    sections: [
      { h: "How FORGE makes money", p: ["Some links on FORGE are affiliate links. If you buy through one, we may earn a commission from the merchant — at no extra cost to you."] },
      { h: "What it doesn't change", p: ["Commissions never change a product's score or what we say about it. Products are ranked by FORGE's scoring engine, and every score shows its reasoning and data sources.", "We don't accept payment for placement, and we never publish fake reviews or testimonials."] },
      { h: "Sponsored content", p: ["Social posts that link to products with an affiliate relationship are labelled as ads or affiliate content according to each platform's rules."] },
    ],
  },
};
