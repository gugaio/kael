export type InboundEmailMessage = {
  id: string;
  from: string;
  fromEmail?: string;
  subject: string;
  date?: string;
  body: string;
};

export interface EmailProvider {
  init(): Promise<void>;
  poll(): Promise<InboundEmailMessage[]>;
}

export interface EmailSender {
  sendReply(params: {
    original: InboundEmailMessage;
    replyText: string;
  }): Promise<void>;
}
