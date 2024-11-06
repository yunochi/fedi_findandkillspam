import { printDebug, printMessage } from './utils';
import jsQR from 'jsqr';
import { Jimp } from 'jimp';
import fs from 'fs';
import { randomUUID } from 'crypto';
import axios from 'axios';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webp = require('webp-converter');
import * as config from '../config.json';
import { env } from 'process';

const NEW_ACCOUNT_THRESHOLD = 1000 * 60 * 60 * 24;
const ACCOUNT_TRUST_TIME = 1000 * 60 * 60 * 24 * 7;
const MANY_MENTIONS_THRESHOLD = 5;

export interface FediverseUser {
  userId: string;
  username: string;
  nickname: string | null;
  host: string | null;
  avatarExists: boolean;
  avatarUri: string | null;
  firstSeenAt: Date;
}

export interface FediverseFile {
  uri: string;
  blurHash: string | null;
}

export interface FediversePost {
  postId: string;
  text: string;
  user: FediverseUser;
  files: FediverseFile[];
  createdAt: Date;
  mentions: number;
  // in misskey: "public" | "home" | "followers" | "specified"
  visibility: 'public' | 'unlisted' | 'private' | 'direct';
}
type SpamCheck = {
  triggered: boolean;
  score: number;
};
export abstract class FediverseSpamInterceptor {
  abstract suspendUser(user: FediverseUser): void;
  abstract deletePost(post: FediversePost): void;
  constructor() {}

  imageChecker = new ImageChecker();

  public examinedPosts = 0;
  public async examinePost(post: FediversePost): Promise<void> {
    this.examinedPosts += 1;

    if (this.isUserTrusted(post.user) && env.NODE_ENV === 'production') {
      return;
    }

    const checks: Record<string, SpamCheck> = {};
    checks.userTrusted = { triggered: this.isUserTrusted(post.user), score: -5 };
    checks.isMention = { triggered: this.isMention(post), score: 1 };
    checks.nameAndAvatarEmpty = { triggered: this.checkUserNameAndImage(post.user), score: 1 };
    checks.newUser = { triggered: this.newUser(post.user), score: 1 };
    checks.hashTag = { triggered: this.hasHashTag(post), score: 1 };
    checks.manyMentions = { triggered: this.manyMentions(post), score: 2 };
    checks.badQr = { triggered: await this.badQrCodes(post), score: 3 };
    checks.badText = { triggered: this.checkText(post), score: 3 };

    let spamScore = 0;
    const reasons = [];
    for (const key in checks) {
      const check = checks[key];
      if (check.triggered) {
        spamScore += check.score;
        reasons.push(`${key} score: ${check.score}`);
      }
    }

    const shouldKill = spamScore >= 5;

    const reason_string = JSON.stringify(reasons);
    printDebug(`Post ${post.postId} Spam Score: ${spamScore}. reason: ${reason_string}`);

    if (shouldKill) {
      printMessage(
        `SPAM-KILLED: ${post.postId} from user ${post.user.username}@${post.user.host ?? 'THIS_SERVER'}.`,
        `Reason: Spam Score: ${spamScore}, ${reason_string}`,
      );
      printMessage(`Content: ${post.text.slice(0, 300).replaceAll('\n', '\\n')}`);
      this.deletePost(post);
      this.suspendUser(post.user);
    }
  }

  isUserTrusted(user: FediverseUser): boolean {
    const oldUser = user.firstSeenAt.getTime() <= Date.now() - ACCOUNT_TRUST_TIME;
    const emptyNameAndAvatar = this.checkUserNameAndImage(user);
    return oldUser && !emptyNameAndAvatar;
  }

  checkUserNameAndImage(user: FediverseUser): boolean {
    const aaa = !user.avatarExists;
    const bbb = !user.nickname || user.username == user.nickname;
    return aaa && bbb;
  }

  hasHashTag(post: FediversePost): boolean {
    return post.text.includes('#');
  }

  isMention(post: FediversePost): boolean {
    return post.mentions >= 1;
  }

  newUser(user: FediverseUser): boolean {
    return user.firstSeenAt.getTime() > Date.now() - NEW_ACCOUNT_THRESHOLD;
  }

  manyMentions(post: FediversePost): boolean {
    return post.mentions >= MANY_MENTIONS_THRESHOLD;
  }

  checkText(post: FediversePost): boolean {
    let match_count = 0;
    config.badPostTextRegex.forEach((re) => {
      const regex = new RegExp(re);
      if (regex.test(post.text)) {
        match_count += 3;
        printMessage(`Bad Text: ${post.text}`);
      }
    });
    return match_count !== 0;
  }

  async badQrCodes(post: FediversePost): Promise<boolean> {
    return await this.imageChecker.checkQrCode(post);
  }
}

class ImageChecker {
  private readonly tempDir = './tmp';
  constructor() {
    // Clean & recreate temp directory
    fs.promises
      .rm(this.tempDir, { recursive: true })
      .catch(() => {})
      .then(() => {
        fs.promises.mkdir(this.tempDir, { recursive: true });
      });
  }

  async checkQrCode(post: FediversePost): Promise<boolean> {
    if (post.files.length == 0) {
      return false;
    }

    const qrReads = await Promise.allSettled(
      post.files.map(async (file) => {
        let image;

        //WebP 는 Jimp 를 위해 변환해야함...
        if (file.uri.match(/(\.webp)/gi)) {
          const filePath = `${this.tempDir}/${randomUUID()}.webp`;

          try {
            //Download file
            await this.getFile(file.uri, `${filePath}`);

            // Convert the webp image to a readable format
            await webp.dwebp(`${filePath}`, `${filePath}.png`, '-o');
            // Read the newly created image
            image = await Jimp.read(`${filePath}.png`);
          } finally {
            // Delete the temporary files
            fs.unlink(`${filePath}`, () => {});
            fs.unlink(`${filePath}.png`, () => {});
          }
        } else {
          // read directly
          image = await Jimp.read(file.uri);
        }
        image.scaleToFit({ w: 1024, h: 1024 }).greyscale().normalize();

        const data = new Uint8ClampedArray(image.bitmap.data);
        const qr = jsQR(data, image.bitmap.width, image.bitmap.height, { inversionAttempts: 'attemptBoth' });

        if (!qr) {
          throw new Error(`QR decode Error!`);
        }
        return qr.data;
      }),
    );

    for (const qrRead of qrReads) {
      if (qrRead.status === 'fulfilled') {
        printMessage(`QR string: ${qrRead.value}`);
        for (const regex of config.badPostQrTextRegex) {
          const re = new RegExp(regex);
          if (re.test(qrRead.value)) {
            printMessage(`Bad QR: ${qrRead.value}`);
            return true;
          }
        }
      }
    }

    return false;
  }

  async getFile(uri: string, filePath: string): Promise<string> {
    return new Promise(async (resolve) => {
      // Get the webp image
      const response = await axios.get(uri, {
        responseType: 'stream',
      });

      // Create a stream at the temporary directory and load the data into it
      const fsFile = fs.createWriteStream(`${filePath}`);
      await response.data.pipe(fsFile);
      fsFile.on('finish', () => {
        resolve(filePath);
      });
    });
  }
}
