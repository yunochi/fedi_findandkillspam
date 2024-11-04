import { env } from 'process';

function pad(num: number, amount = 2) {
  return num.toString().padStart(amount, '0');
}

function timeStamp() {
  const date = new Date();
  const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const msStr = `${pad(date.getMilliseconds(), 3)}`;
  return `[${dateStr} ${timeStr}.${msStr}] `;
}

export function printError(...params: any[]) {
  console.error('%c%s', 'color:red', timeStamp(), 'ERROR:', ...params);
}

export function printMessage(...params: any[]) {
  console.log('%c%s', 'color:lightgreen', timeStamp(), 'LOG:', ...params);
}

export function printDebug(...params: any[]) {
  if (env.NODE_ENV === 'production') return;
  console.info('%c%s', 'color:cyan', timeStamp(), 'DEBUG:', ...params);
}

export function countExternalMentions(text: string): number {
  text = ' ' + text;
  const mentions =
    text.match(/[ \n]@[a-zA-Z0-9_]+([a-zA-Z0-9_.-]+[a-zA-Z0-9_]+)?@[-a-zA-Z0-9._]{1,256}\.[-a-zA-Z0-9]{1,25}/g) ?? [];

  const uniqueMentions = new Set(mentions.map((v) => v.replace(/^[ \n]/, '')));
  return uniqueMentions.size;
}
