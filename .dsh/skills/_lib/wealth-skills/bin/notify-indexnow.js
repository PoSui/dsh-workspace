#!/usr/bin/env node

/**
 * Notifies IndexNow (https://www.indexnow.org) that the published pages changed, so Bing, Yandex and
 * the engines that use their results recrawl them. Run after a deploy; the key file it names is
 * published by bin/build-site.js.
 *
 *   node bin/notify-indexnow.js [--dry-run]
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { SITE_URL, INDEXNOW_KEY, buildSitemap } from './build-site.js';

const ENDPOINT = 'https://api.indexnow.org/indexnow';

export function indexNowRequest() {
  const site = new URL(SITE_URL);
  return {
    host: site.host,
    key: INDEXNOW_KEY,
    // The key file lives under the project path, which scopes the notification to URLs under it.
    keyLocation: `${SITE_URL}${INDEXNOW_KEY}.txt`,
    // Taken from the sitemap, so a page added to the site is announced without touching this file.
    urlList: [...buildSitemap().matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])
  };
}

async function notify() {
  const body = indexNowRequest();
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  // 200 and 202 both mean accepted; 202 means the key is still being verified.
  console.log(`IndexNow responded ${response.status} ${response.statusText}`);
  if (response.status !== 200 && response.status !== 202) process.exitCode = 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  notify().catch((err) => {
    console.error(`IndexNow notification failed: ${err.message}`);
    process.exitCode = 1;
  });
}
