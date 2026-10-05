import type { MetadataRoute } from "next";

/**
 * Keep the whole site out of search engines. It pairs real names with roasts
 * written for a private league; nobody outside the group chat should find it
 * by searching a manager's name. The robots meta tag (root layout) and the
 * X-Robots-Tag header (next.config.ts) say the same thing to crawlers that
 * ignore this file.
 *
 * The one exception is link previews: the bots that fetch a page to draw its
 * card when a link is pasted into iMessage, Slack, Discord, X and friends.
 * They don't index anything (and the noindex tags still apply), but several of
 * them honour robots.txt, and blocking them would leave every link the league
 * shares as a bare URL. iMessage identifies as facebookexternalhit/Twitterbot.
 */
const LINK_PREVIEW_BOTS = [
  "facebookexternalhit",
  "Facebot",
  "Twitterbot",
  "Slackbot-LinkExpanding",
  "Discordbot",
  "WhatsApp",
  "TelegramBot",
  "LinkedInBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: LINK_PREVIEW_BOTS, allow: "/" },
      { userAgent: "*", disallow: "/" },
    ],
  };
}
