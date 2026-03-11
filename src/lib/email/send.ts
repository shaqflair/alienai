import { getResendClient, getFromAddress } from "./resend";

type SendEmailArgs = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  react?: any;
  replyTo?: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
};

export async function sendEmail(args: SendEmailArgs) {
  const resend = getResendClient();
  const from = getFromAddress();

  if (!args.to) throw new Error("sendEmail: 'to' is required");
  if (!args.subject) throw new Error("sendEmail: 'subject' is required");

  const payload: any = {
    from,
    to: args.to,
    subject: args.subject,
    reply_to: args.replyTo,
    headers: args.headers,
    tags: args.tags,
  };

  if (args.react) payload.react = args.react;
  else if (args.html) payload.html = args.html;
  else if (args.text) payload.text = args.text;
  else {
    throw new Error("sendEmail requires one of: react | html | text");
  }

  const { data, error } = await resend.emails.send(payload);

  if (error) {
    const status = (error as any)?.statusCode;
    throw new Error(
      `Resend error: ${error.name ?? "Error"} - ${error.message}${status ? ` (status ${status})` : ""}`
    );
  }

  return data; // contains message id
}
