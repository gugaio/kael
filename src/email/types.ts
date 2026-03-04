export type InboundEmailAttachment = {
  kind: "image" | "audio";
  dataBase64: string;
  mimeType?: string;
  fileName?: string;
};

export type InboundEmailMessage = {
  id: string;
  from: string;
  fromEmail?: string;
  subject: string;
  date?: string;
  body: string;
  attachments?: InboundEmailAttachment[];
};

export interface EmailProvider {
  init(): Promise<void>;
  poll(): Promise<InboundEmailMessage[]>;
}

export interface EmailSender {
  sendReply(params: {
    original: InboundEmailMessage;
    replyText: string;
    attachments?: InboundEmailAttachment[];
  }): Promise<void>;
}
