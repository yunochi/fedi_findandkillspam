import { FediversePost, FediverseSpamInterceptor, FediverseUser } from './interceptor_core';
import { printMessage, printError, countExternalMentions } from './utils';
let cfg: any = null;

async function mastoApi(method: string, endpoint: string, body: any) {
  const jsonBody = JSON.stringify(body);
  const url = cfg.default.Site.replace(/\/$/, '') + '/api/v1/' + endpoint;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.default.ApiKey}`,
  };

  const res = await fetch(url, {
    headers,
    body: jsonBody,
    method: method,
  });

  if (!res.ok) {
    printError(`API Request to ${endpoint} Failed:`, res.status);
    printError(`body:`, await res.text().catch((_) => '(failed to parse)'));
    return undefined;
  }

  const resJson = await res.json().catch((_) => undefined);
  return resJson;
}

async function mastoApiGet(endpoint: string) {
  const url = cfg.default.Site.replace(/\/$/, '') + '/api/v1/' + endpoint;
  const headers = {
    Authorization: `Bearer ${cfg.default.ApiKey}`,
  };

  const res = await fetch(url, {
    headers,
    method: 'GET',
  });

  if (!res.ok) {
    printError(`API Request to ${endpoint} Failed:`, res.status);
    printError(`body:`, await res.text().catch((_) => '(failed to parse)'));
    return undefined;
  }

  const resJson = await res.json().catch((_) => undefined);
  return resJson;
}

class MastodonSpamInterceptor extends FediverseSpamInterceptor {
  suspendUser(user: FediverseUser): void {
    printMessage('Suspended user', `${user.username}@${user.host ?? 'THIS_SERVER'}`);
    mastoApi('POST', `admin/accounts/${user.userId}/action`, {
      type: 'suspend',
      text: '(Automatic, fedi_findandkillspam) Spam detected',
      send_email_notification: false,
    });
  }

  deletePost(_post: FediversePost): void {
    printMessage('Mastodon does not support deleting post...');
  }
}

function getMentions(text: string, mentions: string[]): number {
  text = text.replaceAll(/(<br ?\/?>|<\/p>)/g, '\n') ?? '';
  text = text.replaceAll(/<[^>]*>/g, '') ?? '';

  return mentions.length + countExternalMentions(text);
}

function parseMastodonId(id: string): Date {
  return new Date(Number(BigInt(id) >> 16n));
}

function processToot(toot: any) {
  const fediPost: FediversePost = {
    createdAt: parseMastodonId(toot.id),
    files: toot.media_attachments.map((file: any) => {
      return {
        uri: file.url,
        blurHash: file.blurhash,
      };
    }),
    mentions: getMentions(toot.content ?? '', toot.mentions ?? []),
    postId: toot.id,
    text: toot.content ?? '',
    user: {
      userId: toot.account.id,
      firstSeenAt: parseMastodonId(toot.account.id),
      avatarExists: toot.account.avatar && !toot.account.avatar.endsWith('missing.png'),
      avatarUri: toot.account.avatar ?? null,
      host: toot.account.acct.split('@')[1] ?? null,
      nickname: toot.account.display_name || null,
      username: toot.account.username,
    },
    visibility: toot.visibility,
  };

  interceptor.examinePost(fediPost);
}

async function fetchToots(limit: number) {
  // Maximum limit is 40
  const toots: any[] | undefined = await mastoApiGet(`timelines/public?limit=${limit}`);

  if (toots === undefined) {
    return printError('Failed to fetch toots? got undefined response.');
  }

  toots.forEach(processToot);
}

const interceptor = new MastodonSpamInterceptor();

async function watch() {
  const wssBase = cfg.default.Site.replace(/\/$/, '').replace(/^https?:\/\//, 'wss://');
  const url = wssBase + `/api/v1/streaming?access_token=${cfg.default.ApiKey}&stream=public`;
  const socket = new WebSocket(url);

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', reject);
  });

  printMessage('Connected to WebSocket!');

  socket.addEventListener('message', (ev) => {
    let message: any = null;
    try {
      message = JSON.parse(ev.data);
    } catch (_) {
      return printError('Failed to parse WebSocket data as JSON:', ev.data);
    }

    const { event, payload } = message;
    if (event != 'update') {
      return;
    }

    let toot = null;
    try {
      toot = JSON.parse(payload);
    } catch (_) {
      return printError('Failed to parse payload as JSON:', payload);
    }

    processToot(toot);
  });

  socket.addEventListener('close', (ev) => {
    printError('Websocket Closed:', ev.code, ev.reason);
  });

  socket.addEventListener('error', (ev) => printError('Got Websocket error event:', ev));

  return socket;
}

export async function start(cfgModule: any) {
  cfg = cfgModule;

  printMessage('find_and_kill_spam (Mastodon) rev (+yunochi)');
  printMessage('Started!');

  let mainSocket = await watch();
  let lastExaminedPostCount = 0;

  // WS checker
  setInterval(async () => {
    if (mainSocket.readyState === WebSocket.CLOSED) {
      mainSocket = await watch();
    }
  }, 5 * 1000);

  // Status reporter
  setInterval(() => {
    printMessage('scanned', interceptor.examinedPosts - lastExaminedPostCount, 'toots.');
    lastExaminedPostCount = interceptor.examinedPosts;
  }, 10 * 1000);

  // Initial fetching
  fetchToots(40);

  // Refetch every 5 minutes
  setInterval(() => {
    fetchToots(40);
  }, 300 * 1000);
}
