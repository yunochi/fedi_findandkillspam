import { FediversePost, FediverseSpamInterceptor, FediverseUser } from './interceptor_core';
import { printMessage, printError, countExternalMentions, printDebug } from './utils';
import WebSocket from 'ws';
let cfg: any = null;

const MISSKEY_STATUS_429 = Symbol();
async function mkApi(endpoint: string, body: any, except429 = false) {
  body = {
    i: cfg.default.ApiKey.replaceAll(/[' ]/g, ''),
    ...body,
  };

  const jsonBody = JSON.stringify(body);
  const url = cfg.default.Site.replace(/\/$/, '') + '/api/' + endpoint;
  const headers = { 'Content-Type': 'application/json' };
  const res = await fetch(url, {
    headers,
    body: jsonBody,
    method: 'POST',
  });

  if (!res.ok) {
    if (except429 && res.status == 429) {
      return MISSKEY_STATUS_429;
    }
    printError(`API Request to ${endpoint} Failed:`, res.status);
    printError(`body:`, await res.text().catch(() => '(failed to parse)'));
    return undefined;
  }

  const resJson = await res.json().catch(() => undefined);
  return resJson;
}

class MisskeyApiRequester {
  static deleteQueue: string[] = [];
  static lastLimit = new Date(0);

  static requestSuspend(user: FediverseUser) {
    // admin/suspend-user does not have rate limiting?
    printMessage('Suspend user', `${user.username}@${user.host ?? 'THIS_SERVER'}`);
    mkApi('admin/suspend-user', { userId: user.userId });
  }

  static requestDelete(post: FediversePost) {
    // notes/delete does have a rate limiting
    this.deleteQueue.push(post.postId);
    this.processQueue();
  }

  static async processQueue() {
    if (this.lastLimit.getTime() > Date.now() - 1000) {
      // Sleep a second between processing
      return;
    }

    const postId = this.deleteQueue.shift();
    if (postId == undefined) {
      return;
    }

    const result = await mkApi('notes/delete', { noteId: postId }, true);

    if (result == MISSKEY_STATUS_429) {
      // Retry
      printError(`Rate limit excedded deleting note ${postId} (429), Trying again...`);
      this.lastLimit = new Date();
      this.deleteQueue.unshift(postId);
    } else {
      printMessage(`Deleted note ${postId}`);
    }
  }

  static start() {
    setInterval(() => this.processQueue(), 1500);
  }
}

class MisskeySpamInterceptor extends FediverseSpamInterceptor {
  suspendUser(user: FediverseUser): void {
    if (!cfg.default.Misskey_ShouldBanUser) {
      return;
    }
    MisskeyApiRequester.requestSuspend(user);
  }

  deletePost(post: FediversePost): void {
    MisskeyApiRequester.requestDelete(post);
  }
}

function parseAidx(id: string): Date {
  const TIME2000 = 946684800000;
  const TIME_LENGTH = 8;
  const time = parseInt(id.slice(0, TIME_LENGTH), 36) + TIME2000;
  return new Date(time);
}

const interceptor = new MisskeySpamInterceptor();

function processNote(note: any) {
  if (note.renote) {
    return;
  }
  if (cfg.__Peeping_Tom === true) {
    // ONLY FOR DEBUG. Use with caution
    printDebug('Note:', note);
  }

  // Interface
  const fediPost: FediversePost = {
    createdAt: new Date(note.createdAt),
    files: note.files?.map((file: any) => {
      return {
        uri: file.url,
        blurHash: file.blurhash,
      };
    }),
    mentions: countExternalMentions(note.text ?? ''),
    postId: note.id,
    text: note.text ?? '',
    user: {
      userId: note.user.id,
      firstSeenAt: parseAidx(note.user.id),
      avatarExists: !!note.user.avatarBlurhash,
      avatarUri: note.user.avatarUrl ?? null,
      host: note.user.host,
      nickname: note.user.name,
      username: note.user.username,
    },
    visibility: note.visibility,
  };

  interceptor.examinePost(fediPost);
}

async function fetchNotes(limit: number) {
  const notes: Array<Record<string, any>> | undefined = await mkApi('notes/global-timeline', {
    withRenotes: false,
    limit: limit,
  });

  if (notes === undefined) {
    printError('Fetch failed?! Got undefined response.');
    return;
  }

  notes.forEach(processNote);
}

async function connect() {
  const wssBase = cfg.default.Site.replace(/\/$/, '').replace(/^https?:\/\//, 'wss://');
  const url = wssBase + `/streaming?i=${cfg.default.ApiKey}`;
  const wsChannelName = cfg.default.Misskey_StreamName ? cfg.default.Misskey_StreamName : 'globalTimeline';
  printMessage(`Use channel ${wsChannelName}`);
  const socket = new WebSocket(url);

  const onMessage = (data: any) => {
    let message: any = null;

    try {
      message = JSON.parse(data.toString());
    } catch {
      return printError('Failed to parse WebSocket data as JSON:', data);
    }

    const {
      body: { type, body: note },
    } = message;
    if (type != 'note') {
      return;
    }
    processNote(note);
  };

  socket.on('error', (err) => printError('Got Websocket error event:', err));
  socket.on('close', (code: number) => {
    printError(`Websocket Disconnected: Code: ${code}}`);
  });
  socket.on('open', () => {
    printMessage('Connected to WebSocket!');
    socket.on('message', onMessage);
    socket.send(
      JSON.stringify({
        type: 'connect',
        body: {
          channel: wsChannelName,
          id: '1',
        },
      }),
    );
  });

  return socket;
}

async function watch() {
  let ping_counter = 0;
  const onPong = () => {
    ping_counter = 0;
  };
  const socketWatch = async () => {
    if (socket.readyState === socket.OPEN) {
      socket.ping();
      ping_counter += 1;
    }
    if (socket.readyState !== socket.OPEN || ping_counter > 3) {
      if (socket.readyState === socket.OPEN) {
        printError(`Websocket ping timeout. close socket`);
        socket.close();
      }
      if (socket.readyState === socket.CLOSED) {
        clearTimeout(interval);
        printMessage('Reconnecting Websocket...');
        socket = await connect();
        socket.on('pong', onPong);
        interval = setInterval(socketWatch, 3000);
      }
    }
  };

  let socket = await connect();
  socket.on('pong', onPong);
  let interval = setInterval(socketWatch, 3000);
}

export async function start(cfgModule: any) {
  cfg = cfgModule;

  printMessage('find_and_kill_spam (Misskey) (+yunochi)');
  printMessage('Started!');

  MisskeyApiRequester.start();
  await watch();
  let lastExaminedPostCount = 0;

  // Status reporter
  setInterval(() => {
    printMessage('scanned', interceptor.examinedPosts - lastExaminedPostCount, 'notes.');
    lastExaminedPostCount = interceptor.examinedPosts;
  }, 60 * 1000);

  // Initial fetching
  fetchNotes(100);

  // Refetch every 5 minutes
  setInterval(() => {
    fetchNotes(100);
  }, 300 * 1000);
}
