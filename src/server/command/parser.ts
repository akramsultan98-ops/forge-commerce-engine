// Rule-based natural-language command parser for the AI Command Center. Deterministic and free;
// the executor only falls back to an AI intent model when these rules return UNKNOWN.

import type { ParsedIntent } from "../ai/schemas";

const PLATFORMS: Array<[RegExp, string]> = [
  [/\btik ?tok\b/, "TIKTOK"],
  [/\b(instagram|reels?|insta)\b/, "INSTAGRAM"],
  [/\b(youtube|shorts?)\b/, "YOUTUBE"],
  [/\b(pinterest|pins?)\b/, "PINTEREST"],
  [/\bfacebook\b/, "FACEBOOK"],
  [/\b(twitter|x\.com|on x)\b/, "X"],
];

function cleanRef(s: string | undefined | null): string | null {
  if (!s) return null;
  const out = s
    .replace(/[.?!]+$/g, "")
    .replace(/^(the|a|an|product|products)\s+/i, "")
    .replace(/\s+(on|for)\s+(tiktok|instagram|youtube|pinterest|facebook|x)$/i, "")
    .trim();
  return out.length >= 2 ? out.slice(0, 120) : null;
}

export function extractProductRef(text: string): string | null {
  const quoted = text.match(/["“'‘]([^"”'’]{2,80})["”'’]/);
  if (quoted) return cleanRef(quoted[1]);
  const why = text.match(/why (?:did|is|does|has|was)\s+(.+?)\s+(?:fail|flop|underperform|not\b|failing|struggl|die|tank)/i);
  if (why) return cleanRef(why[1]);
  const forX = text.match(/\b(?:for|about|of)\s+(.+?)\s*[.?!]*$/i);
  if (forX) return cleanRef(forX[1]);
  const launch = text.match(/\b(?:launch|test|start testing)\s+(.+?)\s*[.?!]*$/i);
  if (launch) return cleanRef(launch[1]);
  return null;
}

export function parseCommand(input: string): ParsedIntent {
  const text = input.trim().slice(0, 500);
  const lower = text.toLowerCase();
  const out: ParsedIntent = { intent: "UNKNOWN", productQuery: null, limit: null, maxPrice: null, platform: null, traits: [] };
  if (!text || /^(help|\?|what can you do|commands)\b/.test(lower)) return { ...out, intent: "HELP" };

  const price = lower.match(/(?:under|below|less than|cheaper than|up to|max(?:imum)?|<)\s*\$?\s*(\d+(?:\.\d+)?)/);
  if (price) out.maxPrice = Number(price[1]);
  const withoutPrice = price ? lower.replace(price[0], " ") : lower;
  const limit = withoutPrice.match(/\b(\d{1,3})\b/);
  if (limit) out.limit = Math.min(Number(limit[1]), 100);
  for (const [re, p] of PLATFORMS) {
    if (re.test(lower)) {
      out.platform = p;
      break;
    }
  }
  if (/tik ?tok|video|viral|short-form|reels?|shorts|demonstrat/.test(lower)) out.traits.push("content");
  if (/problem|solv|fix/.test(lower)) out.traits.push("problem");
  if (/impulse/.test(lower)) out.traits.push("impulse");
  if (/margin|profit/.test(lower)) out.traits.push("margin");
  if (/trend|rising|growing|momentum/.test(lower)) out.traits.push("trend");
  if (/low competition|less competition|uncrowded/.test(lower)) out.traits.push("low_competition");

  if (/\bwhy (did|is|does|has|was)\b.*\b(fail|flop|underperform|not (work|sell|convert)|failing|struggl|die|tank)/.test(lower) || /^explain\b/.test(lower)) {
    return { ...out, intent: "EXPLAIN_PRODUCT", productQuery: extractProductRef(text) };
  }
  if (/\b(landing page|lp|sales page|product page)\b/.test(lower) && /\b(create|build|make|generate|write|new)\b/.test(lower)) {
    return { ...out, intent: "CREATE_LANDING_PAGE", productQuery: extractProductRef(text) };
  }
  if (/\b(generate|create|write|give me|make|draft|come up with)\b/.test(lower) && /\b(ideas?|scripts?|videos?|concepts?|content|hooks?|posts?|pins?|reels?|shorts?|captions?|carousels?)\b/.test(lower)) {
    return { ...out, intent: "GENERATE_CONTENT", productQuery: extractProductRef(text), limit: out.limit ?? 10, platform: out.platform ?? "TIKTOK" };
  }
  if (/\b(launch|test kit|launch kit|start (a )?test|start testing)\b/.test(lower)) {
    return { ...out, intent: "LAUNCH_TEST", productQuery: extractProductRef(text) };
  }
  if (/\b(which|what)\b.*\bscale\b|\bscale\b.*\?$|\bready to scale\b/.test(lower)) return { ...out, intent: "WHICH_TO_SCALE" };
  if (/\b(which|what)\b.*\bkill\b|\bshould i kill\b|\bdrop\b.*\bproducts?\b/.test(lower)) return { ...out, intent: "WHICH_TO_KILL" };
  if (/(high|lots of|strong|good) (traffic|clicks|visits).*(low|poor|weak|bad|no) (conversion|sales|conversions)|clicks but no (sales|conversions)|traffic but (low|poor|weak|no) conversion/.test(lower)) {
    return { ...out, intent: "HIGH_TRAFFIC_LOW_CONVERSION" };
  }
  if (/(rising|growing|increasing|trending) (demand|interest).*(low|less|weak) competition|(low|less) competition.*(rising|growing|increasing) (demand|interest)/.test(lower)) {
    return { ...out, intent: "RISING_DEMAND_LOW_COMPETITION" };
  }
  if (/\b(run|start)\b.*\bdiscovery\b|\bdiscover new\b|\bfind new products\b/.test(lower)) return { ...out, intent: "RUN_DISCOVERY" };
  if (/\b(best|top|highest[- ]scoring|strongest)\b.*\bproducts?\b|\btop \d+\b/.test(lower)) return { ...out, intent: "TOP_PRODUCTS", limit: out.limit ?? 5 };
  if (/\b(find|show|search|list|get|give)\b.*\bproducts?\b|\bproducts? (under|below|with)\b/.test(lower)) return { ...out, intent: "FIND_PRODUCTS", limit: out.limit ?? 10 };
  return out;
}

export const COMMAND_EXAMPLES = [
  "Find me 10 products under $30 with strong TikTok potential.",
  "Show me the best 5 products this week.",
  "Why did Car Seat Gap Filler fail?",
  "Create a landing page for Silicone Stretch Lids.",
  "Generate 20 TikTok ideas for Electric Fabric Shaver.",
  "Which product should I scale?",
  "Which product should I kill?",
  "Show me products with high traffic but low conversion.",
  "Find products with rising demand and low competition.",
  "Launch a test for Mini Thermal Label Printer.",
];
