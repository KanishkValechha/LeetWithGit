import { browser } from 'wxt/browser';
import type { RuntimeMessageInput } from '../types/messages';

export async function sendMessage(message: RuntimeMessageInput): Promise<void> {
  await browser.runtime.sendMessage(message);
}
