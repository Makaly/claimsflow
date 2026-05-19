export interface SendMessageOptions {
  to: string;
  body: string;
}

export interface WhatsAppAdapter {
  sendText(opts: SendMessageOptions): Promise<void>;
  sendImage(opts: SendMessageOptions & { imageUrl: string }): Promise<void>;
}
