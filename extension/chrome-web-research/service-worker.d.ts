type Msg = Record<string, unknown>;
type MsgResult = Record<string, unknown>;

export declare function handle(msg: Msg): Promise<MsgResult>;
export declare function handleReadPage(msg: Msg): Promise<MsgResult>;
export declare function handleReadPages(msg: Msg): Promise<MsgResult>;
export declare function handleGetStatus(msg: Msg): MsgResult;
export declare function handleRequestHostPermission(
  msg: Msg,
): Promise<MsgResult>;
export declare function handleReadCurrentTab(msg: Msg): MsgResult;
export declare function errorResponse(
  kind: string,
  message: string,
  requestId?: unknown,
  retryable?: boolean,
): MsgResult;
export declare function validateMessageSchema(msg: Msg): MsgResult | null;
export declare function validateOptionalMaxChars(value: unknown): string | null;
export declare const handlers: Record<string, (msg: Msg) => unknown>;
export declare const isAllowedSender: (sender: unknown) => boolean;
export declare const ALLOWED_ORIGINS: string[];
export declare const PROTOCOL_VERSION: number;
export declare const EXTENSION_VERSION: string;
