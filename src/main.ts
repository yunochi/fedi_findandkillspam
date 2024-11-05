import { printError, printMessage } from './utils';

export async function main(cfg: any) {
  printMessage('Initializing!');

  const isMisskey = cfg.default.Misskey;
  const isMastodon = cfg.default.Mastodon;

  if (isMisskey == isMastodon) {
    printError('Misskey and Maston is both set to', isMisskey, '!');
    printError('Please check your config.json file.');
    return;
  }

  if (!cfg.default.Site) {
    printError('Site URL is not set!');
    printError('Please check your config.json file.');
    return;
  }

  if (!cfg.default.ApiKey) {
    printError('API Key is not set!');
    printError('Please check your config.json file.');
    return;
  }

  let module: any = null;
  if (isMisskey) {
    module = await import('./misskey');
  } else {
    module = await import('./mastodon');
  }
  module.start(cfg);
}
